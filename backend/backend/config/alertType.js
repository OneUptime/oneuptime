/**
 *
 * Copyright HackerBay, Inc.
 *
 */

module.exports = {
    Call: 'call',
    Email: 'email',
    SMS: 'sms',
    getAlertChargeAmount: function(type, country) {
        if (type === 'sms') {
            if (country === 'us') {
                return {
                    alertType: 'sms',
                    category: 'us',
                    price: 1.0,
                    minimumBalance: 5,
                };
            } else if (country === 'non-us') {
                return {
                    alertType: 'sms',
                    category: 'non-us',
                    price: 1.0,
                    minimumBalance: 10,
                };
            } else if (country === 'risk') {
                return {
                    alertType: 'sms',
                    category: 'risk',
                    price: 1.0,
                    minimumBalance: 20,
                };
            } else return {};
        } else if (type === 'email') {
            if (country === 'us') {
                return {
                    alertType: 'email',
                    category: 'us',
                    price: 1.0,
                    minimumBalance: 0,
                };
            } else if (country === 'non-us') {
                return {
                    alertType: 'email',
                    category: 'non-us',
                    price: 1.0,
                    minimumBalance: 0,
                };
            } else if (country === 'risk') {
                return {
                    alertType: 'email',
                    category: 'risk',
                    price: 1.0,
                    minimumBalance: 0,
                };
            } else return {};
        } else if (type === 'call') {
            if (country === 'us') {
                return {
                    alertType: 'call',
                    category: 'us',
                    price: 1.0,
                    minimumBalance: 10,
                };
            } else if (country === 'non-us') {
                return {
                    alertType: 'call',
                    category: 'non-us',
                    price: 2.0,
                    minimumBalance: 20,
                };
            } else if (country === 'risk') {
                return {
                    alertType: 'call',
                    category: 'risk',
                    price: 5.0,
                    minimumBalance: 50,
                };
            } else return {};
        } else return {};
    },
    getCountryType: function(code) {
        if (code === '+1') {
            return 'us';
        } else if (
            [
                '+53',
                '+371',
                '+252',
                '+370',
                '+224',
                '220',
                '960',
                '372',
                '263',
                '+216',
            ].includes(code)
        ) {
            return 'risk';
        } else return 'non-us';
    },
};
