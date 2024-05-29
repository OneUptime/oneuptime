import Hostname from '../API/Hostname';
import Email from '../Email';
import ObjectID from '../ObjectID';
import Port from '../Port';

export default interface EmailServer {
    id?: ObjectID | undefined; // If this is custom SMTP, this is the ID of the SMTP config. Otherwise, it's undefined
    host: Hostname;
    port: Port;
    username: string | undefined;
    password: string | undefined;
    secure: boolean;
    fromEmail: Email;
    fromName: string;
}
