import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
} from '../Infrastructure/ORM';

const Schema = mongoose.Schema;

/**
 * Represents the Zapier Schema in the database.
 * @let {object} zapierSchema
 * @property {string} projectId - The `ID` of the project the incident is created on.
 * @property {string} url - The zapier hook that the oneuptime server pings with new incidents.
 * @property {string} type - The name of trigger that receives the incident object.
 * @property {number} counter - The number of incidents send to the zapier `url`.
 *
 */
const schema = new Schema({
    projectId: String,
    url: URL,
    type: String,
    monitors: [String],
    deleted: {
        type: Boolean,
        default: false,
    },
});
export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: encryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('Zapier', schema);
