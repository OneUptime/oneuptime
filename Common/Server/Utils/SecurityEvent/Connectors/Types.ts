import { JSONObject } from "../../../../Types/JSON";
import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../DataSource/HttpFetch";

export interface SecurityEventConnectorFetchResult {
  events: Array<JSONObject>;
  complete: boolean;
  requestCount: number;
  warnings: Array<string>;
  continuation?: JSONObject | undefined;
}

export type SecurityEventConnectorHttpRequest = (
  request: DataSourceHttpRequest,
) => Promise<DataSourceHttpResponse>;

export interface SecurityEventConnectorClient {
  fetchEvents(data: {
    startTime: Date;
    endTime: Date;
    continuation?: JSONObject | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<SecurityEventConnectorFetchResult>;
}

export type SecurityEventConnectorClientFactory = (
  connection: SecurityEventConnection,
  request?: SecurityEventConnectorHttpRequest,
) => SecurityEventConnectorClient;
