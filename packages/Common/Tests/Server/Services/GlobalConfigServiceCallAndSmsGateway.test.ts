import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import GlobalConfigService, {
  Service as GlobalConfigServiceClass,
} from "../../../Server/Services/GlobalConfigService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import SSRFProtection from "../../../Server/Utils/SSRFProtection";
import URL from "../../../Types/API/URL";
import CallAndSmsProviders, {
  CALL_AND_SMS_PROVIDER_TITLE,
  CallAndSmsProvider,
} from "../../../Types/CallAndSMS/CallAndSmsProvider";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * THE SERVER'S SMS AND CALL GATEWAY, AS A MASTER ADMIN SAVES IT.
 *
 * Admin Dashboard > Settings > Call and SMS writes three columns of the one
 * GlobalConfig row: what carries the server's SMS and calls, the gateway's
 * URL and its signing secret. A write that touches any of them leaves a
 * gateway the server can send through:
 *
 *   - what carries them is Twilio or Gateway, nothing else (create too);
 *   - the URL is text or a URL, trimmed, empty is none, and checked as a
 *     webhook's is - the installation's private network allowed, where a
 *     gateway usually is;
 *   - the secret is text, trimmed, empty is none;
 *   - the gateway is never chosen without a URL, stored or written;
 *   - whenever there is a URL there is a secret: made here when there is
 *     none, or when it is cleared - which is how an admin replaces it.
 *
 * The stored row is read as the update's own rows are
 * (findRowsAndHoldUpdateToThem), so the check is made of what the write
 * leaves behind.
 */

interface ServiceHooks {
  onBeforeCreate(
    createBy: CreateBy<GlobalConfig>,
  ): Promise<OnCreate<GlobalConfig>>;
  onBeforeUpdate(
    updateBy: UpdateBy<GlobalConfig>,
  ): Promise<OnUpdate<GlobalConfig>>;
}

const hooks: ServiceHooks = GlobalConfigService as unknown as ServiceHooks;

const STORED_URL: string = "https://sms-gateway.internal.example.com/stored";
const NEW_URL: string = "https://sms-gateway.internal.example.com/new";
const STORED_SECRET: string = "a".repeat(64);
const GENERATED_SECRET: string = "b".repeat(64);

const NO_URL_MESSAGE: string =
  "To send SMS and calls through your own gateway, add its Gateway URL.";

// The three columns, stored or written.
interface GatewayColumns {
  callAndSmsProvider?: unknown;
  callAndSmsGatewayUrl?: unknown;
  callAndSmsGatewaySecret?: unknown;
}

function storedRow(columns: GatewayColumns): GlobalConfig {
  const row: GlobalConfig = new GlobalConfig();
  row._id = ObjectID.getZeroObjectID().toString();
  Object.assign(row, columns);
  return row;
}

function updateBy(data: Record<string, unknown>): UpdateBy<GlobalConfig> {
  return {
    query: { _id: ObjectID.getZeroObjectID().toString() },
    data: data,
    limit: 1,
    skip: 0,
    props: { isRoot: true },
  } as unknown as UpdateBy<GlobalConfig>;
}

let rows: Array<GlobalConfig>;
let findRows: jest.SpyInstance;
let ssrf: jest.SpyInstance;
let generate: jest.SpyInstance;

beforeEach(() => {
  rows = [storedRow({ callAndSmsProvider: "Twilio" })];

  findRows = jest
    .spyOn(GlobalConfigService, "findRowsAndHoldUpdateToThem")
    .mockImplementation((async (): Promise<Array<GlobalConfig>> => {
      return rows;
    }) as never);
  ssrf = jest
    .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
    .mockResolvedValue(undefined);
  generate = jest
    .spyOn(GlobalConfigServiceClass, "generateCallAndSmsGatewaySecret")
    .mockReturnValue(GENERATED_SECRET);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The data the update goes on to write, once the hook has run.
async function written(
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result: OnUpdate<GlobalConfig> = await hooks.onBeforeUpdate(
    updateBy(data),
  );

  return result.updateBy.data as unknown as Record<string, unknown>;
}

async function refusal(data: Record<string, unknown>): Promise<Error> {
  try {
    await hooks.onBeforeUpdate(updateBy(data));
  } catch (err) {
    return err as Error;
  }

  throw new Error("Expected the update to be refused, but it went through.");
}

describe("generateCallAndSmsGatewaySecret", () => {
  test("is 32 random bytes as 64 hex digits, as a custom channel's secret is", () => {
    generate.mockRestore();

    expect(GlobalConfigServiceClass.generateCallAndSmsGatewaySecret()).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  test("is never the same twice", () => {
    generate.mockRestore();

    const secrets: Set<string> = new Set<string>();

    for (let index: number = 0; index < 200; index++) {
      secrets.add(GlobalConfigServiceClass.generateCallAndSmsGatewaySecret());
    }

    expect(secrets.size).toBe(200);
  });
});

describe("what carries the server's SMS and calls", () => {
  test("a create may say Twilio", async () => {
    const row: GlobalConfig = new GlobalConfig();
    row.callAndSmsProvider = CallAndSmsProvider.Twilio;

    await expect(
      hooks.onBeforeCreate({
        data: row,
        props: { isRoot: true },
      } as CreateBy<GlobalConfig>),
    ).resolves.toBeDefined();
  });

  test("a create may say Gateway with a URL: the URL is checked and trimmed, and a secret is made", async () => {
    const row: GlobalConfig = new GlobalConfig();
    row.callAndSmsProvider = CallAndSmsProvider.Gateway;
    row.callAndSmsGatewayUrl = `  ${NEW_URL}  `;

    await hooks.onBeforeCreate({
      data: row,
      props: { isRoot: true },
    } as CreateBy<GlobalConfig>);

    expect(ssrf).toHaveBeenCalledWith(NEW_URL, {
      allowPrivateNetworkTargets: true,
    });
    expect(row.callAndSmsGatewayUrl).toBe(NEW_URL);
    expect(row.callAndSmsGatewaySecret).toBe(GENERATED_SECRET);
    // A create has no stored row to read.
    expect(findRows).not.toHaveBeenCalled();
  });

  test("a create that says Gateway with no URL is refused, as an update would be", async () => {
    const row: GlobalConfig = new GlobalConfig();
    row.callAndSmsProvider = CallAndSmsProvider.Gateway;

    await expect(
      hooks.onBeforeCreate({
        data: row,
        props: { isRoot: true },
      } as CreateBy<GlobalConfig>),
    ).rejects.toThrow(new BadDataException(NO_URL_MESSAGE));
  });

  test("a create keeps a secret it names, trimmed", async () => {
    const row: GlobalConfig = new GlobalConfig();
    row.callAndSmsProvider = CallAndSmsProvider.Gateway;
    row.callAndSmsGatewayUrl = NEW_URL;
    row.callAndSmsGatewaySecret = "  mine  ";

    await hooks.onBeforeCreate({
      data: row,
      props: { isRoot: true },
    } as CreateBy<GlobalConfig>);

    expect(row.callAndSmsGatewaySecret).toBe("mine");
    expect(generate).not.toHaveBeenCalled();
  });

  test("a create whose URL is refused by the SSRF check is refused", async () => {
    ssrf.mockRejectedValueOnce(new BadDataException("not allowed"));

    const row: GlobalConfig = new GlobalConfig();
    row.callAndSmsProvider = CallAndSmsProvider.Gateway;
    row.callAndSmsGatewayUrl = NEW_URL;

    await expect(
      hooks.onBeforeCreate({
        data: row,
        props: { isRoot: true },
      } as CreateBy<GlobalConfig>),
    ).rejects.toThrow("not allowed");
  });

  test("a create that names a null provider starts with Twilio, never null", async () => {
    const row: GlobalConfig = new GlobalConfig();
    (row as unknown as Record<string, unknown>)["callAndSmsProvider"] = null;

    await hooks.onBeforeCreate({
      data: row,
      props: { isRoot: true },
    } as CreateBy<GlobalConfig>);

    expect(row.callAndSmsProvider).toBe(CallAndSmsProvider.Twilio);
  });

  test("a create that says nothing starts with what the column starts with", async () => {
    await expect(
      hooks.onBeforeCreate({
        data: new GlobalConfig(),
        props: { isRoot: true },
      } as CreateBy<GlobalConfig>),
    ).resolves.toBeDefined();
  });

  test.each([["twilio"], ["SMS"], [""], [1], [true], [{}]])(
    "a create that says %p is refused, with the reason",
    async (provider: unknown) => {
      const row: GlobalConfig = new GlobalConfig();
      (row as unknown as Record<string, unknown>)["callAndSmsProvider"] =
        provider;

      await expect(
        hooks.onBeforeCreate({
          data: row,
          props: { isRoot: true },
        } as CreateBy<GlobalConfig>),
      ).rejects.toThrow(
        new BadDataException(
          CallAndSmsProviders.getProviderError(provider) as string,
        ),
      );
    },
  );

  test("an update that says something else is refused before anything is read", async () => {
    const error: Error = await refusal({ callAndSmsProvider: "Plivo" });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(
      `${CALL_AND_SMS_PROVIDER_TITLE} must be "Twilio" or "Gateway", not "Plivo".`,
    );
    expect(findRows).not.toHaveBeenCalled();
    expect(ssrf).not.toHaveBeenCalled();
  });

  test("an update that says something that is not text is refused without repeating it", async () => {
    const error: Error = await refusal({ callAndSmsProvider: { a: 1 } });

    expect(error.message).toBe(
      `${CALL_AND_SMS_PROVIDER_TITLE} must be "Twilio" or "Gateway".`,
    );
  });

  test("the provider is refused before the URL is looked at", async () => {
    const error: Error = await refusal({
      callAndSmsProvider: "SMS",
      callAndSmsGatewayUrl: 42,
    });

    expect(error.message).toContain(CALL_AND_SMS_PROVIDER_TITLE);
  });
});

describe("an update that touches none of the gateway's columns", () => {
  test("is let through as it always was: nothing is read, checked or made", async () => {
    const data: Record<string, unknown> = await written({
      smtpHost: "smtp.example.com",
    });

    expect(findRows).not.toHaveBeenCalled();
    expect(ssrf).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(data).toEqual({ smtpHost: "smtp.example.com" });
  });

  test("even on a server set to the gateway without a URL", async () => {
    rows = [storedRow({ callAndSmsProvider: "Gateway" })];

    await expect(
      written({ disableUserProjectCreation: true }),
    ).resolves.toEqual({ disableUserProjectCreation: true });
    expect(findRows).not.toHaveBeenCalled();
  });
});

describe("the gateway's URL", () => {
  test("is checked as a webhook's is, with the installation's private network allowed", async () => {
    await written({ callAndSmsGatewayUrl: NEW_URL });

    expect(ssrf).toHaveBeenCalledTimes(1);
    expect(ssrf).toHaveBeenCalledWith(NEW_URL, {
      allowPrivateNetworkTargets: true,
    });
  });

  test("is saved without the spaces around it, and checked as saved", async () => {
    const data: Record<string, unknown> = await written({
      callAndSmsGatewayUrl: `  ${NEW_URL}\n`,
    });

    expect(data["callAndSmsGatewayUrl"]).toBe(NEW_URL);
    expect(ssrf).toHaveBeenCalledWith(NEW_URL, {
      allowPrivateNetworkTargets: true,
    });
  });

  test("a URL, as a request's body can carry one, is saved as its text", async () => {
    const url: URL = URL.fromString(NEW_URL);
    const data: Record<string, unknown> = await written({
      callAndSmsGatewayUrl: url,
    });

    expect(typeof data["callAndSmsGatewayUrl"]).toBe("string");
    expect(data["callAndSmsGatewayUrl"]).toBe(url.toString().trim());
    expect(ssrf).toHaveBeenCalledWith(url.toString().trim(), {
      allowPrivateNetworkTargets: true,
    });
  });

  test("an address on the installation's private network is passed to the check, which allows it", async () => {
    await written({ callAndSmsGatewayUrl: "http://10.0.0.5:8080/sms" });

    expect(ssrf).toHaveBeenCalledWith("http://10.0.0.5:8080/sms", {
      allowPrivateNetworkTargets: true,
    });
  });

  test.each([[""], ["   "], ["\n\t"], [null]])(
    "%p is no URL: saved as none, and not checked",
    async (value: unknown) => {
      const data: Record<string, unknown> = await written({
        callAndSmsGatewayUrl: value,
      });

      expect(data["callAndSmsGatewayUrl"]).toBeNull();
      expect(ssrf).not.toHaveBeenCalled();
    },
  );

  test.each([[42], [true], [{ url: NEW_URL }], [[NEW_URL]], [0]])(
    "%p is refused: it is not a web address",
    async (value: unknown) => {
      const error: Error = await refusal({ callAndSmsGatewayUrl: value });

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe("Gateway URL must be a web address.");
      expect(ssrf).not.toHaveBeenCalled();
      expect(findRows).not.toHaveBeenCalled();
    },
  );

  test("a URL the check refuses is refused, and nothing is read or made", async () => {
    ssrf.mockRejectedValue(
      new BadDataException(
        "The URL resolves to a blocked address (169.254.169.254).",
      ),
    );

    const error: Error = await refusal({
      callAndSmsProvider: "Gateway",
      callAndSmsGatewayUrl: "http://169.254.169.254/latest/meta-data",
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(
      "The URL resolves to a blocked address (169.254.169.254).",
    );
    expect(findRows).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("the gateway's signing secret", () => {
  test("is saved without the spaces around it", async () => {
    rows = [
      storedRow({
        callAndSmsProvider: "Gateway",
        callAndSmsGatewayUrl: STORED_URL,
        callAndSmsGatewaySecret: STORED_SECRET,
      }),
    ];

    const data: Record<string, unknown> = await written({
      callAndSmsGatewaySecret: "  my-own-secret \n",
    });

    expect(data["callAndSmsGatewaySecret"]).toBe("my-own-secret");
    expect(generate).not.toHaveBeenCalled();
  });

  test.each([[7], [true], [{ secret: "s" }], [["s"]]])(
    "%p is refused: it is not text",
    async (value: unknown) => {
      const error: Error = await refusal({ callAndSmsGatewaySecret: value });

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe("Gateway Signing Secret must be text.");
      expect(findRows).not.toHaveBeenCalled();
    },
  );

  test.each([[""], ["   "], [null]])(
    "cleared (%p) while the gateway has a URL, a new one is made: how an admin replaces it",
    async (value: unknown) => {
      rows = [
        storedRow({
          callAndSmsProvider: "Gateway",
          callAndSmsGatewayUrl: STORED_URL,
          callAndSmsGatewaySecret: STORED_SECRET,
        }),
      ];

      const data: Record<string, unknown> = await written({
        callAndSmsGatewaySecret: value,
      });

      expect(generate).toHaveBeenCalledTimes(1);
      expect(data["callAndSmsGatewaySecret"]).toBe(GENERATED_SECRET);
    },
  );

  test("the secret made is a real one when nothing stands in for it", async () => {
    generate.mockRestore();
    rows = [storedRow({ callAndSmsProvider: "Twilio" })];

    const data: Record<string, unknown> = await written({
      callAndSmsProvider: "Gateway",
      callAndSmsGatewayUrl: NEW_URL,
    });

    expect(data["callAndSmsGatewaySecret"]).toMatch(/^[0-9a-f]{64}$/);
    expect(data["callAndSmsGatewaySecret"]).not.toBe(STORED_SECRET);
  });

  test("cleared on a server with no gateway URL, it stays cleared", async () => {
    rows = [
      storedRow({
        callAndSmsProvider: "Twilio",
        callAndSmsGatewaySecret: STORED_SECRET,
      }),
    ];

    const data: Record<string, unknown> = await written({
      callAndSmsGatewaySecret: "",
    });

    expect(data["callAndSmsGatewaySecret"]).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("choosing the gateway", () => {
  test("with a URL, saves it and makes the secret the admin copies into the gateway", async () => {
    const data: Record<string, unknown> = await written({
      callAndSmsProvider: "Gateway",
      callAndSmsGatewayUrl: NEW_URL,
    });

    expect(data).toEqual({
      callAndSmsProvider: "Gateway",
      callAndSmsGatewayUrl: NEW_URL,
      callAndSmsGatewaySecret: GENERATED_SECRET,
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  test("without a URL anywhere is refused, with what to add", async () => {
    const error: Error = await refusal({ callAndSmsProvider: "Gateway" });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(NO_URL_MESSAGE);
    expect(generate).not.toHaveBeenCalled();
  });

  test("with an empty URL is refused", async () => {
    const error: Error = await refusal({
      callAndSmsProvider: "Gateway",
      callAndSmsGatewayUrl: "  ",
    });

    expect(error.message).toBe(NO_URL_MESSAGE);
  });

  test("on a server that already holds a URL needs no new one, and keeps its secret", async () => {
    rows = [
      storedRow({
        callAndSmsProvider: "Twilio",
        callAndSmsGatewayUrl: STORED_URL,
        callAndSmsGatewaySecret: STORED_SECRET,
      }),
    ];

    const data: Record<string, unknown> = await written({
      callAndSmsProvider: "Gateway",
    });

    expect(data).toEqual({ callAndSmsProvider: "Gateway" });
    expect(generate).not.toHaveBeenCalled();
    // The stored URL was checked when it was saved.
    expect(ssrf).not.toHaveBeenCalled();
  });

  test("a new URL keeps the stored secret: the gateway's verifier keeps working", async () => {
    rows = [
      storedRow({
        callAndSmsProvider: "Gateway",
        callAndSmsGatewayUrl: STORED_URL,
        callAndSmsGatewaySecret: STORED_SECRET,
      }),
    ];

    const data: Record<string, unknown> = await written({
      callAndSmsGatewayUrl: NEW_URL,
    });

    expect(data).toEqual({ callAndSmsGatewayUrl: NEW_URL });
    expect(generate).not.toHaveBeenCalled();
  });

  test("a secret the admin writes with the URL is kept, not replaced", async () => {
    const data: Record<string, unknown> = await written({
      callAndSmsProvider: "Gateway",
      callAndSmsGatewayUrl: NEW_URL,
      callAndSmsGatewaySecret: "chosen-by-the-admin",
    });

    expect(data["callAndSmsGatewaySecret"]).toBe("chosen-by-the-admin");
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("a server that sends through its gateway", () => {
  beforeEach(() => {
    rows = [
      storedRow({
        callAndSmsProvider: "Gateway",
        callAndSmsGatewayUrl: STORED_URL,
        callAndSmsGatewaySecret: STORED_SECRET,
      }),
    ];
  });

  test.each([[null], [""], ["   "]])(
    "may not clear its URL (%p): it would have nothing to send through",
    async (value: unknown) => {
      const error: Error = await refusal({ callAndSmsGatewayUrl: value });

      expect(error.message).toBe(NO_URL_MESSAGE);
    },
  );

  test("may clear its URL while it goes back to Twilio", async () => {
    const data: Record<string, unknown> = await written({
      callAndSmsProvider: "Twilio",
      callAndSmsGatewayUrl: null,
    });

    expect(data).toEqual({
      callAndSmsProvider: "Twilio",
      callAndSmsGatewayUrl: null,
    });
    expect(generate).not.toHaveBeenCalled();
  });

  test("a provider written as null is the default, Twilio, so clearing the URL with it is let through", async () => {
    const data: Record<string, unknown> = await written({
      callAndSmsProvider: null,
      callAndSmsGatewayUrl: null,
    });

    expect(data).toEqual({
      callAndSmsProvider: "Twilio",
      callAndSmsGatewayUrl: null,
    });
  });

  test("a provider written as null is never stored as null: the column is NOT NULL", async () => {
    const data: Record<string, unknown> = await written({
      callAndSmsProvider: null,
    });

    expect(data["callAndSmsProvider"]).toBe("Twilio");
  });

  test("going back to Twilio keeps the URL and secret, for the next time", async () => {
    const data: Record<string, unknown> = await written({
      callAndSmsProvider: "Twilio",
    });

    expect(data).toEqual({ callAndSmsProvider: "Twilio" });
  });
});

describe("the rows the check is made of", () => {
  test("are the update's own, read with the gateway's three columns", async () => {
    const update: UpdateBy<GlobalConfig> = updateBy({
      callAndSmsProvider: "Gateway",
      callAndSmsGatewayUrl: NEW_URL,
    });

    await hooks.onBeforeUpdate(update);

    expect(findRows).toHaveBeenCalledTimes(1);
    expect(findRows.mock.calls[0]![0]).toBe(update);
    expect(findRows.mock.calls[0]![1]).toEqual({
      callAndSmsProvider: true,
      callAndSmsGatewayUrl: true,
      callAndSmsGatewaySecret: true,
    });
  });

  test("an update that reaches no row refuses nothing and makes nothing", async () => {
    rows = [];

    const data: Record<string, unknown> = await written({
      callAndSmsProvider: "Gateway",
    });

    expect(data).toEqual({ callAndSmsProvider: "Gateway" });
    expect(generate).not.toHaveBeenCalled();
  });

  test("a stored value that is not a provider is read as Twilio: clearing its URL is allowed", async () => {
    rows = [
      storedRow({
        callAndSmsProvider: "gateway",
        callAndSmsGatewayUrl: STORED_URL,
        callAndSmsGatewaySecret: STORED_SECRET,
      }),
    ];

    await expect(written({ callAndSmsGatewayUrl: "" })).resolves.toEqual({
      callAndSmsGatewayUrl: null,
    });
  });
});

/*
 * Every combination of what is stored and what is written, against the rule
 * as the docs and the card state it - worked out here on its own, not by
 * calling the service's code.
 */
describe("every combination of stored and written columns", () => {
  const URL_OBJECT: URL = URL.fromString(NEW_URL);

  const WRITTEN_PROVIDERS: Array<unknown> = [
    undefined,
    null,
    "Twilio",
    "Gateway",
    "SMS",
  ];
  const STORED_PROVIDERS: Array<unknown> = [
    "Twilio",
    "Gateway",
    undefined,
    "gateway",
  ];
  const STORED_URLS: Array<unknown> = [undefined, STORED_URL];
  const WRITTEN_URLS: Array<unknown> = [
    undefined,
    null,
    "",
    "   ",
    `  ${NEW_URL}  `,
    URL_OBJECT,
  ];
  const STORED_SECRETS: Array<unknown> = [undefined, STORED_SECRET];
  const WRITTEN_SECRETS: Array<unknown> = [undefined, null, "", "  mine  "];

  interface Expected {
    refused: string | null;
    read: boolean;
    checked: string | null;
    data: Record<string, unknown>;
  }

  function expectedOutcome(
    stored: GatewayColumns,
    data: GatewayColumns,
  ): Expected {
    const providerError: string | null = CallAndSmsProviders.getProviderError(
      data.callAndSmsProvider,
    );

    if (providerError) {
      return { refused: providerError, read: false, checked: null, data: {} };
    }

    if (
      data.callAndSmsProvider === undefined &&
      data.callAndSmsGatewayUrl === undefined &&
      data.callAndSmsGatewaySecret === undefined
    ) {
      return { refused: null, read: false, checked: null, data: {} };
    }

    const result: Record<string, unknown> = {};

    // A provider written as null is stored as the default, Twilio (NOT NULL).
    if (data.callAndSmsProvider !== undefined) {
      result["callAndSmsProvider"] =
        data.callAndSmsProvider === null ? "Twilio" : data.callAndSmsProvider;
    }

    let writtenUrl: string | null | undefined = undefined;

    if (data.callAndSmsGatewayUrl !== undefined) {
      const text: string =
        data.callAndSmsGatewayUrl === null
          ? ""
          : String(data.callAndSmsGatewayUrl).trim();

      writtenUrl = text || null;
      result["callAndSmsGatewayUrl"] = writtenUrl;
    }

    let writtenSecret: string | null | undefined = undefined;

    if (data.callAndSmsGatewaySecret !== undefined) {
      writtenSecret = String(data.callAndSmsGatewaySecret || "").trim() || null;
      result["callAndSmsGatewaySecret"] = writtenSecret;
    }

    const provider: unknown =
      data.callAndSmsProvider === undefined
        ? stored.callAndSmsProvider
        : result["callAndSmsProvider"];
    const url: unknown =
      writtenUrl !== undefined ? writtenUrl : stored.callAndSmsGatewayUrl;
    const secret: unknown =
      writtenSecret !== undefined
        ? writtenSecret
        : stored.callAndSmsGatewaySecret;

    const checked: string | null = writtenUrl ? writtenUrl : null;

    if (provider === "Gateway" && !url) {
      return { refused: NO_URL_MESSAGE, read: true, checked, data: {} };
    }

    if (url && !secret) {
      result["callAndSmsGatewaySecret"] = GENERATED_SECRET;
    }

    return { refused: null, read: true, checked, data: result };
  }

  test("each one is refused, or saved, exactly as the rule says", async () => {
    let combinations: number = 0;

    for (const storedProvider of STORED_PROVIDERS) {
      for (const storedUrl of STORED_URLS) {
        for (const storedSecret of STORED_SECRETS) {
          for (const writtenProvider of WRITTEN_PROVIDERS) {
            for (const writtenUrl of WRITTEN_URLS) {
              for (const writtenSecret of WRITTEN_SECRETS) {
                combinations++;

                const stored: GatewayColumns = {};

                if (storedProvider !== undefined) {
                  stored.callAndSmsProvider = storedProvider;
                }

                if (storedUrl !== undefined) {
                  stored.callAndSmsGatewayUrl = storedUrl;
                }

                if (storedSecret !== undefined) {
                  stored.callAndSmsGatewaySecret = storedSecret;
                }

                const data: Record<string, unknown> = {};

                if (writtenProvider !== undefined) {
                  data["callAndSmsProvider"] = writtenProvider;
                }

                if (writtenUrl !== undefined) {
                  data["callAndSmsGatewayUrl"] = writtenUrl;
                }

                if (writtenSecret !== undefined) {
                  data["callAndSmsGatewaySecret"] = writtenSecret;
                }

                const expected: Expected = expectedOutcome(stored, {
                  ...data,
                });

                rows = [storedRow(stored)];
                findRows.mockClear();
                ssrf.mockClear();

                let refused: string | null = null;
                let after: Record<string, unknown> = {};

                try {
                  // A copy: the hook writes what it saves back into the data.
                  after = await written({ ...data });
                } catch (err) {
                  refused = (err as Error).message;
                }

                const actual: Expected = {
                  refused: refused,
                  read: findRows.mock.calls.length > 0,
                  checked:
                    ssrf.mock.calls.length > 0
                      ? (ssrf.mock.calls[0]![0] as string)
                      : null,
                  data: refused || !expected.read ? {} : after,
                };

                expect({ stored, written: data, ...actual }).toEqual({
                  stored,
                  written: data,
                  ...expected,
                });
              }
            }
          }
        }
      }
    }

    expect(combinations).toBe(
      STORED_PROVIDERS.length *
        STORED_URLS.length *
        STORED_SECRETS.length *
        WRITTEN_PROVIDERS.length *
        WRITTEN_URLS.length *
        WRITTEN_SECRETS.length,
    );
  });
});
