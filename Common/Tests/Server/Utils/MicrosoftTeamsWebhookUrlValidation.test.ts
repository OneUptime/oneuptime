import MicrosoftTeamsUtil from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import URL from "../../../Types/API/URL";
import { describe, expect, test } from "@jest/globals";

/*
 * Status page subscribers — including unauthenticated visitors on a public
 * status page — supply these webhook URLs, and the server POSTs to them as
 * soon as the subscriber is created. The validators are therefore the only
 * thing standing between an anonymous request and an outbound server-side
 * request to an arbitrary host.
 *
 * The Teams validator used to substring-match the whole URL for "office.com",
 * which an attacker satisfied from the path or query
 * (http://169.254.169.254/?x=office.com) — SSRF into the cloud metadata
 * endpoint. These pin the host-anchored behavior that replaced it.
 */

describe("MicrosoftTeamsUtil.isValidMicrosoftTeamsIncomingWebhookUrl", () => {
  describe("accepts genuine Microsoft webhook hosts", () => {
    const validUrls: Array<string> = [
      "https://outlook.office.com/webhook/abc123/IncomingWebhook/def456",
      "https://outlook.office365.com/webhook/abc123/IncomingWebhook/def456",
      "https://contoso.webhook.office.com/webhookb2/abc-123/IncomingWebhook/def",
    ];

    test.each(validUrls)("accepts %s", (url: string) => {
      expect(
        MicrosoftTeamsUtil.isValidMicrosoftTeamsIncomingWebhookUrl(
          URL.fromString(url),
        ),
      ).toBe(true);
    });
  });

  describe("rejects SSRF payloads that the substring check let through", () => {
    const ssrfUrls: Array<string> = [
      // The advisory-class payload: metadata endpoint with office.com in the query.
      "http://169.254.169.254/latest/meta-data/iam/security-credentials/?x=office.com",
      "https://169.254.169.254/latest/meta-data/?x=office.com",
      "http://localhost:9200/_cluster/health?a=office.com",
      "http://127.0.0.1/admin?x=outlook.office.com",
      "http://10.0.0.5/office.com",
      "https://192.168.1.1/?redirect=outlook.office.com",
    ];

    test.each(ssrfUrls)("rejects %s", (url: string) => {
      expect(
        MicrosoftTeamsUtil.isValidMicrosoftTeamsIncomingWebhookUrl(
          URL.fromString(url),
        ),
      ).toBe(false);
    });
  });

  describe("rejects look-alike domains", () => {
    const lookAlikeUrls: Array<string> = [
      "https://office.com.attacker.tld/webhook",
      "https://evil-office.com/webhook",
      "https://attacker.tld/webhook?host=office.com",
      "https://outlook.office.com.evil.tld/webhook",
    ];

    test.each(lookAlikeUrls)("rejects %s", (url: string) => {
      expect(
        MicrosoftTeamsUtil.isValidMicrosoftTeamsIncomingWebhookUrl(
          URL.fromString(url),
        ),
      ).toBe(false);
    });
  });

  test("rejects a plaintext http Microsoft host (no downgrade)", () => {
    expect(
      MicrosoftTeamsUtil.isValidMicrosoftTeamsIncomingWebhookUrl(
        URL.fromString("http://outlook.office.com/webhook/abc/IncomingWebhook"),
      ),
    ).toBe(false);
  });
});

describe("SlackUtil.isValidSlackIncomingWebhookUrl", () => {
  test("accepts a genuine Slack incoming webhook URL", () => {
    expect(
      SlackUtil.isValidSlackIncomingWebhookUrl(
        URL.fromString("https://hooks.slack.com/services/T000/B000/XXXX"),
      ),
    ).toBe(true);
  });

  const invalidUrls: Array<string> = [
    "http://169.254.169.254/?x=https://hooks.slack.com/services/",
    "https://hooks.slack.com.attacker.tld/services/x",
    "http://hooks.slack.com/services/T000/B000/XXXX",
    "https://127.0.0.1/services/",
  ];

  test.each(invalidUrls)("rejects %s", (url: string) => {
    expect(SlackUtil.isValidSlackIncomingWebhookUrl(URL.fromString(url))).toBe(
      false,
    );
  });
});
