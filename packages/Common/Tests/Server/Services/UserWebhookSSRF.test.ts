import UserWebhookService from "../../../Server/Services/UserWebhookService";
import SSRFProtection from "../../../Server/Utils/SSRFProtection";
import URL from "../../../Types/API/URL";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import dns from "dns";

/*
 * UserWebhookService used to carry its own copy of the SSRF blocklist, and the
 * copy had drifted weaker than the original: it compared the host with the
 * port still attached (so "169.254.169.254:80" slipped through), never
 * resolved DNS, and only ran on create. Nothing depended on it — every sender
 * goes through WebhookService, which calls the real guard — but a weakened
 * lookalike reads as "this is checked".
 *
 * These tests assert both hooks now call the canonical guard, including the
 * cases the local copy got wrong.
 */

type LookupSpy = jest.SpiedFunction<
  (
    hostname: string,
    options: { all: true },
  ) => Promise<Array<{ address: string; family: number }>>
>;

interface WebhookCreate {
  data: { webhookUrl?: URL | undefined; name?: string | undefined };
}

interface WebhookUpdate {
  data: { webhookUrl?: URL | undefined };
}

type CallCreate = (create: WebhookCreate) => Promise<unknown>;

const callOnBeforeCreate: CallCreate = (
  create: WebhookCreate,
): Promise<unknown> => {
  return (
    UserWebhookService as unknown as {
      onBeforeCreate: (c: WebhookCreate) => Promise<unknown>;
    }
  ).onBeforeCreate(create);
};

type CallUpdate = (update: WebhookUpdate) => Promise<unknown>;

const callOnBeforeUpdate: CallUpdate = (
  update: WebhookUpdate,
): Promise<unknown> => {
  return (
    UserWebhookService as unknown as {
      onBeforeUpdate: (u: WebhookUpdate) => Promise<unknown>;
    }
  ).onBeforeUpdate(update);
};

let lookupSpy: LookupSpy;

beforeEach(() => {
  lookupSpy = jest.spyOn(dns.promises, "lookup") as unknown as LookupSpy;
  lookupSpy.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("UserWebhookService no longer carries its own SSRF check", () => {
  test("the weakened local helper is gone", () => {
    expect(
      (UserWebhookService as unknown as { validateWebhookUrl?: unknown })
        .validateWebhookUrl,
    ).toBeUndefined();
  });

  test("onBeforeCreate delegates to SSRFProtection", async () => {
    const guardSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      SSRFProtection,
      "validateWebhookTargetIsSafe",
    );

    await callOnBeforeCreate({
      data: {
        webhookUrl: URL.fromString("https://hooks.example.com/x"),
        name: "test",
      },
    });

    expect(guardSpy).toHaveBeenCalled();
  });
});

describe("UserWebhookService rejects internal webhook URLs on create", () => {
  const blockedUrls: Array<string> = [
    "http://127.0.0.1/webhook",
    "http://169.254.169.254/latest/meta-data/",
    // The port-glue case the local copy let through.
    "http://169.254.169.254:80/latest/meta-data/",
    "http://localhost:3000/webhook",
    "http://10.0.0.5/webhook",
    "http://[::1]/webhook",
  ];

  test.each(blockedUrls)("rejects %s", async (rawUrl: string) => {
    await expect(
      callOnBeforeCreate({
        data: { webhookUrl: URL.fromString(rawUrl), name: "test" },
      }),
    ).rejects.toThrow();
  });

  test("rejects a public hostname that resolves to an internal address", async () => {
    // The DNS branch the local copy never had.
    lookupSpy.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);

    await expect(
      callOnBeforeCreate({
        data: {
          webhookUrl: URL.fromString("https://rebind.attacker.example/x"),
          name: "test",
        },
      }),
    ).rejects.toThrow();
  });

  test("allows a public webhook URL", async () => {
    await expect(
      callOnBeforeCreate({
        data: {
          webhookUrl: URL.fromString("https://hooks.example.com/x"),
          name: "test",
        },
      }),
    ).resolves.toBeDefined();
  });
});

describe("UserWebhookService validates on update too", () => {
  const blockedUrls: Array<string> = [
    "http://127.0.0.1/webhook",
    "http://169.254.169.254:80/latest/meta-data/",
    "http://10.0.0.5/webhook",
  ];

  test.each(blockedUrls)(
    "rejects an update repointing the webhook at %s",
    async (rawUrl: string) => {
      await expect(
        callOnBeforeUpdate({ data: { webhookUrl: URL.fromString(rawUrl) } }),
      ).rejects.toThrow();
    },
  );

  test("allows an update to a public URL", async () => {
    await expect(
      callOnBeforeUpdate({
        data: { webhookUrl: URL.fromString("https://hooks.example.com/x") },
      }),
    ).resolves.toBeDefined();
  });

  test("leaves an update that does not touch the URL alone", async () => {
    await expect(callOnBeforeUpdate({ data: {} })).resolves.toBeDefined();
    expect(lookupSpy).not.toHaveBeenCalled();
  });
});
