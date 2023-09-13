import GlobalConfig, { EmailServerType } from 'Model/Models/GlobalConfig';
import Hostname from 'Common/Types/API/Hostname';
import Email from 'Common/Types/Email';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ObjectID from 'Common/Types/ObjectID';
import Port from 'Common/Types/Port';
import GlobalConfigService from 'CommonServer/Services/GlobalConfigService';
import Phone from 'Common/Types/Phone';
import EmailServer from 'Common/Types/Email/EmailServer';

export const InternalSmtpUsername: string =
    process.env['INTERNAL_SMTP_USERNAME'] || '';

export const InternalSmtpPassword: string =
    process.env['INTERNAL_SMTP_PASSWORD'] || '';

export const InternalSmtpHost: Hostname = new Hostname(
    process.env['INTERNAL_SMTP_HOST'] || ''
);

export const InternalSmtpPort: Port = new Port(
    parseInt(process.env['INTERNAL_SMTP_PORT'] || '25')
);

export const InternalSmtpSecure: boolean =
    process.env['INTERNAL_SMTP_IS_SECURE'] === 'true';

export const InternalSmtpEmail: Email = new Email(
    process.env['INTERNAL_SMTP_EMAIL'] || 'noreply@oneuptime.com'
);

export const InternalSmtpFromName: string =
    process.env['INTERNAL_SMTP_NAME'] || '';

export interface TwilioConfig {
    accountSid: string;
    authToken: string;
    phoneNumber: Phone;
}

export const getGlobalSMTPConfig: Function =
    async (): Promise<EmailServer | null> => {
        const globalConfig: GlobalConfig | null =
            await GlobalConfigService.findOneBy({
                query: {
                    _id: ObjectID.getZeroObjectID().toString(),
                },
                props: {
                    isRoot: true,
                },
                select: {
                    smtpFromEmail: true,
                    smtpHost: true,
                    smtpPort: true,
                    smtpUsername: true,
                    smtpPassword: true,
                    isSMTPSecure: true,
                    smtpFromName: true,
                },
            });

        if (!globalConfig) {
            throw new BadDataException('Global Config not found');
        }

        if (
            !globalConfig.smtpFromEmail ||
            !globalConfig.smtpHost ||
            !globalConfig.smtpPort ||
            !globalConfig.smtpUsername ||
            !globalConfig.smtpPassword ||
            !globalConfig.smtpFromName
        ) {
            return null;
        }

        return {
            host: globalConfig.smtpHost,
            port: globalConfig.smtpPort,
            username: globalConfig.smtpUsername,
            password: globalConfig.smtpPassword,
            secure: globalConfig.isSMTPSecure || false,
            fromEmail: globalConfig.smtpFromEmail,
            fromName: globalConfig.smtpFromName,
        };
    };

export const getEmailServerType: Function =
    async (): Promise<EmailServerType> => {
        const globalConfig: GlobalConfig | null =
            await GlobalConfigService.findOneBy({
                query: {
                    _id: ObjectID.getZeroObjectID().toString(),
                },
                props: {
                    isRoot: true,
                },
                select: {
                    emailServerType: true,
                },
            });

        if (!globalConfig) {
            return EmailServerType.Internal;
        }

        return globalConfig.emailServerType || EmailServerType.Internal;
    };

export const getSendgridAPIKey: Function =
    async (): Promise<string | null> => {
        const globalConfig: GlobalConfig | null =
            await GlobalConfigService.findOneBy({
                query: {
                    _id: ObjectID.getZeroObjectID().toString(),
                },
                props: {
                    isRoot: true,
                },
                select: {
                    sendgridApiKey: true,
                },
            });

        if (!globalConfig) {
            return null;
        }

        return globalConfig.sendgridApiKey || null;
    };

export const getTwilioConfig: Function =
    async (): Promise<TwilioConfig | null> => {
        const globalConfig: GlobalConfig | null =
            await GlobalConfigService.findOneBy({
                query: {
                    _id: ObjectID.getZeroObjectID().toString(),
                },
                props: {
                    isRoot: true,
                },
                select: {
                    twilioAccountSID: true,
                    twilioAuthToken: true,
                    twilioPhoneNumber: true,
                },
            });

        if (!globalConfig) {
            throw new BadDataException('Global Config not found');
        }

        if (
            !globalConfig.twilioAccountSID ||
            !globalConfig.twilioAuthToken ||
            !globalConfig.twilioPhoneNumber
        ) {
            return null;
        }

        return {
            accountSid: globalConfig.twilioAccountSID,
            authToken: globalConfig.twilioAuthToken,
            phoneNumber: globalConfig.twilioPhoneNumber,
        };
    };

export const SMSDefaultCostInCents: number = process.env[
    'SMS_DEFAULT_COST_IN_CENTS'
]
    ? parseInt(process.env['SMS_DEFAULT_COST_IN_CENTS'])
    : 0;

export const CallDefaultCostInCentsPerMinute: number = process.env[
    'CALL_DEFAULT_COST_IN_CENTS_PER_MINUTE'
]
    ? parseInt(process.env['CALL_DEFAULT_COST_IN_CENTS_PER_MINUTE'])
    : 0;

