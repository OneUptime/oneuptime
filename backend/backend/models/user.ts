import mongoose from '../config/db';

const Schema = mongoose.Schema;
const userSchema = new Schema(
    {
        name: { type: String, index: true },
        email: String,
        tempEmail: String,
        password: String,
        isVerified: {
            type: Boolean,
            default: false,
        },
        sso: { type: String, ref: 'Sso', index: true },
        companyName: String,
        companyRole: String,
        companySize: String,
        referral: String,
        companyPhoneNumber: String,

        airtableId: String,

        onCallAlert: Array,
        profilePic: String,

        twoFactorAuthEnabled: { type: Boolean, default: false },
        twoFactorSecretCode: String,
        otpauth_url: URL,
        backupCodes: Array,

        jwtRefreshToken: String,
        stripeCustomerId: String,
        resetPasswordToken: String,
        resetPasswordExpires: String,
        timezone: String,
        lastActive: {
            type: Date,
            default: Date.now,
        },
        coupon: String,

        disabled: {
            type: Boolean,
            default: false,
        },
        paymentFailedDate: {
            type: Date,
            default: null,
        },
        role: {
            type: String,
            enum: ['master-admin', 'user'],
        },
        isBlocked: {
            type: Boolean,
            default: false,
        },
        adminNotes: [
            {
                note: { type: String },
                createdAt: { type: Date },
            },
        ],

        deleted: { type: Boolean, default: false },

        deletedAt: {
            type: Date,
        },

        deletedById: { type: String, ref: 'User', index: true },
        alertPhoneNumber: {
            type: String,
            default: '',
        },
        alertPhoneVerificationCode: {
            type: String,
            default: '',
        },
        alertPhoneVerificationCodeRequestTime: {
            type: Date,
        },
        tempAlertPhoneNumber: String,
        tutorial: Object,
        createdBy: { type: String, ref: 'User' },
        identification: [
            {
                subscription: Object,
                userAgent: String,
            },
        ],
        source: Object,
        cachedPassword: {
            // store original password here in "admin mode"
            type: String,
            default: null,
        },
        isAdminMode: {
            type: Boolean, // currently in admin mode
            default: false,
        },
    },
    { timestamps: true }
);

export default mongoose.model('User', userSchema);
