import DataMigrationBase from './DataMigrationBase';
import ObjectID from 'Common/Types/ObjectID';
import GlobalConfigService from 'CommonServer/Services/GlobalConfigService';
import Hostname from 'Common/Types/API/Hostname';

export default class UpdateGlobalConfigFromEnv extends DataMigrationBase {
    public constructor() {
        super('UpdateGlobalConfigFromEnv');
    }

    public override async migrate(): Promise<void> {
        // get all the users with email isVerified true.

        await GlobalConfigService.updateOneById({
            id: ObjectID.getZeroObjectID(),
            data: {
                // Update Twilio

                twilioAccountSID: process.env['TWILIO_ACCOUNT_SID'] || '',
                twilioAuthToken: process.env['TWILIO_AUTH_TOKEN'] || '',
                twilioPhoneNumber: process.env['TWILIO_PHONE_NUMBER'] || '',

                // Update host
                host: process.env['DOMAIN'] || 'localhost',
                useHttps: process.env['HTTP_PROTOCOL'] === 'https',

                // Update SMTP
                smtpUsername: process.env['SMTP_USERNAME'] || '',
                smtpPassword: process.env['SMTP_PASSWORD'] || '',
                smtpHost: Hostname.fromString(process.env['SMTP_HOST'] || ''),
                smtpPort: parseInt(process.env['SMTP_PORT'] || '25'),
                isSMTPSecure: process.env['SMTP_IS_SECURE'] === 'true',
                smtpFromEmail: process.env['SMTP_FROM_EMAIL'] || '',
                smtpFromName: process.env['SMTP_FROM_NAME'] || '',
            },
            props: {
                isRoot: true,
            },
        });
    }

    public override async rollback(): Promise<void> {
        return;
    }
}
