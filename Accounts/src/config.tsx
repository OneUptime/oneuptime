import React from 'react';

import isEmail from 'sane-email-validation';

import validUrl from 'valid-url';
import valid from 'card-validator';

import FileSaver from 'file-saver';

//Data validation Util goes in here.
export const Validate = {
    isDomain(domain: $TSFixMe) {
        return domain.search(/\./) >= 0;
    },

    url(url: URL) {
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

export const getQueryVar: Function = (variable: $TSFixMe, url: URL) => {
    if (!url) return null;
    variable = variable.replace(/[[\]]/g, '\\$&');
    const regex = new RegExp('[?&]' + variable + '(=([^&#]*)|&|#|$)'),
        results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

export const saveFile: Function = (content: $TSFixMe, filename: $TSFixMe) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    FileSaver.saveAs(blob, filename);
}
