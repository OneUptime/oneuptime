export default {
    create: async function({
        name,
        value
    }: $TSFixMe) {
        if (name === 'smtp' && value.internalSmtp && !value.customSmtp) {
            value = {
                internalSmtp: true,
                customSmtp: false,
                'email-enabled': true,
            };
        }

        if (name === 'twilio' && value['authentication-token']) {
            const iv = Crypto.randomBytes(16);
            value['authentication-token'] = await EncryptDecrypt.encrypt(
                value['authentication-token'],
                iv
            );
            value['iv'] = iv;
        } else if (name === 'smtp' && value['password']) {
            const iv = Crypto.randomBytes(16);
            value['password'] = await EncryptDecrypt.encrypt(
                value['password'],
                iv
            );
            value['iv'] = iv;
        }

        let globalConfig = new GlobalConfigModel();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type 'Document<a... Remove this comment to see the full error message
        globalConfig.name = name;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'Document<... Remove this comment to see the full error message
        globalConfig.value = value;
        globalConfig = await globalConfig.save();

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type 'Document<a... Remove this comment to see the full error message
        if (globalConfig.name === 'twilio') {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'Document<... Remove this comment to see the full error message
            globalConfig.value[
                'authentication-token'
            ] = await EncryptDecrypt.decrypt(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'Document<... Remove this comment to see the full error message
                globalConfig.value['authentication-token'],
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'Document<... Remove this comment to see the full error message
                globalConfig.value['iv']
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'Document<... Remove this comment to see the full error message
            delete globalConfig.value['iv'];
        }
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type 'Document<a... Remove this comment to see the full error message
            globalConfig.name === 'smtp' &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'Document<... Remove this comment to see the full error message
            (!globalConfig.value.internalSmtp ||
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'Document<... Remove this comment to see the full error message
                (globalConfig.value.internalSmtp &&
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'Document<... Remove this comment to see the full error message
                    globalConfig.value.customSmtp))
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'Document<... Remove this comment to see the full error message
            globalConfig.value['password'] = await EncryptDecrypt.decrypt(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'Document<... Remove this comment to see the full error message
                globalConfig.value['password'],
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'Document<... Remove this comment to see the full error message
                globalConfig.value['iv']
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'Document<... Remove this comment to see the full error message
            delete globalConfig.value['iv'];
        }

        return globalConfig;
    },

    updateOneBy: async function(query: $TSFixMe, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (
            query.name === 'smtp' &&
            data.value.internalSmtp &&
            !data.value.customSmtp
        ) {
            data.value = {
                internalSmtp: true,
                customSmtp: false,
                'email-enabled': true,
            };
        }

        if (
            query.name === 'twilio' &&
            data &&
            data.value &&
            data.value['authentication-token']
        ) {
            const { value } = data;
            const iv = Crypto.randomBytes(16);
            value['authentication-token'] = await EncryptDecrypt.encrypt(
                value['authentication-token'],
                iv
            );
            value['iv'] = iv;
        } else if (
            query.name === 'smtp' &&
            data &&
            data.value &&
            data.value['password']
        ) {
            const { value } = data;
            const iv = Crypto.randomBytes(16);
            value['password'] = await EncryptDecrypt.encrypt(
                value['password'],
                iv
            );
            value['iv'] = iv;
        }

        const globalConfig = await GlobalConfigModel.findOneAndUpdate(
            query,
            { $set: data },
            {
                new: true,
            }
        );

        if (globalConfig.name === 'twilio') {
            globalConfig.value[
                'authentication-token'
            ] = await EncryptDecrypt.decrypt(
                globalConfig.value['authentication-token'],
                globalConfig.value['iv'].buffer
            );
            delete globalConfig.value['iv'];
        } else if (
            globalConfig.name === 'smtp' &&
            (!globalConfig.value.internalSmtp ||
                (globalConfig.value.internalSmtp &&
                    globalConfig.value.customSmtp))
        ) {
            globalConfig.value['password'] = await EncryptDecrypt.decrypt(
                globalConfig.value['password'],
                globalConfig.value['iv'].buffer
            );
            delete globalConfig.value['iv'];
        }

        return globalConfig;
    },

    updateBy: async function(query: $TSFixMe, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        let globalConfigs = await GlobalConfigModel.updateMany(query, {
            $set: data,
        });

        const selectConfig = 'name value createdAt';
        globalConfigs = await this.findBy({ query, select: selectConfig });

        return globalConfigs;
    },

    findBy: async function({
        query,
        skip,
        limit,
        populate,
        select
    }: $TSFixMe) {
        if (!skip) skip = 0;
        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = parseInt(skip);
        if (typeof limit === 'string') limit = parseInt(limit);

        if (!query) {
            query = {};
        }

        let globalConfigsQuery = GlobalConfigModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip);

        globalConfigsQuery = handleSelect(select, globalConfigsQuery);
        globalConfigsQuery = handlePopulate(populate, globalConfigsQuery);

        const globalConfigs = await globalConfigsQuery;
        for (const globalConfig of globalConfigs) {
            if (globalConfig.name === 'twilio') {
                if (
                    globalConfig.value['iv'] &&
                    globalConfig.value['authentication-token']
                ) {
                    globalConfig.value[
                        'authentication-token'
                    ] = await EncryptDecrypt.decrypt(
                        globalConfig.value['authentication-token'],
                        globalConfig.value['iv'].buffer
                    );
                    delete globalConfig.value['iv'];
                }
            } else if (
                globalConfig.name === 'smtp' &&
                (!globalConfig.value.internalSmtp ||
                    (globalConfig.value.internalSmtp &&
                        globalConfig.value.customSmtp))
            ) {
                if (
                    globalConfig.value['iv'] &&
                    globalConfig.value['password']
                ) {
                    globalConfig.value[
                        'password'
                    ] = await EncryptDecrypt.decrypt(
                        globalConfig.value['password'],
                        globalConfig.value['iv'].buffer
                    );
                    delete globalConfig.value['iv'];
                }
            }
        }

        return globalConfigs;
    },

    findOneBy: async function({
        query,
        select,
        populate
    }: $TSFixMe) {
        if (!query) {
            query = {};
        }

        // we won't use lean here because of iv that should be a buffer
        let globalConfigQuery = GlobalConfigModel.findOne(query);

        globalConfigQuery = handleSelect(select, globalConfigQuery);
        globalConfigQuery = handlePopulate(populate, globalConfigQuery);

        const globalConfig = await globalConfigQuery;

        if (globalConfig && globalConfig.name === 'twilio') {
            if (
                globalConfig.value['iv'] &&
                globalConfig.value['authentication-token']
            ) {
                globalConfig.value[
                    'authentication-token'
                ] = await EncryptDecrypt.decrypt(
                    globalConfig.value['authentication-token'],
                    globalConfig.value['iv'].buffer
                );
                delete globalConfig.value['iv'];
            }
        } else if (
            globalConfig &&
            globalConfig.name === 'smtp' &&
            (!globalConfig.value.internalSmtp ||
                (globalConfig.value.internalSmtp &&
                    globalConfig.value.customSmtp))
        ) {
            if (globalConfig.value['iv'] && globalConfig.value['password']) {
                globalConfig.value['password'] = await EncryptDecrypt.decrypt(
                    globalConfig.value['password'],
                    globalConfig.value['iv'].buffer
                );
                delete globalConfig.value['iv'];
            }
        }
        return globalConfig;
    },

    countBy: async function(query: $TSFixMe) {
        if (!query) {
            query = {};
        }

        const count = await GlobalConfigModel.countDocuments(query);

        return count;
    },

    hardDeleteBy: async function(query: $TSFixMe) {
        await GlobalConfigModel.deleteMany(query);
        return 'Global Config(s) Removed Successfully!';
    },
};

import Crypto from 'crypto'
import GlobalConfigModel from '../models/globalConfig'
import EncryptDecrypt from '../config/encryptDecrypt'
import handleSelect from '../utils/select'
import handlePopulate from '../utils/populate'
