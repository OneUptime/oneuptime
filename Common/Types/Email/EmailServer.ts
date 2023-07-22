import Email from '../Email';
import Port from '../Port';
import Hostname from '../API/Hostname';
import ObjectID from '../ObjectID';

export default interface EmailServer {
    id?: ObjectID | undefined; // If this is custom SMTP, this is the ID of the SMTP config. Otherwise, it's undefined
    host: Hostname;
    port: Port;
    username: string;
    password: string;
    secure: boolean;
    fromEmail: Email;
    fromName: string;
}
