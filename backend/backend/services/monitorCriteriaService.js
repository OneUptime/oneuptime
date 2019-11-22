/* eslint-disable linebreak-style */
const MonitorCriteriaService = {
    getCriteria: function () {
        return {
            url: {
                up_1000: [
                    { match: 'all', responseType: 'statusCode', filter: 'gtEqualTo', field1: '200', field2: '', field3: false },
                    { responseType: 'statusCode', filter: 'lessThan', field1: '300', field2: '', field3: false },
                    { responseType: 'doesRespond', filter: 'isUp', field1: '', field2: '', field3: false },
                    { responseType: 'responseTime', filter: 'ltEqualTo', field1: '5000', field2: '', field3: false }
                ], up_1000_createAlert: false, up_1000_autoAcknowledge: false, up_1000_autoResolve: false,
                down_1000: [
                    { match: 'any', responseType: 'doesRespond', filter: 'isDown', field1: '', field2: '', field3: false },
                    { responseType: 'statusCode', filter: 'gtEqualTo', field1: '400', field2: '', field3: false }
                ], down_1000_createAlert: true, down_1000_autoAcknowledge: true, down_1000_autoResolve: true,
                degraded_1000: [
                    { match: 'all', responseType: 'responseTime', filter: 'greaterThan', field1: '5000', field2: '', field3: false }
                ], degraded_1000_createAlert: true, degraded_1000_autoAcknowledge: true, degraded_1000_autoResolve: true,
                type_1000: 'url'
            },
            default: {
                up_1000: [{ match: '', responseType: '', filter: '', field1: '', field2: '', field3: false }], up_1000_createAlert: false, up_1000_autoAcknowledge: false, up_1000_autoResolve: false,
                down_1000: [{ match: '', responseType: '', filter: '', field1: '', field2: '', field3: false }], down_1000_createAlert: true, down_1000_autoAcknowledge: true, down_1000_autoResolve: true,
                degraded_1000: [{ match: '', responseType: '', filter: '', field1: '', field2: '', field3: false }], degraded_1000_createAlert: true, degraded_1000_autoAcknowledge: true, degraded_1000_autoResolve: true,
                type_1000: ''
            }
        };
    },

    create: function (monitorType) {
        try {
            const criteria = this.getCriteria()[monitorType];
            let criteriaObj = {};

            if (criteria) {
                if (criteria.up_1000 && criteria.up_1000.length) {
                    criteriaObj.up = this.makeCriteria(criteria.up_1000);
                    criteriaObj.up.createAlert = criteria.up_1000_createAlert ? true : false;
                    criteriaObj.up.autoAcknowledge = criteria.up_1000_autoAcknowledge ? true : false;
                    criteriaObj.up.autoResolve = criteria.up_1000_autoResolve ? true : false;
                }

                if (criteria.degraded_1000 && criteria.degraded_1000.length) {
                    criteriaObj.degraded = this.makeCriteria(criteria.degraded_1000);
                    criteriaObj.degraded.createAlert = criteria.degraded_1000_createAlert ? true : false;
                    criteriaObj.degraded.autoAcknowledge = criteria.degraded_1000_autoAcknowledge ? true : false;
                    criteriaObj.degraded.autoResolve = criteria.degraded_1000_autoResolve ? true : false;
                }

                if (criteria.down_1000 && criteria.down_1000.length) {
                    criteriaObj.down = this.makeCriteria(criteria.down_1000);
                    criteriaObj.down.createAlert = criteria.down_1000_createAlert ? true : false;
                    criteriaObj.down.autoAcknowledge = criteria.down_1000_autoAcknowledge ? true : false;
                    criteriaObj.down.autoResolve = criteria.down_1000_autoResolve ? true : false;
                }
            }

            return criteriaObj;
        } catch (error) {
            ErrorService.log('MonitorCriteriaService.getCriteria', error);
            throw error;
        }
    },

    makeCriteria: function (val) {
        let val2 = {};
        let and = [];
        let or = [];

        for (let i = 0; i < val.length; i++) {
            let val3 = {};
            if (val[i].responseType && val[i].responseType.length) {
                val3.responseType = val[i].responseType;
            }
            if (val[i].filter && val[i].filter.length) {
                val3.filter = val[i].filter;
            }
            if (val[i].field1 && val[i].field1.length) {
                val3.field1 = val[i].field1;
            }
            if (val[i].field2 && val[i].field2.length) {
                val3.field2 = val[i].field2;
            }
            if (val[i].collection && val[i].collection.length) {
                val3.collection = this.makeCriteria(val[i].collection);
            }
            if (val[0].match && val[0].match.length && val[0].match === 'all') {
                and.push(val3);
            }
            if (val[0].match && val[0].match.length && val[0].match === 'any') {
                or.push(val3);
            }
        }
        val2.and = and;
        val2.or = or;
        return val2;
    },

    mapCriteria: function (val) {
        let val2 = [];
        if (val && val.and && val.and.length) {
            for (let i = 0; i < val.and.length; i++) {
                let val3 = {};
                if (val.and[i].responseType && val.and[i].responseType.length) {
                    val3.responseType = val.and[i].responseType;
                }
                if (val.and[i].filter && val.and[i].filter.length) {
                    val3.filter = val.and[i].filter;
                }
                if (val.and[i].field1 && val.and[i].field1.length) {
                    val3.field1 = val.and[i].field1;
                }
                if (val.and[i].field2 && val.and[i].field2.length) {
                    val3.field2 = val.and[i].field2;
                }
                if (val.and[i].collection && (val.and[i].collection.and || val.and[i].collection.or)) {
                    val3.field3 = true;
                    val3.collection = this.mapCriteria(val.and[i].collection);
                }
                else {
                    val3.field3 = false;
                }
                if (i === 0) {
                    val3.match = 'all';
                }
                val2.push(val3);
            }
            return val2;
        }
        else if (val && val.or && val.or.length) {
            for (let i = 0; i < val.or.length; i++) {
                let val3 = {};
                if (val.or[i].responseType && val.or[i].responseType.length) {
                    val3.responseType = val.or[i].responseType;
                }
                if (val.or[i].filter && val.or[i].filter.length) {
                    val3.filter = val.or[i].filter;
                }
                if (val.or[i].field1 && val.or[i].field1.length) {
                    val3.field1 = val.or[i].field1;
                }
                if (val.or[i].field2 && val.or[i].field2.length) {
                    val3.field2 = val.or[i].field2;
                }
                if (val.or[i].collection && (val.or[i].collection.and || val.or[i].collection.or)) {
                    val3.field3 = true;
                    val3.collection = this.mapCriteria(val.or[i].collection);
                }
                else {
                    val3.field3 = false;
                }
                if (i === 0) {
                    val3.match = 'any';
                }
                val2.push(val3);
            }
            return val2;
        }
    }
};

var ErrorService = require('../services/errorService');

module.exports = MonitorCriteriaService;