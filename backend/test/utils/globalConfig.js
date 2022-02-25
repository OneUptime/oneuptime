import GlobalConfigService from '../../backend/services/globalConfigService'

export default {
    initTestConfig: async function() {
        await GlobalConfigService.create({
            name: 'smtp',
            value: {
                'email-enabled': true,
                email: 'ibukun.o.dairo@gmail.com',
                password: 'ZEC1kY9xFN6aVf3j',
                'from-name': 'Ibukun',
                from: 'ibukun.o.dairo@gmail.com',
                'smtp-server': 'smtp-relay.sendinblue.com',
                'smtp-port': '465',
                'smtp-secure': true,
                customSmtp: true,
            },
        });
        //
        //https://www.twilio.com/docs/iam/test-credentials
        await GlobalConfigService.create({
            name: 'twilio',
            value: {
                'sms-enabled': true,
                'call-enabled': true,
                'account-sid': 'AC4b957669470069d68cd5a09d7f91d7c6',
                'authentication-token': '79a35156d9967f0f6d8cc0761ef7d48d',
                phone: '+15005550006',
                'alert-limit': 100,
            },
        });
    },

    enableEmailLog: async function() {
        await GlobalConfigService.create({
            name: 'emailLogMonitoringStatus',
            value: true,
        });
    },

    removeTestConfig: async function() {
        await GlobalConfigService.hardDeleteBy({});
    },
};
