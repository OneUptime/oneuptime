import mongoose, { RequiredFields, UniqueFields } from '../infrastructure/ORM';

const Schema = mongoose.Schema;
const schema = new Schema({
    teamMembers: [
        {
            startTime: Date,
            endTime: Date,
            timezone: String,
            userId: { type: String, ref: 'User', index: true, default: null },
            groupId: {
                type: String,
                ref: 'Groups',
                index: true,
                default: null,
            },
        },
    ],
});

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];

export const sligifyField: string = '';

export default schema;
