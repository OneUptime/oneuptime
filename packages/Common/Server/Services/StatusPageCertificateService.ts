import DatabaseConfig from "../DatabaseConfig";
import { AppApiHostname } from "../EnvironmentConfig";
import BaseService from "./BaseService";
import EmptyResponseData from "../../Types/API/EmptyResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import { JSONObject } from "../../Types/JSON";
import API from "../../Utils/API";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class StatusPageCertificateService extends BaseService {
  public constructor() {
    super();
  }

  @CaptureSpan()
  public async add(domain: string): Promise<HTTPResponse<EmptyResponseData>> {
    const body: JSONObject = {
      domain: domain,
    };

    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    return await API.post<EmptyResponseData>({
      url: new URL(
        httpProtocol,
        AppApiHostname,
        new Route("/api/workers/cert"),
      ),
      data: body,
    });
  }

  @CaptureSpan()
  public async remove(
    domain: string,
  ): Promise<HTTPResponse<EmptyResponseData>> {
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const body: JSONObject = {
      domain: domain,
    };

    return await API.delete<EmptyResponseData>({
      url: new URL(
        httpProtocol,
        AppApiHostname,
        new Route("/api/workers/cert"),
      ),
      data: body,
    });
  }

  @CaptureSpan()
  public async get(domain: string): Promise<HTTPResponse<JSONObject>> {
    const body: JSONObject = {
      domain: domain,
    };

    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    return await API.get<JSONObject>({
      url: new URL(
        httpProtocol,
        AppApiHostname,
        new Route("/api/workers/cert"),
      ),
      data: body,
    });
  }
}

export default new StatusPageCertificateService();
