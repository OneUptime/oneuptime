const generateWebToken = require('../utils/WebToken').generateWebToken;
import AirtableService from 'common-server/utils/airtable';
import Email from 'common/Types/email';
import PositiveNumber from 'common/Types/PositiveNumber';
import BadDataException from 'common/Types/Exception/BadDataException';

export default {
    confirm: async (license: string, email: Email, limit: PositiveNumber) => {
        const records = await AirtableService.find(
            'License',
            'Grid view',
            limit
        );
        const userRecord: {
            id: string;
            expiryDate: Date;
        } = {
            id: '',
            expiryDate: new Date(),
        };

        let licenseFound = false;

        for (const record of records) {
            const fetchedLicense = record.get('License Key');
            if (license === fetchedLicense) {
                userRecord['id'] = record.id;
                userRecord['expiryDate'] = new Date(
                    record.get('Expires') as string
                );
                licenseFound = true;
            }
        }

        if (!licenseFound) {
            throw new BadDataException('Invalid Expired');
        }

        const presentTime = new Date().getTime();

        const expiryTime = new Date(userRecord.expiryDate).getTime();

        if (expiryTime < presentTime) {
            throw new BadDataException('License Expired');
        }

        await AirtableService.update('License', userRecord.id, {
            'Contact Email': email.toString(),
        });

        const token = generateWebToken({
            license,
            presentTime,
            expiryTime,
        });

        return { token };
    },
};
