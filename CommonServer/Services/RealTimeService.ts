import API from 'Common/utils/API';
import { RealtimeHostname, HttpProtocol, ClusterKey } from '../Config';
import { JSONObjectOrArray } from 'Common/Types/JSON';
import Hostname from 'Common/Types/API/Hostname';
import Route from 'Common/Types/API/Route';
import Headers from 'Common/Types/API/Headers';

export default class Service {
    private api: API;
    private headers: Headers;

    constructor() {
        this.api = new API(HttpProtocol, new Hostname(RealtimeHostname));
        this.headers = {
            CLUSTER_KEY: ClusterKey,
        };
    }

    async send(
        projectId: string,
        eventType: string,
        data: JSONObjectOrArray
    ): void {
        await this.api.post(
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
