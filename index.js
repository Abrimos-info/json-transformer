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

process.stdin.setEncoding('utf8');

try {
    process.stdin
    .pipe(JSONStream.parse())
    .pipe(es.mapSync(function (obj) {
        switch(args.transform) {
            case 'guatecompras':
                return guatecomprasTransform(obj);
            case 'guatecompras_proveedores':
                return guatecomprasProveedoresTransform(obj);
            case 'guatecompras_historico_contracts':
                return guatecomprasHistoricoContractsTransform(obj);
            case 'guatecompras_historico_buyers':
                let buyers = guatecomprasHistoricoBuyersTransform(obj);
                if(buyers.length > 0) {
                    buyers.map(b => {
                        process.stdout.write( JSON.stringify(b) + '\n' );
                    })
                }
                return;
            case 'guatecompras_ocds_contracts':
                let gc_ocds_contracts = guatecomprasOCDSContractsTransform(obj);
                if(gc_ocds_contracts.length > 0) {
                    gc_ocds_contracts.map(c => {
                        process.stdout.write( JSON.stringify(c) + '\n' );
                    })
                }
                return;
            case 'guatecompras_ocds_buyers':
                let ocds_buyers = guatecomprasOCDSBuyersTransform(obj);
                if(ocds_buyers.length > 0) {
                    ocds_buyers.map(b => {
                        process.stdout.write( JSON.stringify(b) + '\n' );
                    })
                }
                return;
            case 'guatecompras_ocds_suppliers':
                let ocds_suppliers = guatecomprasOCDSSuppliersTransform(obj);
                if(ocds_suppliers.length > 0) {
                    ocds_suppliers.map(s => {
                        process.stdout.write( JSON.stringify(s) + '\n' );
                    })
                }
                return;
            
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
                let open_buyers = openTenderBuyersTransform(obj);
                if(open_buyers.length > 0) {
                    open_buyers.map(p => {
                        process.stdout.write( JSON.stringify(p) + '\n' );
                    })
                }
                return;
            case 'opentender_suppliers':
                let open_suppliers = openTenderSuppliersTransform(obj);
                if(open_suppliers.length > 0) {
                    open_suppliers.map(p => {
                        process.stdout.write( JSON.stringify(p) + '\n' );
                    })
                }
                return;
            
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

function parseRazonSocial(str) {
    if(str.match(/.*,.*,.*,.*,.*/) && !str.match(/SOCIEDAD/)) {
        let [ apellido1, apellido2, apellido3, nombre1, nombre2 ] = str.split(',');
        return nombre1 + (nombre2? ' ' + nombre2 : '') + ' ' + apellido1 + (apellido2? ' ' + apellido2 : '') + (apellido3? ' ' + apellido3 : '')
    }
    return str;
}

function parseFecha(str) {
    if(str == '[--NO ESPECIFICADO--]') return null;
    let [ day, month, year ] = str.split('/');
    return new Date( year + '-' + month + '-' + day );
}

function parseFechaSat(str) {
    // 14.feb..2020 07:17:24
    let [ date, time ] = str.split(' ');
    let [ day, month, year ] = date.split(/\.{1,2}/);
    return new Date( year + '-' + getMonthNum(month) + '-' + day + 'T' + time + '-06:00' );
}

function getMonthNum(str) {
    switch(str) {
        case 'ene': return '01';
        case 'feb': return '02';
        case 'mar': return '03';
        case 'abr': return '04';
        case 'may': return '05';
        case 'jun': return '06';
        case 'jul': return '07';
        case 'ago': return '08';
        case 'sep': return '09';
        case 'oct': return '10';
        case 'nov': return '11';
        case 'dic': return '12';
        default:
            console.log('invalid month', str);
            process.exit(1);
    }
}



/* * * * * * * * * * * * * * * * * * * */
/* Guatecompras Histórico/Proveedores  */
/* * * * * * * * * * * * * * * * * * * */

function guatecomprasProveedoresTransform(obj) {
    if(!obj['Nombre o razón social']) return;

    let newObj = {
        id: '',
        name: '',
        identifier: '',
        country: 'GT',
        address: {
            country: 'GT'
        },
        source: 'guatecompras_proveedores'
    }

    Object.keys(obj).map( k => {
        switch(k) {
            case 'gcid':
                newObj.url = 'https://www.guatecompras.gt/proveedores/consultaDetProvee.aspx?rqp=9&lprv=' + obj[k].toString();
                break;
            case 'Fecha SAT':
                newObj.updated_date = parseFechaSat(obj[k]);
                break;
            case 'Nombre o razón social':
                newObj.name = parseRazonSocial(obj[k]);
                newObj.id = generateEntityID(newObj.name, 'GT', 'GT');
                break;
            case 'Tipo de organización':
                newObj.classification = obj[k];
                break;
            case 'Número de Identificación Tributaria (NIT)':
                newObj.identifier = obj[k].toString();
                break;
            case 'Nombre comercial 1':
            case 'Nombre comercial 2':
            case 'Nombre comercial 3':
            case 'Nombre comercial 4':
            case 'Nombre comercial 5':
            case 'Nombre comercial 5':
                if(!newObj.hasOwnProperty('other_names')) newObj['other_names'] = [];
                newObj['other_names'].push(obj[k]);
                break;
            case 'Existen otros nombres comerciales':
                newObj['other_names'].push(...obj[k]);
                break;
            case 'Estado del proveedor (Obtenido desde RGAE)':
                newObj.status = obj[k];
                break;
            case 'Adjudicado o No adjudicado':
                newObj.has_awards = (obj[k] == 'ADJUDICADO')? true : false;
                break;
            case 'Participa o no en Contrato Abierto':
                newObj.has_contracts = (obj[k] == 'NO PARTICIPA (no tiene productos en el catálogo)')? false : true;
                break;
            case 'Con o Sin contraseña':
                newObj.has_password = (obj[k] == 'CON CONTRASEÑA')? true : false;
                break;
            case 'CUI':
                newObj.additional_identifier = obj[k].toString();
                break;
            case 'Número de escritura de constitución':
                newObj.creation_document_number = obj[k];
                break;
            case 'Fecha de constitución':
                newObj.creation_date = parseFecha(obj[k]);
                break;
            case 'Inscripción PROVISIONAL en el Registro Mercantil':
                newObj.temporary_registration_date = parseFecha(obj[k]);
                break;
            case 'Inscripción DEFINITIVA en el Registro Mercantil':
                newObj.official_registration_date = parseFecha(obj[k]);
                break;
            case 'Inscripción en la SAT':
                newObj.tax_registration_date = parseFecha(obj[k]);
                break;
            case 'Actividad Económica':
                newObj.main_activity = obj[k];
                break;

            case 'Notario':
                if(typeof obj[k] !== "string") {
                    newObj.notary = {}
                    
                    if(obj[k].hasOwnProperty('Nombre')) {
                        let notary_name = parseRazonSocial(obj[k]['Nombre']);
                        newObj.notary.id = generateEntityID(notary_name, 'GT', 'GT');
                        newObj.notary.name = notary_name;
                    }
                    if(obj[k].hasOwnProperty('NIT')) newObj.notary.identifier = obj[k]['NIT'].toString();
                }
                break;

            case 'Estatus del NIT en SAT':
                newObj.tax_status = obj[k];
                break;
            case 'Motivo del Estatus':
                newObj.tax_status_reason = obj[k];
                break;
            case 'Departamento':
                if(!newObj.address) newObj.address = {}
                newObj.address.region = obj[k];
                break;
            case 'Municipio':
                if(!newObj.address) newObj.address = {}
                newObj.address.locality = obj[k];
                break;
            case 'Dirección':
                if(!newObj.address) newObj.address = {}
                newObj.address.street = obj[k];
                break;
            case 'Teléfonos':
                if(!newObj.contactPoint) newObj.contactPoint = {}
                newObj.contactPoint.telephone = obj[k];
                break;
            case 'Números de fax':
                if(!newObj.contactPoint) newObj.contactPoint = {}
                newObj.contactPoint.faxNumber = obj[k];
                break;

            case 'Representantes Legales':
                if(obj[k].length > 0) {
                    newObj.representatives = [];
                    obj[k].map( r => {
                        let rl = {}
                        // if(r.hasOwnProperty('gcid')) rl['gcid'] = r['gcid'].toString();
                        if(r.hasOwnProperty('NIT')) rl.identifier = r['NIT'].toString();
                        if(r.hasOwnProperty('Nombre')) {
                            rl.name = parseRazonSocial(r['Nombre']);
                            rl.id = generateEntityID(rl.name, 'GT', 'GT');
                        }
                        if(r.hasOwnProperty('Plazo de Nombramiento')) rl.representation_date = parseFecha(r['Plazo de Nombramiento']);
                        if(r.hasOwnProperty('Otras Representaciones')) rl.has_other_representations = r['Otras Representaciones'];
                        newObj.representatives.push(rl);
                    } )
                }
                break;
        }
    } );

    if(newObj.hasOwnProperty('other_names')) {
        let unique_names = new Set([...newObj['other_names']]);
        newObj['other_names'] = [...unique_names];
    }
    return newObj;
}

function guatecomprasHistoricoContractsTransform(obj) {
    let country = 'GT';
    let contract = {
        id: getContractID(country, obj.nog_concurso),
        country: country,
        title: obj.descripcion,
        description: '',
        publish_date: obj.fecha_publicacion,
        award_date: obj.fecha_adjudicacion,
        buyer: {
            id: generateEntityID(obj.entidad_compradora, country, 'GT'),
            name: obj.entidad_compradora,
            country: country
        },
        procuring_entity: {
            id: generateEntityID(obj.unidad_compradora + ' UC', country, 'GT'),
            name: obj.unidad_compradora
        },
        method: obj.modalidad,
        method_details: obj.submodalidad,
        categories: obj.categorias,
        status: obj.estatus_concurso,
        url: 'https://www.guatecompras.gt/concursos/consultaConcurso.aspx?o=4&nog=' + obj.nog_concurso,
        source: 'guatecompras_historico'
    }

    if(obj.nit && obj.nombre) {
        contract.supplier = {
            id: generateEntityID(parseRazonSocial(obj.nombre), country, 'GT'),
            name: parseRazonSocial(obj.nombre),
            country: country
        }
    }

    if(obj.monto) {
        contract.amount = parseFloat(obj.monto);
        contract.currency = 'GTQ';
    }

    return contract;
}

function guatecomprasHistoricoBuyersTransform(obj) {
    let country = 'GT';
    let entities = [];
    if(obj.entidad_compradora) {
        entities.push( {
            id: generateEntityID(obj.entidad_compradora, country, 'GT'),
            name: obj.entidad_compradora,
            classification: 'government_institution',
            country: country,
            source: 'guatecompras_historico',
            updated_date: obj.fecha_publicacion
        } );
    }
    if(obj.unidad_compradora) {
        entities.push( {
            id: generateEntityID(obj.unidad_compradora + ' UC', country, 'GT'),
            name: obj.unidad_compradora,
            classification: 'buyer_unit',
            member_of: {
                id: generateEntityID(obj.entidad_compradora, country, 'GT'),
                name: obj.entidad_compradora,
            },
            country: country,
            source: 'guatecompras_historico',
            updated_date: obj.fecha_publicacion
        } );
    }

    return entities;
}



/* * * * * * * * * * * */
/*  Guatecompras OCDS  */
/* * * * * * * * * * * */

function guatecomprasOCDSContractsTransform(obj) {
    let flatContracts = [];
    let release = obj;
    let country = 'GT';
    
    if(obj.hasOwnProperty('compiledRelease'))
        release = obj.compiledRelease;

    if(release?.tender?.status == "complete") {
        if(release.awards && release.awards.length > 0) {
            release.awards.map( award => {
                if(award.status == "active") {
                    let flat = {
                        id: getContractID(country, release.ocid),
                        country: country,
                        title: release.tender.title,
                        description: getTenderDescriptionFromItems(release.tender),
                        publish_date: release.tender.datePublished,
                        award_date: award.date,
                        amount: parseFloat(award.value?.amount),
                        currency: award.value?.currency,
                        method: release.tender.procurementMethod,
                        method_details: release.tender.procurementMethodDetails,
                        categories: release.tender.mainProcurementCategory,
                        status: release.tender.statusDetails,
                        url: 'https://www.guatecompras.gt/concursos/consultaConcurso.aspx?o=4&nog=' + release.ocid.replace('ocds-xqjsxa-', ''),
                        source: 'guatecompras_ocds'
                    }
                    
                    let buyer = getGuatecomprasOCDSBuyer(release.parties);
                    if(buyer) {
                        flat.buyer = {
                            id: generateEntityID(buyer.name, country, 'GT'),
                            name: buyer.name,
                            country: country
                        }
                    }
                    
                    let uc = getGuatecomprasOCDSBuyer(release.parties, true);
                    if(uc) {
                        flat.procuring_entity = {
                            id: generateEntityID(uc.name + ' UC', country, 'GT'),
                            name: uc.name,
                            country: country
                        }
                    }

                    let suppliers = [];
                    if(release.parties.supplier?.length > 0) {
                        release.parties.supplier.map( s => {
                            award.suppliers.map( a => {
                                if(a.id == s.id) suppliers.push(s);
                            } )
                        } )
                    }
                    else
                        suppliers = award.suppliers;
                    
                    if(suppliers.length > 0) {
                        let supplier_country = getGuatecomprasOCDSCountry(release.parties, suppliers[0].name, 'GT');
                        flat.supplier = {
                            id: generateEntityID(parseRazonSocial(suppliers[0].name), supplier_country, 'GT'),
                            name: parseRazonSocial(suppliers[0].name)
                        }
                    }
                    
                    let contract = findContract(release, award);
                    if(contract) {
                        if(contract.dateSigned) flat.contract_date = contract.dateSigned;
                        else if(contract.period?.startDate) flat.contract_date = contract.period.startDate;
                    }

                    flatContracts.push(flat);
                }
            } );
        }
    }

    return flatContracts;
}

function getGuatecomprasOCDSCountry(parties, name, default_country) {
    let country = default_country;
    if(parties.length > 0) {
        parties.map( party => {
            if(party.name == name) {
                if(party.identifier?.scheme == 'GT-GCID') {
                    country = party.identifier.id.substring(0,2);
                }
            }
        } );
    }

    return country;
}

function findContract(release, award) {
    let contract = null;
    if(release.hasOwnProperty('contracts') && release.contracts.length > 0) {
        release.contracts.map( c => {
            if(c.awardID == award.id) contract = c;
        } );
    }
    return contract;
}

function getTenderDescriptionFromItems(tender) {
    let item_descriptions = [];

    if(tender.items && tender.items.length > 0) {
        tender.items.map( item => {
            if(item.description) item_descriptions.push(item.description);
        } )
    }

    return item_descriptions.join(' ');
}

function getGuatecomprasOCDSBuyer(parties, uc=false) {
    let buyer = null;

    if(parties.length > 0) {
        parties.map( party => {
            if(party.roles.indexOf('buyer') > -1) {
                if(uc && party.memberOf) buyer = party;
                else if(!uc && !party.memberOf) buyer = party;
            }
        } )
    }

    return buyer;
}

function guatecomprasOCDSBuyersTransform(obj) {
    let release = obj;
    let country = 'GT';
    let entities = [];
    
    if(obj.hasOwnProperty('compiledRelease'))
        release = obj.compiledRelease;

    if(release.parties) {
        let buyer = getGuatecomprasOCDSBuyer(release.parties);
        if(buyer) {
            entities.push( {
                id: generateEntityID(buyer.name, country, 'GT'),
                name: buyer.name,
                classification: 'government_institution',
                type: buyer.details?.level?.description,
                identifier: buyer.identifier?.id,
                address: {
                    street: buyer.address?.streetAddress,
                    locality: buyer.address?.locality,
                    region: buyer.address?.region,
                    country: country
                },
                contactPoint: buyer.contactPoint,
                country: country,
                source: 'guatecompras_ocds',
                updated_date: release.tender.datePublished
            } );
        }

        let uc = getGuatecomprasOCDSBuyer(release.parties, true);
        if(uc) {
            entities.push( {
                id: generateEntityID(uc.name + ' UC', country, 'GT'),
                name: uc.name,
                classification: 'buyer_unit',
                identifier: uc.identifier?.id,
                member_of: {
                    id: generateEntityID(uc.memberOf[0].name, country, 'GT'),
                    name: uc.memberOf[0].name,
                },
                address: {
                    street: uc.address?.streetAddress,
                    locality: uc.address?.locality,
                    region: uc.address?.region,
                    country: country
                },
                contactPoint: uc.contactPoint,
                country: country,
                source: 'guatecompras_ocds',
                updated_date: release.tender.datePublished
            } );
        }
    }
   
    return entities;
}

function guatecomprasOCDSSuppliersTransform(obj) {
    let release = obj;
    let country = 'GT';
    let entities = [];
    
    if(obj.hasOwnProperty('compiledRelease'))
        release = obj.compiledRelease;

    if(release.parties) {
        release.parties.map( party => {
            if(party.roles.indexOf('supplier') >= 0) {
                let fixedName = parseRazonSocial(party.name);
                entities.push({
                    id: generateEntityID(fixedName, 'GT', 'GT'),
                    name: fixedName,
                    identifier: getOCDSSupplierID(party),
                    classification: party.details?.legalEntityTypeDetail?.description,
                    country: country,
                    address: {
                        street: party.address?.streetAddress,
                        locality: party.address?.locality,
                        region: party.address?.region,
                        country: country
                    },
                    contactPoint: party.contactPoint,
                    source: 'guatecompras_ocds',
                    updated_date: release.tender.datePublished
                })
            }
        } );
    }

    return entities;
}

function getOCDSSupplierID(party) {
    if(party?.identifier?.id) return party.identifier.id;
    let str = party.id;
    let parts = str.split('-');
    return parts[parts.length - 1];
}



/* * * * * */
/*  SIPOT  */
/* * * * * */

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



/* * * * * * * * * */
/*  PNT Temáticos  */
/* * * * * * * * * */

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



/* * * * * * */
/*  ProACT   */
/* * * * * * */

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



/* * * * * * * * */
/*  OpenTender   */
/* * * * * * * * */

function openTenderContractsTransform(obj) {
    let contracts = []
    if(!obj.releases || !obj.releases[0].awards) return contracts;

    obj.releases.map( release => {
        let country = '';
        if(extraData?.country && extraData.country != 'ted') country = extraData?.country.toUpperCase();
        else country = getOpenTenderCountry(release, 'buyer', release.buyer.name);
        
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
                        name: release.buyer.name,
                        country: country
                    },
                    supplier: {},
                    amount: parseFloat(award.value?.amount),
                    currency: award.value?.currency,
                    method: release.tender?.procurementMethod,
                    method_details: release.tender?.procurementMethodDetails,
                    category: [ release.tender?.mainProcurementCategory ],
                    url: getAwardNotice(award.documents), // Puede ser tenderNotice o awardNotice, usamos el segundo
                    source: 'opentender'
                }
                
                let allBuyers = getAllOpenTenderBuyers(release.parties, release.buyer.name);
                if(allBuyers.length > 0) {
                    contract.other_buyers = []
                    allBuyers.map(b => {
                        let buyer_country = getOpenTenderCountry(release, 'buyer', b.name);
                        contract.other_buyers.push({
                            id: generateEntityID(b.name, buyer_country, 'EU'),
                            name: b.name,
                            country: buyer_country
                        });
                    });
                }

                // Add supplier data
                if(award.suppliers?.length > 0 && award.suppliers[0].name) {
                    let supplier_country = getOpenTenderCountry(release, 'supplier', award.suppliers[0].name);
                    contract.supplier = {
                        id: generateEntityID(award.suppliers[0].name, supplier_country, country),
                        name: award.suppliers[0].name,
                        country: supplier_country
                    }
                }

                if(!contract.publish_date) {
                    if(contract.award_date) contract.publish_date = contract.award_date;
                    else if(contract.contract_date) contract.publish_date = contract.contract_date;
                    else delete contract.publish_date;
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
    if(!obj.releases || !obj.releases[0].parties?.length > 0) return [];
    
    let parties = [];
    obj.releases.map( release => {
        release.parties.map( party => {
            if(party.roles.indexOf(role) >= 0 && party.name) {
                let country = '';
                if(role == 'buyer' && extraData?.country && extraData.country != 'ted') country = extraData?.country.toUpperCase();
                else if(role == 'buyer' && extraData?.country && extraData.country == 'ted') country = getOpenTenderCountry(release, role, release.buyer.name);
                else country = getOpenTenderCountry(release, role, party.name);

                if(role == 'buyer' && party.name != release.buyer.name) return;
                let partyObj = {
                    id: generateEntityID(party.name, country, 'EU'),
                    name: party.name,
                    identifier: getTaxId(party.additionalIdentifiers),
                    country: country,
                    source: 'opentender',
                    updated_date: getContractDate(release.date)
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

                parties.push(partyObj);
            }
        } );
    } );

    return parties;
}

function getContractID(country, id_str) {
    let id = transliterate(id_str);
    if(!id.match(country + '_')) id = country + '_' + id;
    return id;
}

function getOpenTenderCountry(release, role, name='') {
    let country = '';
    if(release.parties?.length > 0) {
        let found = false;
        release.parties.map(party => {
            if(!found && party.roles.indexOf(role) >= 0) {
                if(party.address?.countryName) {
                    country = party.address?.countryName;
                    found = true;
                }
                if(name && name != party.name) {
                    country = '';
                    found = false;
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
        case 'Аргентина':
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
        
        case 'Bolgarija':
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
        case 'Dánia':
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
        
        case 'Lettország':
        case 'Latvia':
            return 'LV';
        
        case 'Moldova':
            return 'MD';
        
        case 'Crna Gora':
        case 'Монтенегро':
            return 'ME';
        
        case 'Nekdanja jug. republika Makedonija':
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
        case 'Недерланд':
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
        case "Törökország":
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

function getAllOpenTenderBuyers(parties, exclude_buyer='') {
    let buyers = [];
    let buyer_names = [];
    
    if(parties.length > 0) {
        parties.map(party => {
            if(party.name != exclude_buyer && party.roles.indexOf('buyer') >= 0) {
                if(buyer_names.indexOf(party.name) < 0) {
                    buyers.push(party);
                    buyer_names.push(party.name);
                }
            }
        });
    }
    
    return buyers;
}


/*  HELPERS   */

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

function generateEntityID(str, entity_country, contract_country) {
    str = str.replace(/\./g, ' ').trim();
    str = slugify(str + ' ' + (entity_country ? entity_country : contract_country));
    return str.replace(/-{2,}/g, '-');
}

const isISOString = (val) => {
    // Create a Date object from the input string
    const d = new Date(val);
    // Check if the date is valid (not NaN)
    return !Number.isNaN(d.valueOf());
};
