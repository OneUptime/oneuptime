import React from 'react';
import isEmail from 'sane-email-validation';
import validUrl from 'valid-url';
import valid from 'card-validator';
import FileSaver from 'file-saver';
import moment from 'moment';
import { emaildomains } from './constants/emaildomains';
// import booleanParser from './utils/booleanParser';

let apiUrl = window.location.origin + '/api';
let dashboardUrl = window.location.origin + '/dashboard';
let accountsUrl = window.location.origin + '/accounts';

const isLocalhost =
    window &&
    window.location &&
    window.location.host &&
    (window.location.host.includes('localhost:') ||
        window.location.host.includes('0.0.0.0:') ||
        window.location.host.includes('127.0.0.1:'));

if (isLocalhost) {
    apiUrl = window.location.protocol + '//localhost:3002/api';
    dashboardUrl = window.location.protocol + '//localhost:3000/dashboard';
    accountsUrl = window.location.protocol + '//localhost:3003/accounts';
}

export function env(value) {
    const { _env } = window;
    return (
        (_env && _env[`REACT_APP_${value}`]) ||
        process.env[`REACT_APP_${value}`]
    );
}

export const API_URL = apiUrl;

export const DASHBOARD_URL = dashboardUrl;

export const ACCOUNTS_URL = accountsUrl;

export const DOMAIN_URL = window.location.origin;

export const SHOULD_LOG_ANALYTICS = !!env('AMPLITUDE_PUBLIC_KEY');

export const IS_SAAS_SERVICE = process.env.REACT_APP_IS_SAAS_SERVICE;

export const IS_LOCALHOST = isLocalhost;

export const User = {
    getAccessToken() {
        return localStorage.getItem('access_token');
    },

    setCurrentProjectId(projectId) {
        localStorage.setItem('current_project_id', projectId);
    },

    getCurrentProjectId() {
        return localStorage.getItem('current_project_id');
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
        if (typeof number === 'string' && number.length === 0) {
            return false;
        }

        if (number && !isNaN(number)) {
            return true;
        } else {
            return false;
        }
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
};

export const ValidateField = {
    required: value =>
        value && value.length ? undefined : 'This field is required',

    select: value =>
        value
            ? value.value
                ? value.value.length && value.value.trim() !== ''
                    ? undefined
                    : 'Please select a value'
                : value.length && value.trim() !== ''
                ? undefined
                : 'Please select a value'
            : 'Please select a value',

    maxValue10000: value =>
        value && value.length && value < 10000
            ? undefined
            : `input value should be less than ${10000}`,

    maxValue20000: value =>
        value && value.length && value < 20000
            ? undefined
            : `input value should be less than ${20000}`,

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
                {
                    category: 'Scale',
                    planId: 'plan_H9Iox3l2YqLTDR',
                    type: 'month',
                    amount: 99,
                    details: '$99 / Month / User',
                },
                {
                    category: 'Scale',
                    planId: 'plan_H9IlBKhsFz4hV2',
                    type: 'annual',
                    amount: 1188,
                    details: '$1188 / Year / User',
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
                {
                    category: 'Scale',
                    planId: 'plan_H9Ii6Qj3HLdtty',
                    type: 'month',
                    amount: 99,
                    details: '$99 / Month / User',
                },
                {
                    category: 'Scale',
                    planId: 'plan_H9IjvX2Flsvlcg',
                    type: 'annual',
                    amount: 1188,
                    details: '$1188 / Year / User',
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
    getTutorials() {
        return [
            {
                id: 'component',
                title: 'What are Components?',
                iconText: 'component',
                icon:
                    'data:image/svg+xml;utf8;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pg0KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE5LjAuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPg0KPHN2ZyB2ZXJzaW9uPSIxLjEiIGlkPSJDYXBhXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4Ig0KCSB2aWV3Qm94PSIwIDAgMzkyLjggMzkyLjgiIHN0eWxlPSJlbmFibGUtYmFja2dyb3VuZDpuZXcgMCAwIDM5Mi44IDM5Mi44OyIgeG1sOnNwYWNlPSJwcmVzZXJ2ZSI+DQo8Zz4NCgk8cG9seWdvbiBzdHlsZT0iZmlsbDojRDlBQzgwOyIgcG9pbnRzPSIxOTYuNCwwIDI5Miw0OS4yIDM4OCw5OCAyOTIsMTQ3LjIgMTk2LjQsMTk2LjQgMTAwLjgsMTQ3LjIgNC44LDk4IDEwMC44LDQ5LjIgCSIvPg0KCTxwb2x5Z29uIHN0eWxlPSJmaWxsOiNEN0JBQTQ7IiBwb2ludHM9IjMxNiwxNzkuNiAzMTYsMTM1LjIgMjY4LDE1OS42IDI2OCwyMDQgMjk0LjQsMTcxLjYgCSIvPg0KCTxwb2x5Z29uIHN0eWxlPSJmaWxsOiNBNjdFNEY7IiBwb2ludHM9IjE5Ni40LDE5Ni40IDE5Ni40LDM5Mi44IDM4OCwyOTQuOCAzODgsOTggMzE2LDEzNS4yIDMxNC40LDEzNiAzMTQuNCwxNzkuMiAyOTQuNCwxNzEuNiANCgkJMjY4LDIwNCAyNjgsMTU5LjYgCSIvPg0KCTxwb2x5Z29uIHN0eWxlPSJmaWxsOiM5MjZFNDM7IiBwb2ludHM9IjE5Ni40LDM5Mi44IDE5Ni40LDE5Ni40IDEwMC44LDE0Ny4yIDQuOCw5OCA0LjgsMjk0LjggCSIvPg0KCTxwb2x5Z29uIHN0eWxlPSJmaWxsOiNGMkQzQkE7IiBwb2ludHM9Ijc2LjgsNjEuMiAyNjgsMTU5LjYgMzE0LjQsMTM2IDMxNiwxMzUuMiAxMjQuOCwzNi44IDEwMC44LDQ5LjIgCSIvPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPC9zdmc+DQo=',
                description: (
                    <p>
                        Components are like containers that contain other Fyipe
                        resources. For example: If you&apos;re trying to monitor
                        your Home Page of your business, create a new container
                        called Home
                    </p>
                ),
            },
            {
                id: 'monitor',
                title: 'What are Monitors?',
                iconText: 'monitor',
                icon:
                    'data:image/svg+xml;utf8;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pgo8IS0tIEdlbmVyYXRvcjogQWRvYmUgSWxsdXN0cmF0b3IgMTkuMC4wLCBTVkcgRXhwb3J0IFBsdWctSW4gLiBTVkcgVmVyc2lvbjogNi4wMCBCdWlsZCAwKSAgLS0+CjxzdmcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIgdmVyc2lvbj0iMS4xIiBpZD0iTGF5ZXJfMSIgeD0iMHB4IiB5PSIwcHgiIHZpZXdCb3g9IjAgMCA1MTIgNTEyIiBzdHlsZT0iZW5hYmxlLWJhY2tncm91bmQ6bmV3IDAgMCA1MTIgNTEyOyIgeG1sOnNwYWNlPSJwcmVzZXJ2ZSIgd2lkdGg9IjUxMnB4IiBoZWlnaHQ9IjUxMnB4Ij4KPGc+Cgk8cmVjdCB4PSI4OC4yNzYiIHk9IjMyNi42MjEiIHN0eWxlPSJmaWxsOiNEN0RFRUQ7IiB3aWR0aD0iMTcuNjU1IiBoZWlnaHQ9IjQ0LjEzOCIvPgoJPHJlY3QgeD0iMTY3LjcyNCIgeT0iMjkxLjMxIiBzdHlsZT0iZmlsbDojRDdERUVEOyIgd2lkdGg9IjE3LjY1NSIgaGVpZ2h0PSI3OS40NDgiLz4KCTxyZWN0IHg9IjMyNi42MjEiIHk9IjI1NiIgc3R5bGU9ImZpbGw6I0Q3REVFRDsiIHdpZHRoPSIxNy42NTUiIGhlaWdodD0iMTE0Ljc1OSIvPgoJPHJlY3QgeD0iNDA2LjA2OSIgeT0iMTY3LjcyNCIgc3R5bGU9ImZpbGw6I0Q3REVFRDsiIHdpZHRoPSIxNy42NTUiIGhlaWdodD0iMjAzLjAzNCIvPgoJPHJlY3QgeD0iMjQ3LjE3MiIgeT0iMjExLjg2MiIgc3R5bGU9ImZpbGw6I0Q3REVFRDsiIHdpZHRoPSIxNy42NTUiIGhlaWdodD0iMTU4Ljg5NyIvPgo8L2c+CjxwYXRoIHN0eWxlPSJmaWxsOiM4Rjk2QUM7IiBkPSJNOTcuMTA4LDMzNS40NTFjLTMuMzgyLDAtNi42MS0xLjk1NC04LjA3Mi01LjI0NWMtMS45OC00LjQ1NSwwLjAyNi05LjY3Miw0LjQ4Mi0xMS42NTJsNzcuNzMtMzQuNTQ3ICBsNzguMTktODYuODc4YzIuOTMyLTMuMjYsNy44MS0zLjg3MywxMS40NTgtMS40NGw3Mi43ODgsNDguNTI1bDc0LjM3OS05MC45MDhjMy4wODctMy43NzUsOC42NDgtNC4zMzEsMTIuNDIzLTEuMjQyICBjMy43NzMsMy4wODcsNC4zMjksOC42NDksMS4yNDIsMTIuNDIybC03OS40NDgsOTcuMTAzYy0yLjg3NiwzLjUxNi03Ljk0OSw0LjI3Ny0xMS43MjksMS43NTZsLTczLjA5Ny00OC43M2wtNzQuMzQyLDgyLjYwMSAgYy0wLjgyOSwwLjkyMS0xLjg0MywxLjY1OC0yLjk3NiwyLjE2MmwtNzkuNDQ4LDM1LjMxQzk5LjUyMywzMzUuMjA2LDk4LjMwNiwzMzUuNDUxLDk3LjEwOCwzMzUuNDUxeiIvPgo8cGF0aCBzdHlsZT0iZmlsbDojOTU5Q0IzOyIgZD0iTTQ5NC4zNDUsNDMyLjU1MkgxNy42NTVDNy45MDQsNDMyLjU1MiwwLDQyNC42NDgsMCw0MTQuODk3di04LjgyOGMwLTQuODc1LDMuOTUzLTguODI4LDguODI4LTguODI4ICBoNDk0LjM0NWM0Ljg3NSwwLDguODI4LDMuOTUzLDguODI4LDguODI4djguODI4QzUxMiw0MjQuNjQ4LDUwNC4wOTYsNDMyLjU1Miw0OTQuMzQ1LDQzMi41NTJ6Ii8+CjxwYXRoIHN0eWxlPSJmaWxsOiM3MDc0ODc7IiBkPSJNMjg1Ljg1NSw0MTQuODk3aC01OS43MDljLTMuMzQzLDAtNi40LTEuODg5LTcuODk1LTQuODc5bC02LjM4OS0xMi43NzZoODguMjc2bC02LjM4OCwxMi43NzYgIEMyOTIuMjU1LDQxMy4wMDcsMjg5LjE5OCw0MTQuODk3LDI4NS44NTUsNDE0Ljg5N3oiLz4KPHBhdGggc3R5bGU9ImZpbGw6I0FGQjlEMjsiIGQ9Ik00NjcuODYyLDc5LjQ0OEg0NC4xMzhjLTE0LjYyNiwwLTI2LjQ4MywxMS44NTctMjYuNDgzLDI2LjQ4M3YyOTEuMzFoNDc2LjY5di0yOTEuMzEgIEM0OTQuMzQ1LDkxLjMwNSw0ODIuNDg4LDc5LjQ0OCw0NjcuODYyLDc5LjQ0OHogTTQ2Ny44NjIsMzYxLjkzMWMwLDQuODc1LTMuOTUzLDguODI4LTguODI4LDguODI4SDUyLjk2NiAgYy00Ljg3NSwwLTguODI4LTMuOTUzLTguODI4LTguODI4VjExNC43NTljMC00Ljg3NSwzLjk1My04LjgyOCw4LjgyOC04LjgyOGg0MDYuMDY5YzQuODc1LDAsOC44MjgsMy45NTMsOC44MjgsOC44MjhWMzYxLjkzMXoiLz4KPGNpcmNsZSBzdHlsZT0iZmlsbDojRkZENzgyOyIgY3g9IjI1NiIgY3k9IjIwMy4wMzQiIHI9IjE3LjY1NSIvPgo8Y2lyY2xlIHN0eWxlPSJmaWxsOiNGRjY0NjQ7IiBjeD0iMTc2LjU1MiIgY3k9IjI5MS4zMSIgcj0iMTcuNjU1Ii8+CjxjaXJjbGUgc3R5bGU9ImZpbGw6IzlCRTZEMjsiIGN4PSI0MTQuODk3IiBjeT0iMTU4Ljg5NyIgcj0iMTcuNjU1Ii8+CjxjaXJjbGUgc3R5bGU9ImZpbGw6I0MzRTY3ODsiIGN4PSIzMzUuNDQ4IiBjeT0iMjU2IiByPSIxNy42NTUiLz4KPGNpcmNsZSBzdHlsZT0iZmlsbDojMDBEMkZGOyIgY3g9Ijk3LjEwMyIgY3k9IjMyNi42MjEiIHI9IjE3LjY1NSIvPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8L3N2Zz4K',
                description: (
                    <p>
                        Monitors lets you monitor any resource like API&apos;s,
                        Websites, Servers, Containers, IoT device and more.
                        Create a new monitor below.
                    </p>
                ),
            },
            {
                id: 'incident',
                title: 'What are Incidents?',
                iconText: 'incident',
                icon:
                    'data:image/svg+xml;utf8;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pgo8IS0tIEdlbmVyYXRvcjogQWRvYmUgSWxsdXN0cmF0b3IgMTkuMC4wLCBTVkcgRXhwb3J0IFBsdWctSW4gLiBTVkcgVmVyc2lvbjogNi4wMCBCdWlsZCAwKSAgLS0+CjxzdmcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIgdmVyc2lvbj0iMS4xIiBpZD0iTGF5ZXJfMSIgeD0iMHB4IiB5PSIwcHgiIHZpZXdCb3g9IjAgMCA1MTIuMDAxIDUxMi4wMDEiIHN0eWxlPSJlbmFibGUtYmFja2dyb3VuZDpuZXcgMCAwIDUxMi4wMDEgNTEyLjAwMTsiIHhtbDpzcGFjZT0icHJlc2VydmUiIHdpZHRoPSI1MTJweCIgaGVpZ2h0PSI1MTJweCI+CjxnPgoJPHBhdGggc3R5bGU9ImZpbGw6I0ZGNjQ2NDsiIGQ9Ik0zODguNDE0LDEyMy41ODdsMy44MzYtNDIuMTg2YzAuMzc0LTQuMTE0LDIuMTc4LTcuOTY1LDUuMDk5LTEwLjg4Nmw1Mi44NTgtNTIuODYgICBjMy40NDctMy40NDcsOS4wMzctMy40NDcsMTIuNDg0LDBsMzEuNjU0LDMxLjY1NGMzLjQ0NywzLjQ0NywzLjQ0Nyw5LjAzNywwLDEyLjQ4NGwtNTIuODYsNTIuODYgICBjLTIuOTIxLDIuOTIxLTYuNzczLDQuNzI1LTEwLjg4Niw1LjA5OUwzODguNDE0LDEyMy41ODd6Ii8+Cgk8Y2lyY2xlIHN0eWxlPSJmaWxsOiNGRjY0NjQ7IiBjeD0iMjExLjg2MiIgY3k9IjMwMC4xMzkiIHI9IjIxMS44NjIiLz4KPC9nPgo8Y2lyY2xlIHN0eWxlPSJmaWxsOiNGRkZGRkY7IiBjeD0iMjExLjg2MiIgY3k9IjMwMC4xMzkiIHI9IjE1OC44OTciLz4KPGNpcmNsZSBzdHlsZT0iZmlsbDojRkY2NDY0OyIgY3g9IjIxMS44NjIiIGN5PSIzMDAuMTM5IiByPSIxMDUuOTMxIi8+CjxjaXJjbGUgc3R5bGU9ImZpbGw6I0ZGRkZGRjsiIGN4PSIyMTEuODYyIiBjeT0iMzAwLjEzOSIgcj0iNTIuOTY2Ii8+CjxwYXRoIHN0eWxlPSJmaWxsOiM0NjQ2NTU7IiBkPSJNMjExLjg2MiwzMDguOTY2Yy0yLjI1OSwwLTQuNTE4LTAuODYyLTYuMjQxLTIuNTg2Yy0zLjQ0OC0zLjQ0OC0zLjQ0OC05LjAzNSwwLTEyLjQ4M2wyOTEuMzEtMjkxLjMxICBjMy40NDgtMy40NDgsOS4wMzUtMy40NDgsMTIuNDgzLDBjMy40NDgsMy40NDgsMy40NDgsOS4wMzQsMCwxMi40ODJsLTI5MS4zMSwyOTEuMzEgIEMyMTYuMzgsMzA4LjEwNSwyMTQuMTIxLDMwOC45NjYsMjExLjg2MiwzMDguOTY2eiIvPgo8cGF0aCBzdHlsZT0iZmlsbDojRkY2NDY0OyIgZD0iTTUwOS40MTQsMi41ODdjLTMuNDQ4LTMuNDQ4LTkuMDM1LTMuNDQ4LTEyLjQ4MywwbC0xNS4wNjksMTUuMDY5bDEyLjQ4MywxMi40ODJsMTUuMDY5LTE1LjA2OSAgQzUxMi44NjIsMTEuNjIxLDUxMi44NjIsNi4wMzYsNTA5LjQxNCwyLjU4N3oiLz4KPGc+CjwvZz4KPGc+CjwvZz4KPGc+CjwvZz4KPGc+CjwvZz4KPGc+CjwvZz4KPGc+CjwvZz4KPGc+CjwvZz4KPGc+CjwvZz4KPGc+CjwvZz4KPGc+CjwvZz4KPGc+CjwvZz4KPGc+CjwvZz4KPGc+CjwvZz4KPGc+CjwvZz4KPGc+CjwvZz4KPC9zdmc+Cg==',
                description: (
                    <p>
                        When any of your resources (like API&apos;s, Websites,
                        etc) do not behave normally, an incident is created and
                        your on-call team is alerted.
                    </p>
                ),
            },
            {
                id: 'status-page',
                title: 'What is a status page?',
                iconText: 'status',
                icon:
                    'data:image/svg+xml;utf8;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pgo8IS0tIEdlbmVyYXRvcjogQWRvYmUgSWxsdXN0cmF0b3IgMTkuMC4wLCBTVkcgRXhwb3J0IFBsdWctSW4gLiBTVkcgVmVyc2lvbjogNi4wMCBCdWlsZCAwKSAgLS0+CjxzdmcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIgdmVyc2lvbj0iMS4xIiBpZD0iTGF5ZXJfMSIgeD0iMHB4IiB5PSIwcHgiIHZpZXdCb3g9IjAgMCA1MTIgNTEyIiBzdHlsZT0iZW5hYmxlLWJhY2tncm91bmQ6bmV3IDAgMCA1MTIgNTEyOyIgeG1sOnNwYWNlPSJwcmVzZXJ2ZSIgd2lkdGg9IjUxMnB4IiBoZWlnaHQ9IjUxMnB4Ij4KPHBhdGggc3R5bGU9ImZpbGw6I0UxQzNBMDsiIGQ9Ik00MDYuMDY5LDUxMkgxMDUuOTMxYy0xOS41MDEsMC0zNS4zMS0xNS44MDktMzUuMzEtMzUuMzFWNzAuNjIxYzAtMTkuNTAxLDE1LjgwOS0zNS4zMSwzNS4zMS0zNS4zMSAgaDMwMC4xMzhjMTkuNTAxLDAsMzUuMzEsMTUuODA5LDM1LjMxLDM1LjMxVjQ3Ni42OUM0NDEuMzc5LDQ5Ni4xOTEsNDI1LjU3LDUxMiw0MDYuMDY5LDUxMnoiLz4KPHBhdGggc3R5bGU9ImZpbGw6I0VGRjJGQTsiIGQ9Ik00MDYuMDY5LDQ4NS41MTdIMTA1LjkzMWMtNC44NzUsMC04LjgyOC0zLjk1My04LjgyOC04LjgyOFY3MC42MjFjMC00Ljg3NSwzLjk1My04LjgyOCw4LjgyOC04LjgyOCAgaDMwMC4xMzhjNC44NzUsMCw4LjgyOCwzLjk1Myw4LjgyOCw4LjgyOFY0NzYuNjlDNDE0Ljg5Nyw0ODEuNTY1LDQxMC45NDQsNDg1LjUxNyw0MDYuMDY5LDQ4NS41MTd6Ii8+CjxwYXRoIHN0eWxlPSJmaWxsOiNDN0NGRTI7IiBkPSJNMzA4Ljk2NiwzNS4zMWgtMjYuNDgzdi04LjgyOEMyODIuNDgzLDExLjg1NywyNzAuNjI2LDAsMjU2LDBzLTI2LjQ4MywxMS44NTctMjYuNDgzLDI2LjQ4M3Y4LjgyOCAgaC0yNi40ODNjLTkuNzUsMC0xNy42NTUsNy45MDQtMTcuNjU1LDE3LjY1NXYxNy42NTVoMTQxLjI0MVY1Mi45NjZDMzI2LjYyMSw0My4yMTQsMzE4LjcxNiwzNS4zMSwzMDguOTY2LDM1LjMxeiBNMjU2LDM1LjMxICBjLTQuODc1LDAtOC44MjgtMy45NTMtOC44MjgtOC44MjhzMy45NTMtOC44MjgsOC44MjgtOC44MjhzOC44MjgsMy45NTMsOC44MjgsOC44MjhTMjYwLjg3NSwzNS4zMSwyNTYsMzUuMzF6Ii8+CjxwYXRoIHN0eWxlPSJmaWxsOiNBRkI5RDI7IiBkPSJNMzI2LjYyMSw3OS40NDhIMTg1LjM3OWMtNC44NzUsMC04LjgyOC0zLjk1My04LjgyOC04LjgyOGwwLDBjMC00Ljg3NSwzLjk1My04LjgyOCw4LjgyOC04LjgyOCAgaDE0MS4yNDFjNC44NzUsMCw4LjgyOCwzLjk1Myw4LjgyOCw4LjgyOGwwLDBDMzM1LjQ0OCw3NS40OTYsMzMxLjQ5Niw3OS40NDgsMzI2LjYyMSw3OS40NDh6Ii8+CjxwYXRoIHN0eWxlPSJmaWxsOiM4Mjg4OUQ7IiBkPSJNMTY3LjcyNCwyMDMuMDM0Yy0yLjI1OSwwLTQuNTE4LTAuODYyLTYuMjQxLTIuNTg2TDEzNSwxNzMuOTY1Yy0zLjQ0OC0zLjQ0OC0zLjQ0OC05LjAzNSwwLTEyLjQ4MyAgYzMuNDQ4LTMuNDQ4LDkuMDM1LTMuNDQ4LDEyLjQ4MywwbDIwLjI0MSwyMC4yNDJsMzcuODk3LTM3Ljg5N2MzLjQ0OC0zLjQ0OCw5LjAzNS0zLjQ0OCwxMi40ODMsMGMzLjQ0OCwzLjQ0OCwzLjQ0OCw5LjAzNSwwLDEyLjQ4MyAgbC00NC4xMzgsNDQuMTM4QzE3Mi4yNDIsMjAyLjE3MywxNjkuOTgzLDIwMy4wMzQsMTY3LjcyNCwyMDMuMDM0eiIvPgo8ZyBzdHlsZT0ib3BhY2l0eTowLjk3OyI+Cgk8cGF0aCBzdHlsZT0iZmlsbDojQUZCOUQyOyIgZD0iTTMxNy43OTMsMTY3LjcyNGgtNzAuNjIxYy00Ljg3NSwwLTguODI4LTMuOTUzLTguODI4LTguODI4bDAsMGMwLTQuODc1LDMuOTUzLTguODI4LDguODI4LTguODI4ICAgaDcwLjYyMWM0Ljg3NSwwLDguODI4LDMuOTUzLDguODI4LDguODI4bDAsMEMzMjYuNjIxLDE2My43NzIsMzIyLjY2OCwxNjcuNzI0LDMxNy43OTMsMTY3LjcyNHoiLz4KPC9nPgo8ZyBzdHlsZT0ib3BhY2l0eTowLjk3OyI+Cgk8cGF0aCBzdHlsZT0iZmlsbDojQzdDRkUyOyIgZD0iTTM2MS45MzEsMjAzLjAzNEgyNDcuMTcyYy00Ljg3NSwwLTguODI4LTMuOTUzLTguODI4LTguODI4bDAsMGMwLTQuODc1LDMuOTUzLTguODI4LDguODI4LTguODI4ICAgaDExNC43NTljNC44NzUsMCw4LjgyOCwzLjk1Myw4LjgyOCw4LjgyOGwwLDBDMzcwLjc1OSwxOTkuMDgyLDM2Ni44MDYsMjAzLjAzNCwzNjEuOTMxLDIwMy4wMzR6Ii8+CjwvZz4KPHBhdGggc3R5bGU9ImZpbGw6IzgyODg5RDsiIGQ9Ik0xNjcuNzI0LDQxNC44OTdjLTIuMjU5LDAtNC41MTgtMC44NjItNi4yNDEtMi41ODZMMTM1LDM4NS44MjdjLTMuNDQ4LTMuNDQ4LTMuNDQ4LTkuMDM1LDAtMTIuNDgzICBjMy40NDgtMy40NDgsOS4wMzUtMy40NDgsMTIuNDgzLDBsMjAuMjQxLDIwLjI0MmwzNy44OTctMzcuODk3YzMuNDQ4LTMuNDQ4LDkuMDM1LTMuNDQ4LDEyLjQ4MywwYzMuNDQ4LDMuNDQ4LDMuNDQ4LDkuMDM1LDAsMTIuNDgzICBsLTQ0LjEzOCw0NC4xMzhDMTcyLjI0Miw0MTQuMDM1LDE2OS45ODMsNDE0Ljg5NywxNjcuNzI0LDQxNC44OTd6Ii8+CjxnIHN0eWxlPSJvcGFjaXR5OjAuOTc7Ij4KCTxwYXRoIHN0eWxlPSJmaWxsOiNBRkI5RDI7IiBkPSJNMzE3Ljc5MywzNzkuNTg2aC03MC42MjFjLTQuODc1LDAtOC44MjgtMy45NTMtOC44MjgtOC44MjhsMCwwYzAtNC44NzUsMy45NTMtOC44MjgsOC44MjgtOC44MjggICBoNzAuNjIxYzQuODc1LDAsOC44MjgsMy45NTMsOC44MjgsOC44MjhsMCwwQzMyNi42MjEsMzc1LjYzNCwzMjIuNjY4LDM3OS41ODYsMzE3Ljc5MywzNzkuNTg2eiIvPgo8L2c+CjxnIHN0eWxlPSJvcGFjaXR5OjAuOTc7Ij4KCTxwYXRoIHN0eWxlPSJmaWxsOiNDN0NGRTI7IiBkPSJNMzYxLjkzMSw0MTQuODk3SDI0Ny4xNzJjLTQuODc1LDAtOC44MjgtMy45NTMtOC44MjgtOC44MjhsMCwwYzAtNC44NzUsMy45NTMtOC44MjgsOC44MjgtOC44MjggICBoMTE0Ljc1OWM0Ljg3NSwwLDguODI4LDMuOTUzLDguODI4LDguODI4bDAsMEMzNzAuNzU5LDQxMC45NDQsMzY2LjgwNiw0MTQuODk3LDM2MS45MzEsNDE0Ljg5N3oiLz4KPC9nPgo8cGF0aCBzdHlsZT0iZmlsbDojODI4ODlEOyIgZD0iTTE2Ny43MjQsMzA4Ljk2NmMtMi4yNTksMC00LjUxOC0wLjg2Mi02LjI0MS0yLjU4NkwxMzUsMjc5Ljg5NmMtMy40NDgtMy40NDgtMy40NDgtOS4wMzUsMC0xMi40ODMgIGMzLjQ0OC0zLjQ0OCw5LjAzNS0zLjQ0OCwxMi40ODMsMGwyMC4yNDEsMjAuMjQybDM3Ljg5Ny0zNy44OTdjMy40NDgtMy40NDgsOS4wMzUtMy40NDgsMTIuNDgzLDBjMy40NDgsMy40NDgsMy40NDgsOS4wMzUsMCwxMi40ODMgIGwtNDQuMTM4LDQ0LjEzOEMxNzIuMjQyLDMwOC4xMDQsMTY5Ljk4MywzMDguOTY2LDE2Ny43MjQsMzA4Ljk2NnoiLz4KPGcgc3R5bGU9Im9wYWNpdHk6MC45NzsiPgoJPHBhdGggc3R5bGU9ImZpbGw6I0FGQjlEMjsiIGQ9Ik0zMTcuNzkzLDI3My42NTVoLTcwLjYyMWMtNC44NzUsMC04LjgyOC0zLjk1My04LjgyOC04LjgyOGwwLDBjMC00Ljg3NSwzLjk1My04LjgyOCw4LjgyOC04LjgyOCAgIGg3MC42MjFjNC44NzUsMCw4LjgyOCwzLjk1Myw4LjgyOCw4LjgyOGwwLDBDMzI2LjYyMSwyNjkuNzAzLDMyMi42NjgsMjczLjY1NSwzMTcuNzkzLDI3My42NTV6Ii8+CjwvZz4KPGcgc3R5bGU9Im9wYWNpdHk6MC45NzsiPgoJPHBhdGggc3R5bGU9ImZpbGw6I0M3Q0ZFMjsiIGQ9Ik0zNjEuOTMxLDMwOC45NjZIMjQ3LjE3MmMtNC44NzUsMC04LjgyOC0zLjk1My04LjgyOC04LjgyOGwwLDBjMC00Ljg3NSwzLjk1My04LjgyOCw4LjgyOC04LjgyOCAgIGgxMTQuNzU5YzQuODc1LDAsOC44MjgsMy45NTMsOC44MjgsOC44MjhsMCwwQzM3MC43NTksMzA1LjAxMywzNjYuODA2LDMwOC45NjYsMzYxLjkzMSwzMDguOTY2eiIvPgo8L2c+CjxnPgo8L2c+CjxnPgo8L2c+CjxnPgo8L2c+CjxnPgo8L2c+CjxnPgo8L2c+CjxnPgo8L2c+CjxnPgo8L2c+CjxnPgo8L2c+CjxnPgo8L2c+CjxnPgo8L2c+CjxnPgo8L2c+CjxnPgo8L2c+CjxnPgo8L2c+CjxnPgo8L2c+CjxnPgo8L2c+Cjwvc3ZnPgo=',
                description: (
                    <p>
                        Status Pages helps your team and your customers to view
                        real-time status and health of your monitors.
                        <br />
                        Status Page helps improve transparency and trust in your
                        organization and with your customers.
                    </p>
                ),
            },
            {
                id: 'call-schedule',
                title: 'What are call schedules?',
                iconText: 'schedule',
                icon:
                    'data:image/svg+xml;utf8;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pgo8IS0tIEdlbmVyYXRvcjogQWRvYmUgSWxsdXN0cmF0b3IgMTkuMC4wLCBTVkcgRXhwb3J0IFBsdWctSW4gLiBTVkcgVmVyc2lvbjogNi4wMCBCdWlsZCAwKSAgLS0+CjxzdmcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIgdmVyc2lvbj0iMS4xIiBpZD0iTGF5ZXJfMSIgeD0iMHB4IiB5PSIwcHgiIHZpZXdCb3g9IjAgMCA1MTIgNTEyIiBzdHlsZT0iZW5hYmxlLWJhY2tncm91bmQ6bmV3IDAgMCA1MTIgNTEyOyIgeG1sOnNwYWNlPSJwcmVzZXJ2ZSIgd2lkdGg9IjUxMnB4IiBoZWlnaHQ9IjUxMnB4Ij4KPHBhdGggc3R5bGU9ImZpbGw6I0VGRjJGQTsiIGQ9Ik00OTQuMzQ1LDQ1OS4wMzRIMTcuNjU1QzcuOTA0LDQ1OS4wMzQsMCw0NTEuMTMsMCw0NDEuMzc5VjM1LjMxYzAtOS43NTEsNy45MDQtMTcuNjU1LDE3LjY1NS0xNy42NTUgIGg0NzYuNjljOS43NTEsMCwxNy42NTUsNy45MDQsMTcuNjU1LDE3LjY1NXY0MDYuMDY5QzUxMiw0NTEuMTI5LDUwNC4wOTUsNDU5LjAzNCw0OTQuMzQ1LDQ1OS4wMzR6Ii8+CjxwYXRoIHN0eWxlPSJmaWxsOiNFNEVBRjY7IiBkPSJNMzc4LjE5MSw0NTkuMDM0YzEyLjA0NC0yMC43OTEsMTkuMDUtNDQuODY0LDE5LjA1LTcwLjYyMWMwLTc4LjAwNS02My4yMzYtMTQxLjI0MS0xNDEuMjQxLTE0MS4yNDEgIHMtMTQxLjI0MSw2My4yMzYtMTQxLjI0MSwxNDEuMjQxYzAsMjUuNzU3LDcuMDA2LDQ5LjgyOSwxOS4wNSw3MC42MjFIMzc4LjE5MXoiLz4KPHBhdGggc3R5bGU9ImZpbGw6I0ZGNjQ2NDsiIGQ9Ik01MTIsMTA1LjkzMUgwVjM1LjMxYzAtOS43NTEsNy45MDQtMTcuNjU1LDE3LjY1NS0xNy42NTVoNDc2LjY5YzkuNzUxLDAsMTcuNjU1LDcuOTA0LDE3LjY1NSwxNy42NTUgIFYxMDUuOTMxeiIvPgo8cmVjdCB5PSIxMDUuOTMxIiBzdHlsZT0iZmlsbDojRTRFQUY2OyIgd2lkdGg9IjUxMiIgaGVpZ2h0PSIxNy42NTUiLz4KPGNpcmNsZSBzdHlsZT0iZmlsbDojRDI1NTVBOyIgY3g9Ijc1LjAzNCIgY3k9IjU3LjM3OSIgcj0iMjYuNDgzIi8+CjxwYXRoIHN0eWxlPSJmaWxsOiNDN0NGRTI7IiBkPSJNNzUuMDM0LDcwLjYyMUw3NS4wMzQsNzAuNjIxYy03LjMxMywwLTEzLjI0MS01LjkyOS0xMy4yNDEtMTMuMjQxVjEzLjI0MSAgQzYxLjc5Myw1LjkyOSw2Ny43MjIsMCw3NS4wMzQsMGwwLDBjNy4zMTMsMCwxMy4yNDEsNS45MjksMTMuMjQxLDEzLjI0MXY0NC4xMzhDODguMjc2LDY0LjY5Miw4Mi4zNDcsNzAuNjIxLDc1LjAzNCw3MC42MjF6Ii8+CjxwYXRoIHN0eWxlPSJmaWxsOiNBRkI5RDI7IiBkPSJNNzUuMDM0LDQ0LjEzOGMtNy4zMTMsMC0xMy4yNDEtNS45MjktMTMuMjQxLTEzLjI0MXYyNi40ODNjMCw3LjMxMyw1LjkyOSwxMy4yNDEsMTMuMjQxLDEzLjI0MSAgYzcuMzEzLDAsMTMuMjQxLTUuOTI5LDEzLjI0MS0xMy4yNDFWMzAuODk3Qzg4LjI3NiwzOC4yMDksODIuMzQ3LDQ0LjEzOCw3NS4wMzQsNDQuMTM4eiIvPgo8Y2lyY2xlIHN0eWxlPSJmaWxsOiNEMjU1NUE7IiBjeD0iNDM2Ljk2NiIgY3k9IjU3LjM3OSIgcj0iMjYuNDgzIi8+CjxwYXRoIHN0eWxlPSJmaWxsOiNDN0NGRTI7IiBkPSJNNDM2Ljk2Niw3MC42MjFMNDM2Ljk2Niw3MC42MjFjLTcuMzEzLDAtMTMuMjQxLTUuOTI5LTEzLjI0MS0xMy4yNDFWMTMuMjQxICBDNDIzLjcyNCw1LjkyOSw0MjkuNjUzLDAsNDM2Ljk2NiwwbDAsMGM3LjMxMywwLDEzLjI0MSw1LjkyOSwxMy4yNDEsMTMuMjQxdjQ0LjEzOEM0NTAuMjA3LDY0LjY5Miw0NDQuMjc4LDcwLjYyMSw0MzYuOTY2LDcwLjYyMXoiLz4KPHBhdGggc3R5bGU9ImZpbGw6I0FGQjlEMjsiIGQ9Ik00MzYuOTY2LDQ0LjEzOGMtNy4zMTMsMC0xMy4yNDEtNS45MjktMTMuMjQxLTEzLjI0MXYyNi40ODNjMCw3LjMxMyw1LjkyOSwxMy4yNDEsMTMuMjQxLDEzLjI0MSAgczEzLjI0MS01LjkyOSwxMy4yNDEtMTMuMjQxVjMwLjg5N0M0NTAuMjA3LDM4LjIwOSw0NDQuMjc4LDQ0LjEzOCw0MzYuOTY2LDQ0LjEzOHoiLz4KPGc+Cgk8cGF0aCBzdHlsZT0iZmlsbDojRTRFQUY2OyIgZD0iTTk3LjEwMywyMjkuNTE3aC0zNS4zMWMtNC44NzUsMC04LjgyOC0zLjk1My04LjgyOC04LjgyOHYtMjYuNDgzYzAtNC44NzUsMy45NTMtOC44MjgsOC44MjgtOC44MjggICBoMzUuMzFjNC44NzUsMCw4LjgyOCwzLjk1Myw4LjgyOCw4LjgyOHYyNi40ODNDMTA1LjkzMSwyMjUuNTY1LDEwMS45NzgsMjI5LjUxNyw5Ny4xMDMsMjI5LjUxN3oiLz4KCTxwYXRoIHN0eWxlPSJmaWxsOiNFNEVBRjY7IiBkPSJNMTY3LjcyNCwyMjkuNTE3aC0zNS4zMWMtNC44NzUsMC04LjgyOC0zLjk1My04LjgyOC04LjgyOHYtMjYuNDgzYzAtNC44NzUsMy45NTMtOC44MjgsOC44MjgtOC44MjggICBoMzUuMzFjNC44NzUsMCw4LjgyOCwzLjk1Myw4LjgyOCw4LjgyOHYyNi40ODNDMTc2LjU1MiwyMjUuNTY1LDE3Mi41OTksMjI5LjUxNywxNjcuNzI0LDIyOS41MTd6Ii8+Cgk8cGF0aCBzdHlsZT0iZmlsbDojRTRFQUY2OyIgZD0iTTIzOC4zNDUsMjI5LjUxN2gtMzUuMzFjLTQuODc1LDAtOC44MjgtMy45NTMtOC44MjgtOC44Mjh2LTI2LjQ4M2MwLTQuODc1LDMuOTUzLTguODI4LDguODI4LTguODI4ICAgaDM1LjMxYzQuODc1LDAsOC44MjgsMy45NTMsOC44MjgsOC44Mjh2MjYuNDgzQzI0Ny4xNzIsMjI1LjU2NSwyNDMuMjIsMjI5LjUxNywyMzguMzQ1LDIyOS41MTd6Ii8+Cgk8cGF0aCBzdHlsZT0iZmlsbDojRTRFQUY2OyIgZD0iTTMwOC45NjYsMjI5LjUxN2gtMzUuMzFjLTQuODc1LDAtOC44MjgtMy45NTMtOC44MjgtOC44Mjh2LTI2LjQ4M2MwLTQuODc1LDMuOTUzLTguODI4LDguODI4LTguODI4ICAgaDM1LjMxYzQuODc1LDAsOC44MjgsMy45NTMsOC44MjgsOC44Mjh2MjYuNDgzQzMxNy43OTMsMjI1LjU2NSwzMTMuODQxLDIyOS41MTcsMzA4Ljk2NiwyMjkuNTE3eiIvPgo8L2c+CjxnPgoJPHBhdGggc3R5bGU9ImZpbGw6I0Q3REVFRDsiIGQ9Ik0zNzkuNTg2LDIyOS41MTdoLTM1LjMxYy00Ljg3NSwwLTguODI4LTMuOTUzLTguODI4LTguODI4di0yNi40ODNjMC00Ljg3NSwzLjk1My04LjgyOCw4LjgyOC04LjgyOCAgIGgzNS4zMWM0Ljg3NSwwLDguODI4LDMuOTUzLDguODI4LDguODI4djI2LjQ4M0MzODguNDE0LDIyNS41NjUsMzg0LjQ2MSwyMjkuNTE3LDM3OS41ODYsMjI5LjUxN3oiLz4KCTxwYXRoIHN0eWxlPSJmaWxsOiNEN0RFRUQ7IiBkPSJNNDUwLjIwNywyMjkuNTE3aC0zNS4zMWMtNC44NzUsMC04LjgyOC0zLjk1My04LjgyOC04LjgyOHYtMjYuNDgzYzAtNC44NzUsMy45NTMtOC44MjgsOC44MjgtOC44MjggICBoMzUuMzFjNC44NzUsMCw4LjgyOCwzLjk1Myw4LjgyOCw4LjgyOHYyNi40ODNDNDU5LjAzNCwyMjUuNTY1LDQ1NS4wODIsMjI5LjUxNyw0NTAuMjA3LDIyOS41MTd6Ii8+CjwvZz4KPGc+Cgk8cGF0aCBzdHlsZT0iZmlsbDojQzdDRkUyOyIgZD0iTTk3LjEwMywxNjcuNzI0aC0zNS4zMWMtNC44NzUsMC04LjgyOC0zLjk1My04LjgyOC04LjgyOGwwLDBjMC00Ljg3NSwzLjk1My04LjgyOCw4LjgyOC04LjgyOCAgIGgzNS4zMWM0Ljg3NSwwLDguODI4LDMuOTUzLDguODI4LDguODI4bDAsMEMxMDUuOTMxLDE2My43NzIsMTAxLjk3OCwxNjcuNzI0LDk3LjEwMywxNjcuNzI0eiIvPgoJPHBhdGggc3R5bGU9ImZpbGw6I0M3Q0ZFMjsiIGQ9Ik0xNjcuNzI0LDE2Ny43MjRoLTM1LjMxYy00Ljg3NSwwLTguODI4LTMuOTUzLTguODI4LTguODI4bDAsMGMwLTQuODc1LDMuOTUzLTguODI4LDguODI4LTguODI4ICAgaDM1LjMxYzQuODc1LDAsOC44MjgsMy45NTMsOC44MjgsOC44MjhsMCwwQzE3Ni41NTIsMTYzLjc3MiwxNzIuNTk5LDE2Ny43MjQsMTY3LjcyNCwxNjcuNzI0eiIvPgoJPHBhdGggc3R5bGU9ImZpbGw6I0M3Q0ZFMjsiIGQ9Ik0yMzguMzQ1LDE2Ny43MjRoLTM1LjMxYy00Ljg3NSwwLTguODI4LTMuOTUzLTguODI4LTguODI4bDAsMGMwLTQuODc1LDMuOTUzLTguODI4LDguODI4LTguODI4ICAgaDM1LjMxYzQuODc1LDAsOC44MjgsMy45NTMsOC44MjgsOC44MjhsMCwwQzI0Ny4xNzIsMTYzLjc3MiwyNDMuMjIsMTY3LjcyNCwyMzguMzQ1LDE2Ny43MjR6Ii8+Cgk8cGF0aCBzdHlsZT0iZmlsbDojQzdDRkUyOyIgZD0iTTMwOC45NjYsMTY3LjcyNGgtMzUuMzFjLTQuODc1LDAtOC44MjgtMy45NTMtOC44MjgtOC44MjhsMCwwYzAtNC44NzUsMy45NTMtOC44MjgsOC44MjgtOC44MjggICBoMzUuMzFjNC44NzUsMCw4LjgyOCwzLjk1Myw4LjgyOCw4LjgyOGwwLDBDMzE3Ljc5MywxNjMuNzcyLDMxMy44NDEsMTY3LjcyNCwzMDguOTY2LDE2Ny43MjR6Ii8+CjwvZz4KPGc+Cgk8cGF0aCBzdHlsZT0iZmlsbDojRkY2NDY0OyIgZD0iTTM3OS41ODYsMTY3LjcyNGgtMzUuMzFjLTQuODc1LDAtOC44MjgtMy45NTMtOC44MjgtOC44MjhsMCwwYzAtNC44NzUsMy45NTMtOC44MjgsOC44MjgtOC44MjggICBoMzUuMzFjNC44NzUsMCw4LjgyOCwzLjk1Myw4LjgyOCw4LjgyOGwwLDBDMzg4LjQxNCwxNjMuNzcyLDM4NC40NjEsMTY3LjcyNCwzNzkuNTg2LDE2Ny43MjR6Ii8+Cgk8cGF0aCBzdHlsZT0iZmlsbDojRkY2NDY0OyIgZD0iTTQ1MC4yMDcsMTY3LjcyNGgtMzUuMzFjLTQuODc1LDAtOC44MjgtMy45NTMtOC44MjgtOC44MjhsMCwwYzAtNC44NzUsMy45NTMtOC44MjgsOC44MjgtOC44MjggICBoMzUuMzFjNC44NzUsMCw4LjgyOCwzLjk1Myw4LjgyOCw4LjgyOGwwLDBDNDU5LjAzNCwxNjMuNzcyLDQ1NS4wODIsMTY3LjcyNCw0NTAuMjA3LDE2Ny43MjR6Ii8+CjwvZz4KPGc+Cgk8cGF0aCBzdHlsZT0iZmlsbDojRTRFQUY2OyIgZD0iTTk3LjEwMywyOTEuMzFoLTM1LjMxYy00Ljg3NSwwLTguODI4LTMuOTUzLTguODI4LTguODI4VjI1NmMwLTQuODc1LDMuOTUzLTguODI4LDguODI4LTguODI4aDM1LjMxICAgYzQuODc1LDAsOC44MjgsMy45NTMsOC44MjgsOC44Mjh2MjYuNDgzQzEwNS45MzEsMjg3LjM1OCwxMDEuOTc4LDI5MS4zMSw5Ny4xMDMsMjkxLjMxeiIvPgoJPHBhdGggc3R5bGU9ImZpbGw6I0U0RUFGNjsiIGQ9Ik0xNjcuNzI0LDI5MS4zMWgtMzUuMzFjLTQuODc1LDAtOC44MjgtMy45NTMtOC44MjgtOC44MjhWMjU2YzAtNC44NzUsMy45NTMtOC44MjgsOC44MjgtOC44MjggICBoMzUuMzFjNC44NzUsMCw4LjgyOCwzLjk1Myw4LjgyOCw4LjgyOHYyNi40ODNDMTc2LjU1MiwyODcuMzU4LDE3Mi41OTksMjkxLjMxLDE2Ny43MjQsMjkxLjMxeiIvPgoJPHBhdGggc3R5bGU9ImZpbGw6I0U0RUFGNjsiIGQ9Ik0yMzguMzQ1LDI5MS4zMWgtMzUuMzFjLTQuODc1LDAtOC44MjgtMy45NTMtOC44MjgtOC44MjhWMjU2YzAtNC44NzUsMy45NTMtOC44MjgsOC44MjgtOC44MjggICBoMzUuMzFjNC44NzUsMCw4LjgyOCwzLjk1Myw4LjgyOCw4LjgyOHYyNi40ODNDMjQ3LjE3MiwyODcuMzU4LDI0My4yMiwyOTEuMzEsMjM4LjM0NSwyOTEuMzF6Ii8+Cgk8cGF0aCBzdHlsZT0iZmlsbDojRTRFQUY2OyIgZD0iTTMwOC45NjYsMjkxLjMxaC0zNS4zMWMtNC44NzUsMC04LjgyOC0zLjk1My04LjgyOC04LjgyOFYyNTZjMC00Ljg3NSwzLjk1My04LjgyOCw4LjgyOC04LjgyOCAgIGgzNS4zMWM0Ljg3NSwwLDguODI4LDMuOTUzLDguODI4LDguODI4djI2LjQ4M0MzMTcuNzkzLDI4Ny4zNTgsMzEzLjg0MSwyOTEuMzEsMzA4Ljk2NiwyOTEuMzF6Ii8+CjwvZz4KPGc+Cgk8cGF0aCBzdHlsZT0iZmlsbDojRDdERUVEOyIgZD0iTTM3OS41ODYsMjkxLjMxaC0zNS4zMWMtNC44NzUsMC04LjgyOC0zLjk1My04LjgyOC04LjgyOFYyNTZjMC00Ljg3NSwzLjk1My04LjgyOCw4LjgyOC04LjgyOCAgIGgzNS4zMWM0Ljg3NSwwLDguODI4LDMuOTUzLDguODI4LDguODI4djI2LjQ4M0MzODguNDE0LDI4Ny4zNTgsMzg0LjQ2MSwyOTEuMzEsMzc5LjU4NiwyOTEuMzF6Ii8+Cgk8cGF0aCBzdHlsZT0iZmlsbDojRDdERUVEOyIgZD0iTTQ1MC4yMDcsMjkxLjMxaC0zNS4zMWMtNC44NzUsMC04LjgyOC0zLjk1My04LjgyOC04LjgyOFYyNTZjMC00Ljg3NSwzLjk1My04LjgyOCw4LjgyOC04LjgyOCAgIGgzNS4zMWM0Ljg3NSwwLDguODI4LDMuOTUzLDguODI4LDguODI4djI2LjQ4M0M0NTkuMDM0LDI4Ny4zNTgsNDU1LjA4MiwyOTEuMzEsNDUwLjIwNywyOTEuMzF6Ii8+CjwvZz4KPGc+Cgk8cGF0aCBzdHlsZT0iZmlsbDojRTRFQUY2OyIgZD0iTTk3LjEwMywzNTMuMTAzaC0zNS4zMWMtNC44NzUsMC04LjgyOC0zLjk1My04LjgyOC04LjgyOHYtMjYuNDgzYzAtNC44NzUsMy45NTMtOC44MjgsOC44MjgtOC44MjggICBoMzUuMzFjNC44NzUsMCw4LjgyOCwzLjk1Myw4LjgyOCw4LjgyOHYyNi40ODNDMTA1LjkzMSwzNDkuMTUxLDEwMS45NzgsMzUzLjEwMyw5Ny4xMDMsMzUzLjEwM3oiLz4KCTxwYXRoIHN0eWxlPSJmaWxsOiNFNEVBRjY7IiBkPSJNMTY3LjcyNCwzNTMuMTAzaC0zNS4zMWMtNC44NzUsMC04LjgyOC0zLjk1My04LjgyOC04LjgyOHYtMjYuNDgzYzAtNC44NzUsMy45NTMtOC44MjgsOC44MjgtOC44MjggICBoMzUuMzFjNC44NzUsMCw4LjgyOCwzLjk1Myw4LjgyOCw4LjgyOHYyNi40ODNDMTc2LjU1MiwzNDkuMTUxLDE3Mi41OTksMzUzLjEwMywxNjcuNzI0LDM1My4xMDN6Ii8+Cgk8cGF0aCBzdHlsZT0iZmlsbDojRTRFQUY2OyIgZD0iTTIzOC4zNDUsMzUzLjEwM2gtMzUuMzFjLTQuODc1LDAtOC44MjgtMy45NTMtOC44MjgtOC44Mjh2LTI2LjQ4M2MwLTQuODc1LDMuOTUzLTguODI4LDguODI4LTguODI4ICAgaDM1LjMxYzQuODc1LDAsOC44MjgsMy45NTMsOC44MjgsOC44Mjh2MjYuNDgzQzI0Ny4xNzIsMzQ5LjE1MSwyNDMuMjIsMzUzLjEwMywyMzguMzQ1LDM1My4xMDN6Ii8+Cgk8cGF0aCBzdHlsZT0iZmlsbDojRTRFQUY2OyIgZD0iTTMwOC45NjYsMzUzLjEwM2gtMzUuMzFjLTQuODc1LDAtOC44MjgtMy45NTMtOC44MjgtOC44Mjh2LTI2LjQ4M2MwLTQuODc1LDMuOTUzLTguODI4LDguODI4LTguODI4ICAgaDM1LjMxYzQuODc1LDAsOC44MjgsMy45NTMsOC44MjgsOC44Mjh2MjYuNDgzQzMxNy43OTMsMzQ5LjE1MSwzMTMuODQxLDM1My4xMDMsMzA4Ljk2NiwzNTMuMTAzeiIvPgo8L2c+CjxnPgoJPHBhdGggc3R5bGU9ImZpbGw6I0Q3REVFRDsiIGQ9Ik0zNzkuNTg2LDM1My4xMDNoLTM1LjMxYy00Ljg3NSwwLTguODI4LTMuOTUzLTguODI4LTguODI4di0yNi40ODNjMC00Ljg3NSwzLjk1My04LjgyOCw4LjgyOC04LjgyOCAgIGgzNS4zMWM0Ljg3NSwwLDguODI4LDMuOTUzLDguODI4LDguODI4djI2LjQ4M0MzODguNDE0LDM0OS4xNTEsMzg0LjQ2MSwzNTMuMTAzLDM3OS41ODYsMzUzLjEwM3oiLz4KCTxwYXRoIHN0eWxlPSJmaWxsOiNEN0RFRUQ7IiBkPSJNNDUwLjIwNywzNTMuMTAzaC0zNS4zMWMtNC44NzUsMC04LjgyOC0zLjk1My04LjgyOC04LjgyOHYtMjYuNDgzYzAtNC44NzUsMy45NTMtOC44MjgsOC44MjgtOC44MjggICBoMzUuMzFjNC44NzUsMCw4LjgyOCwzLjk1Myw4LjgyOCw4LjgyOHYyNi40ODNDNDU5LjAzNCwzNDkuMTUxLDQ1NS4wODIsMzUzLjEwMyw0NTAuMjA3LDM1My4xMDN6Ii8+CjwvZz4KPGc+Cgk8cGF0aCBzdHlsZT0iZmlsbDojRTRFQUY2OyIgZD0iTTk3LjEwMyw0MTQuODk3aC0zNS4zMWMtNC44NzUsMC04LjgyOC0zLjk1My04LjgyOC04LjgyOHYtMjYuNDgzYzAtNC44NzUsMy45NTMtOC44MjgsOC44MjgtOC44MjggICBoMzUuMzFjNC44NzUsMCw4LjgyOCwzLjk1Myw4LjgyOCw4LjgyOHYyNi40ODNDMTA1LjkzMSw0MTAuOTQ0LDEwMS45NzgsNDE0Ljg5Nyw5Ny4xMDMsNDE0Ljg5N3oiLz4KCTxwYXRoIHN0eWxlPSJmaWxsOiNFNEVBRjY7IiBkPSJNMTY3LjcyNCw0MTQuODk3aC0zNS4zMWMtNC44NzUsMC04LjgyOC0zLjk1My04LjgyOC04LjgyOHYtMjYuNDgzYzAtNC44NzUsMy45NTMtOC44MjgsOC44MjgtOC44MjggICBoMzUuMzFjNC44NzUsMCw4LjgyOCwzLjk1Myw4LjgyOCw4LjgyOHYyNi40ODNDMTc2LjU1Miw0MTAuOTQ0LDE3Mi41OTksNDE0Ljg5NywxNjcuNzI0LDQxNC44OTd6Ii8+Cgk8cGF0aCBzdHlsZT0iZmlsbDojRTRFQUY2OyIgZD0iTTIzOC4zNDUsNDE0Ljg5N2gtMzUuMzFjLTQuODc1LDAtOC44MjgtMy45NTMtOC44MjgtOC44Mjh2LTI2LjQ4M2MwLTQuODc1LDMuOTUzLTguODI4LDguODI4LTguODI4ICAgaDM1LjMxYzQuODc1LDAsOC44MjgsMy45NTMsOC44MjgsOC44Mjh2MjYuNDgzQzI0Ny4xNzIsNDEwLjk0NCwyNDMuMjIsNDE0Ljg5NywyMzguMzQ1LDQxNC44OTd6Ii8+Cgk8cGF0aCBzdHlsZT0iZmlsbDojRTRFQUY2OyIgZD0iTTMwOC45NjYsNDE0Ljg5N2gtMzUuMzFjLTQuODc1LDAtOC44MjgtMy45NTMtOC44MjgtOC44Mjh2LTI2LjQ4M2MwLTQuODc1LDMuOTUzLTguODI4LDguODI4LTguODI4ICAgaDM1LjMxYzQuODc1LDAsOC44MjgsMy45NTMsOC44MjgsOC44Mjh2MjYuNDgzQzMxNy43OTMsNDEwLjk0NCwzMTMuODQxLDQxNC44OTcsMzA4Ljk2Niw0MTQuODk3eiIvPgo8L2c+CjxnPgoJPHBhdGggc3R5bGU9ImZpbGw6I0Q3REVFRDsiIGQ9Ik0zNzkuNTg2LDQxNC44OTdoLTM1LjMxYy00Ljg3NSwwLTguODI4LTMuOTUzLTguODI4LTguODI4di0yNi40ODNjMC00Ljg3NSwzLjk1My04LjgyOCw4LjgyOC04LjgyOCAgIGgzNS4zMWM0Ljg3NSwwLDguODI4LDMuOTUzLDguODI4LDguODI4djI2LjQ4M0MzODguNDE0LDQxMC45NDQsMzg0LjQ2MSw0MTQuODk3LDM3OS41ODYsNDE0Ljg5N3oiLz4KCTxwYXRoIHN0eWxlPSJmaWxsOiNEN0RFRUQ7IiBkPSJNNDUwLjIwNyw0MTQuODk3aC0zNS4zMWMtNC44NzUsMC04LjgyOC0zLjk1My04LjgyOC04LjgyOHYtMjYuNDgzYzAtNC44NzUsMy45NTMtOC44MjgsOC44MjgtOC44MjggICBoMzUuMzFjNC44NzUsMCw4LjgyOCwzLjk1Myw4LjgyOCw4LjgyOHYyNi40ODNDNDU5LjAzNCw0MTAuOTQ0LDQ1NS4wODIsNDE0Ljg5Nyw0NTAuMjA3LDQxNC44OTd6Ii8+CjwvZz4KPGNpcmNsZSBzdHlsZT0iZmlsbDojQUZCOUQyOyIgY3g9IjI1NiIgY3k9IjM4OC40MTQiIHI9IjEyMy41ODYiLz4KPGNpcmNsZSBzdHlsZT0iZmlsbDojRkZGRkZGOyIgY3g9IjI1NiIgY3k9IjM4OC40MTQiIHI9IjEwNS45MzEiLz4KPGNpcmNsZSBzdHlsZT0iZmlsbDojRUZGMkZBOyIgY3g9IjI1NiIgY3k9IjM4OC40MTQiIHI9IjYxLjc5MyIvPgo8Zz4KCTxwYXRoIHN0eWxlPSJmaWxsOiM3MDc0ODc7IiBkPSJNMjU2LDI3My42NTVMMjU2LDI3My42NTVjLTQuODc1LDAtOC44MjgsMy45NTMtOC44MjgsOC44Mjh2OC44MjhjMCw0Ljg3NSwzLjk1Myw4LjgyOCw4LjgyOCw4LjgyOCAgIGwwLDBjNC44NzUsMCw4LjgyOC0zLjk1Myw4LjgyOC04LjgyOHYtOC44MjhDMjY0LjgyOCwyNzcuNjA4LDI2MC44NzUsMjczLjY1NSwyNTYsMjczLjY1NXoiLz4KCTxwYXRoIHN0eWxlPSJmaWxsOiM3MDc0ODc7IiBkPSJNMjU2LDQ3Ni42OUwyNTYsNDc2LjY5Yy00Ljg3NSwwLTguODI4LDMuOTUzLTguODI4LDguODI4djguODI4YzAsNC44NzUsMy45NTMsOC44MjgsOC44MjgsOC44MjggICBsMCwwYzQuODc1LDAsOC44MjgtMy45NTMsOC44MjgtOC44Mjh2LTguODI4QzI2NC44MjgsNDgwLjY0MiwyNjAuODc1LDQ3Ni42OSwyNTYsNDc2LjY5eiIvPgoJPHBhdGggc3R5bGU9ImZpbGw6IzcwNzQ4NzsiIGQ9Ik0zNzAuNzU5LDM4OC40MTRMMzcwLjc1OSwzODguNDE0YzAtNC44NzUtMy45NTMtOC44MjgtOC44MjgtOC44MjhoLTguODI4ICAgYy00Ljg3NSwwLTguODI4LDMuOTUzLTguODI4LDguODI4bDAsMGMwLDQuODc1LDMuOTUzLDguODI4LDguODI4LDguODI4aDguODI4QzM2Ni44MDYsMzk3LjI0MSwzNzAuNzU5LDM5My4yODksMzcwLjc1OSwzODguNDE0eiIvPgoJPHBhdGggc3R5bGU9ImZpbGw6IzcwNzQ4NzsiIGQ9Ik0xNjcuNzI0LDM4OC40MTRMMTY3LjcyNCwzODguNDE0YzAtNC44NzUtMy45NTMtOC44MjgtOC44MjgtOC44MjhoLTguODI4ICAgYy00Ljg3NSwwLTguODI4LDMuOTUzLTguODI4LDguODI4bDAsMGMwLDQuODc1LDMuOTUzLDguODI4LDguODI4LDguODI4aDguODI4QzE2My43NzIsMzk3LjI0MSwxNjcuNzI0LDM5My4yODksMTY3LjcyNCwzODguNDE0eiIvPgo8L2c+CjxnPgoJPHBhdGggc3R5bGU9ImZpbGw6IzVCNUQ2RTsiIGQ9Ik0yNTYsNDIzLjcyNEwyNTYsNDIzLjcyNGMtNC44NzUsMC04LjgyOC0zLjk1My04LjgyOC04LjgyOHYtODguMjc2ICAgYzAtNC44NzUsMy45NTMtOC44MjgsOC44MjgtOC44MjhsMCwwYzQuODc1LDAsOC44MjgsMy45NTMsOC44MjgsOC44Mjh2ODguMjc2QzI2NC44MjgsNDE5Ljc3MiwyNjAuODc1LDQyMy43MjQsMjU2LDQyMy43MjR6Ii8+Cgk8cGF0aCBzdHlsZT0iZmlsbDojNUI1RDZFOyIgZD0iTTIyMC42OSwzODguNDE0TDIyMC42OSwzODguNDE0YzAtNC44NzUsMy45NTMtOC44MjgsOC44MjgtOC44MjhoODguMjc2ICAgYzQuODc1LDAsOC44MjgsMy45NTMsOC44MjgsOC44MjhsMCwwYzAsNC44NzUtMy45NTMsOC44MjgtOC44MjgsOC44MjhoLTg4LjI3NkMyMjQuNjQyLDM5Ny4yNDEsMjIwLjY5LDM5My4yODksMjIwLjY5LDM4OC40MTR6Ii8+CjwvZz4KPGNpcmNsZSBzdHlsZT0iZmlsbDojQzdDRkUyOyIgY3g9IjI1NiIgY3k9IjM4OC40MTQiIHI9IjE3LjY1NSIvPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8L3N2Zz4K',
                description: (
                    <p>
                        Call Schedules let&apos;s you connect your team members
                        to specific monitors, so only on-duty members who are
                        responsible for certain monitors are alerted when an
                        incident is created.
                    </p>
                ),
            },
            {
                id: 'applicationLog',
                title: 'What are Logs?',
                iconText: 'applicationLog',
                icon:
                    'data:image/svg+xml;utf8;base64,PHN2ZyBoZWlnaHQ9IjUxMiIgdmlld0JveD0iMCAwIDY0IDY0IiB3aWR0aD0iNTEyIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IGZpbGw9IiNkOGQ3ZGEiIGhlaWdodD0iNTQiIHJ4PSIyIiB3aWR0aD0iNDIiIHg9IjExIiB5PSI3Ii8+PHJlY3QgZmlsbD0iI2U2ZTdlOCIgaGVpZ2h0PSI1NCIgcng9IjIiIHdpZHRoPSI0MiIgeD0iNyIgeT0iMyIvPjxwYXRoIGQ9Im0xMSA1OWgzOGEyLjAwNiAyLjAwNiAwIDAgMCAyLTJ2LTUwaC0ydjQ4YTIuMDA2IDIuMDA2IDAgMCAxIC0yIDJoLTM2eiIgZmlsbD0iI2M2YzVjYSIvPjxwYXRoIGQ9Im0xNyAzdjdsLTItMy0yIDN2LTd6IiBmaWxsPSIjZmY1MDIzIi8+PHBhdGggZD0ibTQ5IDQwaDJ2MmgtMnoiIGZpbGw9IiNhY2FiYjEiLz48cGF0aCBkPSJtNTEgNDBoMnYyaC0yeiIgZmlsbD0iI2M2YzVjYSIvPjxwYXRoIGQ9Im00OSAyMi43MXYzMi4yOWEyLjAwNiAyLjAwNiAwIDAgMSAtMiAyaC0zNC40OWExMjIuMTc0IDEyMi4xNzQgMCAwIDAgMjAuMzUtMTVjLjcxLS42NCAxLjQyLTEuMzEgMi4xMi0yYTg4LjE2NyA4OC4xNjcgMCAwIDAgMTQuMDItMTcuMjl6IiBmaWxsPSIjZTBlMGUyIi8+PHBhdGggZD0ibTQ5IDQwdjJoLTMwYTIuMDA2IDIuMDA2IDAgMCAxIC0yLTJ6IiBmaWxsPSIjZDFkM2Q0Ii8+PHBhdGggZD0ibTQ5IDQwdjJoLTE2LjE0Yy43MS0uNjQgMS40Mi0xLjMxIDIuMTItMnoiIGZpbGw9IiNiY2JlYzAiLz48cmVjdCBmaWxsPSIjOTZjOGVmIiBoZWlnaHQ9IjI0IiByeD0iMiIgd2lkdGg9IjQyIiB4PSIxNSIgeT0iMTYiLz48cGF0aCBkPSJtNTUgMTVoLTF2LTZhMyAzIDAgMCAwIC0zLTNoLTF2LTFhMyAzIDAgMCAwIC0zLTNoLTM4YTMgMyAwIDAgMCAtMyAzdjUwYTMgMyAwIDAgMCAzIDNoMXYxYTMgMyAwIDAgMCAzIDNoMzhhMyAzIDAgMCAwIDMtM3YtMThoMWEzIDMgMCAwIDAgMy0zdi0yMGEzIDMgMCAwIDAgLTMtM3ptLTQtN2ExIDEgMCAwIDEgMSAxdjZoLTJ2LTd6bS0zNy00aDJ2Mi43bC0uMTY4LS4yNTJhMS4wMzkgMS4wMzkgMCAwIDAgLTEuNjY0IDBsLS4xNjguMjUyem0tNiA1MXYtNTBhMSAxIDAgMCAxIDEtMWgzdjZhMSAxIDAgMCAwIDEuODMyLjU1NWwxLjE2OC0xLjc1NSAxLjE2OCAxLjc1MmExIDEgMCAwIDAgMS44MzItLjU1MnYtNmgyOWExIDEgMCAwIDEgMSAxdjEwaC0zMWEzIDMgMCAwIDAgLTMgM3YyMGEzIDMgMCAwIDAgMyAzaDMxdjE0YTEgMSAwIDAgMSAtMSAxaC0zOGExIDEgMCAwIDEgLTEtMXptNDQgNGExIDEgMCAwIDEgLTEgMWgtMzhhMSAxIDAgMCAxIC0xLTF2LTFoMzVhMyAzIDAgMCAwIDMtM3YtMTRoMnptNC0yMWExIDEgMCAwIDEgLTEgMWgtMzhhMSAxIDAgMCAxIC0xLTF2LTIwYTEgMSAwIDAgMSAxLTFoMzhhMSAxIDAgMCAxIDEgMXoiLz48cGF0aCBkPSJtMjUgMjJoLTJ2MTFhMSAxIDAgMCAwIDEgMWg1di0yaC00eiIvPjxwYXRoIGQ9Im0zNiAyMmgtMmEzIDMgMCAwIDAgLTMgM3Y2YTMgMyAwIDAgMCAzIDNoMmEzIDMgMCAwIDAgMy0zdi02YTMgMyAwIDAgMCAtMy0zem0xIDlhMSAxIDAgMCAxIC0xIDFoLTJhMSAxIDAgMCAxIC0xLTF2LTZhMSAxIDAgMCAxIDEtMWgyYTEgMSAwIDAgMSAxIDF6Ii8+PHBhdGggZD0ibTQ0IDI0aDJhMSAxIDAgMCAxIDEgMWgyYTMgMyAwIDAgMCAtMy0zaC0yYTMgMyAwIDAgMCAtMyAzdjZhMyAzIDAgMCAwIDMgM2gyYTMgMyAwIDAgMCAzLTN2LTNhMSAxIDAgMCAwIC0xLTFoLTN2MmgydjJhMSAxIDAgMCAxIC0xIDFoLTJhMSAxIDAgMCAxIC0xLTF2LTZhMSAxIDAgMCAxIDEtMXoiLz48L3N2Zz4=',
                description: (
                    <p>
                        When any of your application is running, every log is
                        stored here for each activity.
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

export function renderIfSubProjectAdmin(
    currentProject,
    subProjects,
    subProjectId
) {
    const userId = User.getUserId();
    let renderItems = false;
    if (
        userId &&
        currentProject &&
        currentProject.users &&
        currentProject.users.length > 0 &&
        currentProject.users.filter(
            user =>
                user.userId === userId &&
                (user.role === 'Administrator' || user.role === 'Owner')
        ).length > 0
    ) {
        renderItems = true;
    } else {
        if (subProjects) {
            subProjects.forEach(subProject => {
                if (subProjectId) {
                    if (
                        subProject._id === subProjectId &&
                        subProject.users.filter(
                            user =>
                                user.userId === userId &&
                                (user.role === 'Administrator' ||
                                    user.role === 'Owner')
                        ).length > 0
                    ) {
                        renderItems = true;
                    }
                } else {
                    if (
                        userId &&
                        subProject &&
                        subProject.users &&
                        subProject.users.length > 0 &&
                        subProject.users.filter(
                            user =>
                                user.userId === userId &&
                                (user.role === 'Administrator' ||
                                    user.role === 'Owner')
                        ).length > 0
                    ) {
                        renderItems = true;
                    }
                }
            });
        }
    }
    return renderItems;
}

export function renderIfUserInSubProject(
    currentProject,
    subProjects,
    subProjectId
) {
    const userId = User.getUserId();
    let renderItems = false;
    if (
        currentProject &&
        currentProject.users.filter(
            user => user.userId === userId && user.role !== 'Viewer'
        ).length > 0
    ) {
        renderItems = true;
    } else {
        if (subProjects) {
            subProjects.forEach(subProject => {
                if (
                    subProject._id === subProjectId &&
                    subProject.users.filter(
                        user => user.userId === userId && user.role !== 'Viewer'
                    ).length > 0
                ) {
                    renderItems = true;
                }
            });
        }
    }
    return renderItems;
}

export const formatDecimal = (value, decimalPlaces) => {
    return Number(
        Math.round(parseFloat(value + 'e' + decimalPlaces)) +
            'e-' +
            decimalPlaces
    ).toFixed(decimalPlaces);
};

export const formatBytes = (a, b, c, d, e) => {
    return (
        formatDecimal(
            ((b = Math),
            (c = b.log),
            (d = 1e3),
            (e = (c(a) / c(d)) | 0),
            a / b.pow(d, e)),
            2
        ) +
        ' ' +
        (e ? 'kMGTPEZY'[--e] + 'B' : 'Bytes')
    );
};

function compareStatus(incident, log) {
    return moment(incident.createdAt).isSameOrAfter(moment(log.createdAt))
        ? !incident.resolved
            ? incident.incidentType
            : 'online'
        : log.status;
}

export const getMonitorStatus = (incidents, logs) => {
    const incident = incidents && incidents.length > 0 ? incidents[0] : null;
    const log = logs && logs.length > 0 ? logs[0] : null;

    const statusCompare =
        incident && log
            ? compareStatus(incident, log)
            : incident
            ? !incident.resolved
                ? incident.incidentType
                : 'online'
            : log
            ? log.status
            : 'online';

    return statusCompare || 'online';
};

export const getMonitorStatusColor = status => {
    switch (status) {
        case 'degraded':
            return 'yellow';
        case 'offline':
            return 'red';
        case 'online':
            return 'green';
        default:
            return 'blue';
    }
};

export const replaceDashWithSpace = string => {
    return string.replace('-', ' ');
};

export const getMonitorTypeBadgeColor = type => {
    switch (type) {
        case 'manual':
            return 'red';
        case 'device':
            return 'green';
        default:
            return 'blue';
    }
};

export const filterProbeData = (monitor, probe, startDate, endDate) => {
    const monitorLogs = monitor.logs;
    const monitorStatuses = monitor.statuses;

    const start = moment(new Date(startDate));
    const end = moment(new Date(endDate));

    const probesLog =
        monitorLogs && monitorLogs.length > 0
            ? probe
                ? monitorLogs.filter(probeLogs => {
                      return (
                          probeLogs._id === null || probeLogs._id === probe._id
                      );
                  })
                : monitorLogs
            : [];
    let logs =
        probesLog &&
        probesLog[0] &&
        probesLog[0].logs &&
        probesLog[0].logs.length > 0
            ? probesLog[0].logs
            : [];
    logs =
        logs && logs.length > 0
            ? logs.filter(log =>
                  moment(new Date(log.createdAt)).isBetween(
                      start,
                      end,
                      'day',
                      '[]'
                  )
              )
            : [];

    const probesStatus =
        monitorStatuses && monitorStatuses.length > 0
            ? probe
                ? monitorStatuses.filter(probeStatuses => {
                      return (
                          probeStatuses._id === null ||
                          probeStatuses._id === probe._id
                      );
                  })
                : monitorStatuses
            : [];
    let statuses =
        probesStatus &&
        probesStatus[0] &&
        probesStatus[0].statuses &&
        probesStatus[0].statuses.length > 0
            ? probesStatus[0].statuses
            : [];
    statuses =
        statuses && statuses.length > 0
            ? statuses.filter(status =>
                  moment(new Date(status.createdAt)).isBetween(
                      start,
                      end,
                      'day',
                      '[]'
                  )
              )
            : [];

    return { logs, statuses };
};

export const logLibraries = {
    getLibraries() {
        return [
            {
                id: 'js',
                iconText: 'JavaScript',
                icon:
                    'data:image/svg+xml;utf8;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pg0KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE5LjAuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPg0KPHN2ZyB2ZXJzaW9uPSIxLjEiIGlkPSJMYXllcl8xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB4PSIwcHgiIHk9IjBweCINCgkgdmlld0JveD0iMCAwIDUxMiA1MTIiIHN0eWxlPSJlbmFibGUtYmFja2dyb3VuZDpuZXcgMCAwIDUxMiA1MTI7IiB4bWw6c3BhY2U9InByZXNlcnZlIj4NCjxnPg0KCTxnPg0KCQk8cGF0aCBkPSJNNTAzLjQ2NywwSDguNTMzQzMuODE0LDAsMCwzLjgyMywwLDguNTMzdjQ5NC45MzNDMCw1MDguMTc3LDMuODE0LDUxMiw4LjUzMyw1MTJoNDk0LjkzMw0KCQkJYzQuNzE5LDAsOC41MzMtMy44MjMsOC41MzMtOC41MzNWOC41MzNDNTEyLDMuODIzLDUwOC4xODYsMCw1MDMuNDY3LDB6IE0yOTAuMTMzLDM5Mi41MzNjMCw0Mi4zNDItMzQuNDQ5LDc2LjgtNzYuOCw3Ni44DQoJCQljLTQyLjM1MSwwLTc2LjgtMzQuNDU4LTc2LjgtNzYuOGMwLTQuNzEsMy44MTQtOC41MzMsOC41MzMtOC41MzNzOC41MzMsMy44MjMsOC41MzMsOC41MzNjMCwzMi45MzksMjYuODAzLDU5LjczMyw1OS43MzMsNTkuNzMzDQoJCQljMzIuOTMsMCw1OS43MzMtMjYuNzk1LDU5LjczMy01OS43MzN2LTIwNC44YzAtNC43MSwzLjgxNC04LjUzMyw4LjUzMy04LjUzM2M0LjcxOSwwLDguNTMzLDMuODIzLDguNTMzLDguNTMzVjM5Mi41MzN6DQoJCQkgTTM5Mi41MzMsMzE1LjczM2M0Mi4zNTEsMCw3Ni44LDM0LjQ1OCw3Ni44LDc2LjhjMCw0Mi4zNDItMzQuNDQ5LDc2LjgtNzYuOCw3Ni44Yy00Mi4zNTEsMC03Ni44LTM0LjQ1OC03Ni44LTc2LjgNCgkJCWMwLTQuNzEsMy44MTQtOC41MzMsOC41MzMtOC41MzNjNC43MTksMCw4LjUzMywzLjgyMyw4LjUzMyw4LjUzM2MwLDMyLjkzOSwyNi44MDMsNTkuNzMzLDU5LjczMyw1OS43MzMNCgkJCWMzMi45MywwLDU5LjczMy0yNi43OTUsNTkuNzMzLTU5LjczM2MwLTMyLjkzOS0yNi44MDMtNTkuNzMzLTU5LjczMy01OS43MzNjLTQyLjM1MSwwLTc2LjgtMzQuNDU4LTc2LjgtNzYuOA0KCQkJczM0LjQ0OS03Ni44LDc2LjgtNzYuOGM0Mi4zNTEsMCw3Ni44LDM0LjQ1OCw3Ni44LDc2LjhjMCw0LjcxLTMuODE0LDguNTMzLTguNTMzLDguNTMzYy00LjcxOSwwLTguNTMzLTMuODIzLTguNTMzLTguNTMzDQoJCQljMC0zMi45MzktMjYuODAzLTU5LjczMy01OS43MzMtNTkuNzMzYy0zMi45MywwLTU5LjczMywyNi43OTUtNTkuNzMzLDU5LjczM1MzNTkuNjAzLDMxNS43MzMsMzkyLjUzMywzMTUuNzMzeiIvPg0KCTwvZz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjwvc3ZnPg0K',
                link: 'https://github.com/Fyipe/log-js',
            },
            {
                id: 'php',
                iconText: 'PHP',
                icon:
                    'data:image/svg+xml;utf8;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pg0KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE4LjEuMSwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPg0KPHN2ZyB2ZXJzaW9uPSIxLjEiIGlkPSJDYXBhXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4Ig0KCSB2aWV3Qm94PSIwIDAgMTYuMTcyIDE2LjE3MiIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAwIDAgMTYuMTcyIDE2LjE3MjsiIHhtbDpzcGFjZT0icHJlc2VydmUiPg0KPGc+DQoJPGc+DQoJCTxwYXRoIHN0eWxlPSJmaWxsOiMwMzAxMDQ7IiBkPSJNMTMuMDQzLDYuMzY3Yy0wLjIzNywwLTAuMzk4LDAuMDIyLTAuNDgzLDAuMDQ3djEuNTIzYzAuMTAxLDAuMDIyLDAuMjIzLDAuMDMsMC4zOTEsMC4wMw0KCQkJYzAuNjIxLDAsMS4wMDQtMC4zMTMsMS4wMDQtMC44NDJDMTMuOTU0LDYuNjUxLDEzLjYyNSw2LjM2NywxMy4wNDMsNi4zNjd6Ii8+DQoJCTxwYXRoIHN0eWxlPSJmaWxsOiMwMzAxMDQ7IiBkPSJNMTUuMTQsMEgxLjAzM0MwLjQ2MywwLDAsMC40NjIsMCwxLjAzMnYxNC4xMDhjMCwwLjU2OCwwLjQ2MiwxLjAzMSwxLjAzMywxLjAzMUgxNS4xNA0KCQkJYzAuNTcsMCwxLjAzMi0wLjQ2MywxLjAzMi0xLjAzMVYxLjAzMkMxNi4xNzIsMC40NjIsMTUuNzEsMCwxNS4xNCwweiBNNC45MDQsOC4zMkM0LjUwNiw4LjY5NSwzLjkxNiw4Ljg2MywzLjIyNyw4Ljg2Mw0KCQkJYy0wLjE1MywwLTAuMjkxLTAuMDA4LTAuMzk4LTAuMDIzdjEuODQ2SDEuNjczVjUuNTk0YzAuMzYtMC4wNjEsMC44NjUtMC4xMDcsMS41NzgtMC4xMDdjMC43MTksMCwxLjIzMywwLjEzOSwxLjU3NywwLjQxNA0KCQkJQzUuMTU4LDYuMTYyLDUuMzgsNi41OSw1LjM4LDcuMDk1UzUuMjExLDguMDI5LDQuOTA0LDguMzJ6IE0xMC4zODIsMTAuNjg2SDkuMjE4di0yLjE2SDcuMjk3djIuMTZINi4xMjVWNS41MjZoMS4xNzJ2MS45ODNoMS45MjENCgkJCVY1LjUyNmgxLjE2NEMxMC4zODIsNS41MjYsMTAuMzgyLDEwLjY4NiwxMC4zODIsMTAuNjg2eiBNMTQuNjM1LDguMzJjLTAuMzk3LDAuMzc1LTAuOTg3LDAuNTQzLTEuNjc3LDAuNTQzDQoJCQljLTAuMTUyLDAtMC4yOTEtMC4wMDgtMC4zOTgtMC4wMjN2MS44NDZoLTEuMTU1VjUuNTk0YzAuMzU5LTAuMDYxLDAuODY0LTAuMTA3LDEuNTc3LTAuMTA3YzAuNzIsMCwxLjIzMiwwLjEzOSwxLjU3NywwLjQxNA0KCQkJYzAuMzMsMC4yNjEsMC41NTIsMC42ODksMC41NTIsMS4xOTRDMTUuMTEsNy42LDE0Ljk0Miw4LjAyOSwxNC42MzUsOC4zMnoiLz4NCgkJPHBhdGggc3R5bGU9ImZpbGw6IzAzMDEwNDsiIGQ9Ik0zLjMxMiw2LjM2N2MtMC4yMzgsMC0wLjM5OCwwLjAyMi0wLjQ4MywwLjA0N3YxLjUyM2MwLjEsMC4wMjIsMC4yMjIsMC4wMywwLjM5MSwwLjAzDQoJCQljMC42MiwwLDEuMDAzLTAuMzEzLDEuMDAzLTAuODQyQzQuMjIzLDYuNjUxLDMuODk0LDYuMzY3LDMuMzEyLDYuMzY3eiIvPg0KCTwvZz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjwvc3ZnPg0K',
                link: 'https://github.com/Fyipe/log-php',
            },
            {
                id: 'java',
                iconText: 'Java',
                icon:
                    'data:image/svg+xml;utf8;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pg0KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE2LjAuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPg0KPCFET0NUWVBFIHN2ZyBQVUJMSUMgIi0vL1czQy8vRFREIFNWRyAxLjEvL0VOIiAiaHR0cDovL3d3dy53My5vcmcvR3JhcGhpY3MvU1ZHLzEuMS9EVEQvc3ZnMTEuZHRkIj4NCjxzdmcgdmVyc2lvbj0iMS4xIiBpZD0iQ2FwYV8xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB4PSIwcHgiIHk9IjBweCINCgkgd2lkdGg9IjU4NS45MThweCIgaGVpZ2h0PSI1ODUuOTE4cHgiIHZpZXdCb3g9IjAgMCA1ODUuOTE4IDU4NS45MTgiIHN0eWxlPSJlbmFibGUtYmFja2dyb3VuZDpuZXcgMCAwIDU4NS45MTggNTg1LjkxODsiDQoJIHhtbDpzcGFjZT0icHJlc2VydmUiPg0KPGc+DQoJPHBhdGggZD0iTTM1Ny40LDUzNS4zM2MwLjc2NywwLjA0NywxLjU0MywwLjEwOSwyLjMzLDAuMTA5aDE3Ny4zOWMyMC43NDUsMCwzNy42MjctMTYuODgzLDM3LjYyNy0zNy42MjdWODYuNTk3DQoJCWMwLTIwLjc0My0xNi44ODItMzcuNjI4LTM3LjYyNy0zNy42MjhIMzU5LjczYy0wLjc4MiwwLTEuNTYzLDAuMDc3LTIuMzMsMC4xMTNWMEwxMS4xNyw0Ni4yMDZ2NDkyLjMxMWwzNDYuMjMsNDcuNDAxVjUzNS4zM3oNCgkJIE0zNTkuNzMsNzAuNDc2aDE3Ny4zOWM4Ljg5MiwwLDE2LjEyNSw3LjIzNiwxNi4xMjUsMTYuMTI2djQxMS4yMmMwLDguODkzLTcuMjMzLDE2LjEyNy0xNi4xMjUsMTYuMTI3SDM1OS43Mw0KCQljLTAuNzkyLDAtMS41NjMtMC4xMjctMi4zMy0wLjI0M1YzMzkuMzE3YzUuNTYsNC4zOTQsMjEuMzk2LDcuNDY0LDU2Ljk3Nyw3LjQ2NGM0OC4xOS0wLjAxMSw2OS4zNTUtOC44NDYsNzIuODItMTIuNTc3DQoJCWMzLjQ3NS0zLjc1My0xLjA4MS02LjctMS4wODEtNi43czEuNjExLDEuODc1LTAuNTE0LDQuMDEyYy0yLjEzOCwyLjEyNS0yMS43MDIsNy40OS01My4wMzEsOS4wODcNCgkJYy0zMS4zMTIsMS42MjEtNjUuMzE3LTIuOTM5LTY2LjQwMy02Ljk2MmMtMS4wNDEtNC4wMDUsMTcuNDE3LTcuMjEyLDE3LjQxNy03LjIxMmMtMS43NiwwLjIyMS0xOS41NiwwLjYzMS0yNi4xODUsNC42OTNWNzAuNzExDQoJCUMzNTguMTY3LDcwLjU5OSwzNTguOTMzLDcwLjQ3NiwzNTkuNzMsNzAuNDc2eiBNMTAwLjMwNiwyOTQuNzZjMCwzMS42OC0xNC4wNzcsNDIuMzI0LTM2LjM1OCw0MS42OTUNCgkJYy01LjE5OS0wLjEzNy0xMS45ODctMS4zMDEtMTYuNDEzLTMuMDIybDIuNDk5LTE5Ljc2YzMuMDk3LDEuMTg3LDcuMDg3LDIuMDY5LDExLjUzMSwyLjE0Nw0KCQljOS41NTQsMC4xNzIsMTUuNTY3LTQuNDUxLDE1LjU2Ny0yMS41OTF2LTY5LjE4N2wyMy4xNzQtMC41NjJWMjk0Ljc2eiBNMTg1LjAzNCwzMzcuOTgybC04LjYyMy0yOS43NzlsLTMxLjQyNS0wLjQ0MWwtNy42ODYsMjguOTINCgkJbC0yNC44OTYtMC42ODNsMzIuNTgxLTExMi41OThsMzIuNTctMC43ODRsMzUuMDk1LDExNi4xMjdMMTg1LjAzNCwzMzcuOTgyeiBNMjkwLjgwNCwzNDAuODc1DQoJCWMtMi4wMDUtMy40NTMtNC45MTMtMTMuMzg3LTguNTM2LTI4LjMwNGMtMy4yNTEtMTUuMDU3LTguNDgzLTE5LjIwMy0xOS41OTMtMTkuNDY2bC04LjE1LTAuMDUydjQ2LjgzNWwtMjYuNDE1LTAuNzI5VjIyMi45NzENCgkJYzguNTA0LTEuNjAyLDIxLjI5My0yLjk2NCwzNS42NDYtMy4zMThjMTcuOTY0LTAuNDI3LDMwLjY5OCwxLjk1MywzOS41MjIsOC42MDJjNy40MDEsNS42NTEsMTEuNDk3LDE0LjA4OCwxMS40OTcsMjUuMzMzDQoJCWMwLDE1LjU5Mi0xMS4zMTIsMjYuMjgyLTIxLjk1NiwzMC4wNHYwLjUzNWM4LjYyMywzLjQ1NywxMy40MDksMTEuNjA5LDE2LjU2LDIyLjg1NGMzLjkwNSwxMy44MTYsNy44MTEsMjkuODY0LDEwLjIzNiwzNC42NDYNCgkJTDI5MC44MDQsMzQwLjg3NXoiLz4NCgk8cGF0aCBkPSJNMjY2Ljc5OCwyMzkuNjU3Yy02LjU5NiwwLjEwNy0xMC4zMzEsMC43MDMtMTIuMjYyLDEuMDgydjMyLjg2OGwxMC42NTYtMC4wMWMxMy42MzUtMC4wMTYsMjEuNzk2LTYuODM3LDIxLjc5Ni0xNy40MDkNCgkJQzI4Ni45ODIsMjQ1LjA2OCwyNzkuMzcxLDIzOS42NDYsMjY2Ljc5OCwyMzkuNjU3eiIvPg0KCTxwYXRoIGQ9Ik0xNjAuMzM3LDI0Mi4zNmwtMC4zMjgsMC4wMTFjLTEuNjE3LDYuOC0zLjI0NywxNS40NTQtNS4wMTksMjIuMDYxbC02LjQ2NywyNC4xNDZsMjQuMjYzLDAuMTM1bC02Ljg5Ni0yNC4zNDUNCgkJQzE2My45MjgsMjU3LjU4OCwxNjEuOTc5LDI0OS4xMjEsMTYwLjMzNywyNDIuMzZ6Ii8+DQoJPHBhdGggZD0iTTQyMi41MzQsMjY2LjQ1N2MwLDAtMTAuODQ1LTIwLjg5My0xMC40NDUtMzYuMTYxYzAuMjk0LTEwLjkwMSwyNC44OTItMjEuNjgzLDM0LjU1Mi0zNy4zNDENCgkJYzkuNjI3LTE1LjY2NS0xLjIwNy0zMC45MTktMS4yMDctMzAuOTE5czIuNDE1LDExLjI0OS00LjAxMiwyMi44ODhjLTYuNDI1LDExLjY0Ny0zMC4xNDEsMTguNDg1LTM5LjM3LDM4LjU1NA0KCQlDMzkyLjgzMywyNDMuNTYsNDIyLjUzNCwyNjYuNDU3LDQyMi41MzQsMjY2LjQ1N3oiLz4NCgk8cGF0aCBkPSJNNDYzLjExMywyMDMuMDAyYzAsMC0zNi45NDYsMTQuMDU1LTM2Ljk0NiwzMC4xMTNjMCwxNi4wNzIsMTAuMDM3LDIxLjI5MiwxMS42NDUsMjYuNTENCgkJYzEuNjA1LDUuMjMtMi44MDUsMTQuMDU3LTIuODA1LDE0LjA1N3MxNC40NTctMTAuMDM3LDEyLjAzMi0yMS42OWMtMi40MTUtMTEuNjQ4LTEzLjY1OC0xNS4yNjUtNy4yMjMtMjYuOTAzDQoJCUM0NDQuMTA5LDIxNy4yODMsNDYzLjExMywyMDMuMDAyLDQ2My4xMTMsMjAzLjAwMnoiLz4NCgk8cGF0aCBkPSJNNDE4LjUzNSwyODcuNjc1YzM4LjEyMi0xLjM2LDQyLjYwNC04LjUzOSw0Ni41ODMtMTEuOTg3Yy0yMi4wNzksNi4wMTMtODAuNzE1LDUuNjI3LTgxLjEzNSwxLjIwOA0KCQljLTAuMzg4LTQuNDEyLDE4LjA2OC04LjAyOSwxOC4wNjgtOC4wMjlzLTI4LjkwMywwLTMxLjMxOCw3LjIyM0MzNjguMzE4LDI4My4zMjEsMzg0LjQxNCwyODguODc1LDQxOC41MzUsMjg3LjY3NXoiLz4NCgk8cGF0aCBkPSJNNDY3LjkzMywzMDQuNjAyYzAsMCwzNS40MDEtNy4xMjMsMzIuMTA5LTI1LjI3NWMtNC4wMS0yMi4wOTItMjkuMzAyLTkuNjQ4LTI5LjMwMi05LjY0OHMxNi40NjgsMCwxOC4wNjQsMTAuMDMxDQoJCUM0OTAuNDEsMjg5Ljc0OSw0NjcuOTMzLDMwNC42MDIsNDY3LjkzMywzMDQuNjAyeiIvPg0KCTxwYXRoIGQ9Ik0zOTIuMDA1LDI5Ni4xNTZjLTEuNTc0LTIuODA0LDIuODI1LTQuNDA0LDIuODI1LTQuNDA0Yy0yMC4wOTYsNC44MjMtOS4xMTUsMTMuMjUsMTQuNDM0LDE0Ljg2NQ0KCQljMjAuMTgxLDEuMzc2LDQyLjczLTYuMDI1LDQyLjczLTYuMDI1bDYuOTUxLTUuNjE3YzAsMC0xNS45MDYsMi4yMDUtMjguMzksMy42MTJDNDEzLjgzMiwzMDAuNDY1LDM5My42MjIsMjk4Ljk4NCwzOTIuMDA1LDI5Ni4xNTYNCgkJeiIvPg0KCTxwYXRoIGQ9Ik0zOTguODYsMzE1LjQ1N2MtMC44MTgtMS44ODMsMC43OTgtMi45NDQsMC43OTgtMi45NDRzLTkuMTEzLDAuMjU3LTkuNjM4LDUuMDgxYy0wLjU0LDQuNzk0LDIuODE4LDcuMjI5LDI1LjM1NCw2LjY5Mw0KCQljMjYuODI2LTAuNjM1LDMxLjI5OC0zLjgyNiwzNC4wNTktNi4xNjNsNi41NDItNC45MjRjLTE3LjUzNCwyLjI2OC0xOC44ODgsMi44OTgtMjguODIsMy4xODINCgkJQzQxNy4xNTksMzE2LjY3NSwzOTkuNjU4LDMxNy4zMTYsMzk4Ljg2LDMxNS40NTd6Ii8+DQoJPHBhdGggZD0iTTQ2OC40NTgsMzQ5Ljk4OGMtMjEuMTU3LDQuMjg0LTg1LjM4OCwxLjU4Ni04NS4zODgsMS41ODZzNDEuNzQzLDkuOTEsODkuNDA3LDEuNjE2DQoJCWMyMi43ODMtMy45NjksMjQuMTA1LTE0Ljk5NywyNC4xMDUtMTQuOTk3UzQ4OS42MTIsMzQ1LjY5NSw0NjguNDU4LDM0OS45ODh6Ii8+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8L3N2Zz4NCg==',
                link: 'https://github.com/Fyipe/log-java',
            },
            {
                id: 'python',
                iconText: 'Python',
                icon:
                    'data:image/svg+xml;utf8;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pg0KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE4LjEuMSwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPg0KPHN2ZyB2ZXJzaW9uPSIxLjEiIGlkPSJDYXBhXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4Ig0KCSB2aWV3Qm94PSIwIDAgMTcuMDU2IDE3LjA1NiIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAwIDAgMTcuMDU2IDE3LjA1NjsiIHhtbDpzcGFjZT0icHJlc2VydmUiPg0KPGc+DQoJPGc+DQoJCTxwYXRoIHN0eWxlPSJmaWxsOiMwMzAxMDQ7IiBkPSJNMTEuMjk4LDguMDJjMS4yOTUtMC41ODcsMS40ODgtNS4wNTUsMC43MjQtNi4zNzFjLTAuOTk4LTEuNzE4LTUuNzQyLTEuMzczLTcuMjQtMC4xNDUNCgkJCUM0LjYxLDIuMTE0LDQuNjI4LDMuMjIxLDQuNjM2LDQuMTAxaDQuNzAydjAuNDEySDQuNjM3YzAsMC4wMDYtMi4wOTMsMC4wMTMtMi4wOTMsMC4wMTNjLTMuNjA5LDAtMy41MzQsNy44MzgsMS4yMjgsNy44MzgNCgkJCWMwLDAsMC4xNzUtMS43MzYsMC40ODEtMi42MDZDNS4xOTgsNy4wNzMsOS4xNjgsOC45ODYsMTEuMjk4LDguMDJ6IE02LjM3NSwzLjQ2NWMtMC41NDIsMC0wLjk4MS0wLjQzOS0wLjk4MS0wLjk4Mg0KCQkJYzAtMC41NDIsMC40MzktMC45ODIsMC45ODEtMC45ODJjMC41NDMsMCwwLjk4MiwwLjQ0LDAuOTgyLDAuOTgyQzcuMzU4LDMuMDI1LDYuOTE4LDMuNDY1LDYuMzc1LDMuNDY1eiIvPg0KCQk8cGF0aCBzdHlsZT0iZmlsbDojMDMwMTA0OyIgZD0iTTEzLjEyLDQuNjkxYzAsMC0wLjEyNSwxLjczNy0wLjQzMSwyLjYwNmMtMC45NDUsMi42ODQtNC45MTQsMC43NzItNy4wNDUsMS43MzgNCgkJCUM0LjM1LDkuNjIyLDQuMTU1LDE0LjA5LDQuOTIsMTUuNDA2YzAuOTk3LDEuNzE5LDUuNzQxLDEuMzc0LDcuMjQsMC4xNDVjMC4xNzItMC42MDksMC4xNTQtMS43MTYsMC4xNDYtMi41OTZINy42MDN2LTAuNDEyaDQuNzAxDQoJCQljMC0wLjAwNiwyLjMxNy0wLjAxMywyLjMxNy0wLjAxM0MxNy45NDcsMTIuNTMsMTguMjQ1LDQuNjkxLDEzLjEyLDQuNjkxeiBNMTAuMzk4LDEzLjQyYzAuNTQyLDAsMC45ODIsMC40MzksMC45ODIsMC45ODINCgkJCWMwLDAuNTQyLTAuNDQsMC45ODEtMC45ODIsMC45ODFzLTAuOTgxLTAuNDM5LTAuOTgxLTAuOTgxQzkuNDE3LDEzLjg1OSw5Ljg1NiwxMy40MiwxMC4zOTgsMTMuNDJ6Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPC9zdmc+DQo=',
                link: 'https://github.com/Fyipe/log-python',
            },
            {
                id: 'dotnet',
                iconText: 'Dotnet',
                icon:
                    'data:image/svg+xml;utf8;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pg0KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE4LjAuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPg0KPCFET0NUWVBFIHN2ZyBQVUJMSUMgIi0vL1czQy8vRFREIFNWRyAxLjEvL0VOIiAiaHR0cDovL3d3dy53My5vcmcvR3JhcGhpY3MvU1ZHLzEuMS9EVEQvc3ZnMTEuZHRkIj4NCjxzdmcgdmVyc2lvbj0iMS4xIiBpZD0iQ2FwYV8xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB4PSIwcHgiIHk9IjBweCINCgkgdmlld0JveD0iMCAwIDMxMi41NTMgMzEyLjU1MyIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAwIDAgMzEyLjU1MyAzMTIuNTUzOyIgeG1sOnNwYWNlPSJwcmVzZXJ2ZSI+DQo8Zz4NCgk8cGF0aCBkPSJNMzAyLjU1MywwSDEwQzQuNDc3LDAsMCw0LjQ3OCwwLDEwdjI5Mi41NTNjMCw1LjUyMiw0LjQ3NywxMCwxMCwxMGgyOTIuNTUzYzUuNTIzLDAsMTAtNC40NzgsMTAtMTBWMTANCgkJQzMxMi41NTMsNC40NzgsMzA4LjA3NiwwLDMwMi41NTMsMHogTTE0OC4wODcsMTkzLjI4N2MtOS40ODEsOC4yOTYtMjEuNTkyLDEyLjg2Ni0zNC4xMDIsMTIuODY2DQoJCWMtMjguMTA5LDAtNTAuOTc3LTIyLjQtNTAuOTc3LTQ5LjkzNGMwLTI3LjQ3MSwyMi44NjgtNDkuODE5LDUwLjk3Ny00OS44MTljMTIuNTI3LDAsMjQuNTk3LDQuNTMsMzMuOTg3LDEyLjc1Ng0KCQljMy44NzMsMy4zOTMsNC4yNjIsOS4yODMsMC44NjgsMTMuMTU2Yy0zLjM5MiwzLjg3NC05LjI4Myw0LjI2NS0xMy4xNTYsMC44NjljLTUuOTg3LTUuMjQ1LTEzLjY5NC04LjEzNS0yMS42OTktOC4xMzUNCgkJYy0xNy44MjcsMC0zMi4zMywxMy45ODQtMzIuMzMsMzEuMTczYzAsMTcuMjUxLDE0LjUwMywzMS4yODYsMzIuMzMsMzEuMjg2YzcuOTkxLDAsMTUuNzQxLTIuOTMxLDIxLjgyMi04LjI1Mg0KCQljMy44NzUtMy4zOTEsOS43NjUtMi45OTgsMTMuMTU3LDAuODc3QzE1Mi4zNTUsMTg0LjAwNiwxNTEuOTYyLDE4OS44OTYsMTQ4LjA4NywxOTMuMjg3eiBNMjQwLjIyLDE2Mi4yODYNCgkJYzUuMTUsMCw5LjMyNCw0LjE3NCw5LjMyNCw5LjMyM3MtNC4xNzQsOS4zMjMtOS4zMjQsOS4zMjNoLTEwLjg2OWwtMy4zNzgsMTQuOTA0Yy0wLjk4MSw0LjMyOC00LjgyNiw3LjI2NS05LjA4NSw3LjI2NQ0KCQljLTAuNjgzLDAtMS4zNzYtMC4wNzUtMi4wNjktMC4yMzJjLTUuMDIyLTEuMTM5LTguMTctNi4xMzItNy4wMzItMTEuMTUzbDIuNDQ0LTEwLjc4M2gtMjAuMjAxbC0zLjM3OCwxNC45MDQNCgkJYy0wLjk4MSw0LjMyOC00LjgyNiw3LjI2NS05LjA4NCw3LjI2NWMtMC42ODMsMC0xLjM3Ni0wLjA3NS0yLjA2OS0wLjIzMmMtNS4wMjItMS4xMzktOC4xNy02LjEzMi03LjAzMi0xMS4xNTNsMi40NDgtMTAuNzk5DQoJCWMtNS4wMDctMC4xNjItOS4wMTktNC4yNjItOS4wMTktOS4zMDhjMC01LjE0OSw0LjE3NC05LjMyMyw5LjMyNC05LjMyM2gzLjkxN2wyLjcyNS0xMi4wMmgtNi42NDINCgkJYy01LjE0OSwwLTkuMzI0LTQuMTc0LTkuMzI0LTkuMzIyYzAtNS4xNSw0LjE3NC05LjMyNCw5LjMyNC05LjMyNGgxMC44NjlsMy4zNzgtMTQuOTA0YzEuMTM4LTUuMDIxLDYuMTM0LTguMTcsMTEuMTU0LTcuMDMyDQoJCWM1LjAyMiwxLjEzOSw4LjE3LDYuMTMyLDcuMDMyLDExLjE1M2wtMi40NDQsMTAuNzgzaDIwLjIwMWwzLjM3OC0xNC45MDRjMS4xMzgtNS4wMjEsNi4xMzMtOC4xNywxMS4xNTQtNy4wMzINCgkJYzUuMDIyLDEuMTM5LDguMTcsNi4xMzIsNy4wMzIsMTEuMTUzbC0yLjQ0OCwxMC43OTljNS4wMDcsMC4xNjIsOS4wMTksNC4yNjIsOS4wMTksOS4zMDljMCw1LjE0OC00LjE3NCw5LjMyMi05LjMyNCw5LjMyMmgtMy45MTcNCgkJbC0yLjcyNSwxMi4wMkgyNDAuMjJ6Ii8+DQoJPHBvbHlnb24gcG9pbnRzPSIxOTQuMjU4LDE2Mi4yODYgMjE0LjQ1OCwxNjIuMjg2IDIxNy4xODMsMTUwLjI2NyAxOTYuOTgyLDE1MC4yNjcgCSIvPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPC9zdmc+DQo=',
                link: 'https://github.com/Fyipe/log-dotnet',
            },
        ];
    },
};
