(function () {
    "use strict";
    var unicode = require('./unicode');
    var STATE = require('./state');
    var TOKEN = require('./token');
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
    var Scanner = module.exports = function flop_Scanner() {
        if (!(this instanceof Scanner)) {
            var instance = Object.create(Scanner.prototype);
            Scanner.apply(instance, arguments);
            return instance;
        }
        this._source = source;
        this._tokenOutput = [];
        this._atStartOfLine = true;
        this._inputIndex = 0;
        this._inputLine = 1;
        this._inputColumn = 1;
        this._state = [STATE.DEFAULT];
        this._token = null;
    };

    Scanner.Token = function (id) {
        this._id = id | 0;
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

    Scanner.prototype._getState = function () {
        return this._state[this._state.length - 1];
    };

    Scanner.prototype._setState = function (state) {
        if (state == null || parseInt(state) !== parseFloat(state)) {
            throw new TypeError('Invalid state given.');
        }
        this._state[this._state.length - 1] = state | 0;
    };

    Scanner.prototype._enterState = function (state) {
        if (state == null || parseInt(state) !== parseFloat(state)) {
            throw new TypeError('Invalid state given.');
        }
        this._state.push(state | 0);
    };

    Scanner.prototype._exitState = function (state) {
        if (state == null || parseInt(state) !== parseFloat(state)) {
            throw new TypeError('Invalid state given.');
        }
        state |= 0;
        var oldState = this._state.pop();
        if (oldState !== state && this._state.length === 0) {
            throw new Error('TODO: Throw parse error in scanner, reporting position, last state: ' + oldState + '.');
        }
    };

    Scanner.prototype._applyStartPositionToToken = function (token) {
        token._startIndex = this._inputIndex;
        token._startLine = this._inputLine;
        token._startColumn = this._inputColumn;
    };

    Scanner.prototype._createToken = function (id) {
        var token = new Scanner.Token(id);
        this._applyStartPositionToToken(token);
        return token;
    };

    Scanner.prototype._createContentToken = function (id) {
        var token = new Scanner.ContentToken(id);
        this._applyStartPositionToToken(token);
        return token;
    };

    Scanner.prototype._outputToken = function (id) {
        this._output(this._createToken(id));
    };

    Scanner.prototype._output = function (token) {
        this._tokenOutput.push(token);
    };

    Scanner.prototype._syntaxError = function(message, character) {
        var err = new Scanner.SyntaxError(message);
        err.character = character != null ? character : null;
        err.index = this._inputIndex;
        err.line = this._inputLine;
        err.column = this._inputColumn;
        err.scanner = this;
        return err;
    };

    Scanner.prototype.scan = function (character) {
        var complete = false, self = this, isWhiteSpaceCharacter = false;
        var done = function () {
            ++this._inputColumn;
            if(!isWhiteSpaceCharacter) {
                this._atStartOfLine = false;
            }
            complete = true;
        };
        var newLine = function () {
            this._atStartOfLine = true;
            this._inputColumn = 1;
            ++this._inputLine;
        };
        while (!complete) {
            switch (this._getState()) {
                case STATE.DEFAULT:
                    switch (character) {
                        case 13: //\r
                            this._enterState(STATE.MAC_NEW_LINE);
                            this._token = this._createContentToken(TOKEN.NEW_LINE);
                            this._token.append(character);
                            done();
                            break;
                        case 10: //\n, Line separator, Paragraph separator
                        case 0x2028:
                        case 0x2029:
                            (function () {
                                var token = this._createContentToken(TOKEN.NEW_LINE);
                                token.append(character);
                                this._output(token);
                                newLine();
                                complete = true;
                            }).call(this);
                            break;
                        case 34: //"
                        case 39: //'
                            this._enterState(STATE.STRING.OPEN);
                            break;
                        case 60: //< //Includes <, <=, <<, <<=, <!-- (See *html-comment section).
                            this._enterState(STATE.LESS_THAN);
                            done();
                            break;
                        case 62: //> //Includes >, >=, >>, >>>, >>=, >>>=
                            this._enterState(STATE.GREATER_THAN);
                            done();
                            break;
                        case 61: //= //Includes =, ==, ===
                            this._enterState(STATE.EQUAL);
                            done();
                            break;
                        case 33: //! //Includes !, !=, !==
                            this._enterState(STATE.LOGICAL_NOT);
                            done();
                            break;
                        case 43: //+ //Includes +, ++, +=
                            this._enterState(STATE.PLUS);
                            done();
                            break;
                        case 45: //- //Includes -, --, -=, --> (See *html-comment section)
                            this._enterState(STATE.MINUS);
                            done();
                            break;
                        case 42: //* //Includes *, *=
                            this._enterState(STATE.MULTIPLY);
                            done();
                            break;
                        case 37: //% //Includes %, %=
                            this._enterState(STATE.REMINDER);
                            done();
                            break;
                        case 47: /// //Includes /, /=, /*, //
                            this._enterState(STATE.DIVIDE);
                            done();
                            break;
                        case 38: //& //Includes &, &&, &=
                            this._enterState(STATE.BITWISE_AND);
                            done();
                            break;
                        case 124: //| //Includes |, ||, |=
                            this._enterState(STATE.BITWISE_OR);
                            done();
                            break;
                        case 94: //^ //Includes ^, ^=
                            this._enterState(STATE.BITWISE_XOR);
                            done();
                            break;
                        case 46: //. //Includes ., .(number)
                            this._enterState(STATE.DOT);
                            done();
                            break;
                        case 58: //:
                            this._outputToken(TOKEN.COLON);
                            done();
                            break;
                        case 59: //;
                            this._outputToken(TOKEN.SEMICOLON);
                            done();
                            break;
                        case 44: //,
                            this._outputToken(TOKEN.COMMA);
                            done();
                            break;
                        case 40: //(
                            this._outputToken(TOKEN.LPAREN);
                            done();
                            break;
                        case 41: //(
                            this._outputToken(TOKEN.RPAREN);
                            done();
                            break;
                        case 91: //[
                            this._outputToken(TOKEN.LBRACK);
                            done();
                            break;
                        case 93: //]
                            this._outputToken(TOKEN.RBRACK);
                            done();
                            break;
                        case 123: //{
                            this._outputToken(TOKEN.LBRACE);
                            done();
                            break;
                        case 125: //}
                            this._outputToken(TOKEN.RBRACE);
                            done();
                            break;
                        case 63: //?
                            this._outputToken(TOKEN.CONDITIONAL);
                            done();
                            break;
                        case 126: //~
                            this._outputToken(TOKEN.BIT_NOT);
                            done();
                            break;
                        case 92: //\
                            this._enterState(STATE.IDENTIFIER.ESCAPE_SEQUENCE);
                            done();
                            break;
                        default:
                            if (unicode.isIdStart(character)) {
                                this._enterState(STATE.IDENTIFIER);
                            } else if (unicode.isDecimalDigit(character)) {
                                this._enterState(STATE.NUMBER);
                            } else if(unicode.isWhitespace(character)) {
                                isWhiteSpaceCharacter = true;
                                this._token = this._createContentToken(TOKEN.WHITESPACE);
                                this._token.append(character);
                                this._enterState(STATE.WHITESPACE);
                                done();
                            } else {
                                throw this._syntaxError('Illegal character', character);
                            }
                    }
                    break;
                case STATE.MAC_NEW_LINE:
                    switch(character) {
                        case 10: //\n
                            this._token.append(character);
                            complete = true;
                        //noinspection FallThroughInSwitchStatementJS
                        default:
                            this._output(this._token);
                            this._exitState(STATE.MAC_NEW_LINE);
                            newLine();
                    }
                    break;
                case STATE.LESS_THAN:
                    switch(character) {
                        case 60: //< //Includes <<, <<=
                            this._setState(STATE.SHIFT_LEFT);
                            done();
                            break;
                        case 61: //= //Includes <=
                            this._outputToken(TOKEN.LESS_THAN_OR_EQUAL);
                            done();
                            break;
                        case 33: //! //Includes <!--
                            this._token = this._createContentToken(TOKEN.HTML_COMMENT);
                            this._token.append(60);
                            this._token.append(character);
                            this._setState(STATE.HTML_COMMENT.DASH1);
                            done();
                            break;
                        default:
                            this._outputToken(TOKEN.LESS_THAN);
                            this._exitState(STATE.LESS_THAN);
                            break;
                    }
            }
        }
        ++this._inputIndex;
        //In case of result === 0, doScan has updated the position (e.g. in case of new line). We should do nothing.
    };

    Scanner.Token.prototype.valueOf = function () {
        return this._id;
    };

    Scanner.ContentToken.prototype = Object.create(Scanner.Token.prototype);

    Scanner.ContentToken.append = function (character) {
        this._content.push(character);
    };

    Scanner.SyntaxError.prototype = Object.create(Error.prototype);

    Scanner.SyntaxError.prototype.toString = function() {
        return this._constructor.name + (this.message ? ': ' + this.message : '');
    };
})();