#!/usr/bin/env node
const JSONStream = require('JSONStream');
const es = require('event-stream');
const commandLineArgs = require('command-line-args');

const optionDefinitions = [
    { name: 'transform', alias: 't', type: String },
    { name: 'data', alias: 'd', type: String }
];
const args = commandLineArgs(optionDefinitions);

process.stdin.setEncoding('utf8');

process.stdin
.pipe(JSONStream.parse())
.pipe(es.mapSync(function (obj) {
    switch(args.transform) {
        case 'guatecompras':
            return guatecomprasTransform(obj);
        case 'pnt':
            return pntTransform(obj, args.data);
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

function pntTransform(obj, extraData=null) {
    if(!obj.periodoreporta) return null;

    let newObj = {
        id: obj['id'],
        sujeto: obj['sujetoobligado'],
        date: getPntFecha(obj['periodoreporta']),
        size: JSON.stringify(obj).length
    }
    if(extraData) {
        let extraFields = extraData.split('|');
        extraFields.map( f => {
            let [key, value] = f.split(':');
            newObj[key] = value;
        } );
    }

    return newObj;
}

function getPntFecha(str) {
    let dates = str.split(' - ');
    let parts = dates[0].split('/');
    return parts[2] + '-' + parts[1] + '-' + parts[0] + 'T00:00:000-06:00';
}