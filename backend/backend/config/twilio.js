/**
 *
 * Copyright HackerBay, Inc.
 *
 */

module.exports = {
    accountSid : process.env['TWILIO_ACCOUNTSID'] || 'AC0a2295b7745a7ddc57fc73e77f9b72a0',
    authToken : process.env['TWILIO_AUTHTOKEN'] || '09336be1b05ab5b2c1a6870202d9b769',
    phoneNumber : process.env['TWILIO_NUMBER'] || '+14143958232',
    testphoneNumber : process.env['TEST_TWILIO_NUMBER'] || '+919910568840',
    verificationSid: process.env['VERIFICATION_SID'] || 'VAf44c83fc52a25ce09225e3ca33fc1a17'
};