module.exports = {
    findBy: async function(query, limit, skip) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = parseInt(skip);

            if (typeof limit === 'string') limit = parseInt(limit);

            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            const ssos = await ssoDefaultRolesModel
                .find(query, {
                    _id: 1,
                    project: 1,
                    role: 1,
                    domain: 1,
                    createdAt: 1,
                })
                .populate('domain', ['_id', 'domain'])
                .populate('project', ['_id', 'name'])
                .sort([['domaine', -1]])
                .skip(skip)
                .limit(limit);
            return ssos;
        } catch (error) {
            ErrorService.log('ssoDefaultRolesService.findBy', error);
            throw error;
        }
    },

    deleteBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;
            const sso = await ssoDefaultRolesModel.findOneAndUpdate(
                query,
                { $set: { deleted: true, deletedAt: Date.now() } },
                { new: true }
            );
            return sso;
        } catch (error) {
            ErrorService.log('ssoDefaultRolesService.deleteBy', error);
            throw error;
        }
    },

    create: async function(data) {
        const ssoDefaultRole = new ssoDefaultRolesModel();

        if (!data.domain) {
            const error = new Error('Domain must be defined.');
            error.code = 400;
            ErrorService.log('ssoDefaultRolesService.create', error);
            throw error;
        }
        if (!mongoose.Types.ObjectId.isValid(data.domain)) {
            const error = new Error("Domain id isn't valid.");
            error.code = 400;
            ErrorService.log('ssoDefaultRolesService.create', error);
            throw error;
        }

        if (!data.project) {
            const error = new Error('Project  must be defined.');
            error.code = 400;
            ErrorService.log('ssoDefaultRolesService.create', error);
            throw error;
        }
        if (!mongoose.Types.ObjectId.isValid(data.domain)) {
            const error = new Error("Domain id isn't valid.");
            error.code = 400;
            ErrorService.log('ssoDefaultRolesService.create', error);
            throw error;
        }

        if (!data.role) {
            const error = new Error('Role must be defined.');
            error.code = 400;
            ErrorService.log('ssoDefaultRolesService.create', error);
            throw error;
        }
        if (
            !['Owner', 'Administrator', 'Member', 'Viewer'].includes(data.role)
        ) {
            const error = new Error('Invalid role.');
            error.code = 400;
            ErrorService.log('ssoDefaultRolesService.create', error);
            throw error;
        }

        const { domain, project } = data;
        const query = { domain, project };
        const search = await this.findBy(query);

        if (search.length) {
            const error = new Error('Domain has a default role.');
            error.code = 400;
            ErrorService.log('ssoDefaultRolesService.create', error);
            throw error;
        }

        ssoDefaultRole.domain = data.domain;
        ssoDefaultRole.project = data.project;
        ssoDefaultRole.role = data.role;

        try {
            const savedSso = await ssoDefaultRole.save();
            return savedSso;
        } catch (error) {
            ErrorService.log('ssoDefaultRolesService.create', error);
            throw error;
        }
    },

    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) {
                query.deleted = false;
            }
            const sso = await ssoDefaultRolesModel
                .findOne(query)
                .populate('domain', ['_id', 'domain'])
                .populate('project', ['_id', 'name']);
            return sso;
        } catch (error) {
            ErrorService.log('ssoDefaultRolesService.findOneBy', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }
            if (query.createdAt !== undefined) {
                delete query.createdAt;
            }
            query.deleted = false;

            if (!data.domain) {
                const error = new Error('Domain must be defined.');
                error.code = 400;
                ErrorService.log('ssoDefaultRolesService.create', error);
                throw error;
            }
            if (!mongoose.Types.ObjectId.isValid(data.domain)) {
                const error = new Error("Domain id isn't valid.");
                error.code = 400;
                ErrorService.log('ssoDefaultRolesService.updateBy', error);
                throw error;
            }

            if (!data.project) {
                const error = new Error('Project  must be defined.');
                error.code = 400;
                ErrorService.log('ssoDefaultRolesService.updateBy', error);
                throw error;
            }
            if (!mongoose.Types.ObjectId.isValid(data.domain)) {
                const error = new Error("Domain id isn't valid.");
                error.code = 400;
                ErrorService.log('ssoDefaultRolesService.updateBy', error);
                throw error;
            }

            if (!data.role) {
                const error = new Error('Role must be defined.');
                error.code = 400;
                ErrorService.log('ssoDefaultRolesService.updateBy', error);
                throw error;
            }
            if (
                !['Owner', 'Administrator', 'Member', 'Viewer'].includes(
                    data.role
                )
            ) {
                const error = new Error('Invalid role.');
                error.code = 400;
                ErrorService.log('ssoDefaultRolesService.updateBy', error);
                throw error;
            }

            const { domain, project } = data;
            const searchQuery = { domain, project };
            const search = await this.findBy(searchQuery);

            if (search.length) {
                const error = new Error('Domain has a default role.');
                error.code = 400;
                ErrorService.log('ssoDefaultRolesService.updateBy', error);
                throw error;
            }

            await ssoDefaultRolesModel.updateMany(query, {
                $set: data,
            });
            const sso = await this.findBy(query);
            return sso;
        } catch (error) {
            ErrorService.log('ssoDefaultRolesService.updateBy', error);
            throw error;
        }
    },

    countBy: async function(query) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;

        const count = await ssoDefaultRolesModel.countDocuments(query);
        return count;
    },

    hardDeleteBy: async function(query) {
        try {
            await ssoDefaultRolesModel.deleteMany(query);
            return 'SSO(s) removed successfully!';
        } catch (error) {
            ErrorService.log('ssoDefaultRolesService.hardDeleteBy', error);
            throw error;
        }
    },
};

const ssoDefaultRolesModel = require('../models/ssoDefaultRoles');
const mongoose = require('mongoose');
const ErrorService = require('./errorService');
