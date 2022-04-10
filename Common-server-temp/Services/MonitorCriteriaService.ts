const MonitorCriteriaService = {
    getCriteria() {
        return {
            url: {
                up_1000: [
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
                        responseType: 'scriptExecution',
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
                        match: 'any',
                        responseType: 'scriptExecution',
                        filter: 'throwsError',
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
                        match: 'any',
                        responseType: 'scriptExecution',
                        filter: 'doesNotExecuteIn',
                        field1: '5000',
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
                        responseType: 'desiredDeployment',
                        filter: 'equalTo',
                        field1: 'readyDeployment',
                        field2: '',
                        field3: true,
                        criteria: [
                            {
                                match: 'all',
                                responseType: 'podStatus',
                                filter: 'notEqualTo',
                                field1: 'pending',
                                field2: '',
                                field3: false,
                            },
                            {
                                responseType: 'podStatus',
                                filter: 'notEqualTo',
                                field1: 'failed',
                                field2: '',
                                field3: false,
                            },
                            {
                                responseType: 'podStatus',
                                filter: 'notEqualTo',
                                field1: 'unknown',
                                field2: '',
                                field3: false,
                            },
                        ],
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
                        responseType: 'respondsToPing',
                        filter: 'isUp',
                        field1: '',
                        field2: '',
                        field3: false,
                    },
                ],
                up_1000_createAlert: false,
                up_1000_autoAcknowledge: true,
                up_1000_autoResolve: true,
                down_1000: [
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
                        filter: 'isDown',
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

    create(monitorType: $TSFixMe) {
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

                degradedCriteria.createAlert =
                    criteria.degraded_1000_createAlert ? true : false;

                degradedCriteria.autoAcknowledge =
                    criteria.degraded_1000_autoAcknowledge ? true : false;

                degradedCriteria.autoResolve =
                    criteria.degraded_1000_autoResolve ? true : false;

                criteriaObj.degraded = [degradedCriteria];
            }
            if (criteria.down_1000 && criteria.down_1000.length) {
                const downCriteria = this.makeCriteria(criteria.down_1000);

                downCriteria.scheduleIds = [];

                downCriteria.createAlert = criteria.down_1000_createAlert
                    ? true
                    : false;

                downCriteria.autoAcknowledge =
                    criteria.down_1000_autoAcknowledge ? true : false;

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
    },

    makeCriteria(val: $TSFixMe) {
        const val2 = {};
        const criteria = [];

        for (let i = 0; i < val.length; i++) {
            const val3 = {};
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

            let nestVal: $TSFixMe = [];
            nestVal = this.innerCriteria(val[i], nestVal);

            criteria.push(val3);
            criteria.push(...nestVal);

            if (val[0].match && val[0].match.length && val[0].match === 'all') {
                val2.condition = 'and';
            }
            if (val[0].match && val[0].match.length && val[0].match === 'any') {
                val2.condition = 'or';
            }
        }

        val2.criteria = criteria;
        return val2;
    },

    innerCriteria(val: $TSFixMe, nestVal: $TSFixMe) {
        nestVal = [...nestVal];
        if (val.criteria && val.criteria.length) {
            for (let j = 0; j < val.criteria.length; j++) {
                const innerVal = {};
                if (
                    val.criteria[j].responseType &&
                    val.criteria[j].responseType.length
                ) {
                    innerVal.responseType = val.criteria[j].responseType;
                }
                if (val.criteria[j].filter && val.criteria[j].filter.length) {
                    innerVal.filter = val.criteria[j].filter;
                }
                if (val.criteria[j].field1 && val.criteria[j].field1.length) {
                    innerVal.field1 =
                        val.criteria[j].field1 &&
                        typeof val.criteria[j].field1 === 'string' &&
                        val.criteria[j].field1.indexOf(';')
                            ? val.criteria[j].field1.replace(/;/g, '')
                            : val.criteria[j].field1;
                }
                if (val.criteria[j].field2 && val.criteria[j].field2.length) {
                    innerVal.field2 =
                        val.criteria[j].field2 &&
                        typeof val.criteria[j].field2 === 'string' &&
                        val.criteria[j].field2.indexOf(';')
                            ? val.criteria[j].field2.replace(/;/g, '')
                            : val.criteria[j].field2;
                }

                if (Object.keys(val.criteria[j]).includes('match')) {
                    const condition =
                        val.criteria[j].match === 'all' ? 'and' : 'or';
                    const criteria = [innerVal];
                    nestVal.push({ condition, criteria });
                } else {
                    nestVal[nestVal.length - 1].criteria.push(innerVal);
                }

                if (val.criteria[j].criteria) {
                    const out = this.innerCriteria(val.criteria[j], []);
                    nestVal[nestVal.length - 1].criteria.push(...out);
                }
            }
        }
        return nestVal;
    },

    mapCriteria(val: $TSFixMe) {
        const val2 = [];
        if (val && val.criteria && val.criteria.condition === 'and') {
            for (let i = 0; i < val.criteria.criteria.length; i++) {
                const val3 = {};
                if (
                    val.criteria.criteria[i].responseType &&
                    val.criteria.criteria[i].responseType.length
                ) {
                    val3.responseType = val.criteria.criteria[i].responseType;
                }
                if (
                    val.criteria.criteria[i].filter &&
                    val.criteria.criteria[i].filter.length
                ) {
                    val3.filter = val.criteria.criteria[i].filter;
                }
                if (
                    val.criteria.criteria[i].field1 &&
                    val.criteria.criteria[i].field1.length
                ) {
                    val3.field1 = val.criteria.criteria[i].field1;
                }
                if (
                    val.criteria.criteria[i].field2 &&
                    val.criteria.criteria[i].field2.length
                ) {
                    val3.field2 = val.criteria.criteria[i].field2;
                }

                const innerContainer: $TSFixMe = [];
                if (
                    val.criteria.criteria[i].criteria &&
                    val.criteria.criteria[i].criteria.length > 0 &&
                    (val.criteria.criteria[i].condition === 'and' ||
                        val.criteria.criteria[i].condition === 'or')
                ) {
                    this.mapNestedCriteria(
                        val.criteria.criteria[i],
                        innerContainer,
                        val2[val2.length - 1]
                    );
                } else {
                    val3.field3 = false;
                }
                if (i === 0) {
                    val3.match = 'all';
                }
                if (!isEmpty(val3)) {
                    val2.push(val3);
                }
            }
            return val2;
        } else if (val && val.criteria && val.criteria.condition === 'or') {
            for (let i = 0; i < val.criteria.criteria.length; i++) {
                const val3 = {};
                if (
                    val.criteria.criteria[i].responseType &&
                    val.criteria.criteria[i].responseType.length
                ) {
                    val3.responseType = val.criteria.criteria[i].responseType;
                }
                if (
                    val.criteria.criteria[i].filter &&
                    val.criteria.criteria[i].filter.length
                ) {
                    val3.filter = val.criteria.criteria[i].filter;
                }
                if (
                    val.criteria.criteria[i].field1 &&
                    val.criteria.criteria[i].field1.length
                ) {
                    val3.field1 = val.criteria.criteria[i].field1;
                }
                if (
                    val.criteria.criteria[i].field2 &&
                    val.criteria.criteria[i].field2.length
                ) {
                    val3.field2 = val.criteria.criteria[i].field2;
                }

                const innerContainer: $TSFixMe = [];
                if (
                    val.criteria.criteria[i].criteria &&
                    val.criteria.criteria[i].criteria.length > 0 &&
                    (val.criteria.criteria[i].condition === 'and' ||
                        val.criteria.criteria[i].condition === 'or')
                ) {
                    this.mapNestedCriteria(
                        val.criteria.criteria[i],
                        innerContainer,
                        val2[val2.length - 1]
                    );
                } else {
                    val3.field3 = false;
                }
                if (i === 0) {
                    val3.match = 'any';
                }
                if (!isEmpty(val3)) {
                    val2.push(val3);
                }
            }
            return val2;
        }
    },

    mapNestedCriteria(
        criteriaObj: $TSFixMe,
        innerContainer: $TSFixMe,
        cr: $TSFixMe
    ) {
        innerContainer = [...innerContainer];
        for (let j = 0; j < criteriaObj.criteria.length; j++) {
            const innerVal = {};
            if (
                criteriaObj.criteria[j].responseType &&
                criteriaObj.criteria[j].responseType.length
            ) {
                innerVal.responseType = criteriaObj.criteria[j].responseType;
            }
            if (
                criteriaObj.criteria[j].filter &&
                criteriaObj.criteria[j].filter.length
            ) {
                innerVal.filter = criteriaObj.criteria[j].filter;
            }
            if (
                criteriaObj.criteria[j].field1 &&
                criteriaObj.criteria[j].field1.length
            ) {
                innerVal.field1 = criteriaObj.criteria[j].field1;
            }
            if (
                criteriaObj.criteria[j].field2 &&
                criteriaObj.criteria[j].field2.length
            ) {
                innerVal.field2 = criteriaObj.criteria[j].field2;
            }

            if (j === 0 && criteriaObj.condition === 'and') {
                innerVal.match = 'all';
            } else if (j === 0 && criteriaObj.condition === 'or') {
                innerVal.match = 'any';
            }

            if (
                criteriaObj.criteria[j].criteria &&
                criteriaObj.criteria[j].criteria.length > 0
            ) {
                this.mapNestedCriteria(
                    criteriaObj.criteria[j],
                    [],
                    innerContainer[innerContainer.length - 1]
                );
            }

            if (!isEmpty(innerVal)) {
                innerContainer.push(innerVal);
            }
        }
        cr.field3 = true;
        if (cr.criteria) {
            cr.criteria.push(...innerContainer);
        } else {
            cr.criteria = innerContainer;
        }
    },
};

import { isEmpty } from 'lodash';

export default MonitorCriteriaService;
