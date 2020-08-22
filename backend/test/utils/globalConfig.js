const GlobalConfigService = require('../../backend/services/globalConfigService');

module.exports = {
    initTestConfig: async function() {
        await GlobalConfigService.create({
            name: 'smtp',
            value: {
                'email-enabled': false,
                email: 'ibukun.o.dairo@gmail.com',
                password: 'ZEC1kY9xFN6aVf3j',
                'from-name': 'Fyipe <ibukun.o.dairo@gmail.com>',
                'smtp-server': 'smtp-relay.sendinblue.com',
                'smtp-port': '465',
                'smtp-secure': true,
            },
        });
        //
        //https://www.twilio.com/docs/iam/test-credentials
        await GlobalConfigService.create({
            name: 'twilio',
            value: {
                'sms-enabled': false,
                'call-enabled': false,
                'account-sid': 'AC4b957669470069d68cd5a09d7f91d7c6',
                'authentication-token': '79a35156d9967f0f6d8cc0761ef7d48d',
                phone: '+15005550006',
                'alert-limit': 100,
            },
        });
    },

    removeTestConfig: async function() {
        await GlobalConfigService.hardDeleteBy({});
    },
};
