import { EncryptionSecret } from "../EnvironmentConfig";
import Email from "../../Types/Email";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import JSONWebTokenData from "../../Types/JsonWebTokenData";
import Name from "../../Types/Name";
import ObjectID from "../../Types/ObjectID";
import Timezone from "../../Types/Timezone";
import StatusPagePrivateUser from "../../Models/DatabaseModels/StatusPagePrivateUser";
import User from "../../Models/DatabaseModels/User";
import jwt from "jsonwebtoken";
import logger from "./Logger";
import CaptureSpan from "./Telemetry/CaptureSpan";

class JSONWebToken {
  @CaptureSpan()
  public static signUserLoginToken(data: {
    tokenData: {
      userId: ObjectID;
      email: Email;
      name: Name;
      timezone: Timezone | null; // User's timezone
      isMasterAdmin: boolean;
      // If this is OneUptime username and password login. This is true, if this is SSO login. Then, this is false.
      isGlobalLogin: boolean;
      sessionId: ObjectID;
    };
    expiresInSeconds: number;
  }): string {
    return JSONWebToken.sign({
      data: data.tokenData,
      expiresInSeconds: data.expiresInSeconds,
    });
  }

  @CaptureSpan()
  public static sign(props: {
    data: JSONWebTokenData | User | StatusPagePrivateUser | string | JSONObject;
    expiresInSeconds: number;
  }): string {
    const { data, expiresInSeconds } = props;

    let jsonObj: JSONObject;

    if (typeof data === "string") {
      jsonObj = {
        data: data.toString(),
      };
    } else if (data instanceof User) {
      jsonObj = {
        userId: data.id!.toString(),
        email: data.email!.toString(),
        name: data.name?.toString() || "",
        isMasterAdmin: data.isMasterAdmin!,
      };
    } else if (data instanceof StatusPagePrivateUser) {
      jsonObj = {
        userId: data.id!.toString(),
        email: data.email!.toString(),
        statusPageId: data.statusPageId?.toString(),
      };
    } else {
      jsonObj = {
        ...data,
        userId: data.userId?.toString(),
        email: data.email?.toString(),
        name: data.name?.toString() || "",
        projectId: data.projectId?.toString() || "",
        isMasterAdmin: data.isMasterAdmin,
        sessionId: data.sessionId?.toString() || undefined,
      };
    }
    return JSONWebToken.signJsonPayload(jsonObj, expiresInSeconds);
  }

  @CaptureSpan()
  public static signJsonPayload(
    payload: JSONObject,
    expiresInSeconds: number,
  ): string {
    return jwt.sign(payload, EncryptionSecret.toString(), {
      expiresIn: expiresInSeconds,
    });
  }

  /**
   * Sign a JWT with a custom private key using RS256 algorithm.
   * Used for OAuth JWT Bearer flows that require asymmetric signing.
   */
  @CaptureSpan()
  public static signWithPrivateKey(
    payload: Record<string, unknown>,
    privateKey: string,
  ): string {
    return jwt.sign(payload, privateKey, {
      algorithm: "RS256",
    });
  }

  @CaptureSpan()
  public static decodeJsonPayload(token: string): JSONObject {
    const decodedToken: string = JSON.stringify(
      jwt.verify(token, EncryptionSecret.toString()) as string,
    );
    const decoded: JSONObject = JSONFunctions.parseJSONObject(decodedToken);

    return decoded;
  }

  @CaptureSpan()
  public static decode(token: string): JSONWebTokenData {
    try {
      const decoded: JSONObject = JSONWebToken.decodeJsonPayload(token);

      if (decoded["statusPageId"]) {
        return {
          userId: new ObjectID(decoded["userId"] as string),
          email: new Email(decoded["email"] as string),
          statusPageId: new ObjectID(decoded["statusPageId"] as string),
          isMasterAdmin: false,
          name: new Name("User"),
          isGlobalLogin: Boolean(decoded["isGlobalLogin"]),
          sessionId: decoded["sessionId"]
            ? new ObjectID(decoded["sessionId"] as string)
            : undefined,
        };
      }

      return {
        userId: new ObjectID(decoded["userId"] as string),
        email: new Email(decoded["email"] as string),
        name: new Name(decoded["name"] as string),
        projectId: decoded["projectId"]
          ? new ObjectID(decoded["projectId"] as string)
          : undefined,
        isMasterAdmin: Boolean(decoded["isMasterAdmin"]),
        isGlobalLogin: Boolean(decoded["isGlobalLogin"]),
        sessionId: decoded["sessionId"]
          ? new ObjectID(decoded["sessionId"] as string)
          : undefined,
      };
    } catch (e) {
      logger.error(e);
      throw new BadDataException("AccessToken is invalid or expired");
    }
  }
}

export default JSONWebToken;
