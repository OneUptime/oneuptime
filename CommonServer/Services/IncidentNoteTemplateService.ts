import IncidentNoteTemplateModel from '../Models/incidentNoteTemplate';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';
export default class Service {
    async findBy({ query = {}, limit, skip, sort }: FindBy): void {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = Number(skip);

        if (typeof limit === 'string') limit = Number(limit);

        if (!query['deleted']) query['deleted'] = false;

        return await IncidentNoteTemplateModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());
    }

    async countBy(query = {}): void {
        if (!query['deleted']) query['deleted'] = false;

        return await IncidentNoteTemplateModel.countDocuments(query);
    }

    async findOneBy(query = {}): void {
        if (!query['deleted']) query['deleted'] = false;

        const incidentNoteTemplate = await IncidentNoteTemplateModel.findOne(
            query
        ).lean();
        return incidentNoteTemplate;
    }

    async create(data: $TSFixMe): void {
        const { projectId, name } = data;
        let incidentNoteTemplate = await this.findOneBy({
            projectId,
            name,
        });
        if (incidentNoteTemplate) {
            const error = new Error(
                'Incident note template with this name already exist in this project'
            );

            error.code = 400;
            throw error;
        }

        incidentNoteTemplate = await IncidentNoteTemplateModel.create(data);
        return incidentNoteTemplate;
    }

    async updateOneBy({ query = {}, data }: $TSFixMe): void {
        if (!query['deleted']) query['deleted'] = false;

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

            error.code = 400;
            throw error;
        }

        incidentNoteTemplate = await IncidentNoteTemplateModel.findOneAndUpdate(
            query,
            { $set: data },
            { new: true }
        );
        return incidentNoteTemplate;
    }

    async deleteBy(query: Query): void {
        if (!query) return null;

        const data = {
            deleted: true,
            deletedAt: Date.now(),
        };

        return await this.updateOneBy({ query, data });
    }
}
