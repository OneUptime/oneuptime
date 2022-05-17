import React from 'react';
import isEmail from 'sane-email-validation';
import validUrl from 'valid-url';
import valid from 'card-validator';
import FileSaver from 'file-saver';
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
        }
        else {
            return false;
        }
    },
    isValidNumber(number) {
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
        if (this.text(email))
            return isEmail(email);
        return false;
    },
    isValidBusinessEmail(email) {
        //return emaildomains.test(email);
        return true;
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
        if (name.match('[A-Z][a-zA-Z][^#&<>"~;$^%{}?]{1,20}$')) {
            return true;
        }
        return false;
    },
};
export const tutorials = {
    getMonitorTutorials() {
        return [
            {
                id: 's1',
                title: 'What are Monitors',
                icon: 'bell',
                description: (React.createElement("p", null,
                    "You can add web and API server address to to monitor.",
                    React.createElement("br", null),
                    "It allows you monitor the health status of your API")),
            },
            {
                id: 's2',
                title: 'What are Incidents',
                icon: 'bell',
                description: (React.createElement("p", null,
                    "You can use this feature to acknowledge an incident that occurred on a monitor",
                    React.createElement("br", null),
                    " and mark the incident as resolved after resolving the issue on your api or server")),
            },
            {
                id: 's3',
                title: 'Acknowledge/Resolve Incidents',
                icon: 'bell',
                description: (React.createElement("p", null,
                    "You can use this feature to acknowledge an incident that occurred on a monitor",
                    React.createElement("br", null),
                    " and mark the incident as resolved after resolving the issue on your api or server")),
            },
            {
                id: 's4',
                title: 'Status Metrics',
                icon: 'bell',
                description: (React.createElement("p", null,
                    "Get detailed metrics of all incidents that occurred",
                    ' ',
                    React.createElement("br", null),
                    "on connected monitors and with date and time it was resolved")),
            },
            {
                id: 's5',
                title: 'Better Status Handling',
                icon: 'bell',
                description: (React.createElement("p", null,
                    "After adding monitors for your API, you won't miss out on any",
                    React.createElement("br", null),
                    "downtime on your servers, Just let OneUptime alert notify you")),
            },
        ];
    },
};
export const getQueryVar = (variable, url) => {
    if (!url)
        return null;
    variable = variable.replace(/[[\]]/g, '\\$&');
    const regex = new RegExp('[?&]' + variable + '(=([^&#]*)|&|#|$)'), results = regex.exec(url);
    if (!results)
        return null;
    if (!results[2])
        return '';
    return decodeURIComponent(results[2].replace(/\+/g, ' '));
};
export const saveFile = (content, filename) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    FileSaver.saveAs(blob, filename);
};
