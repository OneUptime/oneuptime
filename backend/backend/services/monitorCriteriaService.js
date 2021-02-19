/* eslint-disable linebreak-style */
const MonitorCriteriaService = {
    getCriteria: function() {
        return {
            url: {
                up_1000: [
                    {
                        match: 'all',
                        field3: true,
                    },
                    {
                        match: 'all',
                        responseType: 'statusCode',
                        filter: 'gtEqualTo',
                        field1: '200',
                        field2: '',
                        field3: false,
                    },
                    {
                        responseType: 'statusCode',
                        filter: 'lessThan',
                        field1: '300',
                        field2: '',
                        field3: false,
                    },
                    {
                        responseType: 'doesRespond',
                        filter: 'isUp',
                        field1: '',
                        field2: '',
                        field3: false,
                    },
                    {
                        responseType: 'responseTime',
                        filter: 'ltEqualTo',
                        field1: '5000',
                        field2: '',
                        field3: false,
                    },
                ],
                up_1000_createAlert: false,
                up_1000_autoAcknowledge: false,
                up_1000_autoResolve: false,
                down_1000: [
                    {
                        match: 'all',
                        field3: true,
                    },
                    {
                        match: 'any',
                        responseType: 'doesRespond',
                        filter: 'isDown',
                        field1: '',
                        field2: '',
                        field3: false,
                    },
                    {
                        responseType: 'statusCode',
                        filter: 'gtEqualTo',
                        field1: '400',
                        field2: '',
                        field3: false,
                    },
                ],
                down_1000_createAlert: true,
                down_1000_autoAcknowledge: true,
                down_1000_autoResolve: true,
                degraded_1000: [
                    {
                        match: 'all',
                        field3: true,
                    },
                    {
                        match: 'all',
                        responseType: 'responseTime',
                        filter: 'greaterThan',
                        field1: '5000',
                        field2: '',
                        field3: false,
                    },
                ],
                degraded_1000_createAlert: true,
                degraded_1000_autoAcknowledge: true,
                degraded_1000_autoResolve: true,
                type_1000: 'url',
            },
            api: {
                up_1000: [
                    {
                        match: 'all',
                        field3: true,
                    },
                    {
                        match: 'all',
                        responseType: 'statusCode',
                        filter: 'gtEqualTo',
                        field1: '200',
                        field2: '',
                        field3: false,
                    },
                    {
                        responseType: 'statusCode',
                        filter: 'lessThan',
                        field1: '300',
                        field2: '',
                        field3: false,
                    },
                    {
                        responseType: 'doesRespond',
                        filter: 'isUp',
                        field1: '',
                        field2: '',
                        field3: false,
                    },
                    {
                        responseType: 'responseTime',
                        filter: 'ltEqualTo',
                        field1: '5000',
                        field2: '',
                        field3: false,
                    },
                ],
                up_1000_createAlert: false,
                up_1000_autoAcknowledge: false,
                up_1000_autoResolve: false,
                down_1000: [
                    {
                        match: 'all',
                        field3: true,
                    },
                    {
                        match: 'any',
                        responseType: 'doesRespond',
                        filter: 'isDown',
                        field1: '',
                        field2: '',
                        field3: false,
                    },
                    {
                        responseType: 'statusCode',
                        filter: 'gtEqualTo',
                        field1: '400',
                        field2: '',
                        field3: false,
                    },
                ],
                down_1000_createAlert: true,
                down_1000_autoAcknowledge: true,
                down_1000_autoResolve: true,
                degraded_1000: [
                    {
                        match: 'all',
                        field3: true,
                    },
                    {
                        match: 'all',
                        responseType: 'responseTime',
                        filter: 'greaterThan',
                        field1: '5000',
                        field2: '',
                        field3: false,
                    },
                ],
                degraded_1000_createAlert: true,
                degraded_1000_autoAcknowledge: true,
                degraded_1000_autoResolve: true,
                type_1000: 'api',
            },
            script: {
                up_1000: [
                    {
                        match: 'all',
                        field3: true,
                    },
                    {
                        match: 'all',
                        responseType: 'executes',
                        filter: 'executesIn',
                        field1: '5000',
                        field2: '',
                        field3: false,
                    },
                    {
                        responseType: 'error',
                        filter: 'doesNotThrowError',
                        field1: '',
                        field2: '',
                        field3: false,
                    },
                ],
                up_1000_createAlert: false,
                up_1000_autoAcknowledge: false,
                up_1000_autoResolve: false,
                down_1000: [
                    {
                        match: 'all',
                        field3: true,
                    },
                    {
                        match: 'any',
                        responseType: 'error',
                        filter: 'throwsError',
                        field1: '',
                        field2: '',
                        field3: false,
                    },
                    {
                        responseType: 'executes',
                        filter: 'doesNotExecuteIn',
                        field1: '15000',
                        field2: '',
                        field3: false,
                    },
                ],
                down_1000_createAlert: true,
                down_1000_autoAcknowledge: true,
                down_1000_autoResolve: true,
                degraded_1000: [
                    {
                        match: 'all',
                        field3: true,
                    },
                    {
                        match: 'all',
                        responseType: 'executes',
                        filter: 'doesNotExecuteIn',
                        field1: '5000',
                        field2: '',
                        field3: false,
                    },
                    {
                        responseType: 'error',
                        filter: 'doesNotThrowError',
                        field1: '',
                        field2: '',
                        field3: false,
                    },
                    {
                        responseType: 'executes',
                        filter: 'executesIn',
                        field1: '15000',
                        field2: '',
                        field3: false,
                    },
                ],
                degraded_1000_createAlert: true,
                degraded_1000_autoAcknowledge: true,
                degraded_1000_autoResolve: true,
                type_1000: 'script',
            },
            'server-monitor': {
                up_1000: [
                    {
                        match: 'all',
                        field3: true,
                    },
                    {
                        match: 'all',
                        responseType: 'storageUsage',
                        filter: 'greaterThan',
                        field1: '10',
                        field2: '',
                        field3: false,
                    },
                    {
                        responseType: 'doesRespond',
                        filter: 'isUp',
                        field1: '',
                        field2: '',
                        field3: false,
                    },
                ],
                up_1000_createAlert: false,
                up_1000_autoAcknowledge: false,
                up_1000_autoResolve: false,
                down_1000: [
                    {
                        match: 'all',
                        field3: true,
                    },
                    {
                        match: 'any',
                        responseType: 'storageUsage',
                        filter: 'lessThan',
                        field1: '5',
                        field2: '',
                        field3: false,
                    },
                ],
                down_1000_createAlert: true,
                down_1000_autoAcknowledge: true,
                down_1000_autoResolve: true,
                degraded_1000: [
                    {
                        match: 'all',
                        field3: true,
                    },
                    {
                        match: 'all',
                        responseType: 'storageUsage',
                        filter: 'greaterThan',
                        field1: '5',
                        field2: '',
                        field3: false,
                    },
                    {
                        responseType: 'doesRespond',
                        filter: 'isUp',
                        field1: '',
                        field2: '',
                        field3: false,
                    },
                    {
                        responseType: 'storageUsage',
                        filter: 'lessThan',
                        field1: '10',
                        field2: '',
                        field3: false,
                    },
                ],
                degraded_1000_createAlert: true,
                degraded_1000_autoAcknowledge: true,
                degraded_1000_autoResolve: true,
                type_1000: 'server-monitor',
            },
            default: {
                up_1000: [
                    {
                        match: 'all',
                        field3: true,
                    },
                    {
                        match: '',
                        responseType: '',
                        filter: '',
                        field1: '',
                        field2: '',
                        field3: false,
                    },
                ],
                up_1000_createAlert: false,
                up_1000_autoAcknowledge: false,
                up_1000_autoResolve: false,
                down_1000: [
                    {
                        match: 'all',
                        field3: true,
                    },
                    {
                        match: '',
                        responseType: '',
                        filter: '',
                        field1: '',
                        field2: '',
                        field3: false,
                    },
                ],
                down_1000_createAlert: true,
                down_1000_autoAcknowledge: true,
                down_1000_autoResolve: true,
                degraded_1000: [
                    {
                        match: 'all',
                        field3: true,
                    },
                    {
                        match: '',
                        responseType: '',
                        filter: '',
                        field1: '',
                        field2: '',
                        field3: false,
                    },
                ],
                degraded_1000_createAlert: true,
                degraded_1000_autoAcknowledge: true,
                degraded_1000_autoResolve: true,
                type_1000: '',
            },
            incomingHttpRequest: {
                up_1000: [
                    {
                        match: 'all',
                        field3: true,
                    },
                    {
                        match: 'all',
                        responseType: 'responseBody',
                        filter: 'notEmpty',
                        field1: '',
                        field2: '',
                        field3: false,
                    },
                ],
                up_1000_createAlert: false,
                up_1000_autoAcknowledge: false,
                up_1000_autoResolve: false,
                down_1000: [
                    {
                        match: 'all',
                        field3: true,
                    },
                    {
                        match: 'any',
                        responseType: 'responseBody',
                        filter: 'empty',
                        field1: '',
                        field2: '',
                        field3: false,
                    },
                ],
                down_1000_createAlert: true,
                down_1000_autoAcknowledge: true,
                down_1000_autoResolve: true,
                degraded_1000: [
                    {
                        match: 'all',
                        field3: true,
                    },
                    {
                        match: 'all',
                        responseType: 'responseBody',
                        filter: 'empty',
                        field1: '',
                        field2: '',
                        field3: false,
                    },
                ],
                degraded_1000_createAlert: true,
                degraded_1000_autoAcknowledge: true,
                degraded_1000_autoResolve: true,
                type_1000: 'script',
            },
            kubernetes: {
                up_1000: [
                    {
                        match: 'all',
                        field3: true,
                    },
                    {
                        match: 'any',
                        responseType: 'podStatus',
                        filter: 'equalTo',
                        field1: 'running',
                        field2: '',
                        field3: false,
                    },
                    {
                        responseType: 'podStatus',
                        filter: 'equalTo',
                        field1: 'succeeded',
                        field2: '',
                        field3: false,
                    },
                    {
                        responseType: 'podStatus',
                        filter: 'equalTo',
                        field1: 'pending',
                        field2: '',
                        field3: false,
                    },
                    {
                        match: 'any',
                        responseType: 'jobStatus',
                        filter: 'equalTo',
                        field1: 'running',
                        field2: '',
                        field3: false,
                    },
                    {
                        responseType: 'jobStatus',
                        filter: 'equalTo',
                        field1: 'succeeded',
                        field2: '',
                        field3: false,
                    },
                ],
                up_1000_createAlert: false,
                up_1000_autoAcknowledge: false,
                up_1000_autoResolve: false,
                down_1000: [],
                down_1000_createAlert: true,
                down_1000_autoAcknowledge: true,
                down_1000_autoResolve: true,
            },
            ip: {
                up_1000: [
                    {
                        match: 'all',
                        field3: true,
                    },
                    {
                        match: 'all',
                        responseType: 'respondsToPing',
                        filter: 'isUp',
                        field1: '',
                        field2: '',
                        field3: false,
                    },
                ],
                up_1000_createAlert: true,
                up_1000_autoAcknowledge: true,
                up_1000_autoResolve: true,
                down_1000: [
                    {
                        match: 'all',
                        field3: true,
                    },
                    {
                        match: 'any',
                        responseType: 'respondsToPing',
                        filter: 'isUp',
                        field1: '',
                        field2: '',
                        field3: false,
                    },
                    {
                        responseType: 'respondsToPing',
                        filter: 'isUp',
                        field1: '',
                        field2: '',
                        field3: false,
                    },
                ],
                down_1000_createAlert: true,
                down_1000_autoAcknowledge: true,
                down_1000_autoResolve: true,
                degraded_1000: [],
                type_1000: 'ip',
            },
        };
    },

    create: function(monitorType) {
        try {
            const criteria = this.getCriteria()[monitorType];
            const criteriaObj = {};
            if (criteria) {
                if (criteria.up_1000 && criteria.up_1000.length) {
                    const upCriteria = this.makeCriteria(criteria.up_1000);
                    upCriteria.scheduleIds = [];
                    upCriteria.createAlert = criteria.up_1000_createAlert
                        ? true
                        : false;
                    upCriteria.autoAcknowledge = criteria.up_1000_autoAcknowledge
                        ? true
                        : false;
                    upCriteria.autoResolve = criteria.up_1000_autoResolve
                        ? true
                        : false;
                    criteriaObj.up = [upCriteria];
                }
                if (criteria.degraded_1000 && criteria.degraded_1000.length) {
                    const degradedCriteria = this.makeCriteria(
                        criteria.degraded_1000
                    );
                    degradedCriteria.scheduleIds = [];
                    degradedCriteria.createAlert = criteria.degraded_1000_createAlert
                        ? true
                        : false;
                    degradedCriteria.autoAcknowledge = criteria.degraded_1000_autoAcknowledge
                        ? true
                        : false;
                    degradedCriteria.autoResolve = criteria.degraded_1000_autoResolve
                        ? true
                        : false;
                    criteriaObj.degraded = [degradedCriteria];
                }
                if (criteria.down_1000 && criteria.down_1000.length) {
                    const downCriteria = this.makeCriteria(criteria.down_1000);
                    downCriteria.scheduleIds = [];
                    downCriteria.createAlert = criteria.down_1000_createAlert
                        ? true
                        : false;
                    downCriteria.autoAcknowledge = criteria.down_1000_autoAcknowledge
                        ? true
                        : false;
                    downCriteria.autoResolve = criteria.down_1000_autoResolve
                        ? true
                        : false;

                    const defaultCriterion = {
                        ...downCriteria,
                        default: true,
                    };
                    criteriaObj.down = [defaultCriterion];
                }
            }

            return criteriaObj;
        } catch (error) {
            ErrorService.log('MonitorCriteriaService.create', error);
            throw error;
        }
    },

    makeCriteria: function(val) {
        const val2 = { and: [], or: [] };
        const finalVal = { and: {}, or: {} };

        const parentCondition = val[0] && val[0].match;
        val = val.filter(v => !v.field3);

        let nextStage;
        for (let i = 0; i < val.length; i++) {
            const val3 = {};
            let initCriteria = false;
            if (val[i].match && val[i].match === 'all') {
                nextStage = 'all';
                initCriteria = true;
                val3.match = val[i].match;
                val2.and.push([]);
            } else if (val[i].match && val[i].match === 'any') {
                nextStage = 'any';
                initCriteria = true;
                val3.match = val[i].match;
                val2.or.push([]);
            }

            if (val[i].responseType && val[i].responseType.length) {
                val3.responseType = val[i].responseType;
            }
            if (val[i].filter && val[i].filter.length) {
                val3.filter = val[i].filter;
            }
            if (val[i].field1 && val[i].field1.length) {
                val3.field1 =
                    val[i].field1 &&
                    typeof val[i].field1 === 'string' &&
                    val[i].field1.indexOf(';')
                        ? val[i].field1.replace(/;/g, '')
                        : val[i].field1;
            }
            if (val[i].field2 && val[i].field2.length) {
                val3.field2 =
                    val[i].field2 &&
                    typeof val[i].field2 === 'string' &&
                    val[i].field2.indexOf(';')
                        ? val[i].field2.replace(/;/g, '')
                        : val[i].field2;
            }

            if (
                nextStage &&
                nextStage === 'all' &&
                (initCriteria || !val[i].match)
            ) {
                val2.and[val2.and.length - 1].push(val3);
            }

            if (
                nextStage &&
                nextStage === 'any' &&
                (initCriteria || !val[i].match)
            ) {
                val2.or[val2.or.length - 1].push(val3);
            }
        }
        if (parentCondition === 'all') {
            finalVal.and = val2;
        } else if (parentCondition === 'any') {
            finalVal.or = val2;
        }

        return finalVal;
    },

    mapCriteria: function(val) {
        const val2 = [];
        if (val && !isEmpty(val.and)) {
            val2.push({ match: 'all', field3: true });
            if (val.and && val.and.and && val.and.and.length > 0) {
                for (let i = 0; i < val.and.and.length; i++) {
                    val2.push(...val.and.and[i]);
                }
            }
            if (val.and && val.and.or && val.and.or.length > 0) {
                for (let i = 0; i < val.and.or.length; i++) {
                    val2.push(...val.and.or[i]);
                }
            }
        } else if (val && !isEmpty(val.or)) {
            val2.push({ match: 'any', field3: true });
            if (val.or && val.or.and && val.or.and.length > 0) {
                for (let i = 0; i < val.and.and.length; i++) {
                    val2.push(...val.or.and[i]);
                }
            }
            if (val.or && val.or.or && val.or.or.length > 0) {
                for (let i = 0; i < val.and.or.length; i++) {
                    val2.push(...val.or.or[i]);
                }
            }
        }
        return val2;
    },
};

const ErrorService = require('../services/errorService');
const { isEmpty } = require('lodash');

module.exports = MonitorCriteriaService;
