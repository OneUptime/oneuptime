/**
 *
 * Copyright HackerBay, Inc.
 *
 */

module.exports = {
    accountSid : process.env['TWILIO_ACCOUNTSID'] || 'AC84a1e9639b09c1262d19afa0d1c732a2',
    authToken : process.env['TWILIO_AUTHTOKEN'] || 'e6e39b0b96cabcc30210a01b265b44f2',
    phoneNumber : process.env['TWILIO_NUMBER'] || '+13362838458',
    testphoneNumber : process.env['TEST_TWILIO_NUMBER'] || '+9199105 68840',
    verificationSid: process.env['VERIFICATION_SID'] || 'VAf44c83fc52a25ce09225e3ca33fc1a17'
};