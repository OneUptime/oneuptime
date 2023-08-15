import Hostname from 'Common/Types/API/Hostname';
import Email from 'Common/Types/Email';
import Port from 'Common/Types/Port';

export const ShouldUseInternalSmtp: boolean =
    process.env['USE_INTERNAL_SMTP'] === 'true';

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

export const TwilioAccountSid: string = process.env['TWILIO_ACCOUNT_SID'] || '';
export const TwilioAuthToken: string = process.env['TWILIO_AUTH_TOKEN'] || '';
export const TwilioPhoneNumber: string =
    process.env['TWILIO_PHONE_NUMBER'] || '';
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

export const SendGridApiKey: string = process.env['SENDGRID_API_KEY'] || '';
