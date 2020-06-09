// const bcrypt = require('bcrypt');
// const constants = require('../config/constants.json');
const ContainerSecurityModel = require('../models/containerSecurity');
const ErrorService = require('./errorService');

module.exports = {
    create: async function(data) {
        try {
            const containerNameExist = await this.findOneBy({
                name: data.name,
            });

            if (containerNameExist) {
                const error = new Error(
                    'Container security with this name already exist'
                );
                error.code = 400;
                throw error;
            }

            // encrypt password
            /* data.dockerPassword = await bcrypt.hash(
                data.dockerPassword,
                constants.saltRounds
            ); */

            const containerSecurity = ContainerSecurityModel.create(data);
            return containerSecurity;
        } catch (error) {
            ErrorService.log('containerSecurityService.create', error);
            throw error;
        }
    },
    findOneBy: async function(query) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            const containerSecurity = await ContainerSecurityModel.findOne(
                query
            ).populate('componentId');

            return containerSecurity;
        } catch (error) {
            ErrorService.log('containerSecurityService.findOneBy', error);
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

            const containerSecurities = await ContainerSecurityModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('componentId');

            return containerSecurities;
        } catch (error) {
            ErrorService.log('containerSecurityService.findBy', error);
            throw error;
        }
    },
    updateOneBy: async function(query, data) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            const containerSecurity = ContainerSecurityModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                { new: true }
            );

            if (!containerSecurity) {
                const error = new Error(
                    'Container Security not found or does not exist'
                );
                error.code = 400;
                throw error;
            }

            return containerSecurity;
        } catch (error) {
            ErrorService.log('containerSecurityService.updateOneBy', error);
            throw error;
        }
    },
    deleteBy: async function(query) {
        try {
            let containerSecurity = this.findOneBy(query);

            if (!containerSecurity) {
                const error = new Error(
                    'Container Security not found or does not exist'
                );
                error.code = 400;
                throw error;
            }

            containerSecurity = this.updateOneBy(query, {
                deleted: true,
                deletedAt: Date.now(),
            });

            return containerSecurity;
        } catch (error) {
            ErrorService.log('containerSecurityService.deleteBy', error);
            throw error;
        }
    },
    hardDelete: async function(query) {
        try {
            await ContainerSecurityModel.deleteMany(query);
            return 'Container Securities deleted successfully';
        } catch (error) {
            ErrorService.log('containerSecurityService.hardDelete', error);
            throw error;
        }
    },
};
