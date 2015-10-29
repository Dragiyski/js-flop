(function() {
    "use strict";
    var fs = require('fs');
    var Scanner = require('./lib/Scanner');
    var data = fs.readFileSync('test.js', {
        encoding: 'utf8'
    });
    var scanner = new Scanner();
    for(var i = 0, j = data.length, lead, folw; i < j; ++i) {
        lead = data.charCodeAt(i);
        if(lead >= 0xD800 && lead <= 0xDBFF) {
            folw = data.charCodeAt(++i);
            if(isNaN(folw)) {
                throw new RangeError('Unexpected end of string.');
            }
            if(folw >= 0xDC00 && folw <= 0xDFFF) {
                scanner.scan((lead & 0x03FF) << 10 | folw & 0x03FF);
            } else {
                throw new RangeError('Invalid low surrogate.');
            }
        } else if(lead >= 0xDC00 && lead <= 0xDFFF) {
            throw new RangeError('Unexpected low surrogate.');
        } else {
            scanner.scan(lead);
        }
    }
    console.log(scanner._output);
})();