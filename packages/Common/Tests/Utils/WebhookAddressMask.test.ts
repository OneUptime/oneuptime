import WebhookAddressMask from "../../Utils/WebhookAddressMask";
import URL from "../../Types/API/URL";
import { describe, expect, test } from "@jest/globals";

/*
 * A WEBHOOK'S ADDRESS, AS A LOG KEEPS IT (#9013): its scheme, host and port,
 * and a mark where the rest - the webhook's credential - was left out.
 */

const MASK: string = WebhookAddressMask.MASK;

describe("WebhookAddressMask.mask", () => {
  test.each<[string, string]>([
    [
      "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX",
      `https://hooks.slack.com/${MASK}`,
    ],
    [
      "https://example.webhook.office.com/webhookb2/abc@def/IncomingWebhook/123/456",
      `https://example.webhook.office.com/${MASK}`,
    ],
    [
      "https://discord.com/api/webhooks/123/abcdefSECRET",
      `https://discord.com/${MASK}`,
    ],
    [
      "https://alerts.example.com/in?token=s3cr3t",
      `https://alerts.example.com/${MASK}`,
    ],
    [
      "https://alerts.example.com?token=s3cr3t",
      `https://alerts.example.com/${MASK}`,
    ],
    [
      "https://alerts.example.com/#s3cr3t",
      `https://alerts.example.com/${MASK}`,
    ],
    [
      "https://user:pass@alerts.example.com:8443/in",
      `https://alerts.example.com:8443/${MASK}`,
    ],
    // A user and a password are a credential, path or not.
    [
      "https://user:pass@alerts.example.com",
      `https://alerts.example.com/${MASK}`,
    ],
    ["http://10.0.0.5:8080/hook", `http://10.0.0.5:8080/${MASK}`],
  ])("%s is kept as %s", (address: string, kept: string) => {
    expect(WebhookAddressMask.mask(address)).toBe(kept);
  });

  test("an address with nothing past its host is kept whole, with no mark", () => {
    expect(WebhookAddressMask.mask("https://alerts.example.com")).toBe(
      "https://alerts.example.com",
    );
    expect(WebhookAddressMask.mask("https://alerts.example.com/")).toBe(
      "https://alerts.example.com",
    );
  });

  test("an address that cannot be read, or is not a web address, is the mark alone", () => {
    expect(WebhookAddressMask.mask("not an address s3cr3t")).toBe(MASK);
    expect(WebhookAddressMask.mask("javascript:alert(1)")).toBe(MASK);
    expect(WebhookAddressMask.mask("mailto:someone@example.com")).toBe(MASK);
  });

  test("nothing is nothing", () => {
    expect(WebhookAddressMask.mask("")).toBe("");
    expect(WebhookAddressMask.mask("   ")).toBe("");
    expect(WebhookAddressMask.mask(null)).toBe("");
    expect(WebhookAddressMask.mask(undefined)).toBe("");
  });

  test("a URL is masked as its text is", () => {
    expect(
      WebhookAddressMask.mask(
        URL.fromString("https://hooks.slack.com/services/T0/B0/XXXX"),
      ),
    ).toBe(`https://hooks.slack.com/${MASK}`);
  });

  test("masking a masked address changes nothing", () => {
    for (const address of [
      "https://hooks.slack.com/services/T0/B0/XXXX",
      "https://alerts.example.com",
      "not an address",
    ]) {
      const once: string = WebhookAddressMask.mask(address);

      expect(WebhookAddressMask.mask(once)).toBe(once);
    }
  });
});

describe("WebhookAddressMask.maskIn", () => {
  const ADDRESS: string = "https://hooks.slack.com/services/T0/B0/XXXX";

  test("masks every place an error quotes the address", () => {
    expect(
      WebhookAddressMask.maskIn(
        `Could not post to ${ADDRESS}: refused. Retried ${ADDRESS}.`,
        ADDRESS,
      ),
    ).toBe(
      `Could not post to https://hooks.slack.com/${MASK}: refused. Retried https://hooks.slack.com/${MASK}.`,
    );
  });

  test("text that does not quote it, or no address, is as it is", () => {
    expect(WebhookAddressMask.maskIn("connect ECONNREFUSED", ADDRESS)).toBe(
      "connect ECONNREFUSED",
    );
    expect(WebhookAddressMask.maskIn("connect ECONNREFUSED", "")).toBe(
      "connect ECONNREFUSED",
    );
    expect(WebhookAddressMask.maskIn("", ADDRESS)).toBe("");
  });
});
