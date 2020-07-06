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
                link: 'https://github.com/Fyipe/log-js',
                icon:
                    'data:image/svg+xml;utf8;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pg0KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE5LjAuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPg0KPHN2ZyB2ZXJzaW9uPSIxLjEiIGlkPSJMYXllcl8xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB4PSIwcHgiIHk9IjBweCINCgkgdmlld0JveD0iMCAwIDUxMiA1MTIiIHN0eWxlPSJlbmFibGUtYmFja2dyb3VuZDpuZXcgMCAwIDUxMiA1MTI7IiB4bWw6c3BhY2U9InByZXNlcnZlIj4NCjxnPg0KCTxnPg0KCQk8cGF0aCBkPSJNNTAzLjQ2NywwSDguNTMzQzMuODE0LDAsMCwzLjgyMywwLDguNTMzdjQ5NC45MzNDMCw1MDguMTc3LDMuODE0LDUxMiw4LjUzMyw1MTJoNDk0LjkzMw0KCQkJYzQuNzE5LDAsOC41MzMtMy44MjMsOC41MzMtOC41MzNWOC41MzNDNTEyLDMuODIzLDUwOC4xODYsMCw1MDMuNDY3LDB6IE0yOTAuMTMzLDM5Mi41MzNjMCw0Mi4zNDItMzQuNDQ5LDc2LjgtNzYuOCw3Ni44DQoJCQljLTQyLjM1MSwwLTc2LjgtMzQuNDU4LTc2LjgtNzYuOGMwLTQuNzEsMy44MTQtOC41MzMsOC41MzMtOC41MzNzOC41MzMsMy44MjMsOC41MzMsOC41MzNjMCwzMi45MzksMjYuODAzLDU5LjczMyw1OS43MzMsNTkuNzMzDQoJCQljMzIuOTMsMCw1OS43MzMtMjYuNzk1LDU5LjczMy01OS43MzN2LTIwNC44YzAtNC43MSwzLjgxNC04LjUzMyw4LjUzMy04LjUzM2M0LjcxOSwwLDguNTMzLDMuODIzLDguNTMzLDguNTMzVjM5Mi41MzN6DQoJCQkgTTM5Mi41MzMsMzE1LjczM2M0Mi4zNTEsMCw3Ni44LDM0LjQ1OCw3Ni44LDc2LjhjMCw0Mi4zNDItMzQuNDQ5LDc2LjgtNzYuOCw3Ni44Yy00Mi4zNTEsMC03Ni44LTM0LjQ1OC03Ni44LTc2LjgNCgkJCWMwLTQuNzEsMy44MTQtOC41MzMsOC41MzMtOC41MzNjNC43MTksMCw4LjUzMywzLjgyMyw4LjUzMyw4LjUzM2MwLDMyLjkzOSwyNi44MDMsNTkuNzMzLDU5LjczMyw1OS43MzMNCgkJCWMzMi45MywwLDU5LjczMy0yNi43OTUsNTkuNzMzLTU5LjczM2MwLTMyLjkzOS0yNi44MDMtNTkuNzMzLTU5LjczMy01OS43MzNjLTQyLjM1MSwwLTc2LjgtMzQuNDU4LTc2LjgtNzYuOA0KCQkJczM0LjQ0OS03Ni44LDc2LjgtNzYuOGM0Mi4zNTEsMCw3Ni44LDM0LjQ1OCw3Ni44LDc2LjhjMCw0LjcxLTMuODE0LDguNTMzLTguNTMzLDguNTMzYy00LjcxOSwwLTguNTMzLTMuODIzLTguNTMzLTguNTMzDQoJCQljMC0zMi45MzktMjYuODAzLTU5LjczMy01OS43MzMtNTkuNzMzYy0zMi45MywwLTU5LjczMywyNi43OTUtNTkuNzMzLDU5LjczM1MzNTkuNjAzLDMxNS43MzMsMzkyLjUzMywzMTUuNzMzeiIvPg0KCTwvZz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjwvc3ZnPg0K',
            },
            {
                id: 'php',
                iconText: 'PHP',
                link: 'https://github.com/Fyipe/log-php',
                icon:
                    'data:image/svg+xml;utf8;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pg0KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE4LjEuMSwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPg0KPHN2ZyB2ZXJzaW9uPSIxLjEiIGlkPSJDYXBhXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4Ig0KCSB2aWV3Qm94PSIwIDAgMTYuMTcyIDE2LjE3MiIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAwIDAgMTYuMTcyIDE2LjE3MjsiIHhtbDpzcGFjZT0icHJlc2VydmUiPg0KPGc+DQoJPGc+DQoJCTxwYXRoIHN0eWxlPSJmaWxsOiMwMzAxMDQ7IiBkPSJNMTMuMDQzLDYuMzY3Yy0wLjIzNywwLTAuMzk4LDAuMDIyLTAuNDgzLDAuMDQ3djEuNTIzYzAuMTAxLDAuMDIyLDAuMjIzLDAuMDMsMC4zOTEsMC4wMw0KCQkJYzAuNjIxLDAsMS4wMDQtMC4zMTMsMS4wMDQtMC44NDJDMTMuOTU0LDYuNjUxLDEzLjYyNSw2LjM2NywxMy4wNDMsNi4zNjd6Ii8+DQoJCTxwYXRoIHN0eWxlPSJmaWxsOiMwMzAxMDQ7IiBkPSJNMTUuMTQsMEgxLjAzM0MwLjQ2MywwLDAsMC40NjIsMCwxLjAzMnYxNC4xMDhjMCwwLjU2OCwwLjQ2MiwxLjAzMSwxLjAzMywxLjAzMUgxNS4xNA0KCQkJYzAuNTcsMCwxLjAzMi0wLjQ2MywxLjAzMi0xLjAzMVYxLjAzMkMxNi4xNzIsMC40NjIsMTUuNzEsMCwxNS4xNCwweiBNNC45MDQsOC4zMkM0LjUwNiw4LjY5NSwzLjkxNiw4Ljg2MywzLjIyNyw4Ljg2Mw0KCQkJYy0wLjE1MywwLTAuMjkxLTAuMDA4LTAuMzk4LTAuMDIzdjEuODQ2SDEuNjczVjUuNTk0YzAuMzYtMC4wNjEsMC44NjUtMC4xMDcsMS41NzgtMC4xMDdjMC43MTksMCwxLjIzMywwLjEzOSwxLjU3NywwLjQxNA0KCQkJQzUuMTU4LDYuMTYyLDUuMzgsNi41OSw1LjM4LDcuMDk1UzUuMjExLDguMDI5LDQuOTA0LDguMzJ6IE0xMC4zODIsMTAuNjg2SDkuMjE4di0yLjE2SDcuMjk3djIuMTZINi4xMjVWNS41MjZoMS4xNzJ2MS45ODNoMS45MjENCgkJCVY1LjUyNmgxLjE2NEMxMC4zODIsNS41MjYsMTAuMzgyLDEwLjY4NiwxMC4zODIsMTAuNjg2eiBNMTQuNjM1LDguMzJjLTAuMzk3LDAuMzc1LTAuOTg3LDAuNTQzLTEuNjc3LDAuNTQzDQoJCQljLTAuMTUyLDAtMC4yOTEtMC4wMDgtMC4zOTgtMC4wMjN2MS44NDZoLTEuMTU1VjUuNTk0YzAuMzU5LTAuMDYxLDAuODY0LTAuMTA3LDEuNTc3LTAuMTA3YzAuNzIsMCwxLjIzMiwwLjEzOSwxLjU3NywwLjQxNA0KCQkJYzAuMzMsMC4yNjEsMC41NTIsMC42ODksMC41NTIsMS4xOTRDMTUuMTEsNy42LDE0Ljk0Miw4LjAyOSwxNC42MzUsOC4zMnoiLz4NCgkJPHBhdGggc3R5bGU9ImZpbGw6IzAzMDEwNDsiIGQ9Ik0zLjMxMiw2LjM2N2MtMC4yMzgsMC0wLjM5OCwwLjAyMi0wLjQ4MywwLjA0N3YxLjUyM2MwLjEsMC4wMjIsMC4yMjIsMC4wMywwLjM5MSwwLjAzDQoJCQljMC42MiwwLDEuMDAzLTAuMzEzLDEuMDAzLTAuODQyQzQuMjIzLDYuNjUxLDMuODk0LDYuMzY3LDMuMzEyLDYuMzY3eiIvPg0KCTwvZz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjwvc3ZnPg0K',
            },
            {
                id: 'java',
                iconText: 'Java',
                link: 'https://github.com/Fyipe/log-java',
                icon:
                    'data:image/svg+xml;utf8;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pg0KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE2LjAuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPg0KPCFET0NUWVBFIHN2ZyBQVUJMSUMgIi0vL1czQy8vRFREIFNWRyAxLjEvL0VOIiAiaHR0cDovL3d3dy53My5vcmcvR3JhcGhpY3MvU1ZHLzEuMS9EVEQvc3ZnMTEuZHRkIj4NCjxzdmcgdmVyc2lvbj0iMS4xIiBpZD0iQ2FwYV8xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB4PSIwcHgiIHk9IjBweCINCgkgd2lkdGg9IjU4NS45MThweCIgaGVpZ2h0PSI1ODUuOTE4cHgiIHZpZXdCb3g9IjAgMCA1ODUuOTE4IDU4NS45MTgiIHN0eWxlPSJlbmFibGUtYmFja2dyb3VuZDpuZXcgMCAwIDU4NS45MTggNTg1LjkxODsiDQoJIHhtbDpzcGFjZT0icHJlc2VydmUiPg0KPGc+DQoJPHBhdGggZD0iTTM1Ny40LDUzNS4zM2MwLjc2NywwLjA0NywxLjU0MywwLjEwOSwyLjMzLDAuMTA5aDE3Ny4zOWMyMC43NDUsMCwzNy42MjctMTYuODgzLDM3LjYyNy0zNy42MjdWODYuNTk3DQoJCWMwLTIwLjc0My0xNi44ODItMzcuNjI4LTM3LjYyNy0zNy42MjhIMzU5LjczYy0wLjc4MiwwLTEuNTYzLDAuMDc3LTIuMzMsMC4xMTNWMEwxMS4xNyw0Ni4yMDZ2NDkyLjMxMWwzNDYuMjMsNDcuNDAxVjUzNS4zM3oNCgkJIE0zNTkuNzMsNzAuNDc2aDE3Ny4zOWM4Ljg5MiwwLDE2LjEyNSw3LjIzNiwxNi4xMjUsMTYuMTI2djQxMS4yMmMwLDguODkzLTcuMjMzLDE2LjEyNy0xNi4xMjUsMTYuMTI3SDM1OS43Mw0KCQljLTAuNzkyLDAtMS41NjMtMC4xMjctMi4zMy0wLjI0M1YzMzkuMzE3YzUuNTYsNC4zOTQsMjEuMzk2LDcuNDY0LDU2Ljk3Nyw3LjQ2NGM0OC4xOS0wLjAxMSw2OS4zNTUtOC44NDYsNzIuODItMTIuNTc3DQoJCWMzLjQ3NS0zLjc1My0xLjA4MS02LjctMS4wODEtNi43czEuNjExLDEuODc1LTAuNTE0LDQuMDEyYy0yLjEzOCwyLjEyNS0yMS43MDIsNy40OS01My4wMzEsOS4wODcNCgkJYy0zMS4zMTIsMS42MjEtNjUuMzE3LTIuOTM5LTY2LjQwMy02Ljk2MmMtMS4wNDEtNC4wMDUsMTcuNDE3LTcuMjEyLDE3LjQxNy03LjIxMmMtMS43NiwwLjIyMS0xOS41NiwwLjYzMS0yNi4xODUsNC42OTNWNzAuNzExDQoJCUMzNTguMTY3LDcwLjU5OSwzNTguOTMzLDcwLjQ3NiwzNTkuNzMsNzAuNDc2eiBNMTAwLjMwNiwyOTQuNzZjMCwzMS42OC0xNC4wNzcsNDIuMzI0LTM2LjM1OCw0MS42OTUNCgkJYy01LjE5OS0wLjEzNy0xMS45ODctMS4zMDEtMTYuNDEzLTMuMDIybDIuNDk5LTE5Ljc2YzMuMDk3LDEuMTg3LDcuMDg3LDIuMDY5LDExLjUzMSwyLjE0Nw0KCQljOS41NTQsMC4xNzIsMTUuNTY3LTQuNDUxLDE1LjU2Ny0yMS41OTF2LTY5LjE4N2wyMy4xNzQtMC41NjJWMjk0Ljc2eiBNMTg1LjAzNCwzMzcuOTgybC04LjYyMy0yOS43NzlsLTMxLjQyNS0wLjQ0MWwtNy42ODYsMjguOTINCgkJbC0yNC44OTYtMC42ODNsMzIuNTgxLTExMi41OThsMzIuNTctMC43ODRsMzUuMDk1LDExNi4xMjdMMTg1LjAzNCwzMzcuOTgyeiBNMjkwLjgwNCwzNDAuODc1DQoJCWMtMi4wMDUtMy40NTMtNC45MTMtMTMuMzg3LTguNTM2LTI4LjMwNGMtMy4yNTEtMTUuMDU3LTguNDgzLTE5LjIwMy0xOS41OTMtMTkuNDY2bC04LjE1LTAuMDUydjQ2LjgzNWwtMjYuNDE1LTAuNzI5VjIyMi45NzENCgkJYzguNTA0LTEuNjAyLDIxLjI5My0yLjk2NCwzNS42NDYtMy4zMThjMTcuOTY0LTAuNDI3LDMwLjY5OCwxLjk1MywzOS41MjIsOC42MDJjNy40MDEsNS42NTEsMTEuNDk3LDE0LjA4OCwxMS40OTcsMjUuMzMzDQoJCWMwLDE1LjU5Mi0xMS4zMTIsMjYuMjgyLTIxLjk1NiwzMC4wNHYwLjUzNWM4LjYyMywzLjQ1NywxMy40MDksMTEuNjA5LDE2LjU2LDIyLjg1NGMzLjkwNSwxMy44MTYsNy44MTEsMjkuODY0LDEwLjIzNiwzNC42NDYNCgkJTDI5MC44MDQsMzQwLjg3NXoiLz4NCgk8cGF0aCBkPSJNMjY2Ljc5OCwyMzkuNjU3Yy02LjU5NiwwLjEwNy0xMC4zMzEsMC43MDMtMTIuMjYyLDEuMDgydjMyLjg2OGwxMC42NTYtMC4wMWMxMy42MzUtMC4wMTYsMjEuNzk2LTYuODM3LDIxLjc5Ni0xNy40MDkNCgkJQzI4Ni45ODIsMjQ1LjA2OCwyNzkuMzcxLDIzOS42NDYsMjY2Ljc5OCwyMzkuNjU3eiIvPg0KCTxwYXRoIGQ9Ik0xNjAuMzM3LDI0Mi4zNmwtMC4zMjgsMC4wMTFjLTEuNjE3LDYuOC0zLjI0NywxNS40NTQtNS4wMTksMjIuMDYxbC02LjQ2NywyNC4xNDZsMjQuMjYzLDAuMTM1bC02Ljg5Ni0yNC4zNDUNCgkJQzE2My45MjgsMjU3LjU4OCwxNjEuOTc5LDI0OS4xMjEsMTYwLjMzNywyNDIuMzZ6Ii8+DQoJPHBhdGggZD0iTTQyMi41MzQsMjY2LjQ1N2MwLDAtMTAuODQ1LTIwLjg5My0xMC40NDUtMzYuMTYxYzAuMjk0LTEwLjkwMSwyNC44OTItMjEuNjgzLDM0LjU1Mi0zNy4zNDENCgkJYzkuNjI3LTE1LjY2NS0xLjIwNy0zMC45MTktMS4yMDctMzAuOTE5czIuNDE1LDExLjI0OS00LjAxMiwyMi44ODhjLTYuNDI1LDExLjY0Ny0zMC4xNDEsMTguNDg1LTM5LjM3LDM4LjU1NA0KCQlDMzkyLjgzMywyNDMuNTYsNDIyLjUzNCwyNjYuNDU3LDQyMi41MzQsMjY2LjQ1N3oiLz4NCgk8cGF0aCBkPSJNNDYzLjExMywyMDMuMDAyYzAsMC0zNi45NDYsMTQuMDU1LTM2Ljk0NiwzMC4xMTNjMCwxNi4wNzIsMTAuMDM3LDIxLjI5MiwxMS42NDUsMjYuNTENCgkJYzEuNjA1LDUuMjMtMi44MDUsMTQuMDU3LTIuODA1LDE0LjA1N3MxNC40NTctMTAuMDM3LDEyLjAzMi0yMS42OWMtMi40MTUtMTEuNjQ4LTEzLjY1OC0xNS4yNjUtNy4yMjMtMjYuOTAzDQoJCUM0NDQuMTA5LDIxNy4yODMsNDYzLjExMywyMDMuMDAyLDQ2My4xMTMsMjAzLjAwMnoiLz4NCgk8cGF0aCBkPSJNNDE4LjUzNSwyODcuNjc1YzM4LjEyMi0xLjM2LDQyLjYwNC04LjUzOSw0Ni41ODMtMTEuOTg3Yy0yMi4wNzksNi4wMTMtODAuNzE1LDUuNjI3LTgxLjEzNSwxLjIwOA0KCQljLTAuMzg4LTQuNDEyLDE4LjA2OC04LjAyOSwxOC4wNjgtOC4wMjlzLTI4LjkwMywwLTMxLjMxOCw3LjIyM0MzNjguMzE4LDI4My4zMjEsMzg0LjQxNCwyODguODc1LDQxOC41MzUsMjg3LjY3NXoiLz4NCgk8cGF0aCBkPSJNNDY3LjkzMywzMDQuNjAyYzAsMCwzNS40MDEtNy4xMjMsMzIuMTA5LTI1LjI3NWMtNC4wMS0yMi4wOTItMjkuMzAyLTkuNjQ4LTI5LjMwMi05LjY0OHMxNi40NjgsMCwxOC4wNjQsMTAuMDMxDQoJCUM0OTAuNDEsMjg5Ljc0OSw0NjcuOTMzLDMwNC42MDIsNDY3LjkzMywzMDQuNjAyeiIvPg0KCTxwYXRoIGQ9Ik0zOTIuMDA1LDI5Ni4xNTZjLTEuNTc0LTIuODA0LDIuODI1LTQuNDA0LDIuODI1LTQuNDA0Yy0yMC4wOTYsNC44MjMtOS4xMTUsMTMuMjUsMTQuNDM0LDE0Ljg2NQ0KCQljMjAuMTgxLDEuMzc2LDQyLjczLTYuMDI1LDQyLjczLTYuMDI1bDYuOTUxLTUuNjE3YzAsMC0xNS45MDYsMi4yMDUtMjguMzksMy42MTJDNDEzLjgzMiwzMDAuNDY1LDM5My42MjIsMjk4Ljk4NCwzOTIuMDA1LDI5Ni4xNTYNCgkJeiIvPg0KCTxwYXRoIGQ9Ik0zOTguODYsMzE1LjQ1N2MtMC44MTgtMS44ODMsMC43OTgtMi45NDQsMC43OTgtMi45NDRzLTkuMTEzLDAuMjU3LTkuNjM4LDUuMDgxYy0wLjU0LDQuNzk0LDIuODE4LDcuMjI5LDI1LjM1NCw2LjY5Mw0KCQljMjYuODI2LTAuNjM1LDMxLjI5OC0zLjgyNiwzNC4wNTktNi4xNjNsNi41NDItNC45MjRjLTE3LjUzNCwyLjI2OC0xOC44ODgsMi44OTgtMjguODIsMy4xODINCgkJQzQxNy4xNTksMzE2LjY3NSwzOTkuNjU4LDMxNy4zMTYsMzk4Ljg2LDMxNS40NTd6Ii8+DQoJPHBhdGggZD0iTTQ2OC40NTgsMzQ5Ljk4OGMtMjEuMTU3LDQuMjg0LTg1LjM4OCwxLjU4Ni04NS4zODgsMS41ODZzNDEuNzQzLDkuOTEsODkuNDA3LDEuNjE2DQoJCWMyMi43ODMtMy45NjksMjQuMTA1LTE0Ljk5NywyNC4xMDUtMTQuOTk3UzQ4OS42MTIsMzQ1LjY5NSw0NjguNDU4LDM0OS45ODh6Ii8+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8L3N2Zz4NCg==',
            },
            {
                id: 'python',
                iconText: 'Python',
                link: 'https://github.com/Fyipe/log-python',
                icon:
                    'data:image/svg+xml;utf8;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pg0KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE4LjEuMSwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPg0KPHN2ZyB2ZXJzaW9uPSIxLjEiIGlkPSJDYXBhXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4Ig0KCSB2aWV3Qm94PSIwIDAgMTcuMDU2IDE3LjA1NiIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAwIDAgMTcuMDU2IDE3LjA1NjsiIHhtbDpzcGFjZT0icHJlc2VydmUiPg0KPGc+DQoJPGc+DQoJCTxwYXRoIHN0eWxlPSJmaWxsOiMwMzAxMDQ7IiBkPSJNMTEuMjk4LDguMDJjMS4yOTUtMC41ODcsMS40ODgtNS4wNTUsMC43MjQtNi4zNzFjLTAuOTk4LTEuNzE4LTUuNzQyLTEuMzczLTcuMjQtMC4xNDUNCgkJCUM0LjYxLDIuMTE0LDQuNjI4LDMuMjIxLDQuNjM2LDQuMTAxaDQuNzAydjAuNDEySDQuNjM3YzAsMC4wMDYtMi4wOTMsMC4wMTMtMi4wOTMsMC4wMTNjLTMuNjA5LDAtMy41MzQsNy44MzgsMS4yMjgsNy44MzgNCgkJCWMwLDAsMC4xNzUtMS43MzYsMC40ODEtMi42MDZDNS4xOTgsNy4wNzMsOS4xNjgsOC45ODYsMTEuMjk4LDguMDJ6IE02LjM3NSwzLjQ2NWMtMC41NDIsMC0wLjk4MS0wLjQzOS0wLjk4MS0wLjk4Mg0KCQkJYzAtMC41NDIsMC40MzktMC45ODIsMC45ODEtMC45ODJjMC41NDMsMCwwLjk4MiwwLjQ0LDAuOTgyLDAuOTgyQzcuMzU4LDMuMDI1LDYuOTE4LDMuNDY1LDYuMzc1LDMuNDY1eiIvPg0KCQk8cGF0aCBzdHlsZT0iZmlsbDojMDMwMTA0OyIgZD0iTTEzLjEyLDQuNjkxYzAsMC0wLjEyNSwxLjczNy0wLjQzMSwyLjYwNmMtMC45NDUsMi42ODQtNC45MTQsMC43NzItNy4wNDUsMS43MzgNCgkJCUM0LjM1LDkuNjIyLDQuMTU1LDE0LjA5LDQuOTIsMTUuNDA2YzAuOTk3LDEuNzE5LDUuNzQxLDEuMzc0LDcuMjQsMC4xNDVjMC4xNzItMC42MDksMC4xNTQtMS43MTYsMC4xNDYtMi41OTZINy42MDN2LTAuNDEyaDQuNzAxDQoJCQljMC0wLjAwNiwyLjMxNy0wLjAxMywyLjMxNy0wLjAxM0MxNy45NDcsMTIuNTMsMTguMjQ1LDQuNjkxLDEzLjEyLDQuNjkxeiBNMTAuMzk4LDEzLjQyYzAuNTQyLDAsMC45ODIsMC40MzksMC45ODIsMC45ODINCgkJCWMwLDAuNTQyLTAuNDQsMC45ODEtMC45ODIsMC45ODFzLTAuOTgxLTAuNDM5LTAuOTgxLTAuOTgxQzkuNDE3LDEzLjg1OSw5Ljg1NiwxMy40MiwxMC4zOTgsMTMuNDJ6Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPC9zdmc+DQo=',
            },
            {
                id: 'dotnet',
                iconText: 'Dotnet',
                link: 'https://github.com/Fyipe/log-dotnet',
                icon:
                    'data:image/svg+xml;utf8;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pg0KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE4LjAuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPg0KPCFET0NUWVBFIHN2ZyBQVUJMSUMgIi0vL1czQy8vRFREIFNWRyAxLjEvL0VOIiAiaHR0cDovL3d3dy53My5vcmcvR3JhcGhpY3MvU1ZHLzEuMS9EVEQvc3ZnMTEuZHRkIj4NCjxzdmcgdmVyc2lvbj0iMS4xIiBpZD0iQ2FwYV8xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB4PSIwcHgiIHk9IjBweCINCgkgdmlld0JveD0iMCAwIDMxMi41NTMgMzEyLjU1MyIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAwIDAgMzEyLjU1MyAzMTIuNTUzOyIgeG1sOnNwYWNlPSJwcmVzZXJ2ZSI+DQo8Zz4NCgk8cGF0aCBkPSJNMzAyLjU1MywwSDEwQzQuNDc3LDAsMCw0LjQ3OCwwLDEwdjI5Mi41NTNjMCw1LjUyMiw0LjQ3NywxMCwxMCwxMGgyOTIuNTUzYzUuNTIzLDAsMTAtNC40NzgsMTAtMTBWMTANCgkJQzMxMi41NTMsNC40NzgsMzA4LjA3NiwwLDMwMi41NTMsMHogTTE0OC4wODcsMTkzLjI4N2MtOS40ODEsOC4yOTYtMjEuNTkyLDEyLjg2Ni0zNC4xMDIsMTIuODY2DQoJCWMtMjguMTA5LDAtNTAuOTc3LTIyLjQtNTAuOTc3LTQ5LjkzNGMwLTI3LjQ3MSwyMi44NjgtNDkuODE5LDUwLjk3Ny00OS44MTljMTIuNTI3LDAsMjQuNTk3LDQuNTMsMzMuOTg3LDEyLjc1Ng0KCQljMy44NzMsMy4zOTMsNC4yNjIsOS4yODMsMC44NjgsMTMuMTU2Yy0zLjM5MiwzLjg3NC05LjI4Myw0LjI2NS0xMy4xNTYsMC44NjljLTUuOTg3LTUuMjQ1LTEzLjY5NC04LjEzNS0yMS42OTktOC4xMzUNCgkJYy0xNy44MjcsMC0zMi4zMywxMy45ODQtMzIuMzMsMzEuMTczYzAsMTcuMjUxLDE0LjUwMywzMS4yODYsMzIuMzMsMzEuMjg2YzcuOTkxLDAsMTUuNzQxLTIuOTMxLDIxLjgyMi04LjI1Mg0KCQljMy44NzUtMy4zOTEsOS43NjUtMi45OTgsMTMuMTU3LDAuODc3QzE1Mi4zNTUsMTg0LjAwNiwxNTEuOTYyLDE4OS44OTYsMTQ4LjA4NywxOTMuMjg3eiBNMjQwLjIyLDE2Mi4yODYNCgkJYzUuMTUsMCw5LjMyNCw0LjE3NCw5LjMyNCw5LjMyM3MtNC4xNzQsOS4zMjMtOS4zMjQsOS4zMjNoLTEwLjg2OWwtMy4zNzgsMTQuOTA0Yy0wLjk4MSw0LjMyOC00LjgyNiw3LjI2NS05LjA4NSw3LjI2NQ0KCQljLTAuNjgzLDAtMS4zNzYtMC4wNzUtMi4wNjktMC4yMzJjLTUuMDIyLTEuMTM5LTguMTctNi4xMzItNy4wMzItMTEuMTUzbDIuNDQ0LTEwLjc4M2gtMjAuMjAxbC0zLjM3OCwxNC45MDQNCgkJYy0wLjk4MSw0LjMyOC00LjgyNiw3LjI2NS05LjA4NCw3LjI2NWMtMC42ODMsMC0xLjM3Ni0wLjA3NS0yLjA2OS0wLjIzMmMtNS4wMjItMS4xMzktOC4xNy02LjEzMi03LjAzMi0xMS4xNTNsMi40NDgtMTAuNzk5DQoJCWMtNS4wMDctMC4xNjItOS4wMTktNC4yNjItOS4wMTktOS4zMDhjMC01LjE0OSw0LjE3NC05LjMyMyw5LjMyNC05LjMyM2gzLjkxN2wyLjcyNS0xMi4wMmgtNi42NDINCgkJYy01LjE0OSwwLTkuMzI0LTQuMTc0LTkuMzI0LTkuMzIyYzAtNS4xNSw0LjE3NC05LjMyNCw5LjMyNC05LjMyNGgxMC44NjlsMy4zNzgtMTQuOTA0YzEuMTM4LTUuMDIxLDYuMTM0LTguMTcsMTEuMTU0LTcuMDMyDQoJCWM1LjAyMiwxLjEzOSw4LjE3LDYuMTMyLDcuMDMyLDExLjE1M2wtMi40NDQsMTAuNzgzaDIwLjIwMWwzLjM3OC0xNC45MDRjMS4xMzgtNS4wMjEsNi4xMzMtOC4xNywxMS4xNTQtNy4wMzINCgkJYzUuMDIyLDEuMTM5LDguMTcsNi4xMzIsNy4wMzIsMTEuMTUzbC0yLjQ0OCwxMC43OTljNS4wMDcsMC4xNjIsOS4wMTksNC4yNjIsOS4wMTksOS4zMDljMCw1LjE0OC00LjE3NCw5LjMyMi05LjMyNCw5LjMyMmgtMy45MTcNCgkJbC0yLjcyNSwxMi4wMkgyNDAuMjJ6Ii8+DQoJPHBvbHlnb24gcG9pbnRzPSIxOTQuMjU4LDE2Mi4yODYgMjE0LjQ1OCwxNjIuMjg2IDIxNy4xODMsMTUwLjI2NyAxOTYuOTgyLDE1MC4yNjcgCSIvPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPC9zdmc+DQo=',
            },
            {
                id: 'swift',
                iconText: 'Swift',
                link: 'https://github.com/Fyipe/log-swift',
                icon:
                    'data:image/svg+xml;utf8;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pg0KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDE5LjAuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPg0KPHN2ZyB2ZXJzaW9uPSIxLjEiIGlkPSJDYXBhXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4Ig0KCSB2aWV3Qm94PSIwIDAgNTEyLjAxIDUxMi4wMSIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAwIDAgNTEyLjAxIDUxMi4wMTsiIHhtbDpzcGFjZT0icHJlc2VydmUiPg0KPGc+DQoJPGc+DQoJCTxwYXRoIGQ9Ik00NjcuNjgsMzQ3LjI2OWMwLDAsNzIuOTkyLTE2NS4wNTYtMTUyLjA5Ni0zMTUuMjY0YzAsMCw5Mi4xNiwxMTMuODI0LDQ0LjczNiwyNDAuOTkyYzAsMC0xNjUuMzc2LTExNS4wNzItMjQ4LjU3Ni0xOTcuNg0KCQkJYzAsMCwxMDMuOTY4LDE0Ni43ODQsMTQxLjI4LDE3Ni43MzZjMCwwLTYyLjA0OC0zMS41Mi0yMDUuODI0LTE1MS41NTJjMCwwLDE2NC45MjgsMjExLjE2OCwyNDIuNjg4LDI1NS4yNjQNCgkJCWMwLDAtMTE3LjY2NCw3OC45MTItMjg5Ljg4OC0zMi40NDhjMCwwLDkwLjU5MiwxNTYuNjA4LDI4MS42OTYsMTU2LjYwOGM4NS45MiwwLDExMS4xMDQtNDMuMjk2LDE1My42NjQtNDMuMjk2DQoJCQljNDQuMDMyLDAsNzAuNTYsNDMuMjk2LDcwLjU2LDQzLjI5NkM1MzEuNjE2LDQxOC4wMjEsNDY3LjY4LDM0Ny4yNjksNDY3LjY4LDM0Ny4yNjl6Ii8+DQoJPC9nPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPGc+DQo8L2c+DQo8Zz4NCjwvZz4NCjxnPg0KPC9nPg0KPC9zdmc+DQo=',
            },
            {
                id: 'rust',
                iconText: 'Rust',
                icon:
                    'data:image/png;utf8;base64,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',
                link: 'https://github.com/Fyipe/log-rust',
            },
            {
                id: 'ruby',
                iconText: 'Ruby',
                link: 'https://github.com/Fyipe/log-ruby',
                icon:
                    'data:image/jpeg;utf8;base64,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',
            },
        ];
    },
};
