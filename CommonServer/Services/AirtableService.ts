import Airtable from 'airtable';
const AirtableApiKey: $TSFixMe = process.env['AIRTABLE_API_KEY'];
const AirtableBaseId: $TSFixMe = process.env['AIRTABLE_BASE_ID'];
let base: $TSFixMe = null;
if (AirtableApiKey && AirtableBaseId) {
    base = new Airtable({ apiKey: AirtableApiKey }).base(AirtableBaseId);
}

export default class Service {
    /*
     * Description: Create new user entry on airtable.
     * Params:
     * Param 1: data: User data (name, email, phone, company, jobRole, createdAt).
     * Returns: promise
     */

    public async find({ tableName, view, limit }: $TSFixMe): void {
        return base(tableName).select({ view, pageSize: limit }).firstPage();
    }

    public async update({ tableName, id, fields }: $TSFixMe): void {
        return base(tableName).update(id, fields);
    }

    public async create({ tableName, fields }: $TSFixMe): void {
        return base(tableName).create(fields);
    }

    public async delete({ tableName, id }: $TSFixMe): void {
        return base(tableName).destroy(id);
    }

    public logUser({
        name,
        email,
        phone,
        company,
        jobRole,
        createdAt,
        source,
    }: $TSFixMe): void {
        if (!base) {
            return;
        }

        return base('User').create({
            Name: name,
            Email: email,
            Phone: phone,
            Company: company,
            'Job Role': jobRole,
            'Created At': createdAt,
            Source: JSON.stringify(source),
        });
    }

    public logLeads({
        name,
        country,
        email,
        fullname,
        message,
        phone,
        source,
        type,
        volume,
        website,
    }: $TSFixMe): void {
        if (!base) {
            return;
        }

        return base('Leads').create({
            Name: name,
            Email: email,
            Phone: phone,
            Country: country,
            'Full Name': fullname,
            Message: message,
            Type: type,
            Volume: volume,
            Website: website,
            Source: JSON.stringify(source),
        });
    }

    public deleteUser(airtableId: $TSFixMe): void {
        if (!base) {
            return;
        }

        return base('User').destroy(airtableId);
    }

    /*
     * Description: Create new feedback entry on airtable.
     * Params:
     * Param 1: data: Feedback data (message, name, email, project, page).
     * Returns: promise
     */
    public logFeedback({
        message,
        name,
        email,
        project,
        page,
    }: $TSFixMe): void {
        if (!base) {
            return;
        }

        return base('Feedback').create({
            'Feedback Text': message,
            'User Full Name': name,
            'User Email': email,
            'Project Name': project,
            'Page Name': page,
        });
    }

    public deleteFeedback(airtableId: $TSFixMe): void {
        if (!base) {
            return;
        }

        if (!airtableId) {
            return;
        }

        return base('Feedback').destroy(airtableId);
    }

    public async deleteAll({ tableName, view, limit }: $TSFixMe): void {
        if (!view) {
            view = 'Grid view';
        }

        if (!limit) {
            limit = 10;
        }

        if (limit > 10) {
            throw new Error('Pagesize cannot be greater than 10');
        }

        const records: $TSFixMe = await base(tableName)
            .select({ view, pageSize: limit })
            .firstPage();

        if (records && records.length > 0) {
            const recordIds: $TSFixMe = records.map(
                (record: $TSFixMe): void => {
                    return record.id;
                }
            );

            return await base(tableName).destroy(recordIds);
        }
    }

    public logProjectDeletionFeedback({
        reason,
        project,
        name,
        email,
    }: $TSFixMe): void {
        if (!base) {
            return;
        }

        return base('Project Delete').create({
            'Reason for Deletion': reason,
            'Project Name': project,
            'Full Name': name,
            Email: email,
        });
    }
}
