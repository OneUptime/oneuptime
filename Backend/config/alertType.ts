export default {
    Call: 'call',
    Email: 'email',
    SMS: 'sms',
    Push: 'push',
    Webhook: 'webhook',
    getAlertChargeAmount: function (type: $TSFixMe, country: $TSFixMe): void {
        if (type === 'sms') {
            if (country === 'us') {
                return {
                    alertType: 'sms',
                    category: 'us',
                    price: 0.02,
                    minimumBalance: 5,
                    pricingQuota: '$0.02 / sms / 160 chars',
                };
            } else if (country === 'non-us') {
                return {
                    alertType: 'sms',
                    category: 'non-us',
                    price: 1.0,
                    minimumBalance: 10,
                    pricingQuota: '$1.0 / sms / 160 chars',
                };
            } else if (country === 'risk') {
                return {
                    alertType: 'sms',
                    category: 'risk',
                    price: 1.0,
                    minimumBalance: 20,
                    pricingQuota: '$1.0 / sms / 160 chars',
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
        } else if (type === 'callRouting') {
            if (country === 'us') {
                return {
                    alertType: 'callRouting',
                    category: 'us',
                    price: 0.085,
                    minimumBalance: 5,
                };
            } else if (country === 'non-us') {
                return {
                    alertType: 'callRouting',
                    category: 'non-us',
                    price: 0.1,
                    minimumBalance: 10,
                };
            } else if (country === 'risk') {
                return {
                    alertType: 'callRouting',
                    category: 'risk',
                    price: 0.1,
                    minimumBalance: 20,
                };
            } else return {};
        } else return {};
    },
    getCountryType: function (phoneNumber: $TSFixMe): void {
        if (phoneNumber.startsWith('+1') || phoneNumber.startsWith('+44')) {
            //return us for canadian,us and uk numbers
            return 'us';
        } else if (
            phoneNumber.startsWith('+53') ||
            phoneNumber.startsWith('+371') ||
            phoneNumber.startsWith('+252') ||
            phoneNumber.startsWith('+370') ||
            phoneNumber.startsWith('+224') ||
            phoneNumber.startsWith('+220') ||
            phoneNumber.startsWith('+960') ||
            phoneNumber.startsWith('+372') ||
            phoneNumber.startsWith('+263') ||
            phoneNumber.startsWith('+216')
        ) {
            return 'risk';
        } else return 'non-us';
    },
};
