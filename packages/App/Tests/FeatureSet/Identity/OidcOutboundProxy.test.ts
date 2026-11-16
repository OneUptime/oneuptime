/**
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */

import OIDCUtil from "../../../FeatureSet/Identity/Utils/OIDC";
import { TestIdp, startTestIdp } from "./OidcTestIdp";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import {
  LocalHttpServer,
  PROXY_HOST_NAME,
  approveOnLoopback,
  clearOutboundProxyEnvironmentForEachTest,
  useLocalHttpServers,
} from "Common/Tests/Server/TestingUtils/OutboundProxyFixture";
import { startEachTestOnSelfHostedEgressPolicy } from "Common/Tests/Server/Utils/EgressPolicyEnvironment";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Client } from "openid-client";
import dns from "dns";
import http from "http";

/*
 * SINGLE SIGN-ON BEHIND AN OUTBOUND PROXY (issue #8932).
 *
 * openid-client sends with Node's own http client, which reads no proxy
 * setting, so on a server that reaches the internet only through a proxy,
 * discovery, the token exchange, JWKS and userinfo all failed, and nobody
 * could sign in with an identity provider on the internet. OIDC.ts now hands
 * every request the egress guard's agent for its URL
 * (createGuardedAgentsForNodeHttp): through the proxy set in HTTPS_PROXY,
 * HTTP_PROXY or ALL_PROXY, as axios decides, apart from the hosts NO_PROXY
 * names, which are dialled directly. The guard still sits where the
 * connection is made: a host the discovery document adopts is checked before
 * the proxy is asked for it, so the proxy never carries a request to an
 * address the policy refuses.
 *
 * The proxy here answers as an identity provider behind it would (it is a
 * forward proxy, sent the whole URL); the proxy itself is on loopback, which
 * the policy refuses on every install: it is never held to it.
 */

clearOutboundProxyEnvironmentForEachTest();
startEachTestOnSelfHostedEgressPolicy();

const serve: (options?: {
  host?: string | undefined;
  port?: number | undefined;
  name?: string | undefined;
}) => Promise<LocalHttpServer> = useLocalHttpServers();

const CLIENT_ID: string = "0oa1b2c3d4E5F6G7h8i9";
const ISSUER: string = "http://idp.example.test";

let idp: TestIdp | undefined = undefined;

afterEach(async () => {
  jest.restoreAllMocks();

  if (idp) {
    await idp.close();
    idp = undefined;
  }
});

// The guard's DNS: these names, at a public address; nothing else resolves.
function resolvePublicly(hostnames: Array<string>): void {
  jest.spyOn(dns.promises, "lookup").mockImplementation((async (
    name: string,
  ) => {
    if (!hostnames.includes(name)) {
      throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${name}`), {
        code: "ENOTFOUND",
      });
    }

    return [{ address: "93.184.216.34", family: 4 }];
  }) as never);
}

function discoveryDocument(overrides?: JSONObject): JSONObject {
  return {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    jwks_uri: `${ISSUER}/jwks`,
    userinfo_endpoint: `${ISSUER}/userinfo`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    ...(overrides || {}),
  };
}

// A proxy that answers as the identity provider behind it.
function answerAsTheProvider(
  proxy: LocalHttpServer,
  document: JSONObject,
): void {
  proxy.handler = (
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): void => {
    const path: string = new globalThis.URL(request.url || "").pathname;

    if (path === "/.well-known/openid-configuration") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(document));
      return;
    }

    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({ error: "invalid_grant", error_description: "no" }),
    );
  };
}

async function createClient(discoveryUrl: string): Promise<Client> {
  return await OIDCUtil.createClient({
    discoveryURL: URL.fromString(discoveryUrl),
    clientId: CLIENT_ID,
    clientSecret: "client-secret",
    redirectUri: URL.fromString("https://oneuptime.example.com/callback"),
    scopes: "openid email profile",
  });
}

async function exchangeCode(client: Client): Promise<unknown> {
  const state: string = OIDCUtil.generateState();

  return await OIDCUtil.exchangeCodeAndValidate({
    client,
    redirectUri: URL.fromString("https://oneuptime.example.com/callback"),
    expectedIssuer: ISSUER,
    expectedNonce: "nonce",
    expectedState: state,
    codeVerifier: OIDCUtil.generateCodeVerifier(),
    callbackParams: { code: "the-code", state },
    emailClaimName: "email",
    nameClaimName: "name",
  });
}

describe("OIDC, behind an outbound proxy", () => {
  test("discovery over http goes to a proxy named by host name, which is sent the whole URL", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    resolvePublicly(["idp.example.test"]);
    answerAsTheProvider(proxy, discoveryDocument());

    const client: Client = await createClient(
      `${ISSUER}/.well-known/openid-configuration`,
    );

    expect(client.issuer.metadata.token_endpoint).toBe(`${ISSUER}/token`);
    expect(
      proxy.requests.map((request: { url: string }) => {
        return request.url;
      }),
    ).toEqual([`${ISSUER}/.well-known/openid-configuration`]);
  });

  test("the token exchange, which carries the client secret, goes through the proxy too", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    resolvePublicly(["idp.example.test"]);
    answerAsTheProvider(proxy, discoveryDocument());

    const client: Client = await createClient(
      `${ISSUER}/.well-known/openid-configuration`,
    );

    // The proxy answers as a provider that refuses the code.
    await expect(exchangeCode(client)).rejects.toThrow(/invalid_grant/);

    const token: { method: string; body: string } | undefined =
      proxy.requests.find((request: { url: string }): boolean => {
        return request.url === `${ISSUER}/token`;
      });

    expect(token?.method).toBe("POST");
    expect(token?.body).toContain("grant_type=authorization_code");
    expect(token?.body).toContain("code=the-code");
  });

  test("discovery over https is tunnelled through the proxy, to the provider by name", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTPS_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    resolvePublicly(["login.example.test"]);

    // The proxy refuses every tunnel here; where it was asked to is the point.
    await expect(
      createClient(
        "https://login.example.test/.well-known/openid-configuration",
      ),
    ).rejects.toThrow();

    expect(proxy.connects).toEqual(["login.example.test:443"]);
    expect(proxy.requests).toEqual([]);
  });

  test("a provider host that resolves somewhere refused is never asked of the proxy", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    jest
      .spyOn(dns.promises, "lookup")
      .mockResolvedValue([
        { address: "169.254.169.254", family: 4 },
      ] as unknown as never);

    await expect(
      createClient(
        "http://idp.attacker.example/.well-known/openid-configuration",
      ),
    ).rejects.toThrow(/OIDC provider host idp\.attacker\.example/);

    expect(proxy.isUntouched).toBe(true);
  });

  test("an endpoint the discovery document adopts is checked before the proxy is asked for it", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    resolvePublicly(["idp.example.test"]);
    // The document names the cloud metadata address as its token endpoint.
    answerAsTheProvider(
      proxy,
      discoveryDocument({ token_endpoint: "http://169.254.169.254/token" }),
    );

    const client: Client = await createClient(
      `${ISSUER}/.well-known/openid-configuration`,
    );

    await expect(exchangeCode(client)).rejects.toThrow(
      /OIDC provider host 169\.254\.169\.254 is not allowed/,
    );

    expect(
      proxy.requests.map((request: { url: string }) => {
        return request.url;
      }),
    ).toEqual([`${ISSUER}/.well-known/openid-configuration`]);
  });

  test("a provider in NO_PROXY is dialled directly, at the address the guard approved", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    idp = await startTestIdp({ clientId: CLIENT_ID });
    const port: string = new globalThis.URL(idp.issuerUrl).port;
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    process.env["NO_PROXY"] = "sso.example.test";
    // The name resolves nowhere real: only the guard's answer reaches the provider.
    approveOnLoopback({ "sso.example.test": ["127.0.0.1"] });

    const client: Client = await createClient(
      `http://sso.example.test:${port}/.well-known/openid-configuration`,
    );

    expect(client.issuer.metadata.issuer).toBe(idp.issuerUrl);
    expect(proxy.isUntouched).toBe(true);
  });

  test("with no proxy, discovery is dialled at the address the guard approved", async () => {
    idp = await startTestIdp({ clientId: CLIENT_ID });
    const port: string = new globalThis.URL(idp.issuerUrl).port;
    approveOnLoopback({ "sso.example.test": ["127.0.0.1"] });

    const client: Client = await createClient(
      `http://sso.example.test:${port}/.well-known/openid-configuration`,
    );

    expect(client.issuer.metadata.token_endpoint).toBe(
      `${idp.issuerUrl}/token`,
    );
  });
});
