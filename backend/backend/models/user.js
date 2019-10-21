var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var userSchema = new Schema({
    name: String,
    email: String,
    password: String,
    isVerified: {
        type: Boolean,
        default: false
    },
    companyName: String,
    companyRole: String,
    companySize: String,
    referral: String,
    companyPhoneNumber: String,

    onCallAlert: Array,
    profilePic: String,

    jwtRefreshToken: String,
    stripeCustomerId: String,
    resetPasswordToken: String,
    resetPasswordExpires: String,
    createdAt: {
        type: Date,
        default: Date.now,
    },
    timezone: String,
    lastActive: {
        type: Date,
        default: Date.now,
    },
    coupon: String,

    disabled: {
        type: Boolean,
        default: false
    },
    paymentFailedDate: {
        type: Date,
        default: null,
    },
    role: {
        type: String,
        enum: ['master-admin']
    },
    isBlocked: {
        type: Boolean,
        default: false
    },
    adminNotes: [{
        note: { type: String },
        createdAt: { type: Date }
    }],

    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date
    },

    deletedById: { type: String, ref: 'User' },
    alertPhoneNumber: {
        type: String,
        default: ''
    },

    tutorial: Object
});

module.exports = mongoose.model('User', userSchema);
