#!/usr/bin/env node
const JSONStream = require('JSONStream');
const es = require('event-stream');
const commandLineArgs = require('command-line-args');

const optionDefinitions = [
    { name: 'transform', alias: 't', type: String }
];
const args = commandLineArgs(optionDefinitions);

process.stdin.setEncoding('utf8');

process.stdin
.pipe(JSONStream.parse())
.pipe(es.mapSync(function (obj) {
    switch(args.transform) {
        case 'guatecompras':
            return guatecomprasTransform(obj);
        default:
            return obj;
    }
}))
.pipe(JSONStream.stringify(false))
.pipe(process.stdout);

process.stdin.on('end', () => {
  process.stdout.write('\n');
});

function guatecomprasTransform(obj, type) {
    if(obj.hasOwnProperty('contracts')) {
	obj.contracts.map( c => {
	    if(c.hasOwnProperty('dateSigned')) {
		c.dateSigned = c.dateSigned.replace(' ', '');
	    }
	} );
    }
    return obj;
}
