#!/usr/bin/env node
const JSONStream = require('JSONStream');
const es = require('event-stream');
const commandLineArgs = require('command-line-args');

const optionDefinitions = [
    { name: 'transform', alias: 't', type: String },
    { name: 'data', alias: 'd', type: String },
    { name: 'fieldDelimiter', alias: 'f', type: String, defaultValue: '|' },
    { name: 'valueDelimiter', alias: 'v', type: String, defaultValue: ':' },
];
const args = commandLineArgs(optionDefinitions);
if(args.fieldDelimiter === args.valueDelimiter) {
    console.error("ERROR: Both delimiters cannot be the same.");
    process.exit(1);
}

let extraData = {};
if(args.data) {
    let extraFields = args.data.split(args.fieldDelimiter);
    extraFields.map( f => {
        let [key, value] = f.split(args.valueDelimiter);
        extraData[key] = parseValueString(value);
    } );
}

function parseValueString(str) {
    const trimmed = str.trim();
    
    // Check if it's an integer (positive or negative, no decimal point)
    if (/^-?\d+$/.test(trimmed)) {
        return parseInt(trimmed, 10);
    }
    
    // Check if it's a float (positive or negative, with decimal point)
    if (/^-?\d+\.\d+$/.test(trimmed)) {
        return parseFloat(trimmed);
    }
    
    // Return as string if it doesn't match number patterns
    return str;
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
        case 'sipot':
            return sipotTransform(obj);
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

function sipotTransform(obj) {
    if(obj.fechaInicio)
        obj.fechaInicio = parsePntFecha(obj.fechaInicio);

    if(obj.informacion.length > 0) {
        let infoTemp = obj.informacion;
        obj.informacion = {};
        infoTemp.map( item => {
            if(item.length > 0) {
                switch(item[0]) {
                    case 10:
                        obj.informacion[generateProperKey(item[1])] = parseNestedSipotArray(item[2]);
                        break;
                    default:
                        obj.informacion[generateProperKey(item[1])] = detectMapping(item[2]);
                        break;
                }
            }
        } );
    }

    return obj;
}

function parseNestedSipotArray(arr) {
    let newArr = [];

    if(arr.length > 0) {
        arr.map( a => {
            let tempObj = {}
            if(a.length > 0) {
                a.map( prop => {
                    tempObj[generateProperKey(prop[1])] = detectMapping(prop[2])
                } )
            }
            newArr.push(tempObj);
        } )
    }

    return newArr;
}

function generateProperKey(str) {
    return normalizeString(str)
        .replace(/\(.{1,2}\)/g, '')
        .replace(/[^a-z\sñ]/gi, ' ')
        .trim()
        .replace(/\s+/g, '_');
}

function normalizeString(str) {
    str = str.toLowerCase();
    str = str.replace(/ñ/g, 'n');
    str = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return str;
}

function detectMapping(str) {
    if(str === "") return null;
    if(str.match(/^\d{2}\/\d{2}\/\d{4}$/)) return parsePntFecha(str);
    if(str.match(/^\$-?[0-9.,]+$/)) return parsePntMonto(str);
    return str;
}


function pntTransform(obj) {
    if(!obj.periodoreporta && !obj.periodoinforma) return null;
    if(obj.periodoinforma)
        obj.date = getPntFechaFromRange(obj['periodoinforma']);
    else if(obj.periodoreporta)
        obj.date = getPntFechaFromRange(obj['periodoreporta']);

    if(extraData) {
        switch(extraData.folder) {
            case 'Contratos':
                return pntContratosTransform(obj);
            
            case 'Directorio':
            case 'Servidores_sancionados':
            case 'Servicios':
            case 'Tramites':
                return pntDefaultTransform(obj);
            
            case 'Sueldos':
                return pntSueldosTransform(obj);
            
            case 'Ejercicio presupuestos':
                return pntEjercicioPresupuestosTransform(obj);
            
            case 'Padrón de beneficiarios':
                return pntBeneficiariosTransform(obj);
            
            case 'Presupueso_anual':
                return pntPresupuestoAnualTransform(obj);
            
            case 'Resoluciones':
                return pntResolucionesTransform(obj);

            default:
                return pntMinimalTransform(obj);
        }
    }
}

function pntBeneficiariosTransform(obj) {
    if(obj.informacionPrincipal?.fechaaltabeneficiaria)
        obj.informacionPrincipal.fechaaltabeneficiaria = parsePntFecha(obj.informacionPrincipal.fechaaltabeneficiaria);

    if(obj.montorecibido)
        obj.montorecibido = parsePntMonto(obj.montorecibido);
    else obj.montorecibido = 0;

    if(obj.informacionPrincipal?.montopesos)
        obj.informacionPrincipal.montopesos = parsePntMonto(obj.informacionPrincipal.montopesos);
    else obj.informacionPrincipal.montopesos = 0;

    if(obj.complementoPrincipal?.fechaFinPeriodo)
        obj.complementoPrincipal.fechaFinPeriodo = parsePntFecha(obj.complementoPrincipal.fechaFinPeriodo);

    if(obj.complementoPrincipal?.fechaInicioPeriodo)
        obj.complementoPrincipal.fechaInicioPeriodo = parsePntFecha(obj.complementoPrincipal.fechaInicioPeriodo);

    if(extraData) Object.assign(obj, extraData);

    return obj;
}

function pntContratosTransform(obj) {
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

function pntDefaultTransform(obj) {
    if(obj.informacionPrincipal?.fecharesolucion)
        obj.informacionPrincipal.fecharesolucion = parsePntFecha(obj.informacionPrincipal.fecharesolucion);

    if(obj.complementoPrincipal?.fechaFinPeriodo)
        obj.complementoPrincipal.fechaFinPeriodo = parsePntFecha(obj.complementoPrincipal.fechaFinPeriodo);

    if(obj.complementoPrincipal?.fechaInicioPeriodo)
        obj.complementoPrincipal.fechaInicioPeriodo = parsePntFecha(obj.complementoPrincipal.fechaInicioPeriodo);

    if(extraData) Object.assign(obj, extraData);

    return obj;
}

function pntEjercicioPresupuestosTransform(obj) {
    if(obj.montoneto)
        obj.montoneto = parsePntMonto(obj.montoneto);
    else obj.montoneto = 0;

    if(obj.informacionPrincipal?.informacionSecundarios && obj.informacionPrincipal.informacionSecundarios.length > 0) {
        obj.informacionPrincipal.informacionSecundarios.map( x => {
            if(x.presupuesto) x.presupuesto = parsePntMonto(x.presupuesto); else x.presupuesto = 0;
            if(x.ampliacion) x.ampliacion = parsePntMonto(x.ampliacion); else x.ampliacion = 0;
            if(x.modificado) x.modificado = parsePntMonto(x.modificado); else x.modificado = 0;
            if(x.devengado) x.devengado = parsePntMonto(x.devengado); else x.devengado = 0;
            if(x.pagado) x.pagado = parsePntMonto(x.pagado); else x.pagado = 0;
            if(x.subejercicio) x.subejercicio = parsePntMonto(x.subejercicio); else x.subejercicio = 0;
        } )
    }
    
    if(obj.complementoPrincipal?.fechaFinPeriodo)
        obj.complementoPrincipal.fechaFinPeriodo = parsePntFecha(obj.complementoPrincipal.fechaFinPeriodo);

    if(obj.complementoPrincipal?.fechaInicioPeriodo)
        obj.complementoPrincipal.fechaInicioPeriodo = parsePntFecha(obj.complementoPrincipal.fechaInicioPeriodo);

    if(extraData) Object.assign(obj, extraData);

    return obj;
}

function pntMinimalTransform(obj) {
    let newObj = {
        id: obj.id,
        sujeto: obj.sujetoobligado,
        date: getPntFechaFromRange(obj.periodoreporta),
        size: JSON.stringify(obj).length
    }

    if(extraData) Object.assign(newObj, extraData);

    return newObj;
}

function pntPresupuestoAnualTransform(obj) {
    if(obj.presupuestoasignado)
        obj.presupuestoasignado = parsePntMonto(obj.presupuestoasignado);
    else obj.presupuestoasignado = 0;

    if(obj.informacionPrincipal?.informacionSecundarios && obj.informacionPrincipal.informacionSecundarios.length > 0) {
        obj.informacionPrincipal.informacionSecundarios.map( x => {
            if(x.presupuesto) x.presupuesto = parsePntMonto(x.presupuesto); else x.presupuesto = 0;
        } )
    }
    
    if(obj.complementoPrincipal?.fechaFinPeriodo)
        obj.complementoPrincipal.fechaFinPeriodo = parsePntFecha(obj.complementoPrincipal.fechaFinPeriodo);

    if(obj.complementoPrincipal?.fechaInicioPeriodo)
        obj.complementoPrincipal.fechaInicioPeriodo = parsePntFecha(obj.complementoPrincipal.fechaInicioPeriodo);

    if(extraData) Object.assign(obj, extraData);

    return obj;
}

function pntResolucionesTransform(obj) {
    if(obj.fecharesolucion)
        obj.fecharesolucion = parsePntFecha(obj.fecharesolucion);
    
    if(obj.informacionPrincipal?.fecharesolucion)
        obj.informacionPrincipal.fecharesolucion = parsePntFecha(obj.informacionPrincipal.fecharesolucion);
    
    if(obj.informacionPrincipal?.fechanotificacion)
        obj.informacionPrincipal.fechanotificacion = parsePntFecha(obj.informacionPrincipal.fechanotificacion);

    if(obj.informacionPrincipal?.fechacumplimiento)
        obj.informacionPrincipal.fechacumplimiento = parsePntFecha(obj.informacionPrincipal.fechacumplimiento);

    if(obj.complementoPrincipal?.fechaFinPeriodo)
        obj.complementoPrincipal.fechaFinPeriodo = parsePntFecha(obj.complementoPrincipal.fechaFinPeriodo);

    if(obj.complementoPrincipal?.fechaInicioPeriodo)
        obj.complementoPrincipal.fechaInicioPeriodo = parsePntFecha(obj.complementoPrincipal.fechaInicioPeriodo);

    if(extraData) Object.assign(obj, extraData);

    return obj;
}

function pntSueldosTransform(obj) {
    if(obj.montoneto)
        obj.montoneto = parsePntMonto(obj.montoneto);
    else obj.montoneto = 0;

    if(obj.informacionPrincipal?.informacionSecundarios && obj.informacionPrincipal.informacionSecundarios.length > 0) {
        obj.informacionPrincipal.informacionSecundarios.map( x => {

            let key = Object.keys(x)[0];
            if(x[key] && x[key].length > 0) {
                x[key].map( y => {
                    if(y.montobruto) y.montobruto = parsePntMonto(y.montobruto); else y.montobruto = 0;
                    if(y.montoneto) y.montoneto = parsePntMonto(y.montoneto); else y.montoneto = 0;
                } );
            }

        } )
    }
    
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