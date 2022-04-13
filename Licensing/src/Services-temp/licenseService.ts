const generateWebToken = require('../utils/WebToken').generateWebToken;
import AirtableService from 'CommonServer/Utils/airtable';
import Email from 'Common/Types/email';
import PositiveNumber from 'Common/Types/PositiveNumber';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ObjectID from 'Common/Types/ObjectID';

export default {
    confirm: async (license: string, email: Email, limit: PositiveNumber) => {
        const records = await AirtableService.find(
            'License',
            'Grid view',
            limit
        );
        const userRecord: {
            id: ObjectID;
            expiryDate: Date;
        } = {
            id: new ObjectID(''),
            expiryDate: new Date(),
        };

        let licenseFound = false;

        for (const record of records) {
            const fetchedLicense = record.get('License Key');
            if (license === fetchedLicense) {
                userRecord['id'] = new ObjectID(record.id.toString());
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

        await AirtableService.update('License', userRecord.id.toString(), {
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
