import React from 'react';
import isEmail from 'sane-email-validation';
import validUrl from 'valid-url';
import valid from 'card-validator';
import { isServer } from './store';
import FileSaver from 'file-saver'

let apiUrl = 'http://localhost:3002';
let dashboardUrl = null;
let accountsUrl = null;
let domain = null;

// if (!isServer) {
//     if (window.location.href.indexOf('localhost') > -1) {
//         apiUrl = 'http://localhost:3002';
//         dashboardUrl = 'http://localhost:3000';
//         accountsUrl = 'http://localhost:3003';
//         domain = 'localhost';
//     } else if (window.location.href.indexOf('staging') > -1) {
//         apiUrl = 'https://staging-api.fyipe.com';
//         dashboardUrl = 'http://staging-dashboard.fyipe.com';
//         accountsUrl = 'http://staging-accounts.fyipe.com';
//         domain = 'fyipe.com';
//     } else {
//         apiUrl = 'https://api.fyipe.com';
//         dashboardUrl = 'https://fyipe.com';
//         accountsUrl = 'https://accounts.fyipe.com';
//         domain = 'fyipe.com';
//     }
// }


if (!isServer) {
    if (window.location.href.indexOf('localhost') > -1) {
        apiUrl = 'http://localhost:3002';
        dashboardUrl = 'http://localhost:3000';
        accountsUrl = 'http://localhost:3003';
        domain = 'localhost';
    } else {
        apiUrl = 'http://backend:3002';
        dashboardUrl = 'http://dashboard:3000';
        accountsUrl = 'http://accounts:3003';
        domain = 'local';
    }
}



export const API_URL = apiUrl;

export const DASHBOARD_URL = dashboardUrl;

export const ACCOUNTS_URL = accountsUrl;

export const DOMAIN_URL = domain;

export const User = {

    getAccessToken() {
        return localStorage.getItem('access_token');
    },

    setAccessToken(token) {
        localStorage.setItem('access_token', token);
    },

    isCardRegistered() {
        return localStorage.getItem('cardRegistered');
    },

    setCardRegistered(value) {
        localStorage.setItem('cardRegistered', value);
    },

    setUserId(id) {
        localStorage.setItem('id', id);
    },

    getUserId() {
        return localStorage.getItem('id');
    },

    getName() {
        return localStorage.getItem('name');
    },

    setName(name) {
        localStorage.setItem('name', name);
    },

    getEmail() {
        return localStorage.getItem('email');
    },

    setEmail(email) {
        localStorage.setItem('email', email);
    },
    initialUrl() {
        return sessionStorage.getItem('initialUrl');
    },
    setProject(project) {
        localStorage.setItem('project', project);
    },

    getProject() {
        return localStorage.getItem('project');
    },

    clear() {
        localStorage.clear();
    },

    removeUserId() {
        localStorage.removeItem('id');
    },

    removeAccessToken() {
        localStorage.removeItem('token');
    },

    isLoggedIn() {
        return localStorage.getItem('access_token') ? true : false;
    }

};

//Data validation Util goes in here.
export const Validate = {

    isDomain(domain) {
        return (domain.search(/\./) >= 0);
    },

    url(url) {
        return validUrl.isUri(url);
    },

    text(text) {

        if (!text || text.trim() === '') {
            return false;
        }

        return true;
    },

    number(number) {

        if (number && number.length && !isNaN(number)) {
            return true;
        }
        else {
            return false;
        }
    },

    email(email) {
        if (this.text(email))
            return isEmail(email);
        return false;
    },

    compare(text1, text2) {
        return text1 === text2;
    },

    card(cardNumber) {
        var numberValidation = valid.number(cardNumber);

        if (!numberValidation.isPotentiallyValid) {
            return false;
        }

        return true;
    },

    cardExpiration(expiry) {
        var numberValidation = valid.expirationDate(expiry);

        if (!numberValidation.isPotentiallyValid) {
            return false;
        }

        return true;
    },

    cvv(cvv) {
        var numberValidation = valid.cvv(cvv);

        if (!numberValidation.isPotentiallyValid) {
            return false;
        }

        return true;
    },

    postalCode(postalCode) {
        var numberValidation = valid.postalCode(postalCode);

        if (!numberValidation.isPotentiallyValid) {
            return false;
        }

        return true;
    }
}

export const ValidateField = {

    required: value => value && value.length ? undefined : 'This field is required',

    select: value => value && value.length && value.trim() !== '' ? undefined : 'Please select a value',

    maxValue10000: value => value && value.length && value < 10000 ? undefined : `input value should be less than ${10000}`,

    isDomain: domain => domain.search(/\./) >= 0 ? undefined : 'Please enter a valid Domain',

    url: url => validUrl.isUri(url) ? undefined : 'Please enter a valid Url',

    text: text => !text || text.trim() === '' ? 'This field cannot be left blank' : undefined,

    number: number => number && number.length && !isNaN(number) ? undefined : 'Please enter a valid number',

    email: email => this.text(email) && isEmail(email) ? undefined : 'Please enter a valid email',

    compare: (text1, text2) => text1 === text2 ? undefined : 'These texts donot match',
}

export const PricingPlan = {

    getPlans() {

        if (window.location.href.indexOf('localhost') > -1 || window.location.href.indexOf('staging') > -1) {
            return [
                {
                    category: 'Basic',
                    planId: 'plan_EgTJMZULfh6THW',
                    type: 'Month',
                    amount: 8,
                    details: '$8 / Month / User'
                },
                {
                    category: 'Basic',
                    planId: 'plan_EgTQAx3Z909Dne',
                    type: 'Annual',
                    amount: 80.4,
                    details: '$80.4 / Year / User'
                },
                /* {
                     category: 'Pro',
                     planId: 'plan_CpIZEEfT4YFSvF',
                     type: 'month',
                     amount: 49,
                     details: '$49 / Month'
                 },
                 {
                     category: 'Pro',
                     planId: 'plan_CpIZTQWQiIr6rY',
                     type: 'annual',
                     amount: 708,
                     details: '$708 / Year'
                 },
                 {
                     category: 'Pro Plus',
                     planId: 'plan_CpIatF9qAmeZLP',
                     type: 'month',
                     amount: 99,
                     details: '$99 / Month'
                 },
                 {
                     category: 'Pro Plus',
                     planId: 'plan_CpIbtqozj1UVGs',
                     type: 'annual',
                     amount: 1180,
                     details: '$1180 / Year'
                 } */
            ]
        } else {
            return [
                {
                    category: 'Basic',
                    planId: 'plan_EgT8cUrwsxaqCs',
                    type: 'Month',
                    amount: 8,
                    details: '$8 / Month / User'
                },
                {
                    category: 'Basic',
                    planId: 'plan_EgT9hrq9GdIGQ6',
                    type: 'Annual',
                    amount: 80.4,
                    details: '$80.4 / Year / User'
                },
                /* {
                     category: 'Pro',
                     planId: 'plan_CogeidQkPwkycV',
                     type: 'month',
                     amount: 49,
                     details: '$49 / Month'
                 },
                 {
                     category: 'Pro',
                     planId: 'plan_CogfwRVpqoOLO6',
                     type: 'annual',
                     amount: 708,
                     details: '$708 / Year'
                 },
                 {
                     category: 'Pro Plus',
                     planId: 'prod_Cogffh2xpitVg6',
                     type: 'month',
                     amount: 99,
                     details: '$99 / Month'
                 },
                 {
                     category: 'Pro Plus',
                     planId: 'plan_CoggNmls8dUpDy',
                     type: 'annual',
                     amount: 1180,
                     details: '$1180 / Year'
                 }*/
            ]
        }
    },

    getPlanById(id) {
        let plans = this.getPlans();
        if (id) return plans.find(plan => plan.planId === id);
        else return plans[0];
    },
}

export const tutorials = {

    getMonitorTutorials() {
        return [
            {
                id: 's1',
                title: 'What are Monitors',
                icon: 'bell',
                description: <p>You can add web and API server address to
                    to monitor.<br />It allows you monitor the health status of
                    your API</p>,
            },
            {
                id: 's2',
                title: 'What are Incidents',
                icon: 'bell',
                description: <p>You can use this feature to acknowledge an incident
                                that occurred on a monitor<br /> and mark the
incident as resolved after resolving the
                                issue on your api or server</p>,
            },
            {
                id: 's3',
                title: 'Acknowledge/Resolve Incidents',
                icon: 'bell',
                description: <p>You can use this feature to acknowledge an incident
                                that occurred on a monitor<br /> and mark the
incident as resolved after resolving the
                                issue on your api or server</p>,
            },
            {
                id: 's4',
                title: 'Status Metrics',
                icon: 'bell',
                description: <p>Get detailed metrics of all incidents that occurred <br />
                    on connected monitors and with date and time it was resolved
                                </p>,
            },
            {
                id: 's5',
                title: 'Better Status Handling',
                icon: 'bell',
                description: <p>After adding monitors for your API, you won&quot;t miss out on any<br />
                    downtime on your servers, Just let Fyipe alert notify you
                                </p>,
            },
        ]
    }
}

export function getQueryVar(variable, url) {
    if (!url) return null;
    variable = variable.replace(/[[\]]/g, '\\$&');
    var regex = new RegExp('[?&]' + variable + '(=([^&#]*)|&|#|$)'),
        results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

export function saveFile(content, filename) {
    var blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    FileSaver.saveAs(blob, filename);
}

export function makeCriteria(val){
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
            val3.collection = makeCriteria(val[i].collection);
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
}

export function mapCriteria(val) {
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
                val3.collection = mapCriteria(val.and[i].collection);
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
                val3.collection = mapCriteria(val.or[i].collection);
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