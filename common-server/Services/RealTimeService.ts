import API from 'common/utils/API';
import { RealtimeHostname, HttpProtocol, ClusterKey } from '../Config';
import { JSONObjectOrArray } from 'common/Types/JSON';
import Hostname from 'common/Types/api/Hostname';
import Route from 'common/Types/api/Route';
import Headers from 'common/Types/api/Headers';

export default class Service {
    private api: API;
    private headers: Headers;

    constructor() {
        this.api = new API(HttpProtocol, new Hostname(RealtimeHostname));
        this.headers = {
            CLUSTER_KEY: ClusterKey,
        };
    }

    async send(projectId: string, eventType: string, data: JSONObjectOrArray) {
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
