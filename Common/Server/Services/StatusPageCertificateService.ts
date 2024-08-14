import DatabaseConfig from "../DatabaseConfig";
import { AppApiHostname } from "../EnvironmentConfig";
import BaseService from "./BaseService";
import EmptyResponseData from "../../Types/API/EmptyResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import { JSONObject } from "../../Types/JSON";
import API from "Common/Utils/API";

export class StatusPageCertificateService extends BaseService {
  public constructor() {
    super();
  }

  public async add(domain: string): Promise<HTTPResponse<EmptyResponseData>> {
    const body: JSONObject = {
      domain: domain,
    };

    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    return await API.post<EmptyResponseData>(
      new URL(httpProtocol, AppApiHostname, new Route("/api/workers/cert")),
      body,
    );
  }

  public async remove(
    domain: string,
  ): Promise<HTTPResponse<EmptyResponseData>> {
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const body: JSONObject = {
      domain: domain,
    };

    return await API.delete<EmptyResponseData>(
      new URL(httpProtocol, AppApiHostname, new Route("/api/workers/cert")),
      body,
    );
  }

  public async get(domain: string): Promise<HTTPResponse<JSONObject>> {
    const body: JSONObject = {
      domain: domain,
    };

    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    return await API.get<JSONObject>(
      new URL(httpProtocol, AppApiHostname, new Route("/api/workers/cert")),
      body,
    );
  }
}

export default new StatusPageCertificateService();
