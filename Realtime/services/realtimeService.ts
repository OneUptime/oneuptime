import { JSONObjectOrArray } from 'Common/Types/JSON';
import io, { Socket } from 'CommonServer/infrastructure/SocketIO';
import ObjectID from 'Common/Types/ObjectID';
io.sockets.on('connection', (socket: Socket) => {
    socket.on('project', (projectId: ObjectID) => {
        socket.join(projectId);
    });
});

export default class RealtimeService {
    public static send(
        projectId: ObjectID,
        eventType: string,
        data: JSONObjectOrArray
    ): void {
        io.to(projectId).emit(eventType, data);
    }
}
