// const bcrypt = require('bcrypt');
// const constants = require('../config/constants.json');
const ApplicationSecurityModel = require('../models/applicationSecurity');
const ErrorService = require('./errorService');

module.exports = {
    create: async function(data) {
        try {
            const applicationNameExist = await this.findOneBy({
                name: data.name,
            });

            if (applicationNameExist) {
                const error = new Error(
                    'Application security with this name already exist'
                );
                error.code = 400;
                throw error;
            }

            // encrypt password
            /* data.gitPassword = await bcrypt.hash(
                data.gitPassword,
                constants.saltRounds
            ); */

            const applicationSecurity = ApplicationSecurityModel.create(data);
            return applicationSecurity;
        } catch (error) {
            ErrorService.log('applicationSecurityService.create', error);
            throw error;
        }
    },
    findOneBy: async function(query) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            const applicationSecurity = await ApplicationSecurityModel.findOne(
                query
            ).populate('componentId');

            return applicationSecurity;
        } catch (error) {
            ErrorService.log('applicationSecurityService.findOneBy', error);
            throw error;
        }
    },
    findBy: async function(query, limit, skip) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = Number(skip);

            if (typeof limit === 'string') limit = Number(limit);

            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            const applicationSecurities = await ApplicationSecurityModel.find(
                query
            )
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('componentId');

            return applicationSecurities;
        } catch (error) {
            ErrorService.log('applicationSecurityService.findBy', error);
            throw error;
        }
    },
    updateOneBy: async function(query, data) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            const applicationSecurity = ApplicationSecurityModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                { new: true }
            );

            if (!applicationSecurity) {
                const error = new Error(
                    'Application Security not found or does not exist'
                );
                error.code = 400;
                throw error;
            }

            return applicationSecurity;
        } catch (error) {
            ErrorService.log('applicationSecurityService.updateOneBy', error);
            throw error;
        }
    },
    deleteBy: async function(query) {
        try {
            let applicationSecurity = this.findOneBy(query);

            if (!applicationSecurity) {
                const error = new Error(
                    'Application Security not found or does not exist'
                );
                error.code = 400;
                throw error;
            }

            applicationSecurity = this.updateOneBy(query, {
                deleted: true,
                deletedAt: Date.now(),
            });

            return applicationSecurity;
        } catch (error) {
            ErrorService.log('applicationSecurityService.deleteBy', error);
            throw error;
        }
    },
    hardDelete: async function(query) {
        try {
            await ApplicationSecurityModel.deleteMany(query);
            return 'Application Securities deleted successfully';
        } catch (error) {
            ErrorService.log('applicationSecurityService.hardDelete', error);
            throw error;
        }
    },
};
