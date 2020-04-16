import React from 'react';
import isEmail from 'sane-email-validation';
import validUrl from 'valid-url';
import valid from 'card-validator';
import FileSaver from 'file-saver';
import { emaildomains } from './constants/emaildomains';

export function env(value) {
    const { _env } = window;
    return (
        (_env && _env[`REACT_APP_${value}`]) ||
        process.env[`REACT_APP_${value}`]
    );
}

let apiUrl = window.location.origin + '/api';
let dashboardUrl = window.location.origin + '/dashboard';
let adminDashboardUrl = window.location.origin + '/admin';
let accountsUrl = window.location.origin + '/accounts';
const licensingUrl = env('LICENSE_URL');

if (
    window &&
    window.location &&
    window.location.host &&
    window.location.host.includes('app.local')
) {
    apiUrl = 'http://backend.app.local:3002';
    dashboardUrl = 'http://dashboard.app.local:3000';
    adminDashboardUrl = 'http://admin.app.local:3100';
    accountsUrl = 'http://accounts.app.local:3003';
}

if (
    window &&
    window.location &&
    window.location.host &&
    (window.location.host.includes('localhost:') ||
        window.location.host.includes('0.0.0.0:') ||
        window.location.host.includes('127.0.0.1:'))
) {
    apiUrl = window.location.protocol + '//localhost:3002/api';
    dashboardUrl = window.location.protocol + '//localhost:3000/dashboard';
    adminDashboardUrl = window.location.protocol + '//localhost:3100/admin';
    accountsUrl = window.location.protocol + '//localhost:3003/accounts';
}

export const API_URL = apiUrl;

export const DASHBOARD_URL = dashboardUrl;

export const ACCOUNTS_URL = accountsUrl;

export const ADMIN_DASHBOARD_URL = adminDashboardUrl;

export const IS_SAAS_SERVICE = true;

export const IS_THIRD_PARTY_BILLING =
    env('IS_THIRD_PARTY_BILLING') === 'true' ? true : false;

export const LICENSING_URL = licensingUrl;

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
    },
};

//Data validation Util goes in here.
export const Validate = {
    isDomain(domain) {
        return domain.search(/\./) >= 0;
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
        } else {
            return false;
        }
    },

    isValidNumber(number) {
        // eslint-disable-next-line
        if (number.match('^[+]*[(]{0,1}[0-9]{1,4}[)]{0,1}[-s./0-9]*$')) {
            return true;
        }
        return false;
    },

    isStrongPassword(password) {
        if (password.match('^(?=.{8,})')) {
            return true;
        }
        return false;
    },

    email(email) {
        if (this.text(email)) return isEmail(email);
        return false;
    },

    isValidBusinessEmail(email) {
        return emaildomains.test(email);
    },

    compare(text1, text2) {
        return text1 === text2;
    },

    card(cardNumber) {
        const numberValidation = valid.number(cardNumber);

        if (!numberValidation.isPotentiallyValid) {
            return false;
        }

        return true;
    },

    cardExpiration(expiry) {
        const numberValidation = valid.expirationDate(expiry);

        if (!numberValidation.isPotentiallyValid) {
            return false;
        }

        return true;
    },

    cvv(cvv) {
        const numberValidation = valid.cvv(cvv);

        if (!numberValidation.isPotentiallyValid) {
            return false;
        }

        return true;
    },

    postalCode(postalCode) {
        const numberValidation = valid.postalCode(postalCode);

        if (!numberValidation.isPotentiallyValid) {
            return false;
        }

        return true;
    },

    isValidName(name) {
        // eslint-disable-next-line
        if (name.match('[A-Z][a-zA-Z][^#&<>"~;$^%{}?]{1,20}$')) {
            return true;
        }
        return false;
    },
};

export const ValidateField = {
    required: value =>
        value && value.length ? undefined : 'This field is required',

    select: value =>
        value && value.length && value.trim() !== ''
            ? undefined
            : 'Please select a value',

    maxValue10000: value =>
        value && value.length && value < 10000
            ? undefined
            : `input value should be less than ${10000}`,

    isDomain: domain =>
        domain.search(/\./) >= 0 ? undefined : 'Please enter a valid Domain',

    url: url => (validUrl.isUri(url) ? undefined : 'Please enter a valid Url'),

    text: text =>
        !text || text.trim() === ''
            ? 'This field cannot be left blank'
            : undefined,

    number: number =>
        number && number.length && !isNaN(number)
            ? undefined
            : 'Please enter a valid number',

    email: email =>
        this.text(email) && isEmail(email)
            ? undefined
            : 'Please enter a valid email',

    compare: (text1, text2) =>
        text1 === text2 ? undefined : 'These texts donot match',
};

export const PricingPlan = {
    getPlans() {
        if (
            env('STRIPE_PUBLIC_KEY') &&
            env('STRIPE_PUBLIC_KEY').startsWith('pk_test')
        ) {
            return [
                {
                    category: 'Startup',
                    planId: 'plan_GoWIYiX2L8hwzx',
                    type: 'month',
                    amount: 25,
                    details: '$25 / Month / User',
                },
                {
                    category: 'Startup',
                    planId: 'plan_GoWIqpBpStiqQp',
                    type: 'annual',
                    amount: 264,
                    details: '$264 / Year / User',
                },
                {
                    category: 'Growth',
                    planId: 'plan_GoWKgxRnPPBJWy',
                    type: 'month',
                    amount: 59,
                    details: '$59 / Month / User',
                },
                {
                    category: 'Growth',
                    planId: 'plan_GoWKiTdQ6NiQFw',
                    type: 'annual',
                    amount: 588,
                    details: '$588 / Year / User',
                },
            ];
        } else {
            return [
                {
                    category: 'Startup',
                    planId: 'plan_GoVgVbvNdbWwlm',
                    type: 'month',
                    amount: 25,
                    details: '$25 / Month / User',
                },
                {
                    category: 'Startup',
                    planId: 'plan_GoVgJu5PKMLRJU',
                    type: 'annual',
                    amount: 264,
                    details: '$264 / Year / User',
                },
                {
                    category: 'Growth',
                    planId: 'plan_GoVi9EIa6MU0fG',
                    type: 'month',
                    amount: 59,
                    details: '$59 / Month / User',
                },
                {
                    category: 'Growth',
                    planId: 'plan_GoViZshjqzZ0vv',
                    type: 'annual',
                    amount: 588,
                    details: '$588 / Year / User',
                },
            ];
        }
    },

    getPlanById(id) {
        const plans = this.getPlans();
        if (id) return plans.find(plan => plan.planId === id);
        else return plans[0];
    },
};

export const tutorials = {
    getMonitorTutorials() {
        return [
            {
                id: 's1',
                title: 'What are Monitors',
                icon: 'bell',
                description: (
                    <p>
                        You can add web and API server address to to monitor.
                        <br />
                        It allows you monitor the health status of your API
                    </p>
                ),
            },
            {
                id: 's2',
                title: 'What are Incidents',
                icon: 'bell',
                description: (
                    <p>
                        You can use this feature to acknowledge an incident that
                        occurred on a monitor
                        <br /> and mark the incident as resolved after resolving
                        the issue on your api or server
                    </p>
                ),
            },
            {
                id: 's3',
                title: 'Acknowledge/Resolve Incidents',
                icon: 'bell',
                description: (
                    <p>
                        You can use this feature to acknowledge an incident that
                        occurred on a monitor
                        <br /> and mark the incident as resolved after resolving
                        the issue on your api or server
                    </p>
                ),
            },
            {
                id: 's4',
                title: 'Status Metrics',
                icon: 'bell',
                description: (
                    <p>
                        Get detailed metrics of all incidents that occurred{' '}
                        <br />
                        on connected monitors and with date and time it was
                        resolved
                    </p>
                ),
            },
            {
                id: 's5',
                title: 'Better Status Handling',
                icon: 'bell',
                description: (
                    <p>
                        After adding monitors for your API, you won&apos;t miss
                        out on any
                        <br />
                        downtime on your servers, Just let Fyipe alert notify
                        you
                    </p>
                ),
            },
        ];
    },
};

export function getQueryVar(variable, url) {
    if (!url) return null;
    variable = variable.replace(/[[\]]/g, '\\$&');
    const regex = new RegExp('[?&]' + variable + '(=([^&#]*)|&|#|$)'),
        results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

export function saveFile(content, filename) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    FileSaver.saveAs(blob, filename);
}

export function makeCriteria(val) {
    const val2 = {};
    const and = [];
    const or = [];

    for (let i = 0; i < val.length; i++) {
        const val3 = {};
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
    const val2 = [];
    if (val && val.and && val.and.length) {
        for (let i = 0; i < val.and.length; i++) {
            const val3 = {};
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
            if (
                val.and[i].collection &&
                (val.and[i].collection.and || val.and[i].collection.or)
            ) {
                val3.field3 = true;
                val3.collection = mapCriteria(val.and[i].collection);
            } else {
                val3.field3 = false;
            }
            if (i === 0) {
                val3.match = 'all';
            }
            val2.push(val3);
        }
        return val2;
    } else if (val && val.or && val.or.length) {
        for (let i = 0; i < val.or.length; i++) {
            const val3 = {};
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
            if (
                val.or[i].collection &&
                (val.or[i].collection.and || val.or[i].collection.or)
            ) {
                val3.field3 = true;
                val3.collection = mapCriteria(val.or[i].collection);
            } else {
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
