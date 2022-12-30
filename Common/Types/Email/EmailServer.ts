import Email from '../Email';
import Port from '../Port';
import Hostname from '../API/Hostname';

export default interface EmailServer {
    host: Hostname;
    port: Port;
    username: string;
    password: string;
    secure: boolean;
    fromEmail: Email;
    fromName: string;
}
