(function() {
    "use strict";
    var srcFile = process.argv[2];
    var dstFile = process.argv[3];
    if(!srcFile || !srcFile) {
        throw new Error('No valid source and destination specified.');
    }
    var os = require('os');
    var fs = require('fs');
    var counter = 1;
    var next = function () {
        return counter++;
    };
    function NameID(name, stateId) {
        this._id = stateId;
        this._name = name;
    }
    NameID.prototype.valueOf = function() {
        return this._id;
    };
    NameID.prototype.toString = function() {
        return this._name;
    };

    var data = fs.readFileSync(srcFile, {
        encoding: 'utf8'
    }), tokenList = [];

    data = data.split(/$\s*/m);
    var stateMap = {};
    var dependencyLevelMap = [];
    var exportMap = {};
    var exportLines = [];
    dependencyLevelMap.ensureLevel = function(level) {
        if(!this.hasOwnProperty(level)) {
            this[level] = {};
        }
    };
    data = data.forEach(function(line) {
        if(/^\s*$/.test(line) || /^\s*#.*$/.test(line)) {
            return;
        }
        var matches = /^\s*(\S+)\s*(?:#.*)?$/.exec(line);
        if(!matches) {
            return;
        }
        if(stateMap.hasOwnProperty(matches[1])) {
            throw new TypeError('State with name "' + matches[1] + '" is defined more than once.');
        }
        var nameParts = matches[1].split('.'), level = nameParts.length - 1;
        for(var i = 0, n; i <= level; ++i) {
            n = nameParts.slice(0, i + 1).join('.');
            dependencyLevelMap.ensureLevel(i);
            if (!dependencyLevelMap[i].hasOwnProperty(n)) {
                dependencyLevelMap[i][n] = true;
            }
        }
        stateMap[matches[1]] = new NameID(matches[1], next());
    });
    dependencyLevelMap.forEach(function(levelStateMap, previousDependentLevel) {
        Object.keys(levelStateMap).forEach(function(state) {
            var dependencies = levelStateMap[state];
            var levelNames = state.split('.');
            var currentMap = exportMap;
            var levelName, pathName;
            for(var i = 0, j = levelNames.length; i < j; ++i) {
                levelName = levelNames[i];
                pathName = levelNames.slice(0, i + 1).join('.');
                if(!currentMap.hasOwnProperty(levelName)) {
                    if(stateMap.hasOwnProperty(pathName)) {
                        currentMap[levelName] = stateMap[pathName];
                        exportLines.push('exports.' + pathName + ' = new Number(' + (stateMap[pathName] | 0) + ');');
                    } else {
                        currentMap[levelName] = stateMap[pathName] = new NameID(pathName, next());
                        exportLines.push('exports.' + pathName + ' = new Number(' + (stateMap[pathName] | 0) + ');');
                    }
                }
                currentMap = currentMap[levelName];
            }
        });
    });
    var strExportMap = exportLines.join(os.EOL);
    fs.writeFileSync(dstFile, strExportMap, {
        encoding: 'utf8',
        flag: 'w'
    });
})();