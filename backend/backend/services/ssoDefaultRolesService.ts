export default {
    findBy: async function({
        query,
        limit,
        skip,
        select,
        populate
    }: $TSFixMe) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = parseInt(skip);

        if (typeof limit === 'string') limit = parseInt(limit);

        if (!query) query = {};

        if (!query.deleted) query.deleted = false;

        let ssosQuery = ssoDefaultRolesModel
            .find(query, {
                _id: 1,
                project: 1,
                role: 1,
                domain: 1,
                createdAt: 1,
            })
            .lean()
            .sort([['domain', -1]])
            .skip(skip)
            .limit(limit);

        ssosQuery = handleSelect(select, ssosQuery);
        ssosQuery = handlePopulate(populate, ssosQuery);

        const ssos = await ssosQuery;
        return ssos;
    },
    deleteBy: async function(query: $TSFixMe) {
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
    },

    create: async function(data: $TSFixMe) {
        if (!data.domain) {
            const error = new Error('Domain must be defined.');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        if (!mongoose.Types.ObjectId.isValid(data.domain)) {
            const error = new Error("Domain id isn't valid.");
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }

        if (!data.project) {
            const error = new Error('Project  must be defined.');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        if (!mongoose.Types.ObjectId.isValid(data.domain)) {
            const error = new Error("Domain id isn't valid.");
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }

        if (!data.role) {
            const error = new Error('Role must be defined.');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        if (!['Administrator', 'Member', 'Viewer'].includes(data.role)) {
            const error = new Error('Invalid role.');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }

        const { domain, project } = data;
        const query = { domain, project };

        const sso = await SsoService.findOneBy({
            query: { _id: domain },
            select: '_id',
        });
        if (!sso) {
            const error = new Error("Domain doesn't exist.");
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }

        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { _id: any; }; select: ... Remove this comment to see the full error message
        const projectObj = await ProjectService.findOneBy({
            query: { _id: project },
            select: 'users _id',
        });
        if (!projectObj) {
            const error = new Error("Project doesn't exist.");
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }

        const search = await this.countBy(query);

        if (search && search > 0) {
            const error = new Error(
                '[Domain-Project] are already associated to a default role.'
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }

        const ssoDefaultRole = new ssoDefaultRolesModel();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'domain' does not exist on type 'Document... Remove this comment to see the full error message
        ssoDefaultRole.domain = data.domain;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Documen... Remove this comment to see the full error message
        ssoDefaultRole.project = data.project;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'role' does not exist on type 'Document<a... Remove this comment to see the full error message
        ssoDefaultRole.role = data.role;
        const savedSso = await ssoDefaultRole.save();
        //Add existing users to the project.
        const { _id: ssoId } = sso;
        const existingSsoUsers = await UserService.findBy({
            query: { sso: ssoId },
            select: '_id',
        });
        for (const ssoUser of existingSsoUsers) {
            const { users, _id: projectId } = projectObj;
            if (
                users.some((user: $TSFixMe) => String(user.userId) === String(ssoUser._id))
            ) {
                // User already member of the project!
                continue;
            }
            users.push({
                userId: ssoUser._id,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'role' does not exist on type 'Document<a... Remove this comment to see the full error message
                role: ssoDefaultRole.role,
            });
            await ProjectService.updateOneBy({ _id: projectId }, { users });
        }
        return savedSso;
    },

    findOneBy: async function({
        query,
        select,
        populate
    }: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.deleted = false;
        }
        let ssoQuery = ssoDefaultRolesModel.findOne(query).lean();

        ssoQuery = handleSelect(select, ssoQuery);
        ssoQuery = handlePopulate(populate, ssoQuery);

        const sso = await ssoQuery;

        return sso;
    },

    updateById: async function(id: $TSFixMe, data: $TSFixMe) {
        if (!id) {
            const error = new Error('Id must be defined.');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }

        const query = {
            _id: id,
            deleted: false,
        };

        const { domain, project, role } = data;

        if (!domain) {
            const error = new Error('Domain must be defined.');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        if (!mongoose.Types.ObjectId.isValid(domain)) {
            const error = new Error("Domain id isn't valid.");
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }

        if (!project) {
            const error = new Error('Project must be defined.');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        if (!mongoose.Types.ObjectId.isValid(project)) {
            const error = new Error("Project id isn't valid.");
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }

        if (!role) {
            const error = new Error('Role must be defined.');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        if (!['Administrator', 'Member', 'Viewer'].includes(role)) {
            const error = new Error('Invalid role.');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }

        const search = await this.findOneBy({
            query: { domain, project },
            select: '_id',
        });

        if (!search) {
            const error = new Error("Record doesn't exist.");
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }

        if (String(search._id) !== String(query._id)) {
            const error = new Error('Domain has a default role.');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        const payload = { domain, project, role };

        await ssoDefaultRolesModel.updateOne(query, {
            $set: payload,
        });

        const populateDefaultRoleSso = [
            { path: 'domain', select: '_id domain' },
            { path: 'project', select: '_id name' },
        ];

        const selectDefaultRoleSso =
            '_id domain project role createdAt deleted deletedAt deletedById';
        const ssodefaultRole = await this.findOneBy({
            query,
            select: selectDefaultRoleSso,
            populate: populateDefaultRoleSso,
        });
        return ssodefaultRole;
    },

    countBy: async function(query: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;

        const count = await ssoDefaultRolesModel.countDocuments(query);
        return count;
    },
    addUserToDefaultProjects: async function({
        domain,
        userId
    }: $TSFixMe) {
        const populateDefaultRoleSso = [
            { path: 'domain', select: '_id domain' },
            { path: 'project', select: '_id name' },
        ];

        const ssoDefaultRoles = await this.findBy({
            query: { domain },
            select: 'project role',
            populate: populateDefaultRoleSso,
        });
        if (!ssoDefaultRoles.length) return;

        for (const ssoDefaultRole of ssoDefaultRoles) {
            const { project, role } = ssoDefaultRole;
            const { _id: projectId } = project;
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { _id: any; }; select: ... Remove this comment to see the full error message
            const projectObj = await ProjectService.findOneBy({
                query: { _id: projectId },
                select: 'users',
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
    hardDeleteBy: async function(query: $TSFixMe) {
        await ssoDefaultRolesModel.deleteMany(query);
        return 'SSO(s) removed successfully!';
    },
};

import ssoDefaultRolesModel from '../models/ssoDefaultRoles'
import mongoose from 'mongoose'
import ProjectService from './projectService'
import SsoService from './ssoService'
import UserService from './userService'
import handleSelect from '../utils/select'
import handlePopulate from '../utils/populate'
