import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import BadDataException from "../../../Types/Exception/BadDataException";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Timezone from "../../../Types/Timezone";
import jwt from "jsonwebtoken";
import { generateKeyPairSync } from "crypto";

describe("JSONWebToken", () => {
  const userId: ObjectID = ObjectID.generate();
  const sessionId: ObjectID = ObjectID.generate();
  const email: Email = new Email("jwt-test@oneuptime.com");

  describe("signJsonPayload / decodeJsonPayload", () => {
    test("should round trip a json payload", () => {
      const token: string = JSONWebToken.signJsonPayload(
        { hello: "world" },
        300,
      );

      const decoded: JSONObject = JSONWebToken.decodeJsonPayload(token);

      expect(decoded["hello"]).toEqual("world");
    });

    test("should set an expiry claim on the token", () => {
      const token: string = JSONWebToken.signJsonPayload(
        { hello: "world" },
        300,
      );

      const decoded: JSONObject = JSONWebToken.decodeJsonPayload(token);

      expect(decoded["exp"]).toBeDefined();
      expect(decoded["iat"]).toBeDefined();
      expect((decoded["exp"] as number) - (decoded["iat"] as number)).toEqual(
        300,
      );
    });

    test("should throw when the token was signed with a different secret", () => {
      const token: string = jwt.sign({ hello: "world" }, "some-other-secret", {
        expiresIn: 300,
      });

      expect(() => {
        return JSONWebToken.decodeJsonPayload(token);
      }).toThrow();
    });
  });

  describe("signUserLoginToken / decode", () => {
    test("should round trip user login token data", () => {
      const token: string = JSONWebToken.signUserLoginToken({
        tokenData: {
          userId: userId,
          email: email,
          name: new Name("Test User"),
          timezone: Timezone.AsiaKolkata,
          isMasterAdmin: true,
          isGlobalLogin: true,
          sessionId: sessionId,
        },
        expiresInSeconds: 300,
      });

      const decoded: JSONWebTokenData = JSONWebToken.decode(token);

      expect(decoded.userId.toString()).toEqual(userId.toString());
      expect(decoded.email.toString()).toEqual(email.toString());
      expect(decoded.name?.toString()).toEqual("Test User");
      expect(decoded.isMasterAdmin).toBe(true);
      expect(decoded.isGlobalLogin).toBe(true);
      expect(decoded.sessionId?.toString()).toEqual(sessionId.toString());
    });

    test("should leave sessionId undefined when it was not signed", () => {
      const token: string = JSONWebToken.sign({
        data: {
          userId: userId,
          email: email,
          name: new Name("Test User"),
          isMasterAdmin: false,
          isGlobalLogin: false,
        } as JSONWebTokenData,
        expiresInSeconds: 300,
      });

      const decoded: JSONWebTokenData = JSONWebToken.decode(token);

      expect(decoded.sessionId).toBeUndefined();
      expect(decoded.isMasterAdmin).toBe(false);
    });

    test("should decode a status page private user token", () => {
      const statusPageId: ObjectID = ObjectID.generate();

      const token: string = JSONWebToken.signJsonPayload(
        {
          userId: userId.toString(),
          email: email.toString(),
          statusPageId: statusPageId.toString(),
        },
        300,
      );

      const decoded: JSONWebTokenData = JSONWebToken.decode(token);

      expect(decoded.statusPageId?.toString()).toEqual(statusPageId.toString());
      // Status page users are never master admins.
      expect(decoded.isMasterAdmin).toBe(false);
      expect(decoded.name?.toString()).toEqual("User");
    });

    test("should throw BadDataException for a malformed token", () => {
      expect(() => {
        return JSONWebToken.decode("not-a-token");
      }).toThrow(BadDataException);
    });

    test("should throw BadDataException for an expired token", () => {
      const expiredToken: string = jwt.sign(
        { userId: userId.toString(), email: email.toString() },
        EncryptionSecret.toString(),
        { expiresIn: -10 },
      );

      expect(() => {
        return JSONWebToken.decode(expiredToken);
      }).toThrow(BadDataException);
    });
  });

  describe("sign", () => {
    test("should wrap a plain string payload under a data claim", () => {
      const token: string = JSONWebToken.sign({
        data: "just-a-string",
        expiresInSeconds: 300,
      });

      expect(JSONWebToken.decodeJsonPayload(token)["data"]).toEqual(
        "just-a-string",
      );
    });
  });

  describe("signWithPrivateKey", () => {
    test("should sign with RS256 and be verifiable with the public key", () => {
      const { privateKey, publicKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });

      const token: string = JSONWebToken.signWithPrivateKey(
        { sub: "oauth-subject" },
        privateKey,
      );

      const header: JSONObject = JSON.parse(
        Buffer.from(token.split(".")[0]!, "base64").toString("utf8"),
      );
      expect(header["alg"]).toEqual("RS256");

      const verified: JSONObject = jwt.verify(token, publicKey, {
        algorithms: ["RS256"],
      }) as JSONObject;
      expect(verified["sub"]).toEqual("oauth-subject");
    });
  });
});
