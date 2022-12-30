import { JSONObjectOrArray } from 'Common/Types/JSON';
import io, { Socket } from 'CommonServer/Infrastructure/SocketIO';
import ObjectID from 'Common/Types/ObjectID';

io.sockets.on('connection', (socket: Socket) => {
    socket.on('project', async (projectId: ObjectID) => {
        await socket.join(projectId.toString());
    });
});

export default class RealtimeService {
    public static send(
        projectId: ObjectID,
        eventType: string,
        data: JSONObjectOrArray
    ): void {
        io.to(projectId.toString()).emit(eventType, data);
    }
}
