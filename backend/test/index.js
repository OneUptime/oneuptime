try {
    require('./monitorSla.test'); // Passed
    require('./customField.test'); // Passed
    require('./incomingHttpRequest.test'); // Passed
    require('./monitorCustomField.test'); // Passed
    require('./adminCredentials.test'); // Passed
    require('./incidentCommunicationSla.test'); // Passed
    require('./adminCredentials.test'); //Passed
    require('./alert.test'); // Passed
    require('./applicationLog.test');  // Passed
    require('./applicationSecurity.test');
    require('./auditLogs.test'); // Passed
    require('./emailLogs.test'); // Passed
    require('./component.test'); // Passed
    require('./containerSecurity.test');
    require('./disableSignup.test'); // Passed
    require('./dockerCredential.test'); // 
    require('./emailAuthorization.test'); // Passed
    require('./emailSmtp.test');
    require('./emailTemplate.test'); // Passed
    require('./errorTracker.test');
    require('./feedback.test'); // Passed
    require('./gitCredential.test'); // Passed
    require('./globalConfig.test'); // Passed
    require('./incident.test');
    require('./incidentAlerts.test');
    require('./incidentPriority.test');
    require('./incidentSettings.test');
    require('./invoice.test'); // Passed
    require('./jwttoken.test'); // Passed
    require('./lead.test'); // Passed
    require('./monitor.test');
    require('./monitorCriteria.test'); // Passed
    require('./notification.test');
    require('./probe.test');
    require('./project.test');
    require('./rateLimit.test'); // Passed
    require('./reports.test'); // Passed
    require('./resourceCategory.test');
    require('./schedule.test');
    require('./scheduledEvent.test'); // Passed
    require('./scheduledEventNote.test'); // Passed
    require('./smsTemplate.test'); // Passed
    require('./sso.test'); // Passed
    require('./statusPage.test');
    require('./stripe.test'); // Passed
    require('./subscriber.test'); // Passed
    require('./subscriberAlert.test');
    require('./team.test'); // Passed
    require('./tutorial.test'); // Passed
    require('./twilio.test'); // Passed
    require('./user.test');  // Passed
    require('./version.test'); // Passed
    require('./webhook.test'); // Passed
    require('./zapier.test'); // Passed
} catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    throw error;
}
