(function () {
    "use strict";
    var lodash = require('lodash');
    var unicode = require('./unicode');
    var STATE = require('./state');
    var TOKEN = require('./token');
    var id = function (obj) {
        return obj | 0;
    };
    /**
     * Scans an JavaScript and output array of tokens. Token format is either an object whose valueOf is a TOKEN ID, or
     * just a number representing TOKEN ID.
     *
     * *HTML-Comment: This scanner scans for javascript text within HTML data. Inside that we are allowed to have HTML
     * comments between <!-- and -->. Be warned that those DO NOT WORK as expected. HTML comments within javascript are
     * added for compatibility of browser not capable of executing javascript, when that script is in the body of the
     * HTML. Without an HTML comment, the source of javascript code will be shown on the page, with a comment it will
     * be ignored, but a browser knowing how to execute javascript will still execute it.
     * The policy for HTML comment is
     * <!-- (threat only that line as a comment (e.g. single line comment)
     * (Here goes executable javascript code)
     * -->
     * The --> closing can only be preceded by whitespace, --> preceded with anything else will be treated as
     * [DECREMENT_OPERATOR, LESS_THAN_OPERATOR] tokens.
     * This makes it possible to include in the body of the HTML:
     * <script><!--
     * //Javascript code
     * --></script>
     * Which if browser is incapable of parsing the JS code, will result as an Comment node inside Element node with
     * name "script". For those capable of parsing, it will be a <script> node containing javascript code within its
     * innerHTML (NOT THE nodeValue, as the nodeValue will expand the entity references).
     * @type {Function}
     */
    /* TODO:
     1. Integrate two types of queues.
     TokenQueue: Ability to change the writing token from the output (a simple array or stream) to a token.
     StateQueue: Ability to enter a state.
     2. Queues have particular functionality of "returning" or "history".
     Integrate transitions:
     Entry transitions will be actions that occur on state on entering/switching a state.
     Exit transitions will be actions that occur on state exit.
     Concrete transition will be actions that occur of switching between specified pair of states.
     Same action could be specified for array of transitions (or pair of transition in concrete cases).
     3. Integrate reversal queue, that must aggregate information for reversal in specified stages. It can be
     named a transaction. For example:
     "<!--" begins a single-line comment in javascript (multi-line HTML comment for browsers not recognizing JS).
     "<!a" is valid sequences of operators mistakenly turned into HTML comment start (at "a" character is too
     late to input < and ! operators. The same would happen for invalid escape sequences in strings. Therefore
     the reverse queue can be discarded (equal to transaction commit) or reversed (equal to transaction reject).
     4. Optionally implement state tagging: somehow to categorize the states to ease transitions.
     5. Implement a contextual data layer with global, token and state context. This data layer can be used to
     store data required for scanner other than the state, the input data and the current token. For example
     "start of line" is a flag that affects recognition of HTMLCommentClose sequence.
     6. Provide some way to "return" the resulting token from the called state to the caller state. This could be
     used in some way for actions on transition. For example the "new line" state should generate "\r\n", "\r" or
     "\n" containing token and somehow return it to caller token for output.
     7. A mechanism (which is already used in this code), must be provided for switching state (set or enter)
     without consuming the incoming character.
     8. A mechanism (which is already used in this code), must be provided to track line, columns and character
     index incoming (this is independent from file index, which depends on encoding bytes).
     9. The scanner must run linearly to be fed with characters with external source. For example:

     +--------+     +-----------------+     +---------+     +--------+
     | Reader | --> | CharacterStream | --> | Scanner | --> | Parser |
     +--------+     +-----------------+     +---------+     +--------+

     Reader: reads a data from various sources (FileSystem, Network (HTTP, FTP), etc.)
     CharacterStream: decodes (and encodes) binary data with specific encoding. In some cases, encoding is known
     by the reader (HTTP protocol for example), and in some cases guesses needs to be done.
     Scanner: Scan the input of unicode characters (independent of the encoding) and makes a tokens. Does not
     yield syntax errors, instead have "T_ILLEGAL" token. Input is linear forward stream of characters, output is
     linear forward stream of tokens.
     Parser: Attempting to make sense of the list of tokens. Input is linear forward stream of tokens. Output is
     an AST (Abstract Syntax Tree) of the code. Each node of the tree obey specific set of rules. If that rules
     are not followed by the tokens, syntax error is yield.
     T_WHITESPACE and all kinds of comments can be skipped by the Scanner, but, due to usage in editor, this must
     be an option.
     T_WHITESPACE, all kind of comments and some T_LINE_TERMINATOR can be skipped by parser.
     10. Optionally use states as direct references to actions instead of switching them like:
     while(!complete) { this._stateActionMap[this._getState()](character); }
     This will avoid static switch, allowing live state modification.
     */
    var Scanner = module.exports = function flop_Scanner() {
        if (!(this instanceof Scanner)) {
            var instance = Object.create(Scanner.prototype);
            Scanner.apply(instance, arguments);
            return instance;
        }
        this._output = [];
        this._tokenQueue = [this._output];
        this._stateQueue = [id(STATE.DEFAULT)];
        this._forbiddenStates = [];
        this._isWhitespace = false;
        this._startOfLine = true;
        this._transactionQueue = [];
        this._stateEnterActionMap = {};
        this._stateLeaveActionMap = {};
        this._stateTransitionActionMap = {};
        this._context = {};
    };

    Scanner.DIRECTION = {
        STATIONARY: 0,
        CHARACTER: 1,
        LINE: 2
    };

    Scanner.prototype.advance = function () {
        this._location = {
            line: 1,
            column: 1,
            index: 0
        };
        this._direction = Scanner.DIRECTION.CHARACTER;
        this.advance = function () {
            switch (this._direction) {
                case Scanner.DIRECTION.CHARACTER:
                    ++this._location.column;
                    break;
                case Scanner.DIRECTION.LINE:
                    ++this._location.line;
                    this._location.column = 1;
                    this._direction = Scanner.DIRECTION.CHARACTER;
                    this._startOfLine = true;
                    break;
                case Scanner.DIRECTION.STATIONARY:
                    break;
                default:
                    return;
            }
            ++this._location.index;
        };
    };

    Scanner.prototype.set = function (key, value) {
        this._context[key] = value;
    };

    Scanner.prototype.get = function (key, def) {
        return this.has(key) ? this._context[key] : def;
    };

    Scanner.prototype.has = function (key) {
        return this._context.hasOwnProperty(key);
    };

    Scanner.prototype.delete = function (key) {
        return delete this._context[key];
    };

    Scanner.prototype.startTransaction = function () {
        this._transactionQueue.push({
            stateQueue: this._stateQueue.slice(0),
            location: lodash.clone(this._location),
            direction: this._direction,
            context: lodash.clone(this._context)
        });
        return this;
    };

    Scanner.prototype.commit = function () {
        if (this._transactionQueue.length <= 0) {
            throw new RangeError('Cannot commit: not in transaction.');
        }
        this._transactionQueue.pop();
        return this;
    };

    Scanner.prototype.reject = function () {
        if (this._transactionQueue.length <= 0) {
            throw new RangeError('Cannot reject: not in transaction.');
        }
        var data = this._transactionQueue.pop();
        this._stateQueue = data.stateQueue;
        this._location = data.location;
        this._direction = data.direction;
        this._context = data.context;
        return this;
    };

    Scanner.prototype.getState = function () {
        return this._stateQueue[this._stateQueue.length - 1];
    };

    Scanner.prototype.setState = function (state) {
        this._stateQueue[this._stateQueue.length - 1] = id(state);
        return this;
    };

    Scanner.prototype.enterState = function (state) {
        this._stateQueue.push(id(state));
        return this;
    };

    Scanner.prototype.leaveState = function () {
        if (this._stateQueue.length <= 1) {
            throw new RangeError('Cannot exit the last state: scanner must have at least one state.');
        }
        this._stateQueue.pop();
        return this;
    };

    Scanner.prototype.callToken = function (token) {
        if (this._tokenQueue.indexOf(token) >= 0) {
            throw new ReferenceError('Cannot enter token: token already into the queue.');
        }
        this._tokenQueue.push(token);
        return this;
    };

    Scanner.prototype.signalToken = function (token) {
        this.getCurrentToken().push(token);
        return this;
    };

    Scanner.prototype.returnToken = function () {
        if (this._tokenQueue.length <= 1) {
            throw new RangeError('Cannot exit the last token: scanner must have output token to write to.');
        }
        var lastToken = this._tokenQueue.pop();
        this.getCurrentToken().push(lastToken);
        return this;
    };

    Scanner.prototype.discardToken = function () {
        if (this._tokenQueue.length <= 1) {
            throw new RangeError('Cannot exit the last token: scanner must have output token to write to.');
        }
        this._tokenQueue.pop();
        return this;
    };

    Scanner.prototype.getCurrentToken = function () {
        return this._tokenQueue[this._tokenQueue.length - 1];
    };

    Scanner.prototype.isolate = function (isolator) {
        return isolator.call(this);
    };

    Scanner.prototype.scan = function (character) {
        this.advance();
        if (!this.get('last_character_is_whitespace', true)) {
            this.set('only_whitespace_from_start_of_line', true);
        }
        this.set('last_character_is_whitespace', false);
        var needClarification;
        do {
            needClarification = false;
            switch (this.getState()) {
                case id(STATE.DEFAULT):
                    switch (character) {
                        case 13: //\r
                            this.set('last_character_is_whitespace', true);
                            this.enterState(STATE.MAC_NEW_LINE);
                            this.isolate(function () {
                                var token = new Scanner.ContentToken(TOKEN.NEW_LINE);
                                token.push(character);
                                this.callToken(token);
                            });
                            break;
                        //noinspection FallThroughInSwitchStatementJS
                        case 10:
                        case 0x2028:
                        case 0x2029:
                            this.set('last_character_is_whitespace', true);
                            this._direction = Scanner.DIRECTION.LINE;
                            this.isolate(function () {
                                var token = new Scanner.ContentToken(TOKEN.NEW_LINE);
                                token.push(character);
                                this.signalToken(token);
                            });
                            break;
                        case 39: //'
                        case 34: //"
                            this.isolate(function () {
                                var token = new Scanner.ContentToken(TOKEN.STRING);
                                token._openCharacter = character;
                                this.callToken(token);
                                this.enterState(STATE.STRING);
                            });
                            break;
                        case 47: // / //Possibly starts single-line or multi-line comment sequences.
                            this.set('last_character_is_whitespace', true);
                            this.enterState(STATE.DIVIDE);
                            break;
                        case 60: //< //Possibly starts HTML comment sequence
                            this.set('last_character_is_whitespace', true);
                            this.enterState(STATE.LESS_THAN);
                            break;
                        case 45: //- //Possible starts HTML comment close sequence
                            this.set('last_character_is_whitespace', true);
                            this.enterState(STATE.MINUS);
                            break;
                        default:
                            if (unicode.isWhitespace(character)) {
                                this.set('last_character_is_whitespace', true);
                                this.callToken(new Scanner.ContentToken(TOKEN.WHITESPACE));
                                this.enterState(STATE.WHITESPACE);
                                this.getCurrentToken().push(character);
                            } else {
                                this.enterState(-1);
                                this.isolate(function () {
                                    var token = new Scanner.ContentToken(TOKEN.ILLEGAL);
                                    token.push(character);
                                    this.callToken(token);
                                });
                            }
                            break;
                    }
                    break;
                case id(STATE.WHITESPACE):
                    if (unicode.isWhitespace(character)) {
                        this.set('last_character_is_whitespace', true);
                        this.getCurrentToken().push(character);
                    } else {
                        this.returnToken();
                        this.leaveState();
                        needClarification = true;
                    }
                    break;
                case id(STATE.MAC_NEW_LINE):
                    switch (character) {
                        case 10:
                            this.set('last_character_is_whitespace', true);
                            this._direction = Scanner.DIRECTION.STATIONARY;
                            this.getCurrentToken().push(character);
                            break;
                        default:
                            needClarification = true;
                            break;
                    }
                    this.returnToken();
                    this.leaveState();
                    break;
                case -1: //TODO: Remove that impl, because only used for testing...
                    switch (character) {
                        case 13:
                        case 10:
                        case 0x2028:
                        case 0x2029:
                            this.returnToken();
                            this.leaveState();
                            needClarification = true;
                            break;
                        default:
                            this.getCurrentToken().push(character);
                            break;
                    }
                    break;
                case id(STATE.COMMENT.SINGLE_LINE):
                    if (unicode.isNewLine(character)) {
                        this.returnToken();
                        this.leaveState();
                        needClarification = true;
                    } else {
                        this.set('last_character_is_whitespace', true);
                        this.getCurrentToken().push(character);
                    }
                    break;
                case id(STATE.COMMENT.MULTI_LINE):
                    switch (character) {
                        case 42: //*
                            this.set('last_character_is_whitespace', true);
                            this.setState(STATE.COMMENT.MULTI_LINE.ASTERISKS);
                            break;
                        default:
                            this.set('last_character_is_whitespace', true);
                            this.getCurrentToken().push(character);
                            break;
                    }
                    break;
                case id(STATE.COMMENT.MULTI_LINE.ASTERISKS):
                    this.set('last_character_is_whitespace', true);
                    switch (character) {
                        case 47: // /
                            this.returnToken();
                            this.leaveState();
                            break;
                        default:
                            this.getCurrentToken().push(42);
                            this.setState(STATE.COMMENT.MULTI_LINE);
                            needClarification = true;
                            break;
                    }
                    break;
                case id(STATE.HTML_COMMENT):
                    switch (character) {
                        case 13:
                        case 10:
                        case 0x2028:
                        case 0x2029:
                            this.returnToken();
                            this.leaveState();
                            needClarification = true;
                            break;
                        default:
                            this.set('last_character_is_whitespace', true);
                            this.getCurrentToken().push(character);
                            break;
                    }
                    break;
                case id(STATE.HTML_COMMENT.DASH1):
                    switch (character) {
                        case 45:
                            this.set('last_character_is_whitespace', true);
                            this.setState(STATE.HTML_COMMENT.DASH2);
                            break;
                        default:
                            this.reject();
                            this.set('html_comment_is_forbidden', true);
                            this.scan(60);
                            this.scan(33);
                            needClarification = true;
                            break;
                    }
                    break;
                case id(STATE.HTML_COMMENT.DASH2):
                    switch (character) {
                        case 45:
                            this.set('last_character_is_whitespace', true);
                            this.callToken(new Scanner.ContentToken(TOKEN.HTML_COMMENT));
                            this.setState(STATE.HTML_COMMENT);
                            break;
                        default:
                            this.reject();
                            this.set('html_comment_is_forbidden', true);
                            this.scan(60);
                            this.scan(33);
                            this.scan(45);
                            needClarification = true;
                            break;
                    }
                    break;
                case id(STATE.LESS_THAN):
                    switch (character) {
                        case 60: //<
                            this.setState(STATE.SHIFT_LEFT);
                            break;
                        case 61: //=
                            this.signalToken(new Scanner.Token(TOKEN.LESS_THAN_OR_EQUAL));
                            this.leaveState();
                            break;
                        case 33: //!
                            if (this.isolate(function () {
                                    var isHTMLCommentAllowed = !this.get('html_comment_is_forbidden', false);
                                    if (isHTMLCommentAllowed) {
                                        this.startTransaction();
                                        this.set('last_character_is_whitespace', true);
                                        this.setState(STATE.HTML_COMMENT.DASH1);
                                    } else {
                                        this.set('html_comment_is_forbidden', false);
                                    }
                                    return isHTMLCommentAllowed;
                                })) {
                                break;
                            }
                        //noinspection FallThroughInSwitchStatementJS
                        default:
                            this.signalToken(new Scanner.Token(TOKEN.LESS_THAN));
                            this.leaveState();
                            needClarification = true;
                            break;
                    }
                    break;
                case id(STATE.GREATER_THAN):
                    switch (character) {
                        case 62: //>
                            this.setState(STATE.SHIFT_RIGHT);
                            break;
                        case 61: //=
                            this.signalToken(new Scanner.Token(TOKEN.GREATER_THAN_OR_EQUAL));
                            this.leaveState();
                            break;
                        default:
                            this.signalToken(new Scanner.Token(TOKEN.GREATER_THAN));
                            this.leaveState();
                            needClarification = true;
                            break;
                    }
                    break;
                case id(STATE.SHIFT_LEFT):
                    switch (character) {
                        case 61:
                            this.signalToken(new Scanner.Token(TOKEN.SHIFT_LEFT_AND_ASSIGN));
                            this.leaveState();
                            break;
                        default:
                            this.signalToken(new Scanner.Token(TOKEN.SHIFT_LEFT));
                            this.leaveState();
                            needClarification = true;
                            break;
                    }
                    break;
                case id(STATE.SHIFT_RIGHT):
                    switch (character) {
                        case 62: //>
                            this.setState(STATE.SHIFT_RIGHT_LOGICAL);
                            break;
                        case 61: //=
                            this.signalToken(new Scanner.Token(TOKEN.SHIFT_RIGHT_AND_ASSIGN));
                            this.leaveState();
                            break;
                        default:
                            this.signalToken(new Scanner.Token(TOKEN.SHIFT_RIGHT));
                            this.leaveState();
                            needClarification = true;
                            break;
                    }
                    break;
                case id(STATE.SHIFT_RIGHT_LOGICAL):
                    switch (character) {
                        case 61:
                            this.signalToken(new Scanner.Token(TOKEN.SHIFT_RIGHT_LOGICAL_AND_ASSIGN));
                            this.leaveState();
                            break;
                        default:
                            this.signalToken(new Scanner.Token(TOKEN.SHIFT_RIGHT_LOGICAL));
                            this.leaveState();
                            needClarification = true;
                            break;
                    }
                    break;
                case id(STATE.MINUS):
                    switch (character) {
                        case 45: //-
                            this.setState(STATE.MINUS.DOUBLE);
                            break;
                        default:
                            this.setState(-1);
                            this.callToken(new Scanner.ContentToken(TOKEN.ILLEGAL));
                            needClarification = true;
                            break;
                    }
                    break;
                case id(STATE.MINUS.DOUBLE):
                    switch (character) {
                        case 62: //>
                            if (this.isolate(function () {
                                    if (this.get('only_whitespace_from_start_of_line', true)) {
                                        this.signalToken(new Scanner.Token(TOKEN.HTML_COMMENT_END));
                                        this.leaveState();
                                        return true;
                                    }
                                    return false;
                                })) {
                                break;
                            }
                        //noinspection FallThroughInSwitchStatementJS
                        default:
                            this.signalToken(new Scanner.Token(TOKEN.DECREMENT));
                            this.leaveState();
                            needClarification = true;
                            break;
                    }
                    break;
                case id(STATE.DIVIDE):
                    //Scanner must remain leaner sequencer, which means we cannot know if TOKEN.DIVIDE is expected.
                    //And if not expected, this might be start of valid RegExp.
                    //Since we keep all source characters, parse can scan through the tokens to see if regular
                    // expression is expected.
                    //At this point we write "TOKEN.DIV" and possibly get some strange token following that, as:
                    //TOKEN.IDENTIFIER, TOKEN.KEYWORD, TOKEN.BRACKET.OPEN, TOKEN.BRACKET.CLOSE, etc.
                    switch (character) {
                        case 47: // / //Single-line comment (comments are whitespace ...)
                            this.set('last_character_is_whitespace', true);
                            this.setState(STATE.COMMENT.SINGLE_LINE);
                            this.callToken(new Scanner.ContentToken(TOKEN.COMMENT.SINGLE_LINE));
                            break;
                        case 42: // * //Multi-line comment (comments are whitespace ...)
                            this.set('last_character_is_whitespace', true);
                            this.setState(STATE.COMMENT.MULTI_LINE);
                            this.callToken(new Scanner.ContentToken(TOKEN.COMMENT.MULTI_LINE));
                            break;
                        case 61: //=
                            this.signalToken(new Scanner.Token(TOKEN.DIVIDE_ASSIGN));
                            this.leaveState();
                            break;
                        default:
                            this.signalToken(new Scanner.Token(TOKEN.DIVIDE));
                            this.leaveState();
                            needClarification = true;
                            break;
                    }
                    break;
                case id(STATE.STRING):
                    if (character == 92) {
                        this.callToken(new ContentToken(TOKEN.ESCAPE_SEQUENCE));
                        this.enterState(STATE.STRING.ESCAPE_SEQUENCE);
                    } else if (unicode.isNewLine(character) || character <= 0) {
                        //This codes are invalid inside string.
                        //Since this is a code we can do a shortcut to "switch" already aggregated information in
                        //STRING token to an ILLEGAL token (just change its ID).
                        //Note that scanning may continue, but parsing never expects ILLEGAL token to appear anywhere.
                        //This means result of scanning will never ever be accepted in this case.
                        this.getCurrentToken()._id = TOKEN.ILLEGAL;
                        this.leaveState();
                        this.returnToken();
                        needClarification = true;
                    } else {
                        this.getCurrentToken().push(character);
                    }
                    break;
                case id(STATE.STRING.ESCAPE_SEQUENCE):
                    switch (character) {
                        case 13:
                            this.getCurrentToken().push(character);
                            this.getCurrentToken()._id = TOKEN.ESCAPE_SEQUENCE.NEW_LINE;
                            this.setState(STATE.MAC_NEW_LINE);
                            break;
                        case 10:
                        case 0x2028:
                        case 0x2029:
                            this.getCurrentToken().push(character);
                            this.getCurrentToken()._id = TOKEN.ESCAPE_SEQUENCE.NEW_LINE;
                            this.returnToken();
                            this.leaveState();
                            break;
                        case 39: //'
                            this.getCurrentToken().push(character);
                            this.getCurrentToken()._id = TOKEN.ESCAPE_SEQUENCE.SINGLE_QUOTES;
                            this.returnToken();
                            this.leaveState();
                            break;
                        case 34: //"
                            this.getCurrentToken().push(character);
                            this.getCurrentToken()._id = TOKEN.ESCAPE_SEQUENCE.DOUBLE_QUOTES;
                            this.returnToken();
                            this.leaveState();
                            break;
                        case 39:
                            this.getCurrentToken().push(character);
                            this.getCurrentToken()._id = TOKEN.ESCAPE_SEQUENCE.SINGLE_QUOTES;
                            this.returnToken();
                            this.leaveState();
                            break;
                    }
                    break;
            }
        } while (needClarification);
    };

    Scanner.Token = function (id) {
        this._id = id;
    };

    Scanner.ContentToken = function (id) {
        Scanner.Token.apply(this, arguments);
        this._content = [];
    };

    Scanner.SyntaxError = function SyntaxError(message) {
        this.message = message;
        this._stack = (new Error).stack.split('\n').slice(2).join('\n');
        this.stack = this.toString() + '\n' + this._stack;
    };

    Scanner.StateError = function StateError(message) {
        this.message = message;
        this._stack = (new Error).stack.split('\n').slice(2).join('\n');
        this.stack = this.toString() + '\n' + this._stack;
    };

    Scanner.prototype._syntaxError = function (message, character) {
        var err = new Scanner.SyntaxError(message);
        err.character = character != null ? character : null;
        err.index = this._inputIndex;
        err.line = this._inputLine;
        err.column = this._inputColumn;
        err.scanner = this;
        return err;
    };

    Scanner.Token.prototype.valueOf = function () {
        return this._id;
    };

    Scanner.ContentToken.prototype = Object.create(Scanner.Token.prototype);

    Scanner.ContentToken.prototype.push = function (character) {
        this._content.push(character);
    };

    Scanner.SyntaxError.prototype = Object.create(Error.prototype);

    Scanner.StateError.prototype = Object.create(Error.prototype);

    Scanner.SyntaxError.prototype.toString =
        Scanner.StateError.prototype.toString = function () {
            return this.constructor.name + (this.message ? ': ' + this.message : '');
        };
})();