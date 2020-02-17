try {
    require('./alert.test');
    require('./emailAuthorization.test');
    require('./emailTemplate.test');
    require('./feedback.test');
    require('./incident.test');
    require('./invoice.test');
    require('./jwttoken.test');
    require('./lead.test');
    require('./monitor.test');
    require('./monitorCategory.test');
    require('./monitorCriteria.test');
    require('./notification.test');
    require('./probe.test');
    require('./project.test');
    require('./reports.test');
    require('./schedule.test');
    require('./scheduledEvent.test');
    require('./smsTemplate.test');
    require('./statusPage.test');
    require('./stripe.test');
    require('./subscriber.test');
    require('./subscriberAlert.test');
    require('./team.test');
    require('./tutorial.test');
    require('./twilio.test');
    require('./user.test');
    require('./version.test');
    require('./zapier.test');
    require('./rateLimit.test');
} catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    throw error; 
}