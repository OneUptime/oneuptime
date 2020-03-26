import React from 'react';
import isEmail from 'sane-email-validation';
import validUrl from 'valid-url';
import valid from 'card-validator';
import FileSaver from 'file-saver';
import moment from 'moment';
import { emaildomains } from './constants/emaildomains';

let apiUrl = window.location.origin + '/api';
let dashboardUrl = window.location.origin + '/dashboard';
let accountsUrl = window.location.origin + '/accounts';
let isLocalhost = window &&
window.location &&
window.location.host &&
(window.location.host.includes('localhost:') ||
    window.location.host.includes('0.0.0.0:') ||
    window.location.host.includes('127.0.0.1:'));

if (
    isLocalhost
) {
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

export const IS_SAAS_SERVICE = !!env('IS_SAAS_SERVICE');

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
    getTutorials() {
        return [
            {
                id: 'component',
                title: 'What are Components?',
                iconText: 'component',
                icon:
                    'data:image/svg+xml;utf8;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iaXNvLTg4NTktMSI/Pgo8IS0tIEdlbmVyYXRvcjogQWRvYmUgSWxsdXN0cmF0b3IgMTkuMC4wLCBTVkcgRXhwb3J0IFBsdWctSW4gLiBTVkcgVmVyc2lvbjogNi4wMCBCdWlsZCAwKSAgLS0+CjxzdmcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIgdmVyc2lvbj0iMS4xIiBpZD0iTGF5ZXJfMSIgeD0iMHB4IiB5PSIwcHgiIHZpZXdCb3g9IjAgMCA1MTIgNTEyIiBzdHlsZT0iZW5hYmxlLWJhY2tncm91bmQ6bmV3IDAgMCA1MTIgNTEyOyIgeG1sOnNwYWNlPSJwcmVzZXJ2ZSIgd2lkdGg9IjUxMnB4IiBoZWlnaHQ9IjUxMnB4Ij4KPGc+Cgk8cmVjdCB4PSI4OC4yNzYiIHk9IjMyNi42MjEiIHN0eWxlPSJmaWxsOiNEN0RFRUQ7IiB3aWR0aD0iMTcuNjU1IiBoZWlnaHQ9IjQ0LjEzOCIvPgoJPHJlY3QgeD0iMTY3LjcyNCIgeT0iMjkxLjMxIiBzdHlsZT0iZmlsbDojRDdERUVEOyIgd2lkdGg9IjE3LjY1NSIgaGVpZ2h0PSI3OS40NDgiLz4KCTxyZWN0IHg9IjMyNi42MjEiIHk9IjI1NiIgc3R5bGU9ImZpbGw6I0Q3REVFRDsiIHdpZHRoPSIxNy42NTUiIGhlaWdodD0iMTE0Ljc1OSIvPgoJPHJlY3QgeD0iNDA2LjA2OSIgeT0iMTY3LjcyNCIgc3R5bGU9ImZpbGw6I0Q3REVFRDsiIHdpZHRoPSIxNy42NTUiIGhlaWdodD0iMjAzLjAzNCIvPgoJPHJlY3QgeD0iMjQ3LjE3MiIgeT0iMjExLjg2MiIgc3R5bGU9ImZpbGw6I0Q3REVFRDsiIHdpZHRoPSIxNy42NTUiIGhlaWdodD0iMTU4Ljg5NyIvPgo8L2c+CjxwYXRoIHN0eWxlPSJmaWxsOiM4Rjk2QUM7IiBkPSJNOTcuMTA4LDMzNS40NTFjLTMuMzgyLDAtNi42MS0xLjk1NC04LjA3Mi01LjI0NWMtMS45OC00LjQ1NSwwLjAyNi05LjY3Miw0LjQ4Mi0xMS42NTJsNzcuNzMtMzQuNTQ3ICBsNzguMTktODYuODc4YzIuOTMyLTMuMjYsNy44MS0zLjg3MywxMS40NTgtMS40NGw3Mi43ODgsNDguNTI1bDc0LjM3OS05MC45MDhjMy4wODctMy43NzUsOC42NDgtNC4zMzEsMTIuNDIzLTEuMjQyICBjMy43NzMsMy4wODcsNC4zMjksOC42NDksMS4yNDIsMTIuNDIybC03OS40NDgsOTcuMTAzYy0yLjg3NiwzLjUxNi03Ljk0OSw0LjI3Ny0xMS43MjksMS43NTZsLTczLjA5Ny00OC43M2wtNzQuMzQyLDgyLjYwMSAgYy0wLjgyOSwwLjkyMS0xLjg0MywxLjY1OC0yLjk3NiwyLjE2MmwtNzkuNDQ4LDM1LjMxQzk5LjUyMywzMzUuMjA2LDk4LjMwNiwzMzUuNDUxLDk3LjEwOCwzMzUuNDUxeiIvPgo8cGF0aCBzdHlsZT0iZmlsbDojOTU5Q0IzOyIgZD0iTTQ5NC4zNDUsNDMyLjU1MkgxNy42NTVDNy45MDQsNDMyLjU1MiwwLDQyNC42NDgsMCw0MTQuODk3di04LjgyOGMwLTQuODc1LDMuOTUzLTguODI4LDguODI4LTguODI4ICBoNDk0LjM0NWM0Ljg3NSwwLDguODI4LDMuOTUzLDguODI4LDguODI4djguODI4QzUxMiw0MjQuNjQ4LDUwNC4wOTYsNDMyLjU1Miw0OTQuMzQ1LDQzMi41NTJ6Ii8+CjxwYXRoIHN0eWxlPSJmaWxsOiM3MDc0ODc7IiBkPSJNMjg1Ljg1NSw0MTQuODk3aC01OS43MDljLTMuMzQzLDAtNi40LTEuODg5LTcuODk1LTQuODc5bC02LjM4OS0xMi43NzZoODguMjc2bC02LjM4OCwxMi43NzYgIEMyOTIuMjU1LDQxMy4wMDcsMjg5LjE5OCw0MTQuODk3LDI4NS44NTUsNDE0Ljg5N3oiLz4KPHBhdGggc3R5bGU9ImZpbGw6I0FGQjlEMjsiIGQ9Ik00NjcuODYyLDc5LjQ0OEg0NC4xMzhjLTE0LjYyNiwwLTI2LjQ4MywxMS44NTctMjYuNDgzLDI2LjQ4M3YyOTEuMzFoNDc2LjY5di0yOTEuMzEgIEM0OTQuMzQ1LDkxLjMwNSw0ODIuNDg4LDc5LjQ0OCw0NjcuODYyLDc5LjQ0OHogTTQ2Ny44NjIsMzYxLjkzMWMwLDQuODc1LTMuOTUzLDguODI4LTguODI4LDguODI4SDUyLjk2NiAgYy00Ljg3NSwwLTguODI4LTMuOTUzLTguODI4LTguODI4VjExNC43NTljMC00Ljg3NSwzLjk1My04LjgyOCw4LjgyOC04LjgyOGg0MDYuMDY5YzQuODc1LDAsOC44MjgsMy45NTMsOC44MjgsOC44MjhWMzYxLjkzMXoiLz4KPGNpcmNsZSBzdHlsZT0iZmlsbDojRkZENzgyOyIgY3g9IjI1NiIgY3k9IjIwMy4wMzQiIHI9IjE3LjY1NSIvPgo8Y2lyY2xlIHN0eWxlPSJmaWxsOiNGRjY0NjQ7IiBjeD0iMTc2LjU1MiIgY3k9IjI5MS4zMSIgcj0iMTcuNjU1Ii8+CjxjaXJjbGUgc3R5bGU9ImZpbGw6IzlCRTZEMjsiIGN4PSI0MTQuODk3IiBjeT0iMTU4Ljg5NyIgcj0iMTcuNjU1Ii8+CjxjaXJjbGUgc3R5bGU9ImZpbGw6I0MzRTY3ODsiIGN4PSIzMzUuNDQ4IiBjeT0iMjU2IiByPSIxNy42NTUiLz4KPGNpcmNsZSBzdHlsZT0iZmlsbDojMDBEMkZGOyIgY3g9Ijk3LjEwMyIgY3k9IjMyNi42MjEiIHI9IjE3LjY1NSIvPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8Zz4KPC9nPgo8L3N2Zz4K',
                description: (
                    <p>
                        Monitors are now contained within Components. Create a
                        new component below to get started.
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
