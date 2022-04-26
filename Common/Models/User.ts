import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    {
        name: string,
        email: string,
        tempEmail: string,
        password: string,
        isVerified: boolean,
        sso: { type: string, ref: 'Sso', index: true },
        companyName: string,
        companyRole: string,
        companySize: string,
        referral: string,
        companyPhoneNumber: string,

        airtableId: string,

        onCallAlert: Array,
        profilePic: string,

        twoFactorAuthEnabled: { type: Boolean, default: false },
        twoFactorSecretCode: string,
        otpauth_url: URL,
        backupCodes: Array,

        jwtRefreshToken: string,
        stripeCustomerId: string,
        resetPasswordToken: string,
        resetPasswordExpires: string,
        timezone: string,
        lastActive: {
            type: Date,
            default: Date.now,
        },
        coupon: string,

        disabled: boolean,
        paymentFailedDate: {
            type: Date,
            default: null,
        },
        role: {
            type: string,
            enum: ['master-admin', 'user'],
        },
        isBlocked: boolean,
        adminNotes: [
            {
                note: string,
                createdAt: Date,
            },
        ],

        

        deletedAt: {
            type: Date,
        },

        deletedByUser: User,
        alertPhoneNumber: {
            type: string,
            default: '',
        },
        alertPhoneVerificationCode: {
            type: string,
            default: '',
        },
        alertPhoneVerificationCodeRequestTime: {
            type: Date,
        },
        tempAlertPhoneNumber: string,
        tutorial: Object,
        createdBy: { type: string, ref: 'User' },
        identification: [
            {
                subscription: Object,
                userAgent: string,
            },
        ],
        source: Object,
        cachedPassword: {
            // Store original password here in "admin mode"
            type: string,
            default: null,
        },
        isAdminMode: {
            type: Boolean, // Currently in admin mode
            default: false,
        },
    },
    { timestamps: true }
);









