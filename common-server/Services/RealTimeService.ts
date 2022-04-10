import API from 'common/utils/API';
import { RealtimeHostname, HttpProtocol, ClusterKey } from '../Config';
import { JSONObjectOrArray } from 'common/types/JSON';
import Hostname from 'common/types/api/Hostname';
import Route from 'common/types/api/Route';
import Headers from 'common/types/api/Headers';

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
