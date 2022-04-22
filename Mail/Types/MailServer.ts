import Email from 'Common/Types/Email';
import Port from 'Common/Types/Port';
import Hostname from 'Common/Types/API/Hostname';

export interface MailServer {
    host: Hostname;
    port: Port;
    username: string;
    password: string;
    secure: boolean;
    fromEmail: Email;
    fromName: string;
    enabled: boolean;
    backupMailServer?: MailServer;
}
