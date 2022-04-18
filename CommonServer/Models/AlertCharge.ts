import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
   Schema
} from '../Infrastructure/ORM';


const schema: Schema = new Schema({
    projectId: { type: String, ref: 'Project', index: true },
    chargeAmount: { type: Number, default: 0 },
    closingAccountBalance: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    alertId: { type: String, ref: 'Alert', index: true },
    subscriberAlertId: { type: String, ref: 'SubscriberAlert', index: true },
    monitorId: { type: Schema.Types.ObjectId, ref: 'Monitor', index: true },
    incidentId: { type: Schema.Types.ObjectId, ref: 'Incident', index: true },
    sentTo: { type: String },
});
export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('AlertCharge', schema);
