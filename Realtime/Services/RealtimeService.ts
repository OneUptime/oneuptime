import type { JSONObjectOrArray } from 'Common/Types/JSON';
import type { Socket } from 'CommonServer/Infrastructure/SocketIO';
import io from 'CommonServer/Infrastructure/SocketIO';
import type ObjectID from 'Common/Types/ObjectID';

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
