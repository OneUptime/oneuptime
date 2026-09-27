import DiscordWebhook from "../../../Server/Utils/Workspace/Discord/DiscordWebhook";
import URL from "../../../Types/API/URL";
import { describe, expect, test } from "@jest/globals";

/*
 * Status page subscribers — including unauthenticated visitors on a public
 * status page — supply these webhook URLs, and the server POSTs to them as
 * soon as the subscriber is created. The validator is therefore the only
 * thing standing between an anonymous request and an outbound server-side
 * request carrying a Discord webhook token.
 *
 * The token must never reach another host: any URL that is not an HTTPS
 * discord.com/discordapp.com webhook endpoint is rejected, including
 * look-alike hosts, plaintext downgrades, encoded-path tricks, and query
 * keys outside Discord's documented thread_id/wait set.
 */

describe("DiscordWebhook.isValidUrl for status-page subscribers", () => {
  describe("accepts genuine Discord webhook endpoints", () => {
    const validUrls: Array<string> = [
      "https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOp-QrStUvWxYz0123456789",
      "https://discord.com/api/v10/webhooks/123456789012345678/AbCdEfGhIjKlMnOp-QrStUvWxYz0123456789",
      "https://discordapp.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOp-QrStUvWxYz0123456789",
      "https://discord.com/api/webhooks/123456789012345678/token_here?thread_id=12345678901234567",
      "https://discord.com/api/webhooks/123456789012345678/token_here?wait=true",
      "https://discord.com/api/webhooks/123456789012345678/token_here?thread_id=12345678901234567&wait=false",
    ];

    test.each(validUrls)("accepts %s", (url: string) => {
      expect(DiscordWebhook.isValidUrl(URL.fromString(url))).toBe(true);
    });
  });

  describe("rejects SSRF payloads and private-network targets", () => {
    const ssrfUrls: Array<string> = [
      "http://169.254.169.254/latest/meta-data/?x=discord.com/api/webhooks/1/abc",
      "https://169.254.169.254/api/webhooks/123456789012345678/token",
      "http://localhost/api/webhooks/123456789012345678/token",
      "http://127.0.0.1/api/webhooks/123456789012345678/token",
      "http://10.0.0.5/api/webhooks/123456789012345678/token",
      "https://192.168.1.1/api/webhooks/123456789012345678/token",
      "https://[fd00::1]/api/webhooks/123456789012345678/token",
    ];

    test.each(ssrfUrls)("rejects %s", (url: string) => {
      expect(DiscordWebhook.isValidUrl(url)).toBe(false);
    });
  });

  describe("rejects look-alike and token-exfiltrating hosts", () => {
    const lookAlikeUrls: Array<string> = [
      "https://discord.com.attacker.tld/api/webhooks/123456789012345678/token",
      "https://evil-discord.com/api/webhooks/123456789012345678/token",
      "https://discord.io/api/webhooks/123456789012345678/token",
      "https://webhooks.discord.com.evil.tld/api/webhooks/1/abc",
      "https://attacker.tld/redirect?u=discord.com/api/webhooks/1/abc",
      "https://discord.com.attacker.tld:443/api/webhooks/123456789012345678/token",
    ];

    test.each(lookAlikeUrls)("rejects %s", (url: string) => {
      expect(DiscordWebhook.isValidUrl(url)).toBe(false);
    });
  });

  test("rejects plaintext http Discord hosts (no downgrade)", () => {
    expect(
      DiscordWebhook.isValidUrl(
        "http://discord.com/api/webhooks/123456789012345678/token",
      ),
    ).toBe(false);
    expect(
      DiscordWebhook.isValidUrl(
        "http://discordapp.com/api/webhooks/123456789012345678/token",
      ),
    ).toBe(false);
  });

  describe("rejects malformed webhook paths and tokens", () => {
    const malformedUrls: Array<string> = [
      // Non-numeric webhook id.
      "https://discord.com/api/webhooks/notanumber/token",
      // Token characters outside Discord's documented alphabet.
      "https://discord.com/api/webhooks/123456789012345678/token%20here",
      "https://discord.com/api/webhooks/123456789012345678/to ken",
      // Missing token segment.
      "https://discord.com/api/webhooks/123456789012345678",
      // Missing token segment with query.
      "https://discord.com/api/webhooks/123456789012345678?wait=true",
      // Extra path segments.
      "https://discord.com/api/webhooks/123456789012345678/token/extra",
      // Unsupported API version.
      "https://discord.com/api/v9/webhooks/123456789012345678/token",
      "https://discord.com/api/v11/webhooks/123456789012345678/token",
    ];

    test.each(malformedUrls)("rejects %s", (url: string) => {
      expect(DiscordWebhook.isValidUrl(url)).toBe(false);
    });
  });

  describe("rejects encoded-path tricks", () => {
    const encodedUrls: Array<string> = [
      // Encoded slashes must not smuggle extra path structure.
      "https://discord.com/api%2fwebhooks/123456789012345678/token",
      "https://discord.com/api/webhooks%2F123456789012345678/token",
      // Double encoding.
      "https://discord.com/api%252fwebhooks/123456789012345678/token",
      // Encoded characters inside the token.
      "https://discord.com/api/webhooks/123456789012345678/tok%65n",
    ];

    test.each(encodedUrls)("rejects %s", (url: string) => {
      expect(DiscordWebhook.isValidUrl(url)).toBe(false);
    });
  });

  describe("rejects unexpected or duplicated query keys", () => {
    const badQueryUrls: Array<string> = [
      // Keys outside Discord's documented thread_id/wait set.
      "https://discord.com/api/webhooks/123456789012345678/token?foo=bar",
      "https://discord.com/api/webhooks/123456789012345678/token?wait=true&foo=bar",
      // Duplicate keys, which can confuse downstream parameter handling.
      "https://discord.com/api/webhooks/123456789012345678/token?wait=true&wait=false",
      "https://discord.com/api/webhooks/123456789012345678/token?thread_id=12345678901234567&thread_id=12345678901234568",
      // Invalid thread_id values.
      "https://discord.com/api/webhooks/123456789012345678/token?thread_id=abc",
      "https://discord.com/api/webhooks/123456789012345678/token?thread_id=123",
      // Invalid wait values.
      "https://discord.com/api/webhooks/123456789012345678/token?wait=yes",
    ];

    test.each(badQueryUrls)("rejects %s", (url: string) => {
      expect(DiscordWebhook.isValidUrl(url)).toBe(false);
    });
  });

  test("accepts string input exactly as URL input", () => {
    const value: string =
      "https://discord.com/api/webhooks/123456789012345678/AbCdEf-token";
    expect(DiscordWebhook.isValidUrl(value)).toBe(
      DiscordWebhook.isValidUrl(URL.fromString(value)),
    );
  });
});
