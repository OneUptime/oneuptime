export default {
    confirm: async ({ license, email, limit }: $TSFixMe) => {
        try {
            if (!limit) limit = 9999;

            if (typeof limit === 'string') {
                limit = parseInt(limit);
            }

            const records = await AirtableService.find({
                tableName: 'License',
                view: 'Grid view',
                limit,
            });
            const userRecord = {};

            for (const record of records) {
                const fetchedLicense = record.get('License Key');
                if (license === fetchedLicense) {
                    // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                    userRecord['id'] = record.id;
                    // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                    userRecord['expiryDate'] = record.get('Expires');
                }
            }

            if (Object.entries(userRecord).length === 0) {
                const error = new Error('Invalid License');
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusCode' does not exist on type 'Erro... Remove this comment to see the full error message
                error.statusCode = 400;
                throw error;
            }

            const presentTime = new Date().getTime();
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'expiryDate' does not exist on type '{}'.
            const expiryTime = new Date(userRecord.expiryDate).getTime();

            if (expiryTime < presentTime) {
                const error = new Error('License Expired');
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusCode' does not exist on type 'Erro... Remove this comment to see the full error message
                error.statusCode = 400;
                throw error;
            }

            await AirtableService.update({
                tableName: 'License',
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'id' does not exist on type '{}'.
                id: userRecord.id,
                fields: {
                    'Contact Email': email,
                },
            });

            const token = generateWebToken({
                license,
                presentTime,
                expiryTime,
            });

            return { token };
        } catch (error) {
            ErrorService.log('licenseService.confirm', error);
            throw error;
        }
    },
};

const generateWebToken = require('../utils/WebToken').generateWebToken;
import AirtableService from './airtableService';
import ErrorService from './errorService';
