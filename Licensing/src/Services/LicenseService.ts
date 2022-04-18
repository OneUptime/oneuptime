import WebToken from '../Utils/WebToken';
import AirtableService, { AirtableRecords } from 'CommonServer/Utils/airtable';
import Email from 'Common/Types/email';
import PositiveNumber from 'Common/Types/PositiveNumber';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ObjectID from 'Common/Types/ObjectID';
import OneUptimeDate from 'Common/Types/Date';

export default {
    confirm: async (
        license: string,
        email: Email,
        limit: PositiveNumber
    ): Promise<string> => {
        const records: AirtableRecords = await AirtableService.find(
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

        let licenseFound: boolean = false;

        for (const record of records) {
            const fetchedLicense: string = record.get('License Key') as string;
            if (license === fetchedLicense) {
                userRecord.id = new ObjectID(record.id.toString());
                userRecord.expiryDate = new Date(
                    record.get('Expires') as string
                );
                licenseFound = true;
            }
        }

        if (!licenseFound) {
            throw new BadDataException('Invalid Expired');
        }

        const presentTime: Date = OneUptimeDate.getCurrentDate();

        const expiryTime: Date = new Date(userRecord.expiryDate);

        if (expiryTime.getTime() < presentTime.getTime()) {
            throw new BadDataException('License Expired');
        }

        await AirtableService.update('License', userRecord.id.toString(), {
            'Contact Email': email.toString(),
        });

        const token: string = WebToken.generateWebToken(license, expiryTime);

        return token;
    },
};
