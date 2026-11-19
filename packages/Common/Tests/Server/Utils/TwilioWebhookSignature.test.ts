import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import {
  TWILIO_CALLBACK_REFUSED,
  TWILIO_SIGNATURE_HEADER,
  TwilioSignatureCheck,
  describeTwilioAccountSid,
  describeTwilioWebhookUrl,
  findTwilioAccountThatSigned,
  getTwilioCallbackRefusedMessage,
  getTwilioSignature,
  getTwilioWebhookUrls,
  isSignedWithAuthToken,
} from "../../../Server/Utils/TwilioWebhookSignature";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import { WebhookRequest } from "../../../Types/Call/CallProvider";
import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import {
  TWILIO_PUBLIC_ORIGIN,
  serverTwilioRow,
  signedTwilioRequest,
} from "../TestingUtils/TwilioSignedRequests";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { getExpectedTwilioSignature } from "twilio";

/*
 * WHETHER A REQUEST TO ONE OF ONEUPTIME'S TWILIO WEBHOOKS IS TWILIO'S
 * (#9979).
 *
 * Twilio signs every webhook request - an SMS's delivery status, how a call
 * ended, who answered it, a key pressed on it, an incoming call - with the
 * auth token of the account the message or the call is on, over the public
 * URL it was given and every parameter it posted. Signatures here are made
 * by Twilio's own algorithm (getExpectedTwilioSignature) over the public URL,
 * and the requests reach the check as they reach the app: behind the
 * ingress's /notification rewrite, at the app's own host, with the public
 * scheme and host forwarded - or, for a proxy that forwards neither, only
 * what this server's HOST and HTTP_PROTOCOL say. The database is stood in
 * for: the project's Twilio configs and the server's own account.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    Host: "",
    HttpProtocol: "https://",
  };
});

// What this server's HOST and HTTP_PROTOCOL say, set per test.
const environment: { Host: string; HttpProtocol: string } = jest.requireMock(
  "../../../Server/EnvironmentConfig",
);

const PROJECT_ID: ObjectID = new ObjectID(
  "7c0e0000-0000-4000-8000-000000000001",
);
const LOG_ID: string = "7c0e0000-0000-4000-8000-0000000000a1";
const TOKEN: string = "7c0e0000-0000-4000-8000-0000000000f1";
const MESSAGE_SID: string = "SM0123456789abcdef0123456789abcdef";

// The public URL an SMS's delivery status goes to (SmsService), Twilio's retry fragment and all.
const STATUS_CALLBACK_URL: string = `${TWILIO_PUBLIC_ORIGIN}/notification/sms/status-callback/${LOG_ID}/${TOKEN}?providerConfig=project#rc=3&rp=ct,5xx`;

const SERVER_ACCOUNT: TwilioConfig = {
  accountSid: "AC11111111111111111111111111111111",
  authToken: "server-auth-token-0000000000000001",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
};

const PROJECT_ACCOUNT: TwilioConfig = {
  accountSid: "AC22222222222222222222222222222222",
  authToken: "project-auth-token-000000000000002",
  primaryPhoneNumber: new Phone("+14155550199"),
  secondaryPhoneNumbers: [],
};

const STRANGER_ACCOUNT: TwilioConfig = {
  accountSid: "AC33333333333333333333333333333333",
  authToken: "a-strangers-auth-token-00000000003",
  primaryPhoneNumber: new Phone("+14155550123"),
  secondaryPhoneNumbers: [],
};

let globalConfig: GlobalConfig | null;
let projectConfigs: Array<ProjectCallSMSConfig>;
let findConfigs: jest.SpyInstance;
let findGlobalConfig: jest.SpyInstance;

// A project's own Twilio config on an account, as the database holds it.
function projectConfig(account: TwilioConfig): ProjectCallSMSConfig {
  const row: ProjectCallSMSConfig = new ProjectCallSMSConfig();
  row.id = ObjectID.generate();
  row.projectId = PROJECT_ID;
  row.twilioAccountSID = account.accountSid;
  row.twilioAuthToken = account.authToken;
  row.twilioPrimaryPhoneNumber = account.primaryPhoneNumber!;

  return row;
}

// A delivery report as Twilio posts it about the SMS, on an account.
function deliveryReport(
  account: TwilioConfig,
  more: Partial<Parameters<typeof signedTwilioRequest>[0]> = {},
): WebhookRequest {
  return signedTwilioRequest({
    publicUrl: STATUS_CALLBACK_URL,
    body: {
      AccountSid: account.accountSid,
      MessageSid: MESSAGE_SID,
      MessageStatus: "delivered",
      ApiVersion: "2010-04-01",
    },
    signedWith: account.authToken,
    ...more,
  }) as unknown as WebhookRequest;
}

// The check a callback about the project's message makes; null for a message of no project.
async function check(
  request: WebhookRequest,
  projectId: ObjectID | null = PROJECT_ID,
): Promise<TwilioSignatureCheck> {
  return await findTwilioAccountThatSigned({
    request: request,
    projectId: projectId || undefined,
    urlSecrets: [TOKEN],
  });
}

function expectRefused(result: TwilioSignatureCheck): string {
  expect(result.account).toBeNull();
  expect(typeof result.refusalReason).toBe("string");

  return result.refusalReason as string;
}

// Nothing secret in a reason: no auth token, no whole account SID, no URL token.
function expectNoSecret(text: string): void {
  for (const secret of [
    TOKEN,
    SERVER_ACCOUNT.authToken,
    SERVER_ACCOUNT.accountSid,
    PROJECT_ACCOUNT.authToken,
    PROJECT_ACCOUNT.accountSid,
    STRANGER_ACCOUNT.authToken,
    STRANGER_ACCOUNT.accountSid,
  ]) {
    expect(text).not.toContain(secret);
  }
}

beforeEach(() => {
  environment.Host = "";
  environment.HttpProtocol = "https://";
  globalConfig = serverTwilioRow(SERVER_ACCOUNT);
  projectConfigs = [];

  findGlobalConfig = jest
    .spyOn(GlobalConfigService, "findOneBy")
    .mockImplementation(async (): Promise<GlobalConfig | null> => {
      return globalConfig;
    });
  findConfigs = jest
    .spyOn(ProjectCallSMSConfigService, "findBy")
    .mockImplementation(async (): Promise<Array<ProjectCallSMSConfig>> => {
      return projectConfigs;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the URL Twilio signed", () => {
  test("is the public one: the forwarded scheme and host, the path before the ingress's rewrite, the query - never the fragment", () => {
    expect(getTwilioWebhookUrls(deliveryReport(SERVER_ACCOUNT))).toEqual([
      `${TWILIO_PUBLIC_ORIGIN}/notification/sms/status-callback/${LOG_ID}/${TOKEN}?providerConfig=project`,
    ]);
  });

  test("only the leading /api/notification is the ingress's: the keypad route keeps /api", () => {
    const keypad: WebhookRequest = signedTwilioRequest({
      publicUrl: `/api/user-notification-log-timeline/call/gather-input/${LOG_ID}?pageToken=a&token=b`,
      body: { AccountSid: SERVER_ACCOUNT.accountSid, Digits: "1" },
      signedWith: SERVER_ACCOUNT.authToken,
    }) as unknown as WebhookRequest;

    expect(getTwilioWebhookUrls(keypad)).toEqual([
      `${TWILIO_PUBLIC_ORIGIN}/api/user-notification-log-timeline/call/gather-input/${LOG_ID}?pageToken=a&token=b`,
    ]);
  });

  test("a chain of proxies lists a value a hop: the first is what Twilio used", () => {
    const request: WebhookRequest = deliveryReport(SERVER_ACCOUNT, {
      forwarded: {
        proto: "https, http",
        host: "oneuptime.example.com, ingress.internal",
      },
    });

    expect(getTwilioWebhookUrls(request)[0]).toBe(
      `${TWILIO_PUBLIC_ORIGIN}/notification/sms/status-callback/${LOG_ID}/${TOKEN}?providerConfig=project`,
    );
    expect(isSignedWithAuthToken({ request, authToken: SERVER_ACCOUNT.authToken })).toBe(true);
  });

  test("with nothing forwarded, the request's own scheme and Host header", () => {
    const request: WebhookRequest = deliveryReport(SERVER_ACCOUNT, {
      forwarded: { proto: null, host: null },
    });

    expect(getTwilioWebhookUrls(request)).toEqual([
      `http://app:3002/notification/sms/status-callback/${LOG_ID}/${TOKEN}?providerConfig=project`,
    ]);
  });

  test("and as this server gives it to Twilio, from HOST and HTTP_PROTOCOL - once when the two agree", () => {
    environment.Host = "oneuptime.example.com";

    expect(getTwilioWebhookUrls(deliveryReport(SERVER_ACCOUNT))).toEqual([
      `${TWILIO_PUBLIC_ORIGIN}/notification/sms/status-callback/${LOG_ID}/${TOKEN}?providerConfig=project`,
    ]);

    const request: WebhookRequest = deliveryReport(SERVER_ACCOUNT, {
      forwarded: { proto: null, host: null },
    });

    expect(getTwilioWebhookUrls(request)).toEqual([
      `http://app:3002/notification/sms/status-callback/${LOG_ID}/${TOKEN}?providerConfig=project`,
      `${TWILIO_PUBLIC_ORIGIN}/notification/sms/status-callback/${LOG_ID}/${TOKEN}?providerConfig=project`,
    ]);
  });

  test("a request naming no host, on a server with no HOST, has no URL to check", () => {
    const request: WebhookRequest = deliveryReport(SERVER_ACCOUNT, {
      forwarded: { proto: null, host: null },
      host: "",
    });

    expect(getTwilioWebhookUrls(request)).toEqual([]);
    expect(
      isSignedWithAuthToken({
        request: request,
        authToken: SERVER_ACCOUNT.authToken,
      }),
    ).toBe(false);
  });
});

describe("a signature", () => {
  test("Twilio made with the account's auth token over the public URL is the account's", () => {
    expect(
      isSignedWithAuthToken({
        request: deliveryReport(SERVER_ACCOUNT),
        authToken: SERVER_ACCOUNT.authToken,
      }),
    ).toBe(true);
  });

  test("is read from the X-Twilio-Signature header", () => {
    const request: WebhookRequest = deliveryReport(SERVER_ACCOUNT);

    expect(TWILIO_SIGNATURE_HEADER).toBe("x-twilio-signature");
    expect(getTwilioSignature(request)).toBe(
      getExpectedTwilioSignature(
        SERVER_ACCOUNT.authToken,
        `${TWILIO_PUBLIC_ORIGIN}/notification/sms/status-callback/${LOG_ID}/${TOKEN}?providerConfig=project`,
        request.body as Record<string, string>,
      ),
    );
    expect(
      getTwilioSignature(deliveryReport(SERVER_ACCOUNT, { signedWith: null })),
    ).toBe("");
  });

  test("is no other auth token's", () => {
    expect(
      isSignedWithAuthToken({
        request: deliveryReport(SERVER_ACCOUNT),
        authToken: PROJECT_ACCOUNT.authToken,
      }),
    ).toBe(false);
  });

  test("no longer matches a body changed on the way", () => {
    const request: WebhookRequest = deliveryReport(SERVER_ACCOUNT, {
      signedBody: {
        AccountSid: SERVER_ACCOUNT.accountSid,
        MessageSid: MESSAGE_SID,
        MessageStatus: "delivered",
        ApiVersion: "2010-04-01",
      },
      body: {
        AccountSid: SERVER_ACCOUNT.accountSid,
        MessageSid: MESSAGE_SID,
        MessageStatus: "undelivered",
        ApiVersion: "2010-04-01",
      },
    });

    expect(
      isSignedWithAuthToken({
        request: request,
        authToken: SERVER_ACCOUNT.authToken,
      }),
    ).toBe(false);
  });

  test("no longer matches a path or a query changed on the way", () => {
    const signed: WebhookRequest = deliveryReport(SERVER_ACCOUNT);

    for (const originalUrl of [
      // Another log's callback.
      `/api/notification/sms/status-callback/7c0e0000-0000-4000-8000-0000000000a2/${TOKEN}?providerConfig=project`,
      // The query dropped.
      `/api/notification/sms/status-callback/${LOG_ID}/${TOKEN}`,
      // A prefix a proxy stripped.
      `/sms/status-callback/${LOG_ID}/${TOKEN}?providerConfig=project`,
    ]) {
      expect(
        isSignedWithAuthToken({
          request: { ...signed, originalUrl: originalUrl, url: originalUrl },
          authToken: SERVER_ACCOUNT.authToken,
        }),
      ).toBe(false);
    }
  });

  test("an empty one, or none, is nobody's", () => {
    expect(
      isSignedWithAuthToken({
        request: deliveryReport(SERVER_ACCOUNT, { signedWith: null }),
        authToken: SERVER_ACCOUNT.authToken,
      }),
    ).toBe(false);
    expect(
      isSignedWithAuthToken({
        request: deliveryReport(SERVER_ACCOUNT),
        authToken: SERVER_ACCOUNT.authToken,
        signature: "",
      }),
    ).toBe(false);
    expect(
      isSignedWithAuthToken({
        request: deliveryReport(SERVER_ACCOUNT),
        authToken: "",
      }),
    ).toBe(false);
  });

  test("behind a proxy that forwards neither the public host nor the scheme: checked at the URL HOST and HTTP_PROTOCOL make", () => {
    const request: WebhookRequest = deliveryReport(SERVER_ACCOUNT, {
      forwarded: { proto: null, host: null },
    });

    // Without HOST, the app's own address is all there is to check at.
    expect(
      isSignedWithAuthToken({
        request: request,
        authToken: SERVER_ACCOUNT.authToken,
      }),
    ).toBe(false);

    environment.Host = "oneuptime.example.com";

    expect(
      isSignedWithAuthToken({
        request: request,
        authToken: SERVER_ACCOUNT.authToken,
      }),
    ).toBe(true);
  });

  test("a proxy that forwards an internal scheme and host still passes when HOST is the public one", () => {
    environment.Host = "oneuptime.example.com";

    const request: WebhookRequest = deliveryReport(SERVER_ACCOUNT, {
      forwarded: { proto: "http", host: "oneuptime.internal" },
    });

    expect(
      isSignedWithAuthToken({
        request: request,
        authToken: SERVER_ACCOUNT.authToken,
      }),
    ).toBe(true);
  });

  test("HOST pointing elsewhere - the host changed since the message went out - still passes on the forwarded public URL", () => {
    environment.Host = "status.example.com";

    expect(
      isSignedWithAuthToken({
        request: deliveryReport(SERVER_ACCOUNT),
        authToken: SERVER_ACCOUNT.authToken,
      }),
    ).toBe(true);
  });

  test("HTTP_PROTOCOL of http, as the URL was given to Twilio, is the scheme checked", () => {
    environment.Host = "oneuptime.example.com";
    environment.HttpProtocol = "http://";

    const request: WebhookRequest = deliveryReport(SERVER_ACCOUNT, {
      publicUrl: `http://oneuptime.example.com/notification/sms/status-callback/${LOG_ID}/${TOKEN}`,
      forwarded: { proto: null, host: null },
    });

    expect(
      isSignedWithAuthToken({
        request: request,
        authToken: SERVER_ACCOUNT.authToken,
      }),
    ).toBe(true);
  });

  test("a parameter Twilio posted twice is signed with each of its values", () => {
    const body: Record<string, unknown> = {
      AccountSid: SERVER_ACCOUNT.accountSid,
      CallSid: "CA0123456789abcdef0123456789abcdef",
      StirVerstat: ["TN-Validation-Passed-A", "TN-Validation-Passed-B"],
    };
    const publicUrl: string = `${TWILIO_PUBLIC_ORIGIN}/notification/call/status-callback/${LOG_ID}/${TOKEN}`;
    const request: WebhookRequest = {
      ...deliveryReport(SERVER_ACCOUNT),
      originalUrl: `/api/notification/call/status-callback/${LOG_ID}/${TOKEN}`,
      url: `/notification/call/status-callback/${LOG_ID}/${TOKEN}`,
      body: body as JSONObject,
    };
    request.headers = {
      ...request.headers,
      [TWILIO_SIGNATURE_HEADER]: getExpectedTwilioSignature(
        SERVER_ACCOUNT.authToken,
        publicUrl,
        body,
      ),
    };

    expect(
      isSignedWithAuthToken({
        request: request,
        authToken: SERVER_ACCOUNT.authToken,
      }),
    ).toBe(true);
  });
});

describe("the account that signed a callback", () => {
  test("is the server's own, for a message that went out on it", async () => {
    const result: TwilioSignatureCheck = await check(
      deliveryReport(SERVER_ACCOUNT),
    );

    expect(result.account?.accountSid).toBe(SERVER_ACCOUNT.accountSid);
    expect(result.account?.authToken).toBe(SERVER_ACCOUNT.authToken);
    expect(result.refusalReason).toBeNull();
  });

  test("is the project's own Twilio config, for a message that went out on it - the server's settings are not read", async () => {
    projectConfigs = [projectConfig(PROJECT_ACCOUNT)];

    const result: TwilioSignatureCheck = await check(
      deliveryReport(PROJECT_ACCOUNT),
    );

    expect(result.account?.accountSid).toBe(PROJECT_ACCOUNT.accountSid);
    expect(result.account?.authToken).toBe(PROJECT_ACCOUNT.authToken);
    expect(findGlobalConfig).not.toHaveBeenCalled();
  });

  test("is looked for among the message's own project's configs only, read as root", async () => {
    await check(deliveryReport(SERVER_ACCOUNT));

    expect(findConfigs).toHaveBeenCalledTimes(1);
    const query: JSONObject = (findConfigs.mock.calls[0]![0] as JSONObject)[
      "query"
    ] as JSONObject;
    expect(query).toEqual({ projectId: PROJECT_ID });
    expect(
      (findConfigs.mock.calls[0]![0] as JSONObject)["props"] as JSONObject,
    ).toEqual({ isRoot: true });
  });

  test("of two configs on one account - other numbers, one with a stale token - is the one whose token signed", async () => {
    projectConfigs = [
      projectConfig({ ...PROJECT_ACCOUNT, authToken: "a-rotated-out-token" }),
      projectConfig(PROJECT_ACCOUNT),
    ];

    const result: TwilioSignatureCheck = await check(
      deliveryReport(PROJECT_ACCOUNT),
    );

    expect(result.account?.authToken).toBe(PROJECT_ACCOUNT.authToken);
  });

  test("a project config that cannot be read as an account is passed over, not thrown on", async () => {
    const unreadable: ProjectCallSMSConfig = projectConfig(PROJECT_ACCOUNT);
    delete unreadable.twilioAuthToken;
    projectConfigs = [unreadable];

    const reason: string = expectRefused(
      await check(deliveryReport(PROJECT_ACCOUNT)),
    );

    expect(reason).toContain("neither one of the project's Twilio configs");
  });

  test("a server whose own settings cannot be read still takes a callback on the project's own config", async () => {
    projectConfigs = [projectConfig(PROJECT_ACCOUNT)];
    findGlobalConfig.mockRejectedValue(new Error("Global Config not found"));

    expect(
      (await check(deliveryReport(PROJECT_ACCOUNT))).account?.accountSid,
    ).toBe(PROJECT_ACCOUNT.accountSid);

    // And one on the server's account is refused, not thrown on.
    expectRefused(await check(deliveryReport(SERVER_ACCOUNT)));
  });

  test("a message of no project is checked against the server's own account alone", async () => {
    const result: TwilioSignatureCheck = await check(
      deliveryReport(SERVER_ACCOUNT),
      null,
    );

    expect(result.account?.accountSid).toBe(SERVER_ACCOUNT.accountSid);
    expect(findConfigs).not.toHaveBeenCalled();
  });
});

describe("a callback is refused, and the log is told why - nothing secret in it", () => {
  test("unsigned: nothing is read", async () => {
    const reason: string = expectRefused(
      await check(deliveryReport(SERVER_ACCOUNT, { signedWith: null })),
    );

    expect(reason).toBe(
      "It carries no X-Twilio-Signature header: it is not Twilio's, or a proxy on the way dropped the header.",
    );
    expect(findConfigs).not.toHaveBeenCalled();
    expect(findGlobalConfig).not.toHaveBeenCalled();
  });

  test("naming no account: nothing is read", async () => {
    const reason: string = expectRefused(
      await check(
        deliveryReport(SERVER_ACCOUNT, {
          body: { MessageSid: MESSAGE_SID, MessageStatus: "delivered" },
        }),
      ),
    );

    expect(reason).toContain("It names no Twilio account (no AccountSid)");
    expect(findConfigs).not.toHaveBeenCalled();
    expect(findGlobalConfig).not.toHaveBeenCalled();
  });

  test("signed with another auth token: the account, the URLs it was checked at - its token and query values left out", async () => {
    environment.Host = "oneuptime.example.com";

    const reason: string = expectRefused(
      await check(
        deliveryReport(SERVER_ACCOUNT, {
          signedWith: "an-auth-token-nobody-here-holds",
          forwarded: { proto: "http", host: "oneuptime.internal" },
        }),
      ),
    );

    expect(reason).toBe(
      `Its X-Twilio-Signature does not match the one Twilio account AC…1111 makes for http://oneuptime.internal/notification/sms/status-callback/${LOG_ID}/…?providerConfig=… or https://oneuptime.example.com/notification/sms/status-callback/${LOG_ID}/…?providerConfig=…: the request is not Twilio's, or a proxy on the way changed its host, protocol, path, query or body.`,
    );
    expectNoSecret(reason);
  });

  test("a body changed on the way is refused", async () => {
    const reason: string = expectRefused(
      await check(
        deliveryReport(SERVER_ACCOUNT, {
          signedBody: {
            AccountSid: SERVER_ACCOUNT.accountSid,
            MessageSid: MESSAGE_SID,
            MessageStatus: "delivered",
          },
          body: {
            AccountSid: SERVER_ACCOUNT.accountSid,
            MessageSid: MESSAGE_SID,
            MessageStatus: "failed",
          },
        }),
      ),
    );

    expect(reason).toContain("does not match");
    expectNoSecret(reason);
  });

  test("an account outside the project, signed with its own auth token, is refused", async () => {
    projectConfigs = [projectConfig(PROJECT_ACCOUNT)];

    const reason: string = expectRefused(
      await check(deliveryReport(STRANGER_ACCOUNT)),
    );

    expect(reason).toBe(
      "It names Twilio account AC…3333, which is neither one of the project's Twilio configs nor this server's own Twilio account: nothing it is about went out on that account.",
    );
    expectNoSecret(reason);
  });

  test("another project's config is no account of this project's, even with its own valid token", async () => {
    // The stranger's config is another project's: this project's read returns none of it.
    projectConfigs = [];

    expectRefused(await check(deliveryReport(STRANGER_ACCOUNT)));

    expect(findConfigs).toHaveBeenCalledTimes(1);
  });

  test("of no project, an account that is not the server's is refused", async () => {
    const reason: string = expectRefused(
      await check(deliveryReport(PROJECT_ACCOUNT), null),
    );

    expect(reason).toContain("which is not this server's own Twilio account");
  });

  test("an AccountSid that is not Twilio's form is not repeated", async () => {
    const madeUp: string = "AC\nfake log line: everything is fine";

    const reason: string = expectRefused(
      await check(
        deliveryReport(SERVER_ACCOUNT, {
          body: { AccountSid: madeUp, MessageStatus: "delivered" },
        }),
      ),
    );

    expect(reason).toContain("a Twilio account SID that is not one Twilio makes");
    expect(reason).not.toContain("fake log line");
  });

  test("a request naming no host, on a server with no HOST, says so", async () => {
    const reason: string = expectRefused(
      await check(
        deliveryReport(SERVER_ACCOUNT, {
          forwarded: { proto: null, host: null },
          host: "",
        }),
      ),
    );

    expect(reason).toBe(
      "Its X-Twilio-Signature cannot be checked: the request names no host, and this server's HOST is not set.",
    );
  });
});

describe("what a log line shows", () => {
  test("an account SID: its kind and last four characters", () => {
    expect(describeTwilioAccountSid(SERVER_ACCOUNT.accountSid)).toBe(
      "Twilio account AC…1111",
    );
    expect(describeTwilioAccountSid("AC-server")).toBe(
      "a Twilio account SID that is not one Twilio makes",
    );
  });

  test("a URL: its secrets and every query value left out", () => {
    expect(
      describeTwilioWebhookUrl(
        `${TWILIO_PUBLIC_ORIGIN}/notification/call/status-callback/${LOG_ID}/${TOKEN}?providerConfig=project`,
        [TOKEN],
      ),
    ).toBe(
      `${TWILIO_PUBLIC_ORIGIN}/notification/call/status-callback/${LOG_ID}/…?providerConfig=…`,
    );
    expect(
      describeTwilioWebhookUrl(
        `${TWILIO_PUBLIC_ORIGIN}/api/user-notification-log-timeline/call/gather-input/${LOG_ID}?pageToken=secret-one&token=secret-two`,
      ),
    ).toBe(
      `${TWILIO_PUBLIC_ORIGIN}/api/user-notification-log-timeline/call/gather-input/${LOG_ID}?pageToken=…&token=…`,
    );
    expect(describeTwilioWebhookUrl(`${TWILIO_PUBLIC_ORIGIN}/a/b`, [""])).toBe(
      `${TWILIO_PUBLIC_ORIGIN}/a/b`,
    );
  });

  test("a refusal: one prefix, which the docs tell operators to look for", () => {
    expect(TWILIO_CALLBACK_REFUSED).toBe("Twilio callback refused");
    expect(
      getTwilioCallbackRefusedMessage({
        callback: `the SMS status callback for log ${LOG_ID}`,
        reason: "It carries no X-Twilio-Signature header.",
      }),
    ).toBe(
      `Twilio callback refused: the SMS status callback for log ${LOG_ID}. It carries no X-Twilio-Signature header.`,
    );
  });
});
