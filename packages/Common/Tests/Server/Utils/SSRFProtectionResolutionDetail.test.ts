import SSRFProtection, {
  WebhookTargetValidationOptions,
} from "../../../Server/Utils/SSRFProtection";
import logger from "../../../Server/Utils/Logger";
import BadDataException from "../../../Types/Exception/BadDataException";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import dns from "dns";
import type { SpyInstance } from "jest-mock";
import { startEachTestOnSelfHostedEgressPolicy } from "./EgressPolicyEnvironment";

/*
 * What a DNS-decided refusal is allowed to say.
 *
 * Webhook URLs, workflow API URLs and sandboxed axios requests are typed by
 * project members (and, for status page subscriber webhooks, by anyone), and
 * the refusal is shown straight back to them. "could not be resolved via DNS"
 * next to "resolves to a private network address" is a DNS oracle: try
 * `http://redis/` and `http://oneuptime-postgresql/`, compare, and learn which
 * internal names exist without a request ever being sent.
 *
 * So on SaaS (and wherever an operator forces SaaS policy) every refusal that
 * depended on the DNS answer is one sentence, while a self-hosted operator
 * keeps the precise messages.
 */

type LookupSpy = jest.SpiedFunction<
  (
    hostname: string,
    options: { all: true },
  ) => Promise<Array<{ address: string; family: number }>>
>;

const BILLING_ENV: string = "BILLING_ENABLED";
const BLOCK_PRIVATE_ENV: string = "DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES";

const INTERNAL_NAME: string = "http://oneuptime-postgresql/hook";
const SECRET_ADDRESS: string = "10.96.4.17";

type Validate = (
  url: string,
  options?: WebhookTargetValidationOptions,
) => Promise<unknown>;

/*
 * Both entry points: the webhook sinks use the first, the sandboxed axios
 * bridge (workflow Custom JavaScript and the probe's custom code monitor) the
 * second.
 */
const ENTRY_POINTS: Array<[string, Validate]> = [
  [
    "validateWebhookTargetIsSafe",
    (url: string, options?: WebhookTargetValidationOptions) => {
      return SSRFProtection.validateWebhookTargetIsSafe(url, options);
    },
  ],
  [
    "validateAndResolveWebhookTarget",
    (url: string, options?: WebhookTargetValidationOptions) => {
      return SSRFProtection.validateAndResolveWebhookTarget(url, options);
    },
  ],
];

interface RefusalFingerprint {
  constructorName: string;
  message: string;
  ownProperties: string;
}

async function refusalOf(
  validation: Promise<unknown>,
): Promise<RefusalFingerprint> {
  let caught: unknown = undefined;

  try {
    await validation;
  } catch (err) {
    caught = err;
  }

  expect(caught).toBeInstanceOf(BadDataException);

  const error: Error = caught as Error;
  const ownProperties: Record<string, unknown> = {};

  for (const key of Object.keys(error).sort()) {
    if (key !== "stack") {
      ownProperties[key] = (error as unknown as Record<string, unknown>)[key];
    }
  }

  return {
    constructorName: error.constructor.name,
    message: error.message,
    ownProperties: JSON.stringify(ownProperties),
  };
}

startEachTestOnSelfHostedEgressPolicy();

describe("SSRFProtection — how much a DNS-decided refusal says", () => {
  let lookupSpy: LookupSpy;

  beforeEach(() => {
    lookupSpy = jest.spyOn(dns.promises, "lookup") as unknown as LookupSpy;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  type Answer = () => void;

  const answers: Record<string, Answer> = {
    "does not resolve": () => {
      lookupSpy.mockRejectedValue(
        new Error(`getaddrinfo ENOTFOUND oneuptime-postgresql`),
      );
    },
    "resolves to a private address": () => {
      lookupSpy.mockResolvedValue([{ address: SECRET_ADDRESS, family: 4 }]);
    },
    "resolves to loopback": () => {
      lookupSpy.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    },
    "resolves to the metadata endpoint": () => {
      lookupSpy.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    },
  };

  async function refusalsFor(
    validate: Validate,
    options?: WebhookTargetValidationOptions,
  ): Promise<Array<RefusalFingerprint>> {
    const refusals: Array<RefusalFingerprint> = [];

    for (const answer of Object.values(answers)) {
      answer();
      refusals.push(await refusalOf(validate(INTERNAL_NAME, options)));
    }

    return refusals;
  }

  describe.each(ENTRY_POINTS)("%s", (_name: string, validate: Validate) => {
    test.each([
      ["on SaaS (BILLING_ENABLED=true)", BILLING_ENV],
      [
        "once an operator forces SaaS policy (DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true)",
        BLOCK_PRIVATE_ENV,
      ],
    ])(
      "%s a missing name and an internal name are indistinguishable",
      async (_deployment: string, envVarName: string) => {
        process.env[envVarName] = "true";

        const refusals: Array<RefusalFingerprint> = await refusalsFor(validate);

        expect(refusals[0]!.message).toBe("Webhook URL could not be reached.");
        for (const refusal of refusals) {
          expect(refusal).toEqual(refusals[0]);
        }
      },
    );

    test("on SaaS the project-member sinks get the same single sentence", async () => {
      /*
       * Project webhooks, on-call user webhooks and the workflow API
       * component all opt into the private-network exception. On SaaS it
       * grants nothing, and it must not bring the detail back either.
       */
      process.env[BILLING_ENV] = "true";

      const refusals: Array<RefusalFingerprint> = await refusalsFor(validate, {
        allowPrivateNetworkTargets: true,
      });

      for (const refusal of refusals) {
        expect(refusal.message).toBe("Webhook URL could not be reached.");
        expect(refusal.message).not.toContain("ALLOW_PRIVATE_NETWORK_WEBHOOKS");
      }
    });

    test("a self-hosted install keeps the operator-friendly detail", async () => {
      // Private ranges are refused by default here too, without the opt-in.
      const messages: Array<string> = (await refusalsFor(validate)).map(
        (refusal: RefusalFingerprint) => {
          return refusal.message;
        },
      );

      expect(messages[0]).toBe(
        "Webhook URL hostname could not be resolved via DNS.",
      );
      expect(messages[1]).toMatch(
        /^Webhook URL resolves to a private network address and is not allowed\./,
      );
      expect(messages[2]).toBe(
        "Webhook URL resolves to a private, loopback, or link-local address and is not allowed.",
      );
    });

    test("an explicit includeResolutionDetailInError wins in either deployment", async () => {
      process.env[BILLING_ENV] = "true";
      const detailed: Array<RefusalFingerprint> = await refusalsFor(validate, {
        includeResolutionDetailInError: true,
      });
      expect(detailed[0]!.message).toBe(
        "Webhook URL hostname could not be resolved via DNS.",
      );

      delete process.env[BILLING_ENV];
      const sanitized: Array<RefusalFingerprint> = await refusalsFor(validate, {
        includeResolutionDetailInError: false,
        targetLabel: "Request URL",
      });
      for (const refusal of sanitized) {
        expect(refusal.message).toBe("Request URL could not be reached.");
      }
    });

    test.each([
      [
        "http://10.96.4.17/hook",
        "Webhook URL points to a private network address and is not allowed.",
      ],
      [
        "http://169.254.169.254/latest/meta-data/",
        "Webhook URL points to a private, loopback, or link-local address and is not allowed.",
      ],
      [
        "http://localhost/hook",
        "Webhook URL points to a private, loopback, or link-local address and is not allowed.",
      ],
    ])(
      "on SaaS %s is still refused with its reason: it only restates the URL",
      async (url: string, expected: string) => {
        process.env[BILLING_ENV] = "true";

        const refusal: RefusalFingerprint = await refusalOf(validate(url));

        expect(refusal.message.startsWith(expected)).toBe(true);
        expect(lookupSpy).not.toHaveBeenCalled();
      },
    );

    test("on SaaS a public host is still accepted", async () => {
      process.env[BILLING_ENV] = "true";
      lookupSpy.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);

      await validate("https://hooks.example.com/incoming");

      expect(lookupSpy).toHaveBeenCalledWith("hooks.example.com", {
        all: true,
      });
    });
  });

  test("on SaaS an empty DNS answer reads like every other refusal", async () => {
    /*
     * Only the resolving entry point refuses an empty answer — it has nothing
     * to pin — so this is the one place the empty branch is reachable.
     */
    process.env[BILLING_ENV] = "true";

    lookupSpy.mockResolvedValue([]);
    const empty: RefusalFingerprint = await refusalOf(
      SSRFProtection.validateAndResolveWebhookTarget(INTERNAL_NAME),
    );

    answers["does not resolve"]!();
    const missing: RefusalFingerprint = await refusalOf(
      SSRFProtection.validateAndResolveWebhookTarget(INTERNAL_NAME),
    );

    expect(empty).toEqual(missing);
    expect(empty.message).toBe("Webhook URL could not be reached.");
  });

  test("on SaaS the operator still learns the precise cause from the debug log", async () => {
    process.env[BILLING_ENV] = "true";
    const debugSpy: SpyInstance<typeof logger.debug> = jest
      .spyOn(logger, "debug")
      .mockImplementation((): void => {
        // Only the call is under test.
      });

    await refusalsFor(ENTRY_POINTS[0]![1]);

    const lines: Array<string> = debugSpy.mock.calls.map(
      (call: Array<unknown>) => {
        return String(call[0]);
      },
    );

    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("ENOTFOUND");
    expect(lines[1]).toContain(SECRET_ADDRESS);
    expect(lines[1]).toContain("private network address");
    expect(lines[2]).toContain("127.0.0.1");
    expect(lines[3]).toContain("169.254.169.254");

    for (const line of lines) {
      expect(line).toContain("oneuptime-postgresql");
    }
  });
});
