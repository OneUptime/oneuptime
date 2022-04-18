import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
   Schema
} from '../Infrastructure/ORM';


const schema: Schema = new Schema({
    name: String,
    slug: {
        type: String,
    },
    users: [
        {
            userId: { type: String, ref: 'User', index: true },
            role: {
                type: String,
                enum: ['Owner', 'Administrator', 'Member', 'Viewer'],
            },
            show: { type: Boolean, default: true },
        },
    ],

    stripePlanId: String,
    stripeSubscriptionId: String, // This is for plans.
    parentProjectId: { type: String, ref: 'Project', index: true },
    seats: { type: String, default: '1' },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User', index: true },

    apiKey: String,
    alertEnable: {
        type: Boolean,
        default: false,
    },
    alertLimit: String,
    alertLimitReached: {
        type: Boolean,
        default: false,
    },
    balance: {
        type: Number,
        default: 0,
    },
    alertOptions: {
        minimumBalance: {
            type: Number,
            enum: [20, 50, 100],
        },
        rechargeToBalance: {
            type: Number,
            enum: [40, 100, 200],
        },
        billingUS: {
            type: Boolean,
            default: true,
        },
        billingNonUSCountries: {
            type: Boolean,
            default: false,
        },
        billingRiskCountries: {
            type: Boolean,
            default: false,
        },
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
    sendCreatedIncidentNotificationSms: { type: Boolean, default: true },
    sendAcknowledgedIncidentNotificationSms: { type: Boolean, default: true },
    sendResolvedIncidentNotificationSms: { type: Boolean, default: true },
    sendCreatedIncidentNotificationEmail: { type: Boolean, default: true },
    sendAcknowledgedIncidentNotificationEmail: { type: Boolean, default: true },
    sendResolvedIncidentNotificationEmail: { type: Boolean, default: true },
    enableInvestigationNoteNotificationSMS: { type: Boolean, default: true },
    enableInvestigationNoteNotificationEmail: { type: Boolean, default: true },

    sendAnnouncementNotificationSms: { type: Boolean, default: true },
    sendAnnouncementNotificationEmail: { type: Boolean, default: true },

    sendCreatedScheduledEventNotificationSms: { type: Boolean, default: true },
    sendCreatedScheduledEventNotificationEmail: {
        type: Boolean,
        default: true,
    },
    sendScheduledEventResolvedNotificationSms: { type: Boolean, default: true },
    sendScheduledEventResolvedNotificationEmail: {
        type: Boolean,
        default: true,
    },
    sendNewScheduledEventInvestigationNoteNotificationSms: {
        type: Boolean,
        default: true,
    },
    sendNewScheduledEventInvestigationNoteNotificationEmail: {
        type: Boolean,
        default: true,
    },
    sendScheduledEventCancelledNotificationSms: {
        type: Boolean,
        default: true,
    },
    sendScheduledEventCancelledNotificationEmail: {
        type: Boolean,
        default: true,
    },

    enableInvestigationNoteNotificationWebhook: {
        type: Boolean,
        default: true,
    },
    replyAddress: String,
    unpaidSubscriptionNotifications: { type: String, default: '0' },
    paymentFailedDate: {
        type: Date,
        default: null,
    },
    paymentSuccessDate: {
        type: Date,
        default: null,
    },
});
export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('Project', schema);
