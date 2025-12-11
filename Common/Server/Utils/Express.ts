import logger from "./Logger";
import Dictionary from "../../Types/Dictionary";
import GenericFunction from "../../Types/GenericFunction";
import { JSONObject, JSONObjectOrArray } from "../../Types/JSON";
import JSONWebTokenData from "../../Types/JsonWebTokenData";
import ObjectID from "../../Types/ObjectID";
import {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../Types/Permission";
import Port from "../../Types/Port";
import UserType from "../../Types/UserType";
import "ejs";
import express from "express";
import { Server, createServer } from "http";
import CaptureSpan from "./Telemetry/CaptureSpan";

export type RequestHandler = express.RequestHandler;
export type NextFunction = express.NextFunction;

export const ExpressStatic: GenericFunction = express.static;
export const ExpressJson: GenericFunction = express.json;
export const ExpressUrlEncoded: GenericFunction = express.urlencoded;

export type ProbeRequest = {
  id: ObjectID;
};

export type ExpressRequest = express.Request;
export type ExpressResponse = express.Response;
export type ExpressApplication = express.Application;
export type ExpressRouter = express.Router;

export interface OneUptimeRequest extends express.Request {
  bearerTokenData?: JSONObject | string | undefined; //  if bearer token is passed then this is populated.
  probe?: ProbeRequest;
  userType?: UserType;
  userAuthorization?: JSONWebTokenData;
  tenantId?: ObjectID;
  userGlobalAccessPermission?: UserGlobalAccessPermission;
  userTenantAccessPermission?: Dictionary<UserTenantAccessPermission>; // tenantId <-> UserTenantAccessPermission;
  rawFormUrlEncodedBody?: string;
  rawBody?: string; // Raw body for signature verification (JSON or URL-encoded)
}

export interface OneUptimeResponse extends express.Response {
  logBody: JSONObjectOrArray;
}

export type RequestDeviceInfo = {
  deviceName?: string;
  deviceType?: string;
  deviceOS?: string;
  deviceBrowser?: string;
};

type HeaderValue = string | Array<string> | null | undefined;

class Express {
  private static app: express.Application;
  private static httpServer: Server;

  @CaptureSpan()
  public static getRouter(): express.Router {
    return express.Router();
  }

  @CaptureSpan()
  public static setupExpress(): void {
    this.app = express();
  }

  @CaptureSpan()
  public static getHttpServer(): Server {
    return this.httpServer;
  }

  @CaptureSpan()
  public static getExpressApp(): express.Application {
    if (!this.app) {
      this.setupExpress();
    }

    return this.app;
  }

  @CaptureSpan()
  public static async launchApplication(
    appName: string,
    port?: Port,
  ): Promise<express.Application> {
    if (!this.app) {
      this.setupExpress();
    }

    if (!this.httpServer) {
      this.httpServer = createServer(this.app);
    }

    type ResolveFunction = (app: express.Application) => void;

    return new Promise<express.Application>((resolve: ResolveFunction) => {
      this.httpServer.listen(port?.toNumber() || this.app.get("port"), () => {
        logger.debug(
          `${appName} server started on port: ${port?.toNumber() || this.app.get("port")}`,
        );
        return resolve(this.app);
      });
    });
  }
}

export default Express;

export const headerValueToString: (value: HeaderValue) => string | undefined = (
  value: HeaderValue,
): string | undefined => {
  if (Array.isArray(value)) {
    return value.length > 0 ? value[0] : undefined;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  return undefined;
};

export const extractDeviceInfo: (req: ExpressRequest) => RequestDeviceInfo = (
  req: ExpressRequest,
): RequestDeviceInfo => {
  const body: JSONObject = (req.body || {}) as JSONObject;
  const data: JSONObject = (body["data"] as JSONObject) || {};

  const getValue: (key: string) => string | undefined = (
    key: string,
  ): string | undefined => {
    const headerKey: string = key.toLowerCase();
    const camelKey: string = headerKey
      .split("-")
      .map((part: string, index: number) => {
        if (index === 0) {
          return part;
        }

        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join("");

    return (
      headerValueToString(req.headers[`x-${headerKey}`]) ||
      headerValueToString(body[camelKey] as HeaderValue) ||
      headerValueToString(data[camelKey] as HeaderValue) ||
      headerValueToString(body[key] as HeaderValue) ||
      headerValueToString(data[key] as HeaderValue)
    );
  };

  const result: RequestDeviceInfo = {};

  const deviceName: string | undefined = getValue("device-name");
  if (deviceName) {
    result.deviceName = deviceName;
  }

  const deviceType: string | undefined = getValue("device-type");
  if (deviceType) {
    result.deviceType = deviceType;
  }

  const deviceOS: string | undefined = getValue("device-os");
  if (deviceOS) {
    result.deviceOS = deviceOS;
  }

  const deviceBrowser: string | undefined = getValue("device-browser");
  if (deviceBrowser) {
    result.deviceBrowser = deviceBrowser;
  }

  return result;
};

export const getClientIp: (req: ExpressRequest) => string | undefined = (
  req: ExpressRequest,
): string | undefined => {
  const forwarded: string | Array<string> | undefined = req.headers[
    "x-forwarded-for"
  ] as string | Array<string> | undefined;

  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0]?.split(",")[0]?.trim();
  }

  if (typeof forwarded === "string" && forwarded.trim().length > 0) {
    return forwarded.split(",")[0]?.trim();
  }

  if (req.socket?.remoteAddress) {
    return req.socket.remoteAddress;
  }

  return req.ip;
};
