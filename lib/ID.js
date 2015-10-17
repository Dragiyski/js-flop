(function() {
    "use strict";
    var ID = module.exports = function ID(name, id) {
        if(id instanceof Object) {
            throw new TypeError('ID must be primitive!');
        }
        this._name = String(name);
        this._id = id;
    };
    ID.prototype.valueOf = function() {
        return this._id;
    };
    ID.prototype.toString = function() {
        return this._name;
    };
})();