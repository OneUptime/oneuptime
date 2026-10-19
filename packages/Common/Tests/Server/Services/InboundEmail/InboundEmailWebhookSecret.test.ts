import InboundEmailProvider, {
  InboundEmailDelivery,
  ParsedInboundEmail,
} from "../../../../Server/Services/InboundEmail/InboundEmailProvider";
import SendGridInboundProvider from "../../../../Server/Services/InboundEmail/Providers/SendGridInboundProvider";
import SecretKeyComparison from "../../../../Server/Utils/SecretKeyComparison";
import { JSONObject } from "../../../../Types/JSON";
/*
 * jest itself is the global one: @jest/globals types spyOn as a mock the
 * global jest.SpiedFunction annotations here do not accept.
 */
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * Whether an inbound email delivery comes from the mail provider
 * (InboundEmailProvider.validateWebhook), the check the webhook route makes
 * before it reads a delivery's body.
 *
 *   - An installation with no secret of its own refuses every delivery, for
 *     every provider: unset, blank, a value the repository ships and a
 *     placeholder the setup guide prints are no secret. The rule is the base
 *     class's, so a provider's own check is never even asked.
 *   - With a secret, SendGrid's deliveries are the requests posted to an
 *     address that ends with exactly that secret, compared in constant time.
 *   - The factory builds every provider it knows with the installation's
 *     secret, so each of them is held to the same rule.
 */

const DOMAIN: string = "inbound.oneuptime.example";

// A long random value of an operator's own.
const OPERATORS_SECRET: string =
  "6f1c9a2e8b4d7f30a5c1e9b2d6f8a0c4e7b1d3f5a9c2e6b8";

const NO_SECRET_OF_ITS_OWN: Array<[string, string | undefined]> = [
  ["unset", undefined],
  ["empty", ""],
  ["blank", " \t "],
  ["the value the code used to fall back to", "secret"],
  ["a config.example.env placeholder", "please-change-this-to-random-value"],
  [
    "a probe's config.example.env placeholder",
    "probe-1-please-change-this-to-random-value",
  ],
  ["the guide's URL placeholder", "YOUR_SECRET"],
  ["the guide's URL placeholder, lowercased", "your_secret"],
  ["the guide's example", "your-secret"],
  ["the guide's example, in other case", "Your-Secret"],
  ["the guide's config placeholder", "replace-with-a-strong-random-secret"],
  ["the guide's config placeholder, padded", "  replace-with-a-strong-random-secret\n"],
];

// What a request could end with: anything at all, the secret included.
function endings(secret: string | undefined): Array<string> {
  return [
    "",
    "anything",
    "undefined",
    "null",
    "secret",
    "YOUR_SECRET",
    OPERATORS_SECRET,
    ...(secret !== undefined ? [secret, secret.trim()] : []),
  ];
}

function delivery(pathSecret: string): InboundEmailDelivery {
  return {
    headers: { "content-type": "multipart/form-data; boundary=x" },
    pathSecret: pathSecret,
  };
}

/*
 * A provider whose own check takes every delivery it is asked about, and
 * counts how often it is asked: what the base class does around it is all
 * that stands between a request and the queue.
 */
class TakesEverythingProvider extends InboundEmailProvider {
  public asked: number = 0;

  protected async isFromProvider(): Promise<boolean> {
    this.asked++;
    return true;
  }

  public async parseInboundEmail(_rawData: JSONObject): Promise<ParsedInboundEmail> {
    return { from: "", to: "", subject: "", body: "" };
  }

  public extractSecretKeyFromEmail(_email: string): string | null {
    return null;
  }

  public generateMonitorEmailAddress(secretKey: string): string {
    return `monitor-${secretKey}@${this.config.inboundDomain}`;
  }
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an installation with no webhook secret of its own", () => {
  it.each(NO_SECRET_OF_ITS_OWN)(
    "SendGrid refuses every delivery when the secret is %s",
    async (_label: string, secret: string | undefined) => {
      const provider: SendGridInboundProvider = new SendGridInboundProvider({
        inboundDomain: DOMAIN,
        webhookSecret: secret,
      });

      expect(provider.hasWebhookSecret()).toBe(false);

      for (const ending of endings(secret)) {
        expect({
          ending,
          accepted: await provider.validateWebhook(delivery(ending)),
        }).toEqual({ ending, accepted: false });
      }
    },
  );

  it.each(NO_SECRET_OF_ITS_OWN)(
    "any provider refuses every delivery when the secret is %s, without asking its own check",
    async (_label: string, secret: string | undefined) => {
      const provider: TakesEverythingProvider = new TakesEverythingProvider({
        inboundDomain: DOMAIN,
        webhookSecret: secret,
      });

      for (const ending of endings(secret)) {
        expect(await provider.validateWebhook(delivery(ending))).toBe(false);
      }

      expect(provider.asked).toBe(0);
    },
  );

  it("is not asked to compare anything", async () => {
    const compare: jest.SpiedFunction<typeof SecretKeyComparison.timingSafeEqual> =
      jest.spyOn(SecretKeyComparison, "timingSafeEqual");

    const provider: SendGridInboundProvider = new SendGridInboundProvider({
      inboundDomain: DOMAIN,
    });

    await provider.validateWebhook(delivery("anything"));

    expect(compare).not.toHaveBeenCalled();
  });
});

describe("an installation with a secret of its own", () => {
  const provider: SendGridInboundProvider = new SendGridInboundProvider({
    inboundDomain: DOMAIN,
    webhookSecret: OPERATORS_SECRET,
  });

  it("has one", () => {
    expect(provider.hasWebhookSecret()).toBe(true);
  });

  it("takes a delivery posted to the address that ends with it", async () => {
    expect(await provider.validateWebhook(delivery(OPERATORS_SECRET))).toBe(
      true,
    );
  });

  it.each([
    ["nothing", ""],
    ["another value", "anything"],
    ["the secret in other case", OPERATORS_SECRET.toUpperCase()],
    ["the secret less its last character", OPERATORS_SECRET.slice(0, -1)],
    ["the secret and one character more", `${OPERATORS_SECRET}0`],
    ["the secret with a space before it", ` ${OPERATORS_SECRET}`],
    ["the secret with a space after it", `${OPERATORS_SECRET} `],
    ["the secret twice", `${OPERATORS_SECRET}${OPERATORS_SECRET}`],
    ["the guide's placeholder", "YOUR_SECRET"],
  ])(
    "refuses a delivery posted to an address that ends with %s",
    async (_label: string, ending: string) => {
      expect(await provider.validateWebhook(delivery(ending))).toBe(false);
    },
  );

  it("whatever the headers say", async () => {
    expect(
      await provider.validateWebhook({
        headers: {
          "x-twilio-email-event-webhook-signature": "anything",
          authorization: `Bearer ${OPERATORS_SECRET}`,
        },
        pathSecret: "anything",
      }),
    ).toBe(false);
  });

  it("set with whitespace around it, is the secret without it", async () => {
    const padded: SendGridInboundProvider = new SendGridInboundProvider({
      inboundDomain: DOMAIN,
      webhookSecret: `\t ${OPERATORS_SECRET} \n`,
    });

    expect(await padded.validateWebhook(delivery(OPERATORS_SECRET))).toBe(true);
    expect(
      await padded.validateWebhook(delivery(` ${OPERATORS_SECRET} `)),
    ).toBe(false);
  });

  it("compares in constant time, the presented value against the secret", async () => {
    const compare: jest.SpiedFunction<typeof SecretKeyComparison.timingSafeEqual> =
      jest.spyOn(SecretKeyComparison, "timingSafeEqual");

    await provider.validateWebhook(delivery("guess"));

    expect(compare).toHaveBeenCalledTimes(1);
    expect(compare).toHaveBeenCalledWith("guess", OPERATORS_SECRET);
  });

  it("any provider's own check is asked only then, with the secret", async () => {
    const takesEverything: TakesEverythingProvider =
      new TakesEverythingProvider({
        inboundDomain: DOMAIN,
        webhookSecret: OPERATORS_SECRET,
      });

    expect(await takesEverything.validateWebhook(delivery("anything"))).toBe(
      true,
    );
    expect(takesEverything.asked).toBe(1);
  });
});

describe("the factory holds every provider it builds to the installation's secret", () => {
  const originalEnv: NodeJS.ProcessEnv = { ...process.env };

  interface FactoryModule {
    default: {
      getProvider: () => InboundEmailProvider;
      isConfigured: () => boolean;
    };
  }

  interface EnvironmentModule {
    InboundEmailProviderType: Record<string, string>;
  }

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  async function factoryFor(
    environment: Record<string, string | undefined>,
  ): Promise<FactoryModule["default"]> {
    for (const key of [
      "INBOUND_EMAIL_PROVIDER",
      "INBOUND_EMAIL_DOMAIN",
      "INBOUND_EMAIL_WEBHOOK_SECRET",
    ]) {
      delete process.env[key];
    }

    for (const [key, value] of Object.entries(environment)) {
      if (value !== undefined) {
        process.env[key] = value;
      }
    }

    jest.resetModules();

    return (
      (await import(
        "../../../../Server/Services/InboundEmail/InboundEmailProviderFactory"
      )) as unknown as FactoryModule
    ).default;
  }

  async function providerTypes(): Promise<Array<string>> {
    jest.resetModules();

    return Object.values(
      (
        (await import(
          "../../../../Server/EnvironmentConfig"
        )) as unknown as EnvironmentModule
      ).InboundEmailProviderType,
    );
  }

  it("knows at least SendGrid", async () => {
    expect(await providerTypes()).toContain("SendGrid");
  });

  it.each(NO_SECRET_OF_ITS_OWN)(
    "every provider refuses every delivery when INBOUND_EMAIL_WEBHOOK_SECRET is %s",
    async (_label: string, secret: string | undefined) => {
      for (const type of await providerTypes()) {
        const factory: FactoryModule["default"] = await factoryFor({
          INBOUND_EMAIL_PROVIDER: type,
          INBOUND_EMAIL_DOMAIN: DOMAIN,
          INBOUND_EMAIL_WEBHOOK_SECRET: secret,
        });

        expect(factory.isConfigured()).toBe(true);

        const provider: InboundEmailProvider = factory.getProvider();

        expect({ type, hasSecret: provider.hasWebhookSecret() }).toEqual({
          type,
          hasSecret: false,
        });

        for (const ending of endings(secret)) {
          expect({
            type,
            ending,
            accepted: await provider.validateWebhook(delivery(ending)),
          }).toEqual({ type, ending, accepted: false });
        }
      }
    },
  );

  it("every provider takes a delivery at the installation's own address, and no other", async () => {
    for (const type of await providerTypes()) {
      const factory: FactoryModule["default"] = await factoryFor({
        INBOUND_EMAIL_PROVIDER: type,
        INBOUND_EMAIL_DOMAIN: DOMAIN,
        INBOUND_EMAIL_WEBHOOK_SECRET: OPERATORS_SECRET,
      });

      const provider: InboundEmailProvider = factory.getProvider();

      expect(provider.hasWebhookSecret()).toBe(true);
      expect(await provider.validateWebhook(delivery(OPERATORS_SECRET))).toBe(
        true,
      );
      expect(await provider.validateWebhook(delivery("anything"))).toBe(false);
    }
  });
});
