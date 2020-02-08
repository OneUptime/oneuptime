var ErrorService = require('../services/errorService');

module.exports = {

    checkActiveEscalationPolicyAndSendAlerts: async () => {
        try {

        } catch (error) {
            ErrorService.log('escalationPolicyCron.checkActiveEscalationPolicyAndSendAlerts', error);
            throw error;
        }
    }
};

