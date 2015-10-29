Scanner.prototype.scan = function (character) {
    var complete = false, self = this, isWhiteSpaceCharacter = false;
    var done = function () {
        ++this._inputColumn;
        if (!isWhiteSpaceCharacter) {
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
                        this._token.push(character);
                        done();
                        break;
                    case 10: //\n, Line separator, Paragraph separator
                    case 0x2028:
                    case 0x2029:
                        (function () {
                            var token = this._createContentToken(TOKEN.NEW_LINE);
                            token.push(character);
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
                    case 42: //!* //Includes *, *=
                        this._enterState(STATE.MULTIPLY);
                        done();
                        break;
                    case 37: //% //Includes %, %=
                        this._enterState(STATE.REMINDER);
                        done();
                        break;
                    case 47: /// //Includes /, /=, /!*, //
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
                        } else if (unicode.isWhitespace(character)) {
                            isWhiteSpaceCharacter = true;
                            this._token = this._createContentToken(TOKEN.WHITESPACE);
                            this._token.push(character);
                            this._enterState(STATE.WHITESPACE);
                            done();
                        } else {
                            throw this._syntaxError('Illegal character', character);
                        }
                }
                break;
            case STATE.MAC_NEW_LINE:
                switch (character) {
                    case 10: //\n
                        this._token.push(character);
                        complete = true;
                    //noinspection FallThroughInSwitchStatementJS
                    default:
                        this._output(this._token);
                        this._exitState(STATE.MAC_NEW_LINE);
                        newLine();
                }
                break;
            case STATE.HTML_COMMENT:
                switch(character) {
                    case 13: //\r
                        this._exitState(STATE.HTML_COMMENT);
                        this._exitToken(this._token);
                        this._enterState(STATE.MAC_NEW_LINE);
                        this._token = this._createContentToken(TOKEN.NEW_LINE);
                        this._token.push(character);
                        done();
                        break;
                    case 10: //\n, Line separator, Paragraph separator
                    case 0x2028:
                    case 0x2029:
                        this._exitState(STATE.HTML_COMMENT);
                        this._exitToken(this._token);
                        (function () {
                            var token = this._createContentToken(TOKEN.NEW_LINE);
                            token.push(character);
                            this._output(token);
                            newLine();
                            complete = true;
                        }).call(this);
                        break;
                    default:
                        this._output(character);
                }
                break;
            case STATE.HTML_COMMENT.DASH1:
                switch (character) {
                    case 45: //-
                        this._setState(STATE.HTML_COMMENT.DASH2);
                        done();
                        break;
                    default:
                        //Now here is the first problem:
                        //Code like this if(a<!a) { ... }
                        //It looks like <! are beginning of <!-- but they are not.
                        //We must correct the state, but a<!=a is syntax error, that must be caught by parser, not scanner.
                        //Therefore we re-execute:
                        //1. Exit the wrong state (essentially go back to default).
                        this._exitState(STATE.HTML_COMMENT.DASH1);
                        //Prevent scanner to go into the same path.
                        this._ignoreHTMLCommentOpen = true;
                        //Put the symbol that must have read to reach this state.
                        this.scan(60);
                        this.scan(33);
                        //Allow normal scanner execution (where HTML comment opening is allowed).
                        this._ignoreHTMLCommentOpen = false;
                        //Hopefully after this, the state for handling this dash is the right state.
                        break;
                }
                break;
            case STATE.HTML_COMMENT.DASH2:
                switch(character) {
                    case 45: //-
                        this._setState(STATE.HTML_COMMENT);
                        done();
                        this._enterToken(this._token = this._createContentToken(TOKEN.HTML_COMMENT));
                        break;
                    default: //Same as above state: we are wrong that we are having HTML comment
                        this._exitState(STATE.HTML_COMMENT.DASH2);
                        this._ignoreHTMLCommentOpen = true;
                        this.scan(60);
                        this.scan(33);
                        this.scan(45);
                        this._ignoreHTMLCommentOpen = false;
                        break;
                }
                break;
            case STATE.LESS_THAN:
                switch (character) {
                    case 60: //< //Includes <<, <<=
                        this._setState(STATE.SHIFT_LEFT);
                        done();
                        break;
                    case 61: //= //Includes <=
                        this._outputToken(TOKEN.LESS_THAN_OR_EQUAL);
                        done();
                        break;
                    case 33: //! //Includes <!--
                        if(!this._ignoreHTMLCommentOpen) {
                            this._token = this._createContentToken(TOKEN.HTML_COMMENT);
                            this._token.push(60);
                            this._token.push(character);
                            this._setState(STATE.HTML_COMMENT.DASH1);
                            done();
                            break;
                        }
                    //noinspection FallThroughInSwitchStatementJS
                    default:
                        this._outputToken(TOKEN.LESS_THAN);
                        this._exitState(STATE.LESS_THAN);
                        break;
                }
                break;
            case STATE.GREATER_THAN:
                switch (character) {
                    case 62: //> //Includes >>, >>=, >>>, >>>=
                        this._setState(STATE.SHIFT_RIGHT);
                        done();
                        break;
                    case 61: //= //Includes >=
                        this._outputToken(TOKEN.GREATER_THAN_OR_EQUAL);
                        done();
                        break;
                    default:
                        this._outputToken(TOKEN.GREATER_THAN);
                        this._exitState(STATE.GREATER_THAN);
                        break;
                }
                break;
        }
    }
    ++this._inputIndex;
};