import Email from 'Common/Types/Email';
import URL from 'Common/Types/API/URL';
import Port from 'Common/Types/Port';

export interface MailServer {
    host: URL;
    port: Port;
    user: Email;
    pass: string;
    secure: boolean;
}
