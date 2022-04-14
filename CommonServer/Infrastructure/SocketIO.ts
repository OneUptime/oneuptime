import SocketIO from 'socket.io';
import http from 'http';
import Express from '../Utils/Express';

const app: $TSFixMe = Express.getExpressApp();
const server: $TSFixMe = http.createServer(app);

export type Socket = SocketIO.Socket;

const io: $TSFixMe = new SocketIO.Server(server, {
    path: '/realtime/socket.io',
    transports: ['websocket', 'polling'], // using websocket does not require sticky session
    perMessageDeflate: {
        threshold: 1024, // defaults to 1024
        zlibDeflateOptions: {
            chunkSize: 16 * 1024, // defaults to 16 * 1024
        },
        zlibInflateOptions: {
            windowBits: 15, // defaults to 15
            memLevel: 8, // defaults to 8
        },
    },
});

export default io;
