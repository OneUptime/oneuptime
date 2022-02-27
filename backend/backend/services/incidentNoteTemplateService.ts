import IncidentNoteTemplateModel from '../models/incidentNoteTemplate';

export default {
    findBy: async function({ query = {}, limit, skip }: $TSFixMe) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = Number(skip);

        if (typeof limit === 'string') limit = Number(limit);

        if (!query.deleted) query.deleted = false;

        return await IncidentNoteTemplateModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip);
    },
    countBy: async function(query = {}) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleted' does not exist on type '{}'.
        if (!query.deleted) query.deleted = false;

        return await IncidentNoteTemplateModel.countDocuments(query);
    },
    findOneBy: async function(query = {}) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleted' does not exist on type '{}'.
        if (!query.deleted) query.deleted = false;

        const incidentNoteTemplate = await IncidentNoteTemplateModel.findOne(
            query
        ).lean();
        return incidentNoteTemplate;
    },
    create: async function(data: $TSFixMe) {
        const { projectId, name } = data;
        let incidentNoteTemplate = await this.findOneBy({
            projectId,
            name,
        });
        if (incidentNoteTemplate) {
            const error = new Error(
                'Incident note template with this name already exist in this project'
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }

        incidentNoteTemplate = await IncidentNoteTemplateModel.create(data);
        return incidentNoteTemplate;
    },
    updateOneBy: async function({ query = {}, data }: $TSFixMe) {
        if (!query.deleted) query.deleted = false;

        const { projectId, _id } = query;
        let incidentNoteTemplate = null;
        if (data.name) {
            incidentNoteTemplate = await this.findOneBy({
                projectId,
                _id: { $ne: _id },
                name: data.name,
            });
        }
        if (incidentNoteTemplate) {
            const error = new Error(
                'Incident note template with this name already exist in this project'
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }

        incidentNoteTemplate = await IncidentNoteTemplateModel.findOneAndUpdate(
            query,
            { $set: data },
            { new: true }
        );
        return incidentNoteTemplate;
    },
    deleteBy: async function(query: $TSFixMe) {
        if (!query) return null;

        const data = {
            deleted: true,
            deletedAt: Date.now(),
        };

        return await this.updateOneBy({ query, data });
    },
    hardDeleteBy: async function(query: $TSFixMe) {
        if (!query) return null;

        await IncidentNoteTemplateModel.deleteMany(query);
        return 'Incident note templates removed successfully';
    },
};
