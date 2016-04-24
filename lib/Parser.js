(function () {
    "use strict";

    var Parser = module.exports = function Parser(filename) {
        this._root = {
            filename: filename,
            type: 1,
            childNodes: [],
            parentNode: null
        };
        this._current = {
            node: root,
            index: 0
        };
        this._state = 1;
    };
    Parser.prototype.write = function (character) {
        var complete = true;
        do {
            switch (this._state) {
                case 1:
                    switch (character) {
                        case 13:
                            this._state = 2;
                            break;
                        case 10:
                            break;
                    }
                    break;
                case 2:
                    switch (character) {
                        case 10:
                            this._current.node.childNodes[this._current.index++] = {
                                parentNode: this._current.node,
                                type: 2,
                                content: [13, 10]
                            };
                            break;
                        default:
                            this._current.node.childNodes[this._current.index++] = {
                                parentNode: this._current.node,
                                type: 2,
                                content: [13]
                            };
                            complete = false;
                    }
                    this._state = 1;
                    break;
            }
        } while (!complete)
    };
})();