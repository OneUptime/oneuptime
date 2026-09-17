import CookieUtil from "../../../Server/Utils/Cookie";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import { JSONObject } from "../../../Types/JSON";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import User from "../../../Models/DatabaseModels/User";
import { describe, expect, test } from "@jest/globals";

/*
 * Tests for the SSO-provider discriminator that CookieUtil.getSSOToken stamps
 * onto a per-project SSO token. These run real JWT signing (no mocks): the JWT
 * secret falls back to EncryptionSecret = "secret" when ENCRYPTION_SECRET is
 * unset (see Common/Server/EnvironmentConfig.ts), so no env setup is required.
 */
describe("CookieUtil.getSSOToken - SSO provider discriminator", () => {
  const buildUser: () => User = (): User => {
    const user: User = new User();
    user.id = ObjectID.generate();
    user.name = new Name("Test User");
    user.email = new Email("test@oneuptime.com");
    return user;
  };

  test("token carries userId and projectId (round-trips through JSONWebToken.decode)", () => {
    const user: User = buildUser();
    const projectId: ObjectID = ObjectID.generate();

    const token: string = CookieUtil.getSSOToken({
      user,
      projectId,
    });

    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);

    const decoded: JSONWebTokenData = JSONWebToken.decode(token);

    expect(decoded.userId?.toString()).toBe(user.id!.toString());
    expect(decoded.projectId?.toString()).toBe(projectId.toString());
  });

  test("token carries the ssoProviderId + ssoProviderType discriminator when provided", () => {
    const user: User = buildUser();
    const projectId: ObjectID = ObjectID.generate();
    const ssoProviderId: ObjectID = ObjectID.generate();

    const token: string = CookieUtil.getSSOToken({
      user,
      projectId,
      ssoProviderId,
      ssoProviderType: SsoProviderType.GlobalSSO,
    });

    /*
     * The discriminator lives on the raw JWT payload. JSONWebToken.decode()
     * intentionally re-shapes the payload into JSONWebTokenData and does not
     * surface ssoProviderId / ssoProviderType, so we assert the round-trip on
     * the raw payload (decodeJsonPayload), which is the actual transport layer.
     */
    const payload: JSONObject = JSONWebToken.decodeJsonPayload(token);

    expect(payload["userId"]).toBe(user.id!.toString());
    expect(payload["projectId"]).toBe(projectId.toString());
    expect(payload["ssoProviderId"]).toBe(ssoProviderId.toString());
    expect(payload["ssoProviderType"]).toBe(SsoProviderType.GlobalSSO);
  });

  test("each SsoProviderType enum value round-trips on the token", () => {
    const user: User = buildUser();
    const projectId: ObjectID = ObjectID.generate();
    const ssoProviderId: ObjectID = ObjectID.generate();

    const providerTypes: Array<SsoProviderType> = [
      SsoProviderType.ProjectSSO,
      SsoProviderType.ProjectOIDC,
      SsoProviderType.GlobalSSO,
      SsoProviderType.GlobalOIDC,
    ];

    for (const providerType of providerTypes) {
      const token: string = CookieUtil.getSSOToken({
        user,
        projectId,
        ssoProviderId,
        ssoProviderType: providerType,
      });

      const payload: JSONObject = JSONWebToken.decodeJsonPayload(token);

      expect(payload["ssoProviderId"]).toBe(ssoProviderId.toString());
      expect(payload["ssoProviderType"]).toBe(providerType);
    }
  });

  test("ssoProviderId / ssoProviderType are absent (undefined) when not provided (legacy token shape)", () => {
    const user: User = buildUser();
    const projectId: ObjectID = ObjectID.generate();

    const token: string = CookieUtil.getSSOToken({
      user,
      projectId,
    });

    const payload: JSONObject = JSONWebToken.decodeJsonPayload(token);

    // No discriminator was provided, so neither field should carry a value.
    expect(payload["ssoProviderId"]).toBeUndefined();
    expect(payload["ssoProviderType"]).toBeUndefined();
  });

  test("ssoProviderId without ssoProviderType still records the provider id", () => {
    const user: User = buildUser();
    const projectId: ObjectID = ObjectID.generate();
    const ssoProviderId: ObjectID = ObjectID.generate();

    const token: string = CookieUtil.getSSOToken({
      user,
      projectId,
      ssoProviderId,
    });

    const payload: JSONObject = JSONWebToken.decodeJsonPayload(token);

    expect(payload["ssoProviderId"]).toBe(ssoProviderId.toString());
    expect(payload["ssoProviderType"]).toBeUndefined();
  });
});
