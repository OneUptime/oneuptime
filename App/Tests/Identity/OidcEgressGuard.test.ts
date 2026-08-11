import OIDCUtil from "../../FeatureSet/Identity/Utils/OIDC";
import { TestIdp, startTestIdp } from "./OidcTestIdp";
import URL from "Common/Types/API/URL";
import { afterEach, describe, expect, test } from "@jest/globals";
import dns from "dns";

const CLIENT_ID: string = "0oa1b2c3d4E5F6G7h8i9";

/*
 * OIDC's discoveryURL is tenant-writable, and pinning that one URL fixes
 * nothing: Issuer.discover fetches a document and then adopts the
 * authorization_endpoint, token_endpoint, userinfo_endpoint and jwks_uri THAT
 * DOCUMENT declares. Those are the requests that carry the client secret and
 * the access token, and their hosts are chosen by whoever controls the
 * discovery document. So the guard has to sit on the socket, not on the
 * configured URL — OIDC.ts installs it as openid-client's DNS lookup, which
 * covers every request the library makes regardless of which URL it picked.
 *
 * Unlike OIDC.test.ts, this file deliberately does NOT restore the stock
 * resolver: the loopback provider it starts is the thing that must be
 * refused.
 */

let idp: TestIdp | undefined = undefined;

afterEach(async () => {
  jest.restoreAllMocks();

  if (idp) {
    await idp.close();
    idp = undefined;
  }
});

describe("OIDC discovery is guarded at the socket", () => {
  test("refuses to discover an issuer on loopback", async () => {
    idp = await startTestIdp({ clientId: CLIENT_ID });

    /*
     * Without the guard this resolves: the provider is real and serving a
     * valid discovery document on 127.0.0.1.
     */
    await expect(
      OIDCUtil.createClient({
        discoveryURL: URL.fromString(
          `${idp.issuerUrl}/.well-known/openid-configuration`,
        ),
        clientId: CLIENT_ID,
        clientSecret: "client-secret",
        redirectUri: URL.fromString("https://oneuptime.example.com/callback"),
        scopes: "openid email profile",
      }),
    ).rejects.toThrow();
  });

  test("refuses a hostname that resolves to loopback", async () => {
    idp = await startTestIdp({ clientId: CLIENT_ID });

    const port: string = idp.issuerUrl.split(":")[2] || "";

    // The rebinding shape: a public-looking name, an internal answer.
    jest
      .spyOn(dns.promises, "lookup")
      .mockResolvedValue([
        { address: "127.0.0.1", family: 4 },
      ] as unknown as never);

    await expect(
      OIDCUtil.createClient({
        discoveryURL: URL.fromString(
          `http://idp.attacker.example:${port}/.well-known/openid-configuration`,
        ),
        clientId: CLIENT_ID,
        clientSecret: "client-secret",
        redirectUri: URL.fromString("https://oneuptime.example.com/callback"),
        scopes: "openid email profile",
      }),
    ).rejects.toThrow();
  });

  test("refuses the cloud metadata endpoint as a discovery URL", async () => {
    await expect(
      OIDCUtil.createClient({
        discoveryURL: URL.fromString(
          "http://169.254.169.254/latest/meta-data/",
        ),
        clientId: CLIENT_ID,
        clientSecret: "client-secret",
        redirectUri: URL.fromString("https://oneuptime.example.com/callback"),
        scopes: "openid email profile",
      }),
    ).rejects.toThrow();
  });

  test("the rejection is the guard's, not a connection error", async () => {
    idp = await startTestIdp({ clientId: CLIENT_ID });

    /*
     * The provider is up and serving, so a failure here can only come from
     * the lookup refusing to hand back a loopback address.
     */
    await expect(
      OIDCUtil.createClient({
        discoveryURL: URL.fromString(
          `${idp.issuerUrl}/.well-known/openid-configuration`,
        ),
        clientId: CLIENT_ID,
        clientSecret: "client-secret",
        redirectUri: URL.fromString("https://oneuptime.example.com/callback"),
        scopes: "openid email profile",
      }),
    ).rejects.toThrow(/loopback|not allowed/);
  });
});
