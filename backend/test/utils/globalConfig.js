const GlobalConfigService = require('../../backend/services/globalConfigService');

module.exports = {
    initTestConfig: async function() {
        await GlobalConfigService.create({
            name: 'smtp',
            value: {
                'email-enabled': false,
                email: 'fyipedevtest1@gmail.com',
                password: 'H2Q2ALqEpknLKsPdRgDmkQfpFsiG8KgEq',
                'from-name': 'Fyipe',
                'smtp-server': 'smtp.gmail.com',
                'smtp-port': '465',
                'smtp-secure': true,
            },
        });

        await GlobalConfigService.create({
            name: 'twilio',
            value: {
                'sms-enabled': false,
                'call-enabled': false,
                'account-sid': 'AC0a2295b7745a7ddc57fc73e77f9b72a0',
                'authentication-token': '09336be1b05ab5b2c1a6870202d9b769',
                'phone': '+14143958232',
                'alert-limit': 100,
                'verification-sid': 'VA0832f242a8d417136df936f3e12af8c1'
            },
        });
    },

    removeTestConfig: async function() {
        await GlobalConfigService.hardDeleteBy({});
    },
};
