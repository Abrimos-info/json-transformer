#!/usr/bin/env node
const JSONStream = require('JSONStream');
const es = require('event-stream');
const commandLineArgs = require('command-line-args');
const countries = require('iso-3166-1-alpha-2');
const { transliterate, slugify } = require('transliteration');

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

try {
    process.stdin
    .pipe(JSONStream.parse())
    .pipe(es.mapSync(function (obj) {
        switch(args.transform) {
            case 'guatecompras':
                return guatecomprasTransform(obj);
            case 'pnt':
                return pntTransform(obj);
            case 'pnt_minimal':
                return pntMinimalTransform(obj);
            case 'sipot':
                return sipotTransform(obj);

            case 'proact_contracts':
                return proactContractsTransform(obj);
            case 'proact_buyers':
                return proactBuyersTransform(obj);
            case 'proact_suppliers':
                return proactSuppliersTransform(obj);

            case 'opentender_contracts':
                let contracts = openTenderContractsTransform(obj);
                if(contracts.length > 0) {
                    contracts.map(c => {
                        process.stdout.write( JSON.stringify(c) + '\n' );
                    })
                }
                return;
            case 'opentender_buyers':
                return openTenderBuyersTransform(obj);
            case 'opentender_suppliers':
                return openTenderSuppliersTransform(obj);
            default:
                return obj;
        }
    }))
    .pipe(JSONStream.stringify(false))
    .pipe(process.stdout);
}
catch(e) { console.error(e) }

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
                        let itemKey = generateProperKey(item[1]);
                        obj.informacion[itemKey] = detectMapping(item[2], itemKey);
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
                    let itemKey = generateProperKey(prop[1]);
                    tempObj[itemKey] = detectMapping(prop[2], itemKey)
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

function detectMapping(str, key) {
    if(str === "") return null;
    if(str.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
        let date = parsePntFecha(str);
        if(!isISOString(date)) {
            str = reversePntFecha(str);
            date = parsePntFecha(str);
        }
        return date;
    }
    if(str.match(/^\$-?[0-9.,]+$/)) return parsePntMonto(str);
    if(key.match(/fecha/)) return null;
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
    if(!str) return null;
    let dates = str.split(' - ');
    return parsePntFecha(dates[0]);
}

function parsePntFecha(str) {
    if(!str.match(/^\d{2}\/\d{2}\/\d{4}$/)) return null;
    let parts = str.split('/');
    return parts[2] + '-' + parts[1] + '-' + parts[0] + 'T00:00:00.000-06:00';
}

function reversePntFecha(str) {
    let parts = str.split('/');
    return parts[1] + '/' + parts[0] + '/' + parts[2];
}

const isISOString = (val) => {
    // Create a Date object from the input string
    const d = new Date(val);
    // Check if the date is valid (not NaN)
    return !Number.isNaN(d.valueOf());
};


function proactContractsTransform(obj) {
    // console.log(obj);
    let newObj = {
        id: getContractID(obj.tender_country, obj.tender_id),
        country: obj.tender_country,
        title: obj.lot_title,
        publish_date: getContractDate(obj.tender_publications_firstcallfortenderdate),
        award_date: obj.tender_publications_firstdcontractawarddate ? getContractDate(obj.tender_publications_firstdcontractawarddate) : getContractDate(obj.tender_awarddecisiondate),
        contract_date: getContractDate(obj.tender_contractsignaturedate),
        buyer: {
            id: generateEntityID(obj.buyer_name, obj.buyer_country, obj.tender_country),
            name: obj.buyer_name
        },
        supplier: {
            id: generateEntityID(obj.bidder_name, obj.bidder_country, obj.tender_country),
            name: obj.bidder_name
        },
        amount: parseFloat(obj.bid_price),
        currency: obj.bid_pricecurrency,
        method: obj.tender_proceduretype,
        category: obj.tender_supplytype,
        url: obj.notice_url,
        source: 'proact'
    }

    if(!newObj.amount) delete newObj.amount;
    
    return newObj;
}

function proactBuyersTransform(obj) {
    if(obj.buyer_name.length < 2) return;
    let newObj = {
        id: generateEntityID(obj.buyer_name, obj.buyer_country, obj.tender_country),
        name: obj.buyer_name,
        identifier: obj.buyer_id,
        country: obj.buyer_country ? obj.buyer_country : obj.tender_country,
        address: {
            city: obj.buyer_city,
            postal_code: obj.buyer_postcode,
        },
        classification: obj.buyer_buyertype,
        source: 'proact'
    }

    let sane_name = transliterate(obj.buyer_name);
    if(sane_name != obj.buyer_name)
        newObj.other_names = [ transliterate(obj.buyer_name) ];

    return newObj;
}

function proactSuppliersTransform(obj) {
    if(obj.bidder_name.length < 2) return;    
    let newObj = {
        id: generateEntityID(obj.bidder_name, obj.bidder_country, obj.tender_country),
        name: obj.bidder_name,
        identifier: obj.bidder_id,
        country: obj.bidder_country ? obj.bidder_country : obj.tender_country,
        source: 'proact'
    }

    let sane_name = transliterate(obj.bidder_name);
    if(sane_name != obj.bidder_name)
        newObj.other_names = [ transliterate(obj.bidder_name) ];

    return newObj;
}

function openTenderContractsTransform(obj) {
    let contracts = []
    if(!obj.releases || !obj.releases[0].awards) return contracts;

    obj.releases.map( release => {
        let country = '';
        if(extraData?.country) country = extraData?.country.toUpperCase();
        else country = getOpenTenderCountry(release, 'buyer');
        release.awards.map( award => {
            if(award.suppliers) {
                let contract = {
                    id: getContractID(country, release.ocid + '-' + award.id),
                    country: country,
                    title: release.tender.title ? transliterate(release.tender.title) : '',
                    description: release.tender.description ? transliterate(release.tender.description) : '',
                    publish_date: getContractDate(release.date),
                    award_date: getContractDate(award.date),
                    contract_date: getContractDate(getContractForAward(release.contracts, award.id)),
                    buyer: {
                        id: generateEntityID(release.buyer.name, country, 'EU'),
                        name: release.buyer.name
                    },
                    supplier: {},
                    amount: parseFloat(award.value?.amount),
                    currency: award.value?.currency,
                    method: release.tender?.procurementMethod,
                    method_details: release.tender?.procurementMethodDetails,
                    category: release.tender?.mainProcurementCategory,
                    url: getAwardNotice(award.documents), // Puede ser tenderNotice o awardNotice, usamos el segundo
                    source: 'opentender'
                }

                // Add supplier data
                if(award.suppliers?.length > 0 && award.suppliers[0].name) {
                    contract.supplier = {
                        id: generateEntityID(award.suppliers[0].name, country, 'EU'),
                        name: award.suppliers[0].name
                    }
                }

                contracts.push(contract);
            }
        } );
    } );

    return contracts;
}

function openTenderBuyersTransform(obj) {
    return openTenderPartyObject(obj, 'buyer');
}

function openTenderSuppliersTransform(obj) {
    return openTenderPartyObject(obj, 'supplier');
}

function openTenderPartyObject(obj, role) {
    if(!obj.releases || !obj.releases[0].parties?.length > 0) return;
    
    let partyObj;
    obj.releases.map( release => {
        let country = '';
        if(role == 'buyer' && extraData?.country) country = extraData?.country.toUpperCase();
        else country = getOpenTenderCountry(release, role);

        release.parties.map( party => {
            if(party.roles.indexOf(role) >= 0 && party.name) {
                partyObj = {
                    id: generateEntityID(party.name, country, 'EU'),
                    name: party.name,
                    identifier: getTaxId(party.additionalIdentifiers),
                    country: country,
                    source: 'opentender'
                }

                let sane_name = transliterate(party.name);
                if(sane_name != party.name)
                    partyObj.other_names = [ sane_name ];

                if(party.additionalIdentifiers)
                    partyObj.identifier = getTaxId(party.additionalIdentifiers);
                
                if(party.address) {
                    partyObj.address = {}
                    if(party.address.street) partyObj.address.street = party.address.street;
                    if(party.address.region) partyObj.address.region = party.address.region;
                    if(party.address.postal_code) partyObj.address.postal_code = party.address.postal_code;
                    if(party.address.countryName) partyObj.address.country = getOpenTenderCountryCode(party.address.countryName);
                }

                if(party.contactPoint) {
                    partyObj.contactPoint = {}
                    if(party.contactPoint.name) partyObj.contactPoint.name = party.contactPoint.name;
                    if(party.contactPoint.email) partyObj.contactPoint.email = party.contactPoint.email;
                    if(party.contactPoint.telephone) partyObj.contactPoint.telephone = party.contactPoint.telephone;
                    if(party.contactPoint.url) partyObj.contactPoint.url = party.contactPoint.url;
                }
            }
        } );
    } );

    return partyObj;
}

function getContractID(country, id_str) {
    let id = transliterate(id_str);
    if(!id.match(country + '_')) id = country + '_' + id;
    return id;
}

function getOpenTenderCountry(release, role) {
    let country = '';
    if(release.parties?.length > 0) {
        release.parties.map(party => {
            if(party.roles.indexOf(role) >= 0) {
                if(party.address?.countryName) {
                    country = party.address?.countryName;
                }
            }
        })
    }

    if(!country || country == 'none' || country == '–' || country == '-' || country.match(/\d/)) {
        let buyer = release.buyer;
        if(buyer?.id.match(/^\w{2}_/)) country = buyer.id.substring(0, 2);
        if(buyer?.id.match(/^\w{3}_/)) country = 'SK';
        if(buyer?.id.match(/^hash/)) country = buyer.id.substring(12, 14);
    }

    if(country.length != 2) {
        country = getOpenTenderCountryCode(country);
    }

    return country;
}

function getOpenTenderCountryCode(str) {
    switch(str) {
        case 'Andorra':
            return 'AD';

        case 'Ujed.Arap.emir':
            return 'AE';
        
        case 'Afghanistan':
            return 'AF';

        case 'Antigua and Barbuda':
            return 'AG';
        
        case 'Anguilla':
            return 'AI';
        
        case 'Albania':
        case 'Albanija':
            return 'AL';
        
        case 'Arménie':
            return 'AM';

        case 'Angola':
            return 'AO';
        
        case 'Antarctica':
            return 'AQ';

        case 'Argentina':
            return 'AR';

        case 'Austria':
        case 'Ausztria':
        case 'Austrija':
        case 'Autriche':
        case 'Avstrija':
        case 'Östereich':
        case 'Öстерреицх':
            return 'AT';
        
        case 'Australia':
            return 'AU';
        
        case 'Bosna i Herceg.':
        case 'Bosna in Hercegovina':
        case 'Босниа анд Херзеговина':
            return 'BA';
        
        case 'Belgium':
        case 'Belgija':
        case 'Belgique':
        case 'Белгиqуе/Белгиë':
            return 'BE';
        
        case 'Bulgária':
        case 'Bulgaria':
        case 'Bugarska':
        case 'Булгарија':
            return 'BG';
        
        case 'Belarus':
            return 'BY';
        
        case 'Canada':
        case 'Kanada':
            return 'CA';

        case 'Svájc':
        case 'Švicarska':
        case 'Suisse':
        case 'Švica':
        case 'Switzerland':
        case 'Сwитзерланд':
            return 'CH';

        case 'Congo':
            return 'CG';

        case 'China':
        case 'Chine':
        case 'Kína':
        case 'Kina':
        case 'Kitajska':
            return 'CN';
        
        case 'Cipar':
        case 'Ciper':
        case 'Cyprus':
            return 'CY';

        case 'Csehország':
        case 'Češka':
        case 'Češka republika':
        case 'Czech Republic':
        case 'Czechia':
        case 'Tchèque, République':
        case 'Ческо':
            return 'CZ';
        
        case 'Allemagne':
        case 'Allemagne.':
        case 'Germany':
        case 'Nemčija':
        case 'Németország':
        case 'Njemačka':
        case 'Деутсцхланд':
            return 'DE';

        case 'Danska':
        case 'Denmark':
        case 'Данмарк':
            return 'DK';
        
        case 'Algeria':
            return 'DZ';

        case 'Észtország':
            return 'EE';

        case 'Espagne':
        case 'Španija':
        case 'Spanyolország':
        case 'Španjolska':
        case 'Spain':
            return 'ES';
        
        case 'Егyпт':
            return 'EG';
        
        case 'Finnország':
        case 'Finska':
        case 'Finland':
            return 'FI';

        case 'Franciaország':
        case 'Francuska':
        case 'France':
        case 'Francija':
        case 'Франце':
            return 'FR';
        
        case 'Gabon':
            return 'GA';
        
        case 'Guyane Française':
            return 'GF';
        
        case 'Guadeloupe':
            return 'GP';

        case 'Grčka':
        case 'Greece':
        case 'Grčija':
        case 'Грееце':
            return 'GR';
        
        case 'Hongkong':
        case 'Hong Kong':
            return 'HK';

        case 'Croatia':
        case 'Horvátország':
        case 'Hrvatska':
        case 'Hrvaška':
        case 'Хрватска':
            return 'HR';
        
        case 'Budapest':
        case 'Franciaország ; Magyarország':
        case 'HUN':
        case 'Hungary':
        case 'Liechtenstein, Magyarország':
        case 'Mađarska':
        case 'Madžarska':
        case 'magyar':
        case 'Magyar':
        case 'Magyaro.':
        case 'magyarország':
        case 'Magyarország':
        case 'Magyarorzság':
        case 'Magyarrország':
        case 'Magyyarország':
        case 'MAGYARORSZÁG':
        case 'Magyarország ; Magyarország':
        case 'Nyíregyháza':
        case 'Магyарорсзáг':
            return 'HU';
        
        case 'Irska':
        case 'Irlande':
        case 'Ireland':
            return 'IE';
        
        case 'Israel':
        case 'Israël':
        case 'Israël.':
        case 'Izrael':
            return 'IL';
        
        case 'Isle of Man':
            return 'IM';

        case 'India':
        case 'Indija':
            return 'IN';
        
        case 'British Indian Ocean Territory':
            return 'IO';

        case 'Italija':
        case 'Italie':
        case 'Italy':
        case 'Olaszország':
        case 'Италиа':
            return 'IT';
        
        case 'Japan':
        case 'Japonska':
        case 'Јапан':
            return 'JP';

        case 'Korea (South)':
        case 'Koreja, republika':
            return 'KR';
        
        case 'Kazakhstan':
            return 'KZ';
        
        case 'Liechtenstein':
            return 'LI';

        case 'Litvánia':
        case 'Lithuania':
        case 'Litva':
            return 'LT';
        
        case 'Luksemburg':
        case 'Luxembourg':
            return 'LU';
        
        case 'Latvia':
            return 'LV';
        
        case 'Moldova':
            return 'MD';
        
        case 'Crna Gora':
        case 'Монтенегро':
            return 'ME';
        
        case 'Мацедониа (тхе формер Yугослав Републиц оф)':
            return 'MK';
        
        case 'Martinique':
            return 'MQ';

        case 'Malta':
            return 'MT';
        
        case 'Maurice':
            return 'MU';
        
        case 'Malezija':
            return 'MY';

        case 'Hollandia':
        case 'Nizozemska':
        case 'Netherlands':
        case 'Pays Bas':
            return 'NL';
        
        case 'Norveška':
        case 'Norway':
        case 'Норwаy':
            return 'NO';

        case 'Lengyelország':
        case 'Poland':
        case 'Poljska':
        case 'Polska':
        case 'Pologne':
        case 'Полска':
            return 'PL';
        
        case 'Portugal':
            return 'PT';
        
        case 'Réunion':
            return 'RE';

        case 'Románia':
        case 'Romania':
        case 'Romunija':
        case 'Rumunjska':
            return 'RO';

        case 'Serbia':
        case 'Srbija':
        case 'Szerbia':
        case 'Србија':
            return 'RS';
        
        case 'Ruska federaci.':
        case 'Russian Federation':
        case 'Oroszország':
        case 'Руссиан Федератион':
            return 'RU';
        
        case 'Suède':
        case 'Svédország':
        case 'Švedska':
        case 'Sweden':
        case 'Свериге':
            return 'SE';
        
        case 'Singapour':
        case 'Singapur':
            return 'SG';

        case 'Slovenia':
        case 'Slovenija':
        case 'Szlovénia':
        case 'Словенско':
        case 'Словенија':
            return 'SI';
        
        case 'Slovačka':
        case 'Slovakia':
        case 'Slovaška':
        case 'Szlovákia':
            return 'SK';
        
        case 'Swaziland':
            return 'SZ';
        
        case 'Togo':
            return 'TG';
        
        case 'Turska':
        case 'Turkey':
        case 'Türkiye':
        case 'Turčija':
        case 'Туркеy':
            return 'TR';

        case 'Taiwan':
            return 'TW';

        case 'Ukraine':
        case 'Ukrajina':
            return 'UA';

        case 'Egyesült Királyság':
        case 'Royaume Uni':
        case 'Velika Britania':
        case 'Velika Britanija':
        case 'United Kingdom':
        case 'Združeno kraljestvo':
        case 'Унитед Кингдом оф Греат Бритаин анд Нортхерн Иреланд':
            return 'UK';
        
        case 'United States Minor Outlying Islands':
            return 'UM';
        
        case 'Amerikai Egyesült Államok':
        case 'États Unis':
        case 'USA':
        case 'United States':
        case 'Združene države Amerike':
        case 'Унитед Статес оф Америца':
            return 'US';
        
        case 'Amer.Djev.Otoci':
            return 'VI';
        
        case 'Brit.Djev.Otoci':
        case 'Britanski Djevičanski otoci':
            return 'VG';
        
        case 'Mayotte':
            return 'YT';

        case 'South Africa':
            return 'ZA';
        
        default:
            return str;
    }
}

function getTaxId(list) {
    let taxID = '';

    if(list?.length > 0) {
        list.map( item => {
            if(item.scheme == 'TAX_ID') taxID = item.id;
        } )
    }

    return taxID;
}

function getContractDate(str) {
    if(!str) return null;
    if(str.match(/^\d{4}-\d{2}-\d{2}/)) return new Date(str).toISOString();
    return null;
}

function getContractForAward(contracts, awardID) {
    let date = null;
    if(contracts?.length > 0) {
        contracts.map(c => {
            if(c.awardID == awardID) date = c.dateSigned;
        })
    }
    return date;
}

function getAwardNotice(documents) {
    let url = '';
    if(documents?.length > 0) {
        documents.map(doc => {
            if(doc.documentType == 'awardNotice')
                url = doc.url;
        })
    }
    return url;
}

function generateEntityID(str, entity_country, contract_country) {
    str = str.replace(/\./g, ' ').trim();
    str = slugify(str + ' ' + (entity_country ? entity_country : contract_country));
    return str.replace(/-{2,}/g, '-');
}
