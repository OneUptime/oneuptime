import SocketIO from 'socket.io';
import http from 'http';
import Express, { ExpressApplication } from '../Utils/Express';

const app: ExpressApplication = Express.getExpressApp();
const server: http.Server = http.createServer(app);

export type Socket = SocketIO.Socket;

const io: SocketIO.Server = new SocketIO.Server(server, {
    path: '/realtime/socket.io',
    transports: ['websocket', 'polling'], // Using websocket does not require sticky session
    perMessageDeflate: {
        threshold: 1024, // Defaults to 1024
        zlibDeflateOptions: {
            chunkSize: 16 * 1024, // Defaults to 16 * 1024
        },
        zlibInflateOptions: {
            windowBits: 15, // Defaults to 15
            memLevel: 8, // Defaults to 8
        },
    },
});

export default io;
