/**
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */

import PushNotificationService from "../../../Server/Services/PushNotificationService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import PushNotificationLogService from "../../../Server/Services/PushNotificationLogService";
import UserPushService from "../../../Server/Services/UserPushService";
import OutboundProxyAgents from "../../../Server/Utils/OutboundProxyAgents";
import PushNotificationLog from "../../../Models/DatabaseModels/PushNotificationLog";
import ObjectID from "../../../Types/ObjectID";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import PushStatus from "../../../Types/PushNotification/PushStatus";
import {
  LocalHttpServer,
  PLAIN_CREDENTIALS,
  PROXY_HOST_NAME,
  ProxyCredentials,
  RESERVED_CHARACTER_CREDENTIALS,
  clearOutboundProxyEnvironmentForEachTest,
  proxyUrlWithCredentials,
  signedInAs,
  useLocalHttpServers,
  watchLookups,
} from "../TestingUtils/OutboundProxyFixture";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { createECDH, randomBytes } from "crypto";
import webpush from "web-push";

jest.mock("../../../Server/Utils/Logger");

/*
 * PUSH NOTIFICATIONS GO THROUGH THE OUTBOUND PROXY, AS EVERY REQUEST OF THE
 * SERVER DOES (found while fixing #10720).
 *
 * Expo's push to the mobile app sends with node-fetch, and web push with
 * Node's https, each on the agent it is handed: they were handed none, so
 * both went out on Node's global agent, which reads no HTTPS_PROXY. On a
 * server that reaches the internet only through a proxy, no push reached a
 * phone or a browser. Each request takes the route decided for its URL now
 * (PushNotificationService.expoAgentFor, getWebPushAgent).
 *
 * These send through the real Expo client and the real web-push library to
 * a proxy on this machine (OutboundProxyFixture), which records who each
 * CONNECT signed in as and refuses it; where a push went directly is read
 * from what this machine looked up (watchLookups). Nothing leaves it.
 */

clearOutboundProxyEnvironmentForEachTest();

const serve: (options?: {
  host?: string | undefined;
  port?: number | undefined;
  name?: string | undefined;
}) => Promise<LocalHttpServer> = useLocalHttpServers();

const EXPO_HOST: string = "exp.host";
const WEB_PUSH_HOST: string = "fcm.googleapis.com";
const PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000042",
);

const MESSAGE: PushNotificationMessage = {
  title: "Incident #42: Checkout is down",
  body: "A new incident has been created.",
};

// A browser's subscription, with keys web-push can encrypt a push to.
function browserSubscription(): string {
  const browserKeys: ReturnType<typeof createECDH> = createECDH("prime256v1");

  browserKeys.generateKeys();

  return JSON.stringify({
    endpoint: `https://${WEB_PUSH_HOST}/fcm/send/oneuptime-test-device`,
    expirationTime: null,
    keys: {
      p256dh: browserKeys.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  });
}

async function failureOf(sending: Promise<unknown>): Promise<Error> {
  try {
    await sending;
  } catch (error) {
    return error as Error;
  }

  throw new Error("The push went out.");
}

let logs: Array<PushNotificationLog> = [];

beforeAll(() => {
  const vapid: { publicKey: string; privateKey: string } =
    webpush.generateVAPIDKeys();

  webpush.setVapidDetails(
    "mailto:ops@example.test",
    vapid.publicKey,
    vapid.privateKey,
  );
});

beforeEach(() => {
  logs = [];
  PushNotificationService.isWebPushInitialized = true;

  jest
    .spyOn(GlobalConfigService, "getPushNotificationsTurnedOff")
    .mockResolvedValue(false);
  jest
    .spyOn(PushNotificationLogService, "create")
    .mockImplementation((async (createBy: { data: PushNotificationLog }) => {
      logs.push(createBy.data);
      return createBy.data;
    }) as never);
});

afterEach(() => {
  PushNotificationService.isWebPushInitialized = false;
  OutboundProxyAgents.destroySharedAgents();
  jest.restoreAllMocks();
});

// A push to a browser, as a page sends one.
async function pushToBrowser(): Promise<void> {
  await PushNotificationService.sendPushNotification(
    {
      devices: [{ token: browserSubscription(), name: "Chrome on Windows" }],
      message: MESSAGE,
      deviceType: PushDeviceType.Web,
    },
    { projectId: PROJECT_ID },
  );
}

// A push to a phone, straight to Expo, as a server with its own access token sends one.
async function pushToPhone(): Promise<unknown> {
  jest
    .spyOn(PushNotificationService, "hasExpoAccessToken")
    .mockReturnValue(true);

  return await (
    PushNotificationService as unknown as {
      sendExpoPushNotification: (
        token: string,
        message: PushNotificationMessage,
        deviceType: PushDeviceType,
        options: Record<string, unknown>,
      ) => Promise<unknown>;
    }
  ).sendExpoPushNotification(
    "ExponentPushToken[oneuptime-test-device]",
    MESSAGE,
    PushDeviceType.Android,
    {},
  );
}

interface Push {
  name: string;
  host: string;
  send: () => Promise<unknown>;
  // What a failed push says, where a person reads it.
  failure: (error: Error) => string;
}

const PUSHES: Array<Push> = [
  {
    name: "a push to the mobile app, through Expo",
    host: EXPO_HOST,
    send: pushToPhone,
    failure: (error: Error): string => {
      return error.message;
    },
  },
  {
    name: "a web push to a browser",
    host: WEB_PUSH_HOST,
    send: pushToBrowser,
    // Its log says why.
    failure: (): string => {
      return String(logs[0]?.statusMessage || "");
    },
  },
];

describe.each(PUSHES)("$name", (push: Push) => {
  test.each([
    {
      kind: "with @, : and % in it",
      credentials: RESERVED_CHARACTER_CREDENTIALS,
    },
    {
      kind: "with no character a URL reserves",
      credentials: PLAIN_CREDENTIALS,
    },
  ])(
    "goes through the proxy, signed in with the real user name and password $kind, and its host is not looked up here",
    async (data: { kind: string; credentials: ProxyCredentials }) => {
      const proxy: LocalHttpServer = await serve({ name: "proxy" });
      process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        data.credentials,
      );
      const lookups: Array<string> = watchLookups([push.host]);

      await failureOf(push.send());

      expect(proxy.connects).toEqual([`${push.host}:443`]);
      expect(proxy.connectCredentials).toEqual([signedInAs(data.credentials)]);
      expect(lookups).not.toContain(push.host);
    },
  );

  test("a refused tunnel is said as the proxy's refusal, never naming the proxy", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const failure: Error = await failureOf(push.send());

    expect(push.failure(failure)).toBe(
      `The outbound proxy did not open a connection to ${push.host}:443: it answered HTTP/1.1 403 Forbidden. The request was not sent. Ask whoever runs this OneUptime server to let the proxy reach that host.`,
    );
    expect(push.failure(failure)).not.toContain(String(proxy.port));
    expect(push.failure(failure)).not.toContain(PROXY_HOST_NAME);
  });

  test("a 407 is the proxy not taking OneUptime's user name and password", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    proxy.connectStatusLine = "HTTP/1.1 407 Proxy Authentication Required";
    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const failure: Error = await failureOf(push.send());

    expect(push.failure(failure)).toBe(
      `The outbound proxy answered HTTP/1.1 407 Proxy Authentication Required: it did not take OneUptime's user name and password, so the request to ${push.host}:443 was not sent. Ask whoever runs this OneUptime server to check the user name and password in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY.`,
    );
  });

  test("a host in NO_PROXY is pushed to directly, and the proxy is never asked", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );
    process.env["NO_PROXY"] = push.host;
    const lookups: Array<string> = watchLookups([push.host]);

    await failureOf(push.send());

    expect(lookups).toContain(push.host);
    expect(proxy.isUntouched).toBe(true);
  });

  test("with no proxy at all, it is pushed directly", async () => {
    const lookups: Array<string> = watchLookups([push.host]);

    await failureOf(push.send());

    expect(lookups).toContain(push.host);
  });
});

describe("a web push's failure", () => {
  test("is the server's, so the browser stays as it is", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTPS_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    const markAsGone: jest.SpiedFunction<
      typeof UserPushService.markWebPushSubscriptionAsGone
    > = jest
      .spyOn(UserPushService, "markWebPushSubscriptionAsGone")
      .mockResolvedValue(1);

    await failureOf(pushToBrowser());

    expect(logs).toHaveLength(1);
    expect(logs[0]!.status).toBe(PushStatus.Error);
    expect(markAsGone).not.toHaveBeenCalled();
  });
});
