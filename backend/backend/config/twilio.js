/**
 *
 * Copyright HackerBay, Inc.
 *
 */

module.exports = {
    accountSid : process.env['TWILIO_ACCOUNTSID'] || 'AC55ce28b0141cb9149ee9a12a4a82b61b',
    authToken : process.env['TWILIO_AUTHTOKEN'] || '317b00a94ec303c3a7e174f11a0a0d4c',
    phoneNumber : process.env['TWILIO_NUMBER'] || '+16464194935',
    testphoneNumber : process.env['TEST_TWILIO_NUMBER'] || '+19179009335',
};