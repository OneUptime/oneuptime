import StatusPageSubscriberWebhookUtil, {
  SIGN_UP_PRIVATE_NETWORK_HINT,
  SIGNED_UP_SUBSCRIBER_PRIVATE_NETWORK_HINT,
  StatusPageWebhookPayload,
} from "../../../Server/Utils/StatusPageSubscriberWebhook";
import { WEBHOOK_PRIVATE_NETWORK_HINT } from "../../../Server/Utils/SSRFProtection";
import API from "../../../Utils/API";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import dns from "dns";

jest.mock("../../../Server/Utils/Logger");

/*
 * WHAT A STATUS PAGE SUBSCRIBER'S WEBHOOK MAY REACH, BY WHO WROTE ITS URL
 * (issue #6589).
 *
 * A subscriber that signed up on the status page: anyone who can load a
 * public status page can sign one up, with any URL. Its webhook reaches
 * public addresses only, however the instance is configured - relaxing it
 * would hand every visitor on the internet a POST into the operator's
 * private network. These tests turn the instance settings all the way up
 * and assert nothing moves for it.
 *
 * A subscriber the team added - from the dashboard, with an API key, or by a
 * workflow - carries a URL a project member wrote, like a project webhook's
 * or a workflow's, and is held to the same rule as those: private addresses
 * once the operator allows them (ALLOW_PRIVATE_NETWORK_WEBHOOKS,
 * PRIVATE_NETWORK_WEBHOOK_ALLOWLIST), refused with the settings named when
 * the operator has not. Loopback, link-local and the cloud metadata endpoint
 * stay refused unless the allowlist names them exactly, as for every other
 * webhook.
 *
 * And each refusal says what applies to the one who reads it: the visitor is
 * told to use a public URL, never about the instance's settings; the team
 * reading why a sign-up's webhook was refused is told that it signed up.
 */

const ALLOW_ENV: string = "ALLOW_PRIVATE_NETWORK_WEBHOOKS";
const ALLOWLIST_ENV: string = "PRIVATE_NETWORK_WEBHOOK_ALLOWLIST";
const BLOCK_ENV: string = "DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES";
const BILLING_ENV: string = "BILLING_ENABLED";

const PRIVATE_REFUSAL: string =
  "Webhook URL points to a private network address and is not allowed.";
const PRIVATE_RESOLVED_REFUSAL: string =
  "Webhook URL resolves to a private network address and is not allowed.";
const FORBIDDEN_REFUSAL: string =
  "Webhook URL points to a private, loopback, or link-local address and is not allowed.";

const payload: StatusPageWebhookPayload = {
  eventType: "IncidentCreated",
  statusPageId: "status-page-id",
  statusPageName: "Status Page",
  statusPageUrl: "https://status.example.com",
  unsubscribeUrl: "https://status.example.com/unsubscribe",
  data: {},
};

// What DNS answers, by host. A host not named here does not resolve.
let dnsAnswers: Record<string, string> = {};
let lookupSpy: jest.SpiedFunction<typeof dns.promises.lookup>;
let postSpy: jest.SpiedFunction<typeof API.post>;
const savedEnv: Record<string, string | undefined> = {};

function setInstance(settings: {
  allowPrivateNetwork?: boolean;
  allowlist?: string;
}): void {
  if (settings.allowPrivateNetwork) {
    process.env[ALLOW_ENV] = "true";
  } else {
    delete process.env[ALLOW_ENV];
  }

  if (settings.allowlist) {
    process.env[ALLOWLIST_ENV] = settings.allowlist;
  } else {
    delete process.env[ALLOWLIST_ENV];
  }
}

// The instance's settings turned all the way up.
function setInstanceWideOpen(): void {
  setInstance({
    allowPrivateNetwork: true,
    allowlist:
      "mattermost.internal, 10.0.0.0/8, 127.0.0.1, 169.254.169.254, *.svc.cluster.local",
  });
}

async function send(
  url: string,
  isAddedByTeam: boolean | undefined,
): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
  return await StatusPageSubscriberWebhookUtil.sendWebhookNotification({
    webhookUrl: URL.fromString(url),
    isAddedByTeam: isAddedByTeam,
    payload,
  });
}

function refusalMessage(
  result: HTTPResponse<JSONObject> | HTTPErrorResponse,
): string {
  expect(result).toBeInstanceOf(HTTPErrorResponse);
  return String((result as HTTPErrorResponse).message);
}

async function refusalOf(action: Promise<unknown>): Promise<string | null> {
  try {
    await action;
    return null;
  } catch (err) {
    expect(err).toBeInstanceOf(BadDataException);
    return (err as Error).message;
  }
}

beforeEach(() => {
  for (const name of [ALLOW_ENV, ALLOWLIST_ENV, BLOCK_ENV, BILLING_ENV]) {
    savedEnv[name] = process.env[name];
  }

  // A self-hosted install, where refusals the team reads keep their detail.
  delete process.env[BLOCK_ENV];
  delete process.env[BILLING_ENV];
  setInstance({});

  dnsAnswers = {
    "hooks.example.com": "93.184.216.34",
    "hooks.corp.example": "10.20.30.40",
    "mattermost.internal": "10.1.2.3",
    "mattermost.svc.cluster.local": "10.96.0.12",
    "loopback.example": "127.0.0.1",
  };

  lookupSpy = jest.spyOn(dns.promises, "lookup").mockImplementation((async (
    hostname: string,
  ) => {
    const address: string | undefined = dnsAnswers[hostname];

    if (!address) {
      const error: NodeJS.ErrnoException = new Error(
        `getaddrinfo ENOTFOUND ${hostname}`,
      );
      error.code = "ENOTFOUND";
      throw error;
    }

    return [{ address: address, family: address.includes(":") ? 6 : 4 }];
  }) as never) as unknown as jest.SpiedFunction<typeof dns.promises.lookup>;

  postSpy = jest
    .spyOn(API, "post")
    .mockResolvedValue(
      new HTTPResponse<JSONObject>(200, {}, {}) as never,
    ) as unknown as jest.SpiedFunction<typeof API.post>;
});

afterEach(() => {
  jest.restoreAllMocks();

  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe("a subscriber that signed up on the status page ignores the private network exception", () => {
  beforeEach(() => {
    setInstanceWideOpen();
  });

  test.each([
    "http://10.0.0.5/subscriber-hook",
    "http://192.168.1.10/subscriber-hook",
    "http://100.64.0.1/subscriber-hook",
    "http://[fd00::1]/subscriber-hook",
    "http://127.0.0.1:9000/subscriber-hook",
    "http://mattermost.internal/hooks/abc",
    "http://mattermost.svc.cluster.local/hooks/abc",
    "http://hooks.corp.example/hook",
    "http://169.254.169.254/latest/meta-data/",
  ])("refuses %s and never issues the request", async (url: string) => {
    for (const isAddedByTeam of [false, undefined]) {
      const result: HTTPResponse<JSONObject> | HTTPErrorResponse = await send(
        url,
        isAddedByTeam,
      );

      expect(result).toBeInstanceOf(HTTPErrorResponse);
    }

    expect(postSpy).not.toHaveBeenCalled();
  });

  test("still sends to a public target", async () => {
    const result: HTTPResponse<JSONObject> | HTTPErrorResponse = await send(
      "https://hooks.example.com/subscriber",
      false,
    );

    expect(result).toBeInstanceOf(HTTPResponse);
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  /*
   * The flag is written by OneUptime alone, but a sender that read it
   * wrongly - a value that is not a boolean - must fall to the strict side.
   */
  test.each([["true"], [1], [null], [{}]])(
    "a value of Is Added By Team that is not exactly true (%j) is a sign-up's",
    async (value: unknown) => {
      const result: HTTPResponse<JSONObject> | HTTPErrorResponse = await send(
        "http://10.0.0.5/subscriber-hook",
        value as boolean,
      );

      expect(result).toBeInstanceOf(HTTPErrorResponse);
      expect(postSpy).not.toHaveBeenCalled();
    },
  );
});

describe("a subscriber the team added follows the instance's private network settings", () => {
  describe("on an instance that allows private networks", () => {
    beforeEach(() => {
      setInstance({ allowPrivateNetwork: true });
    });

    test.each([
      "http://10.0.0.5/hook",
      "http://172.16.4.2/hook",
      "http://192.168.1.10/hook",
      "http://100.64.0.1/hook",
      "http://[fd00::1]/hook",
      // The issue's case: a host name that resolves into the private range.
      "http://hooks.corp.example/hook",
      "http://mattermost.svc.cluster.local/hooks/abc",
    ])("sends to %s", async (url: string) => {
      const result: HTTPResponse<JSONObject> | HTTPErrorResponse = await send(
        url,
        true,
      );

      expect(result).toBeInstanceOf(HTTPResponse);
      expect(postSpy).toHaveBeenCalledTimes(1);
      expect(String(postSpy.mock.calls[0]![0].url)).toBe(
        URL.fromString(url).toString(),
      );
    });

    test("never follows a redirect, wherever it is sent", async () => {
      await send("http://10.0.0.5/hook", true);

      expect(postSpy.mock.calls[0]![0].options).toEqual(
        expect.objectContaining({ doNotFollowRedirects: true }),
      );
    });

    test.each([
      ["http://127.0.0.1:9000/hook", FORBIDDEN_REFUSAL],
      ["http://localhost:9000/hook", FORBIDDEN_REFUSAL],
      ["http://[::1]/hook", FORBIDDEN_REFUSAL],
      ["http://169.254.169.254/latest/meta-data/", FORBIDDEN_REFUSAL],
      ["http://metadata.google.internal/", FORBIDDEN_REFUSAL],
      [
        "http://loopback.example/hook",
        "Webhook URL resolves to a private, loopback, or link-local address and is not allowed.",
      ],
    ])(
      "still refuses %s: loopback, link-local and metadata are never in the private tier",
      async (url: string, message: string) => {
        const result: HTTPResponse<JSONObject> | HTTPErrorResponse = await send(
          url,
          true,
        );

        expect(refusalMessage(result)).toBe(message);
        expect(postSpy).not.toHaveBeenCalled();
      },
    );
  });

  describe("on an instance whose allowlist names the target", () => {
    test("a host name it names is sent to, without the blanket switch and without a DNS check", async () => {
      setInstance({ allowlist: "mattermost.internal" });

      const result: HTTPResponse<JSONObject> | HTTPErrorResponse = await send(
        "http://mattermost.internal/hooks/abc",
        true,
      );

      expect(result).toBeInstanceOf(HTTPResponse);
      expect(postSpy).toHaveBeenCalledTimes(1);
      expect(lookupSpy).not.toHaveBeenCalledWith(
        "mattermost.internal",
        expect.anything(),
      );
    });

    test("an address range it names lets in a name that resolves inside it, and nothing outside it", async () => {
      setInstance({ allowlist: "10.20.0.0/16" });

      expect(await send("http://hooks.corp.example/hook", true)).toBeInstanceOf(
        HTTPResponse,
      );

      expect(refusalMessage(await send("http://192.168.1.10/hook", true))).toBe(
        `${PRIVATE_REFUSAL}${WEBHOOK_PRIVATE_NETWORK_HINT}`,
      );

      expect(postSpy).toHaveBeenCalledTimes(1);
    });

    test("loopback is let through only by its exact entry, as for every other webhook", async () => {
      setInstance({ allowlist: "127.0.0.1" });

      expect(await send("http://127.0.0.1:9000/hook", true)).toBeInstanceOf(
        HTTPResponse,
      );
      expect(refusalMessage(await send("http://127.0.0.2/hook", true))).toBe(
        FORBIDDEN_REFUSAL,
      );
    });
  });

  describe("on an instance that allows nothing", () => {
    test.each([
      ["http://10.0.0.5/hook", PRIVATE_REFUSAL],
      ["http://hooks.corp.example/hook", PRIVATE_RESOLVED_REFUSAL],
    ])(
      "refuses %s and names the settings that would allow it - which now would",
      async (url: string, refusal: string) => {
        const result: HTTPResponse<JSONObject> | HTTPErrorResponse = await send(
          url,
          true,
        );

        expect(refusalMessage(result)).toBe(
          `${refusal} Self-hosted instances can allow this by setting ALLOW_PRIVATE_NETWORK_WEBHOOKS or PRIVATE_NETWORK_WEBHOOK_ALLOWLIST.`,
        );
        expect(postSpy).not.toHaveBeenCalled();
      },
    );

    test("still sends to a public target", async () => {
      expect(
        await send("https://hooks.example.com/subscriber", true),
      ).toBeInstanceOf(HTTPResponse);
      expect(postSpy).toHaveBeenCalledTimes(1);
    });
  });
});

describe("what a refusal says, and to whom", () => {
  test("a send to a sign-up's private webhook says why the instance's setting does not apply, and names no setting", async () => {
    setInstanceWideOpen();

    const message: string = refusalMessage(
      await send("http://10.0.0.5/hook", false),
    );

    expect(message).toBe(
      `${PRIVATE_REFUSAL} This subscriber signed up on the status page, so its webhook must be on the public internet.`,
    );
    expect(message).toBe(
      `${PRIVATE_REFUSAL}${SIGNED_UP_SUBSCRIBER_PRIVATE_NETWORK_HINT}`,
    );
    expect(message).not.toContain("ALLOW_PRIVATE_NETWORK_WEBHOOKS");
    expect(message).not.toContain("PRIVATE_NETWORK_WEBHOOK_ALLOWLIST");
  });

  test("the team reading why a sign-up's webhook was refused is told what its host name resolved to", async () => {
    expect(
      refusalMessage(await send("http://hooks.corp.example/hook", false)),
    ).toBe(
      `${PRIVATE_RESOLVED_REFUSAL}${SIGNED_UP_SUBSCRIBER_PRIVATE_NETWORK_HINT}`,
    );
  });

  describe("a visitor signing up", () => {
    const signUpRefusal: (url: string) => Promise<string | null> = (
      url: string,
    ): Promise<string | null> => {
      return refusalOf(
        StatusPageSubscriberWebhookUtil.assertWebhookUrlAllowed({
          webhookUrl: url,
          isAddedByTeam: false,
          isRefusalShownToVisitor: true,
        }),
      );
    };

    test("is told to use a public URL, and nothing about the instance's settings, however it is configured", async () => {
      for (const configure of [
        (): void => {
          setInstance({});
        },
        setInstanceWideOpen,
      ]) {
        configure();

        const message: string | null = await signUpRefusal(
          "http://10.0.0.5/hook",
        );

        expect(message).toBe(
          `${PRIVATE_REFUSAL} Use a webhook URL on the public internet.`,
        );
        expect(message).toBe(
          `${PRIVATE_REFUSAL}${SIGN_UP_PRIVATE_NETWORK_HINT}`,
        );
        expect(message).not.toContain("ALLOW_PRIVATE_NETWORK_WEBHOOKS");
      }
    });

    /*
     * A visitor is not a member of the project, so even on a self-hosted
     * install - where the team's refusals say what DNS answered - the
     * status page must not tell them which internal names exist.
     */
    test("a host name that resolves privately and one that does not resolve at all read the same", async () => {
      const resolvesPrivately: string | null = await signUpRefusal(
        "http://hooks.corp.example/hook",
      );
      const doesNotResolve: string | null = await signUpRefusal(
        "http://no-such-host.corp.example/hook",
      );

      expect(resolvesPrivately).toBe("Webhook URL could not be reached.");
      expect(doesNotResolve).toBe(resolvesPrivately);
    });

    test("a public URL is taken", async () => {
      expect(
        await signUpRefusal("https://hooks.example.com/subscriber"),
      ).toBeNull();
    });

    test("loopback and metadata are refused in the same words as ever", async () => {
      expect(await signUpRefusal("http://127.0.0.1/hook")).toBe(
        FORBIDDEN_REFUSAL,
      );
      expect(await signUpRefusal("http://169.254.169.254/latest/")).toBe(
        FORBIDDEN_REFUSAL,
      );
    });
  });

  test("the team adding a host name that does not resolve is told so, on a self-hosted install", async () => {
    expect(
      await refusalOf(
        StatusPageSubscriberWebhookUtil.assertWebhookUrlAllowed({
          webhookUrl: "http://no-such-host.corp.example/hook",
          isAddedByTeam: true,
        }),
      ),
    ).toBe("Webhook URL hostname could not be resolved via DNS.");
  });
});

describe("getTargetValidationOptions", () => {
  test("a subscriber the team added opts in, and says nothing else", () => {
    expect(
      StatusPageSubscriberWebhookUtil.getTargetValidationOptions({
        isAddedByTeam: true,
      }),
    ).toEqual({ allowPrivateNetworkTargets: true });

    // Who reads the refusal does not change what the team's URL may reach.
    expect(
      StatusPageSubscriberWebhookUtil.getTargetValidationOptions({
        isAddedByTeam: true,
        isRefusalShownToVisitor: true,
      }),
    ).toEqual({ allowPrivateNetworkTargets: true });
  });

  test("a sign-up never opts in", () => {
    for (const isAddedByTeam of [false, undefined]) {
      for (const isRefusalShownToVisitor of [true, false, undefined]) {
        expect(
          StatusPageSubscriberWebhookUtil.getTargetValidationOptions({
            isAddedByTeam,
            isRefusalShownToVisitor,
          }).allowPrivateNetworkTargets,
        ).toBeUndefined();
      }
    }
  });

  test("a visitor's refusal leaves out what DNS answered; the team's keeps the deployment's default", () => {
    expect(
      StatusPageSubscriberWebhookUtil.getTargetValidationOptions({
        isAddedByTeam: false,
        isRefusalShownToVisitor: true,
      }),
    ).toEqual({
      privateNetworkHint: SIGN_UP_PRIVATE_NETWORK_HINT,
      includeResolutionDetailInError: false,
    });

    expect(
      StatusPageSubscriberWebhookUtil.getTargetValidationOptions({
        isAddedByTeam: false,
      }),
    ).toEqual({
      privateNetworkHint: SIGNED_UP_SUBSCRIBER_PRIVATE_NETWORK_HINT,
    });
  });

  test("each hint is a sentence of its own, appended to the refusal's", () => {
    for (const hint of [
      SIGN_UP_PRIVATE_NETWORK_HINT,
      SIGNED_UP_SUBSCRIBER_PRIVATE_NETWORK_HINT,
    ]) {
      expect(hint.startsWith(" ")).toBe(true);
      expect(hint.trim().endsWith(".")).toBe(true);
    }
  });
});
