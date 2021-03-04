const mongoose = require('../config/db');

const Schema = mongoose.Schema;

const containerSecuritySchema = new Schema(
    {
        name: String,
        slug:String,
        dockerCredential: {
            type: Schema.Types.ObjectId,
            ref: 'DockerCredential',
            index: true,
        },
        imagePath: String,
        imageTags: String,
        componentId: {
            type: Schema.Types.ObjectId,
            ref: 'Component',
            index: true,
        },
        resourceCategory: {
            type: Schema.Types.ObjectId,
            ref: 'ResourceCategory',
            index: true,
        },
        deleted: {
            type: Boolean,
            default: false,
        },
        deleteAt: Date,
        lastScan: Date,
        scanned: { type: Boolean, default: false },
        scanning: { type: Boolean, default: false },
    },
    { timestamps: true } //automatically adds createdAt and updatedAt to the schema
);

module.exports = mongoose.model('ContainerSecurity', containerSecuritySchema);
