import Hostname from 'Common/Types/API/Hostname';
import Email from 'Common/Types/Email';
import Port from 'Common/Types/Port';

export const InternalSmtpUser: string = process.env['INTERNAL_SMTP_USER'] || '';

export const InternalSmtpPassword: string =
    process.env['INTERNAL_SMTP_PASSWORD'] || '';

export const InternalSmtpHost: Hostname = new Hostname(
    process.env['INTERNAL_SMTP_HOST'] || ''
);

export const InternalSmtpPort: Port = new Port(
    parseInt(process.env['INTERNAL_SMTP_PORT'] || '25')
);

export const InternalSmtpSecure: boolean =
    !!process.env['INTERNAL_SMTP_SECURE'];

export const InternalSmtpFromEmail: Email = new Email(
    process.env['INTERNAL_SMTP_FROM'] || 'noreply@oneuptime.com'
);

export const InternalSmtpFromName: string =
    process.env['INTERNAL_SMTP_NAME'] || '';
