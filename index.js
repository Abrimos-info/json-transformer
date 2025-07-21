#!/usr/bin/env node
const JSONStream = require('JSONStream');
const es = require('event-stream');
const commandLineArgs = require('command-line-args');

const optionDefinitions = [
    { name: 'transform', alias: 't', type: String },
    { name: 'data', alias: 'd', type: String }
];
const args = commandLineArgs(optionDefinitions);

let extraData = {};
if(args.data) {
    let extraFields = args.data.split('|');
    extraFields.map( f => {
        let [key, value] = f.split(':');
        extraData[key] = value;
    } );
}

process.stdin.setEncoding('utf8');

process.stdin
.pipe(JSONStream.parse())
.pipe(es.mapSync(function (obj) {
    switch(args.transform) {
        case 'guatecompras':
            return guatecomprasTransform(obj);
        case 'pnt':
            return pntTransform(obj);
        default:
            return obj;
    }
}))
.pipe(JSONStream.stringify(false))
.pipe(process.stdout);

process.stdin.on('end', () => {
  process.stdout.write('\n');
});

function guatecomprasTransform(obj) {
    if(obj.hasOwnProperty('contracts')) {
	obj.contracts.map( c => {
	    if(c.hasOwnProperty('dateSigned')) {
		    c.dateSigned = c.dateSigned.replace(' ', '');
	    }
	} );
    }
    return obj;
}

function pntTransform(obj) {
    if(!obj.periodoreporta) return null;

    if(extraData) {
        switch(extraData.folder) {
            case 'Contratos':
                return pntContratosTransform(obj);
            case 'Servidores_sancionados':
                return pntServidoresTransform(obj);
            case 'Directorio':
            case 'Ejercicio presupuestos':
            case 'Padrón de beneficiarios':
            case 'Presupueso_anual':
            case 'Resoluciones':
            case 'Servicios':
            case 'Sueldos':
            case 'Tramites':
            default:
                return pntDefaultTransform(obj);
        }
    }
}

function pntDefaultTransform(obj) {
    let newObj = {
        id: obj.id,
        sujeto: obj.sujetoobligado,
        date: getPntFechaFromRange(obj.periodoreporta),
        size: JSON.stringify(obj).length
    }

    if(extraData) Object.assign(newObj, extraData);

    return newObj;
}

function pntContratosTransform(obj) {
    if(!obj.periodoreporta) return null;
    obj.date = getPntFechaFromRange(obj['periodoreporta']);

    if(obj.montocontrato)
        obj.montocontrato = parsePntMonto(obj.montocontrato);
    else obj.montocontrato = 0;
    
    if(obj.informacionPrincipal?.fechacontrato)
        obj.informacionPrincipal.fechacontrato = parsePntFecha(obj.informacionPrincipal.fechacontrato);
    
    if(obj.informacionPrincipal?.montosinimpuestos)
        obj.informacionPrincipal.montosinimpuestos = parsePntMonto(obj.informacionPrincipal.montosinimpuestos);
    else obj.informacionPrincipal.montosinimpuestos = 0;
    
    if(obj.informacionPrincipal?.montoconimpuestos)
        obj.informacionPrincipal.montoconimpuestos = parsePntMonto(obj.informacionPrincipal.montoconimpuestos);
    else obj.informacionPrincipal.montoconimpuestos = 0;

    if(obj.informacionPrincipal?.montominimo)
        obj.informacionPrincipal.montominimo = parsePntMonto(obj.informacionPrincipal.montominimo);
    else obj.informacionPrincipal.montominimo = 0;
    
    if(obj.informacionPrincipal?.montomaximo)
        obj.informacionPrincipal.montomaximo = parsePntMonto(obj.informacionPrincipal.montomaximo);
    else obj.informacionPrincipal.montomaximo = 0;
    
    if(obj.informacionPrincipal?.fechainicioejecucion)
        obj.informacionPrincipal.fechainicioejecucion = parsePntFecha(obj.informacionPrincipal.fechainicioejecucion);
    
    if(obj.informacionPrincipal?.fechafinejecucion)
        obj.informacionPrincipal.fechafinejecucion = parsePntFecha(obj.informacionPrincipal.fechafinejecucion);

    if(obj.complementoPrincipal?.fechaFinPeriodo)
        obj.complementoPrincipal.fechaFinPeriodo = parsePntFecha(obj.complementoPrincipal.fechaFinPeriodo);

    if(obj.complementoPrincipal?.fechaInicioPeriodo)
        obj.complementoPrincipal.fechaInicioPeriodo = parsePntFecha(obj.complementoPrincipal.fechaInicioPeriodo);

    if(extraData) Object.assign(obj, extraData);

    return obj;
}

function pntServidoresTransform(obj) {
    if(!obj.periodoreporta) return null;
    obj.date = getPntFechaFromRange(obj['periodoreporta']);

    if(obj.informacionPrincipal?.fecharesolucion)
        obj.informacionPrincipal.fecharesolucion = parsePntFecha(obj.informacionPrincipal.fecharesolucion);

    if(obj.complementoPrincipal?.fechaFinPeriodo)
        obj.complementoPrincipal.fechaFinPeriodo = parsePntFecha(obj.complementoPrincipal.fechaFinPeriodo);

    if(obj.complementoPrincipal?.fechaInicioPeriodo)
        obj.complementoPrincipal.fechaInicioPeriodo = parsePntFecha(obj.complementoPrincipal.fechaInicioPeriodo);

    if(extraData) Object.assign(obj, extraData);

    return obj;
}

function parsePntMonto(str) {
    return parseFloat( str.replace(/\$|,/g, '') );
}

function getPntFechaFromRange(str) {
    let dates = str.split(' - ');
    return parsePntFecha(dates[0]);
}

function parsePntFecha(str) {
    let parts = str.split('/');
    return parts[2] + '-' + parts[1] + '-' + parts[0] + 'T00:00:00.000-06:00';
}