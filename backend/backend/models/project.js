var slugify = require('slugify');
var generate = require('nanoid/generate');
var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var projectSchema = new Schema({
    name: String,
    slug: {
        type: String
    },
    users: [{
        userId: { type: String, ref: 'User' },
        role: {
            type: String,
            enum: ['Owner', 'Administrator', 'Member', 'Viewer']
        }
    }],

    stripePlanId: String,
    stripeSubscriptionId: String, // this is for plans.
    parentProjectId: { type: String, ref: 'Project' },
    seats: { type: String, default: '1' },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date
    },

    deletedById: { type: String, ref: 'User' },

    apiKey: String,
    alertEnable: {
        type: Boolean,
        default: false
    },
    balance:{
        type: Number,
        default: 0
    },
    alertOptions: {
        minimumBalance: {
            type: Number,
            enum: [20, 50, 100]
        },
        rechargeToBalance: {
            type: Number,
            enum: [40, 100, 200]
        },
        billingUS: {
            type: Boolean,
            default: true
        },
        billingNonUSCountries: {
            type: Boolean,
            default: false
        },
        billingRiskCountries: {
            type: Boolean,
            default: false
        }
    },
    isBlocked: {
        type: Boolean,
        default: false
    },
    adminNotes: [{
        note: { type: String },
        createdAt: { type: Date }
    }],
});

projectSchema.pre('save', function (next) {
    let name = this.get('name');
    name = slugify(name);
    name = `${name}-${generate('1234567890', 5)}`;
    this.slug = name;
    next();
});

module.exports = mongoose.model('Project', projectSchema);