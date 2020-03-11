/**
 *
 * Copyright HackerBay, Inc.
 *
 */

module.exports = {
    accountSid:
        process.env['TWILIO_ACCOUNTSID'],
    authToken:
        process.env['TWILIO_AUTHTOKEN'],
    phoneNumber: process.env['TWILIO_NUMBER'],
    testphoneNumber: process.env['TEST_TWILIO_NUMBER'],
    verificationSid:
        process.env['TWILIO_VERIFICATION_SID'],
    twilioAlertLimit: process.env['TWILIO_ALERT_LIMIT'] || 100
};
