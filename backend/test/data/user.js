const StringUtil = require('../utils/string');

module.exports = {
    user: {
        name: 'John Smith',
        email: StringUtil.generateRandomString(10) + '@tmpmail.com',
        password: '1234567890',
        confirmPassword: '1234567890',
        companyName: 'Hackerbay',
        jobRole: 'Engineer',
        companySize: 10,
        subscription: {
            stripePlanId: 0,
        },
        city: 'New York',
        state: 'New York',
        zipCode: '111000111',
        country: 'Iceland',
        planId: 'plan_GoWIqpBpStiqQp',
        companyRole: 'Snr. Developer',
        companyPhoneNumber: '+919910568840',
        reference: 'Github',
    },

    adminUser: {
        name: 'Admin Admin',
        email: StringUtil.generateRandomString(10) + '@tmpmail.com',
        password: '1234567890',
        confirmPassword: '1234567890',
        companyName: 'Hackerbay',
        jobRole: 'Engineer',
        companySize: 10,
        subscription: {
            stripePlanId: 0,
        },
        city: 'New York',
        state: 'New York',
        zipCode: '111000111',
        country: 'Iceland',
        planId: 'plan_GoWIqpBpStiqQp',
        companyRole: 'Snr. Developer',
        companyPhoneNumber: '+919910568840',
        reference: 'Github',
        role: 'master-admin',
    },

    anotherUser: {
        name: 'Kayode Adebayo',
        email: StringUtil.generateRandomString(10) + '@fyipe.com',
        password: '123456789',
        confirmPassword: '123456789',
        companyName: 'Hackerbay',
        jobRole: 'Engineer',
        companySize: 10,
        subscription: {
            stripePlanId: 0,
        },
        city: 'New York',
        state: 'New York',
        zipCode: '111000111',
        country: 'Iceland',
        planId: 'plan_GoWIqpBpStiqQp',
        companyRole: 'Snr. Developer',
        companyPhoneNumber: '+919910568840',
        reference: 'Github',
    },

    newUser: {
        name: 'John Smith',
        email: StringUtil.generateRandomString(10) + '@fyipe.com',
        password: '1234567890',
        confirmPassword: '1234567890',
        companyName: 'Hackerbay',
        jobRole: 'Engineer',
        companySize: 10,
        subscription: {
            stripePlanId: 0,
        },
        city: 'New York',
        state: 'New York',
        zipCode: '111000111',
        country: 'Iceland',
        planId: 'plan_GoWIqpBpStiqQp',
        companyRole: 'Snr. Developer',
        companyPhoneNumber: '+919910568840',
        reference: 'Github',
    },

    nullUser: {
        name: null,
        email: null,
        password: null,
        confirmPassword: null,
        companyName: null,
        jobRole: null,
        companySize: null,
        subscription: {
            stripePlanId: null,
        },
        city: null,
        state: null,
        zipCode: null,
        country: null,
        planId: null,
        companyRole: null,
        companyPhoneNumber: null,
        reference: null,
    },

    profile: {
        name: 'John Smith',
        email: StringUtil.generateRandomString(10) + '@fyipe.com',
        timezone: 'Europe/London',
        profilePic: 'Image.jpg',
        companyPhoneNumber: '+919910568840',
        alertPhoneNumber: '+919910568840',
    },

    bulkUsers: {
        emails: StringUtil.generateBulkEmails(120),
    },

    otherBulkUsers: {
        emails: StringUtil.generateBulkEmails(99),
    },

    moreBulkUsers: {
        emails: StringUtil.generateBulkEmails(98),
    },
};
