import API from 'Common/Utils/API';
import { RealtimeHostname, ClusterKey } from '../EnvironmentConfig';
import DatabaseConfig from '../DatabaseConfig';
import { JSONObjectOrArray } from 'Common/Types/JSON';
import Route from 'Common/Types/API/Route';
import Headers from 'Common/Types/API/Headers';
import ObjectID from 'Common/Types/ObjectID';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import EmptyResponse from 'Common/Types/API/EmptyResponse';
import Protocol from 'Common/Types/API/Protocol';

class Service {
    private api: API | null = null;
    private headers: Headers;

    public constructor() {
        this.headers = {
            ONEUPTIME_SECRET: ClusterKey.toString(),
        };
    }

    public async send(
        projectId: ObjectID,
        eventType: string,
        data: JSONObjectOrArray
    ): Promise<HTTPResponse<EmptyResponse>> {
        const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();
        this.api = new API(httpProtocol, RealtimeHostname);

        return await this.api.post<EmptyResponse>(
            new Route(`/send-created-incident`),
            {
                projectId,
                eventType,
                data,
            },
            this.headers
        );
    }
}

export default new Service();
