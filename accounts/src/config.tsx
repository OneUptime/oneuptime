import React from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'sane... Remove this comment to see the full error message
import isEmail from 'sane-email-validation';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'vali... Remove this comment to see the full error message
import validUrl from 'valid-url';
import valid from 'card-validator';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'file... Remove this comment to see the full error message
import FileSaver from 'file-saver';
// import { emaildomains } from './constants/emaildomains';

let apiUrl = window.location.origin + '/api';
let dashboardUrl = window.location.origin + '/dashboard';
let adminDashboardUrl = window.location.origin + '/admin';
let accountsUrl = window.location.origin + '/accounts';

if (
    window &&
    window.location &&
    window.location.host &&
    (window.location.host.includes('localhost:') ||
        window.location.host.includes('0.0.0.0:') ||
        window.location.host.includes('127.0.0.1:'))
) {
    const address = window.location.host.includes('localhost:')
        ? 'localhost'
        : window.location.host.includes('0.0.0.0:')
        ? '0.0.0.0'
        : '127.0.0.1';
    apiUrl = window.location.protocol + `//${address}:3002/api`;
    dashboardUrl = window.location.protocol + `//${address}:3000/dashboard`;
    adminDashboardUrl = window.location.protocol + `//${address}:3100/admin`;
    accountsUrl = window.location.protocol + `//${address}:3003/accounts`;
}

export function env(value: $TSFixMe) {
    // @ts-expect-error ts-migrate(2339) FIXME: Property '_env' does not exist on type 'Window & t... Remove this comment to see the full error message
    const { _env } = window;
    return (
        (_env && _env[`REACT_APP_${value}`]) ||
        process.env[`REACT_APP_${value}`]
    );
}

export const API_URL = apiUrl;

export const DASHBOARD_URL = dashboardUrl;

export const ADMIN_DASHBOARD_URL = adminDashboardUrl;

export const ACCOUNTS_URL = accountsUrl;

export const IS_SAAS_SERVICE = !!env('IS_SAAS_SERVICE');

export const DISABLE_SIGNUP = env('DISABLE_SIGNUP') === 'true';

export const VERSION = process.env.VERSION || env('VERSION');

export const User = {
    getAccessToken() {
        return localStorage.getItem('access_token');
    },

    setAccessToken(token: $TSFixMe) {
        localStorage.setItem('access_token', token);
    },

    isCardRegistered() {
        return localStorage.getItem('cardRegistered');
    },

    setCardRegistered(value: $TSFixMe) {
        localStorage.setItem('cardRegistered', value);
    },

    setUserId(id: $TSFixMe) {
        localStorage.setItem('id', id);
    },

    getUserId() {
        return localStorage.getItem('id');
    },

    getName() {
        return localStorage.getItem('name');
    },

    setName(name: $TSFixMe) {
        localStorage.setItem('name', name);
    },

    getEmail() {
        return localStorage.getItem('email');
    },

    setEmail(email: $TSFixMe) {
        localStorage.setItem('email', email);
    },

    initialUrl() {
        return sessionStorage.getItem('initialUrl');
    },

    setInitialUrl(url: $TSFixMe) {
        sessionStorage.setItem('initialUrl', url);
    },

    setProject(project: $TSFixMe) {
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

    removeInitialUrl() {
        return sessionStorage.removeItem('initialUrl');
    },

    isLoggedIn() {
        return localStorage.getItem('access_token') ? true : false;
    },
};

//Data validation Util goes in here.
export const Validate = {
    isDomain(domain: $TSFixMe) {
        return domain.search(/\./) >= 0;
    },

    url(url: $TSFixMe) {
        return validUrl.isUri(url);
    },

    text(text: $TSFixMe) {
        if (!text || text.trim() === '') {
            return false;
        }

        return true;
    },

    number(number: $TSFixMe) {
        if (number && number.length && !isNaN(number)) {
            return true;
        } else {
            return false;
        }
    },

    isValidNumber(number: $TSFixMe) {
        if (number.match('^[+]*[(]{0,1}[0-9]{1,4}[)]{0,1}[-s./0-9]*$')) {
            return true;
        }
        return false;
    },

    isStrongPassword(password: $TSFixMe) {
        if (password.match('^(?=.{8,})')) {
            return true;
        }
        return false;
    },

    email(email: $TSFixMe) {
        if (this.text(email)) return isEmail(email);
        return false;
    },

    //eslint-disable-next-line
    isValidBusinessEmail(email: $TSFixMe) {
        //return emaildomains.test(email);
        return true;
    },

    compare(text1: $TSFixMe, text2: $TSFixMe) {
        return text1 === text2;
    },

    card(cardNumber: $TSFixMe) {
        const numberValidation = valid.number(cardNumber);

        if (!numberValidation.isPotentiallyValid) {
            return false;
        }

        return true;
    },

    cardExpiration(expiry: $TSFixMe) {
        const numberValidation = valid.expirationDate(expiry);

        if (!numberValidation.isPotentiallyValid) {
            return false;
        }

        return true;
    },

    cvv(cvv: $TSFixMe) {
        const numberValidation = valid.cvv(cvv);

        if (!numberValidation.isPotentiallyValid) {
            return false;
        }

        return true;
    },

    postalCode(postalCode: $TSFixMe) {
        const numberValidation = valid.postalCode(postalCode);

        if (!numberValidation.isPotentiallyValid) {
            return false;
        }

        return true;
    },

    isValidName(name: $TSFixMe) {
        if (name.match('[A-Z][a-zA-Z][^#&<>"~;$^%{}?]{1,20}$')) {
            return true;
        }
        return false;
    },
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
                    details: '$22/mo per user paid annually. ',
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
                    details: '$49/mo per user paid annually. ',
                },
                {
                    category: 'Scale',
                    planId: 'plan_H9Iox3l2YqLTDR',
                    type: 'month',
                    amount: 99,
                    details: '$120 / Month / User',
                },
                {
                    category: 'Scale',
                    planId: 'plan_H9IlBKhsFz4hV2',
                    type: 'annual',
                    amount: 1188,
                    details: '$99/mo per user paid annually. ',
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
                    details: '$22/mo per user paid annually. ',
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
                    details: '$49/mo per user paid annually. ',
                },
                {
                    category: 'Scale',
                    planId: 'plan_H9Ii6Qj3HLdtty',
                    type: 'month',
                    amount: 99,
                    details: '$120 / Month / User',
                },
                {
                    category: 'Scale',
                    planId: 'plan_H9IjvX2Flsvlcg',
                    type: 'annual',
                    amount: 1188,
                    details: '$99/mo per user paid annually. ',
                },
            ];
        }
    },

    getPlanById(id: $TSFixMe) {
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
                        downtime on your servers, Just let OneUptime alert
                        notify you
                    </p>
                ),
            },
        ];
    },
};

export function getQueryVar(variable: $TSFixMe, url: $TSFixMe) {
    if (!url) return null;
    variable = variable.replace(/[[\]]/g, '\\$&');
    const regex = new RegExp('[?&]' + variable + '(=([^&#]*)|&|#|$)'),
        results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

export function saveFile(content: $TSFixMe, filename: $TSFixMe) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    FileSaver.saveAs(blob, filename);
}
