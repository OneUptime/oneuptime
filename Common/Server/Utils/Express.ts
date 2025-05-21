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
}

export interface OneUptimeResponse extends express.Response {
  logBody: JSONObjectOrArray;
}

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
