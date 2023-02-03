import type Email from '../Email';
import type Port from '../Port';
import type Hostname from '../API/Hostname';

export default interface EmailServer {
    host: Hostname;
    port: Port;
    username: string;
    password: string;
    secure: boolean;
    fromEmail: Email;
    fromName: string;
}
