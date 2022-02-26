export default {
    create: async function(data: $TSFixMe) {
        const iv = Crypto.randomBytes(16);
        data.authToken = await EncryptDecrypt.encrypt(data.authToken, iv);
        const twilioModel = new TwilioModel();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Docum... Remove this comment to see the full error message
        twilioModel.projectId = data.projectId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'accountSid' does not exist on type 'Docu... Remove this comment to see the full error message
        twilioModel.accountSid = data.accountSid;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'authToken' does not exist on type 'Docum... Remove this comment to see the full error message
        twilioModel.authToken = data.authToken;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'phoneNumber' does not exist on type 'Doc... Remove this comment to see the full error message
        twilioModel.phoneNumber = data.phoneNumber;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'iv' does not exist on type 'Document<any... Remove this comment to see the full error message
        twilioModel.iv = iv;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'enabled' does not exist on type 'Documen... Remove this comment to see the full error message
        twilioModel.enabled = true;
        const twilioSettings = await twilioModel.save();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'authToken' does not exist on type 'Docum... Remove this comment to see the full error message
        if (twilioSettings && twilioSettings.authToken && twilioSettings.iv) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'authToken' does not exist on type 'Docum... Remove this comment to see the full error message
            twilioSettings.authToken = await EncryptDecrypt.decrypt(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'authToken' does not exist on type 'Docum... Remove this comment to see the full error message
                twilioSettings.authToken,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'iv' does not exist on type 'Document<any... Remove this comment to see the full error message
                twilioSettings.iv
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'iv' does not exist on type 'Document<any... Remove this comment to see the full error message
            delete twilioSettings.iv;
        }
        return twilioSettings;
    },

    updateOneBy: async function(query: $TSFixMe, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;

        if (data.authToken) {
            const iv = Crypto.randomBytes(16);
            data.authToken = await EncryptDecrypt.encrypt(data.authToken, iv);
            data.iv = iv;
        }

        const updatedTwilioSettings = await TwilioModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            {
                new: true,
            }
        ).lean();
        if (
            updatedTwilioSettings &&
            updatedTwilioSettings.authToken &&
            updatedTwilioSettings.iv
        ) {
            updatedTwilioSettings.authToken = await EncryptDecrypt.decrypt(
                updatedTwilioSettings.authToken,
                updatedTwilioSettings.iv.buffer
            );
            delete updatedTwilioSettings.iv;
        }
        return updatedTwilioSettings;
    },

    updateBy: async function(query: $TSFixMe, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        let updatedData = await TwilioModel.updateMany(query, {
            $set: data,
        });
        const populate = [{ path: 'projectId', select: 'name' }];
        const select =
            'projectId accountSid authToken phoneNumber iv enabled createdAt deletedById';
        updatedData = await this.findBy({ query, select, populate });
        return updatedData;
    },

    deleteBy: async function(query: $TSFixMe, userId: $TSFixMe) {
        const deletedData = await TwilioModel.findOneAndUpdate(
            query,
            {
                $set: {
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now(),
                },
            },
            {
                new: true,
            }
        );
        if (deletedData && deletedData.authToken && deletedData.iv) {
            deletedData.authToken = await EncryptDecrypt.decrypt(
                deletedData.authToken,
                deletedData.iv.buffer
            );
            delete deletedData.iv;
        }
        return deletedData;
    },

    findBy: async function({
        query,
        skip,
        limit,
        select,
        populate
    }: $TSFixMe) {
        if (!skip) skip = 0;

        if (!limit) limit = 10;

        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }

        if (!query) {
            query = {};
        }

        query.deleted = false;

        let twilioSettingQuery = TwilioModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip);

        twilioSettingQuery = handleSelect(select, twilioSettingQuery);
        twilioSettingQuery = handlePopulate(populate, twilioSettingQuery);

        const twilioSettings = await twilioSettingQuery;

        for (const config of twilioSettings) {
            if (config && config.authToken && config.iv) {
                config.authToken = await EncryptDecrypt.decrypt(
                    config.authToken,
                    config.iv.buffer
                );
                delete config.iv;
            }
        }
        return twilioSettings;
    },

    findOneBy: async function({
        query,
        select,
        populate
    }: $TSFixMe) {
        if (!query) {
            query = {};
        }

        query.deleted = false;

        let twilioQuery = TwilioModel.findOne(query)
            .sort([['createdAt', -1]])
            .lean();
        twilioQuery = handleSelect(select, twilioQuery);
        twilioQuery = handlePopulate(populate, twilioQuery);

        const twilio = await twilioQuery;

        if (twilio && twilio.authToken && twilio.iv) {
            twilio.authToken = await EncryptDecrypt.decrypt(
                twilio.authToken,
                twilio.iv.buffer
            );
            delete twilio.iv;
        }

        return twilio;
    },

    countBy: async function(query: $TSFixMe) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const count = await TwilioModel.countDocuments(query);
        return count;
    },

    hardDeleteBy: async function(query: $TSFixMe) {
        await TwilioModel.deleteMany(query);
        return 'SMS Smtp(s) removed successfully';
    },
};

import Crypto from 'crypto'
import TwilioModel from '../models/twilio'
import EncryptDecrypt from '../config/encryptDecrypt'
import handleSelect from '../utils/select'
import handlePopulate from '../utils/populate'
