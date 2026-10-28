import {
  RUNBOOK_WEBHOOK_EXAMPLE_BODY,
  RUNBOOK_WEBHOOK_MAX_ACTIVE_RUNS,
  RUNBOOK_WEBHOOK_MAX_BODY_BYTES,
  RUNBOOK_WEBHOOK_PATH,
  RUNBOOK_WEBHOOK_ROUTE,
  RUNBOOK_WEBHOOK_RUNS_PER_MINUTE,
  RUNBOOK_WEBHOOK_SECRET_KEY_BYTES,
  RUNBOOK_WEBHOOK_SECRET_KEY_LENGTH,
  RUNBOOK_WEBHOOK_SECRET_MASK,
  RUNBOOK_WEBHOOK_SECRET_RESET_ROUTE,
  RUNBOOK_WEBHOOK_SECRET_ROUTE,
  RunbookWebhookMessages,
  getMaskedRunbookWebhookUrl,
  getRunbookWebhookCurlExample,
  getRunbookWebhookUrl,
  getRunbookWebhookUrlPrefix,
  isRunbookWebhookSecretKeyShape,
} from "../../../Types/Runbook/RunbookWebhook";
import { RUNBOOK_INPUTS_MAX_BYTES } from "../../../Types/Runbook/RunbookInputs";
import { describe, expect, it } from "@jest/globals";
import crypto from "crypto";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * The webhook URL a runbook's Triggers page shows and the server answers:
 * where the key sits in it, the mask that hides it, the example request,
 * and the sentences every refusal is answered with.
 */

const SERVICE: string = "https://oneuptime.example.com/runbook";
const RUNBOOK_ID: string = "8a7f5c3e-1b2d-4e6f-9a0b-1c2d3e4f5a6b";

const generatedKey: () => string = (): string => {
  return crypto
    .randomBytes(RUNBOOK_WEBHOOK_SECRET_KEY_BYTES)
    .toString("base64url");
};

describe("the webhook URL", () => {
  it("is the runbook service, /webhook, the runbook's id and its secret key", () => {
    const key: string = generatedKey();

    expect(
      getRunbookWebhookUrl({
        runbookServiceUrl: SERVICE,
        runbookId: RUNBOOK_ID,
        secretKey: key,
      }),
    ).toBe(`${SERVICE}/webhook/${RUNBOOK_ID}/${key}`);
    expect(RUNBOOK_WEBHOOK_PATH).toBe("/webhook");
    expect(RUNBOOK_WEBHOOK_ROUTE).toBe("/webhook/:runbookId/:secretKey");
  });

  it("gives the same URL with or without a trailing slash on the service", () => {
    for (const service of [SERVICE, `${SERVICE}/`, `${SERVICE}///`]) {
      expect(
        getRunbookWebhookUrlPrefix({
          runbookServiceUrl: service,
          runbookId: RUNBOOK_ID,
        }),
      ).toBe(`${SERVICE}/webhook/${RUNBOOK_ID}/`);
    }
  });

  it("masks the key with a fixed-length mask that is never built from it", () => {
    const masked: string = getMaskedRunbookWebhookUrl({
      runbookServiceUrl: SERVICE,
      runbookId: RUNBOOK_ID,
    });

    expect(masked).toBe(
      `${SERVICE}/webhook/${RUNBOOK_ID}/${RUNBOOK_WEBHOOK_SECRET_MASK}`,
    );
    expect(RUNBOOK_WEBHOOK_SECRET_MASK).toBe("•".repeat(16));
  });

  it("escapes anything in an id or key that would change the path", () => {
    expect(
      getRunbookWebhookUrl({
        runbookServiceUrl: SERVICE,
        runbookId: "a/b",
        secretKey: "c?d#e",
      }),
    ).toBe(`${SERVICE}/webhook/a%2Fb/c%3Fd%23e`);
  });

  it("reads and resets the key at addresses apart from the public URL's", () => {
    expect(RUNBOOK_WEBHOOK_SECRET_ROUTE).toBe("/webhook-secret/:runbookId");
    expect(RUNBOOK_WEBHOOK_SECRET_RESET_ROUTE).toBe(
      "/webhook-secret/:runbookId/reset",
    );
    expect(
      RUNBOOK_WEBHOOK_SECRET_ROUTE.startsWith(`${RUNBOOK_WEBHOOK_PATH}/`),
    ).toBe(false);
  });
});

describe("the secret key", () => {
  it("is 32 random bytes as 43 characters of base64url", () => {
    for (let i: number = 0; i < 50; i++) {
      const key: string = generatedKey();

      expect(key.length).toBe(RUNBOOK_WEBHOOK_SECRET_KEY_LENGTH);
      expect(isRunbookWebhookSecretKeyShape(key)).toBe(true);
    }
  });

  it("is not something else that looks like a key", () => {
    for (const value of [
      "",
      "short",
      generatedKey().slice(1),
      `${generatedKey()}x`,
      `${generatedKey().slice(1)}+`,
      `${generatedKey().slice(1)}=`,
      RUNBOOK_ID,
      undefined,
      null,
      42,
    ]) {
      expect(isRunbookWebhookSecretKeyShape(value)).toBe(false);
    }
  });

  it("is checked in time that grows with the text, even for 400,000 characters", () => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(isRunbookWebhookSecretKeyShape("a".repeat(400000))).toBe(false);
        expect(isRunbookWebhookSecretKeyShape(`${"a".repeat(400000)}!`)).toBe(
          false,
        );
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("the example request", () => {
  it("POSTs the example JSON body to the URL, one option a line", () => {
    const url: string = `${SERVICE}/webhook/${RUNBOOK_ID}/key`;

    expect(getRunbookWebhookCurlExample(url)).toBe(
      [
        `curl -X POST "${url}" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d '${RUNBOOK_WEBHOOK_EXAMPLE_BODY}'`,
      ].join("\n"),
    );
  });

  it("sends a body that is valid JSON and gives two inputs", () => {
    expect(JSON.parse(RUNBOOK_WEBHOOK_EXAMPLE_BODY)).toEqual({
      host: "web-1",
      reason: "Disk almost full",
    });
    // It sits in single quotes in the example, so it must hold none.
    expect(RUNBOOK_WEBHOOK_EXAMPLE_BODY.includes("'")).toBe(false);
  });
});

describe("what a call is answered", () => {
  it("says what to do about every refusal, in a sentence that ends", () => {
    for (const message of Object.values(RunbookWebhookMessages)) {
      expect(message.length).toBeGreaterThan(20);
      expect(message.trim()).toBe(message);
      expect(message.endsWith(".")).toBe(true);
    }
  });

  it("names the limits the server holds calls to", () => {
    expect(RunbookWebhookMessages.tooManyActiveRuns).toContain(
      `${RUNBOOK_WEBHOOK_MAX_ACTIVE_RUNS} runs`,
    );
    expect(RunbookWebhookMessages.rateLimited).toContain(
      `${RUNBOOK_WEBHOOK_RUNS_PER_MINUTE} runs`,
    );
    expect(RunbookWebhookMessages.bodyTooLarge).toContain("64 KB");
    expect(RUNBOOK_WEBHOOK_MAX_BODY_BYTES).toBe(RUNBOOK_INPUTS_MAX_BYTES);
  });

  it("never echoes the URL or the key", () => {
    for (const message of Object.values(RunbookWebhookMessages)) {
      expect(message.includes("/webhook/")).toBe(false);
    }
  });
});
