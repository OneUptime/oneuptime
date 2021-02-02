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
        if (!['Administrator', 'Member', 'Viewer'].includes(data.role)) {
            const error = new Error('Invalid role.');
            error.code = 400;
            ErrorService.log('ssoDefaultRolesService.create', error);
            throw error;
        }

        const { domain, project } = data;
        const query = { domain, project };

        const sso = await SsoService.findOneBy({ _id: domain });
        if (!sso) {
            const error = new Error("Domain doesn't exist.");
            error.code = 400;
            ErrorService.log('ssoDefaultRolesService.create', error);
            throw error;
        }

        const projectObj = await ProjectService.findOneBy({ _id: project });
        if (!projectObj) {
            const error = new Error("Project doesn't exist.");
            error.code = 400;
            ErrorService.log('ssoDefaultRolesService.create', error);
            throw error;
        }

        const search = await this.findBy(query);

        if (search.length) {
            const error = new Error(
                '[Domain-Project] are already associated to a default role.'
            );
            error.code = 400;
            ErrorService.log('ssoDefaultRolesService.create', error);
            throw error;
        }

        const ssoDefaultRole = new ssoDefaultRolesModel();
        ssoDefaultRole.domain = data.domain;
        ssoDefaultRole.project = data.project;
        ssoDefaultRole.role = data.role;

        try {
            const savedSso = await ssoDefaultRole.save();
            //Add existing users to the project.
            const { _id: ssoId } = sso;
            const existingSsoUsers = await UserService.findBy({ sso: ssoId });
            for (const ssoUser of existingSsoUsers) {
                const { users, _id: projectId } = projectObj;
                if (
                    users.some(
                        user => String(user.userId) === String(ssoUser._id)
                    )
                ) {
                    // User already member of the project!
                    continue;
                }
                users.push({
                    userId: ssoUser._id,
                    role: ssoDefaultRole.role,
                });
                await ProjectService.updateOneBy({ _id: projectId }, { users });
            }
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

    updateById: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }
            if (!query._id) {
                const error = new Error('Id must be defined.');
                error.code = 400;
                ErrorService.log('ssoDefaultRolesService.updateById', error);
                throw error;
            }
            if (query.createdAt !== undefined) {
                delete query.createdAt;
            }
            query.deleted = false;
            const { domain, project, role } = data;

            if (!domain) {
                const error = new Error('Domain must be defined.');
                error.code = 400;
                ErrorService.log('ssoDefaultRolesService.updateById', error);
                throw error;
            }
            if (!mongoose.Types.ObjectId.isValid(domain)) {
                const error = new Error("Domain id isn't valid.");
                error.code = 400;
                ErrorService.log('ssoDefaultRolesService.updateById', error);
                throw error;
            }

            if (!project) {
                const error = new Error('Project  must be defined.');
                error.code = 400;
                ErrorService.log('ssoDefaultRolesService.updateById', error);
                throw error;
            }
            if (!mongoose.Types.ObjectId.isValid(project)) {
                const error = new Error("Project id isn't valid.");
                error.code = 400;
                ErrorService.log('ssoDefaultRolesService.updateById', error);
                throw error;
            }

            if (!role) {
                const error = new Error('Role must be defined.');
                error.code = 400;
                ErrorService.log('ssoDefaultRolesService.updateById', error);
                throw error;
            }
            if (!['Administrator', 'Member', 'Viewer'].includes(role)) {
                const error = new Error('Invalid role.');
                error.code = 400;
                ErrorService.log('ssoDefaultRolesService.updateById', error);
                throw error;
            }

            const payload = { domain };
            const search = await this.findOneBy(payload);
            if (!search) {
                const error = new Error("Record doesn't exist.");
                error.code = 400;
                ErrorService.log('ssoDefaultRolesService.updateById', error);
                throw error;
            }
            if (String(search._id) !== query._id) {
                const error = new Error('Domain has a default role.');
                error.code = 400;
                ErrorService.log('ssoDefaultRolesService.updateById', error);
                throw error;
            }

            await ssoDefaultRolesModel.updateMany(query, {
                $set: payload,
            });
            const sso = await this.findBy(query);
            return sso;
        } catch (error) {
            ErrorService.log('ssoDefaultRolesService.updateById', error);
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
    addUserToDefaultProjects: async function({ domain, userId }) {
        const ssoDefaultRoles = await this.findBy({ domain });
        if (!ssoDefaultRoles.length) return;

        for (const ssoDefaultRole of ssoDefaultRoles) {
            const { project, role } = ssoDefaultRole;
            const { _id: projectId } = project;
            const projectObj = await ProjectService.findOneBy({
                _id: projectId,
            });
            if (!projectObj) continue;

            const { users } = projectObj;
            users.push({
                userId,
                role,
            });
            await ProjectService.updateOneBy({ _id: projectId }, { users });
        }
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
const ProjectService = require('./projectService');
const SsoService = require('./ssoService');
const UserService = require('./userService');
