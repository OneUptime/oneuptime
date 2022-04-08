export default class Service {
    //Description: Create new user entry on airtable.
    //Params:
    //Param 1: data: User data (name, email, phone, company, jobRole, createdAt).
    //Returns: promise

    async find({ tableName, view, limit }: $TSFixMe) {
        return base(tableName).select({ view, pageSize: limit }).firstPage();
    }

    async update({ tableName, id, fields }: $TSFixMe) {
        return base(tableName).update(id, fields);
    }

    async create({ tableName, fields }: $TSFixMe) {
        return base(tableName).create(fields);
    }

    async delete({ tableName, id }: $TSFixMe) {
        return base(tableName).destroy(id);
    }

    logUser({
        name,
        email,
        phone,
        company,
        jobRole,
        createdAt,
        source,
    }: $TSFixMe) {
        if (!base) return;

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

    logLeads({
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
    }: $TSFixMe) {
        if (!base) return;

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

    deleteUser(airtableId: $TSFixMe) {
        if (!base) return;

        return base('User').destroy(airtableId);
    }

    //Description: Create new feedback entry on airtable.
    //Params:
    //Param 1: data: Feedback data (message, name, email, project, page).
    //Returns: promise
    logFeedback({ message, name, email, project, page }: $TSFixMe) {
        if (!base) return;

        return base('Feedback').create({
            'Feedback Text': message,
            'User Full Name': name,
            'User Email': email,
            'Project Name': project,
            'Page Name': page,
        });
    }

    deleteFeedback(airtableId: $TSFixMe) {
        if (!base) return;

        if (!airtableId) {
            return;
        }

        return base('Feedback').destroy(airtableId);
    }

    async deleteAll({ tableName, view, limit }: $TSFixMe) {
        if (!view) {
            view = 'Grid view';
        }

        if (!limit) {
            limit = 10;
        }

        if (limit > 10) {
            throw new Error('Pagesize cannot be greater than 10');
        }

        const records = await base(tableName)
            .select({ view, pageSize: limit })
            .firstPage();

        if (records && records.length > 0) {
            const recordIds = records.map(function (record: $TSFixMe) {
                return record.id;
            });

            return await base(tableName).destroy(recordIds);
        }
    }

    logProjectDeletionFeedback({ reason, project, name, email }: $TSFixMe) {
        if (!base) return;

        return base('Project Delete').create({
            'Reason for Deletion': reason,
            'Project Name': project,
            'Full Name': name,
            Email: email,
        });
    }
}

import Airtable from 'airtable';
const AirtableApiKey = process.env['AIRTABLE_API_KEY'];
const AirtableBaseId = process.env['AIRTABLE_BASE_ID'];
let base: $TSFixMe = null;
if (AirtableApiKey && AirtableBaseId)
    base = new Airtable({ apiKey: AirtableApiKey }).base(AirtableBaseId);
