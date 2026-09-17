// Set required env vars before importing MonitorUtil (which imports Config.ts)
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import MonitorUtil from "../../Utils/Monitors/Monitor";
import URL from "Common/Types/API/URL";
import { describe, expect, it } from "@jest/globals";

describe("MonitorUtil.resolveUrlPlaceholders", () => {
  it("should return the same URL if no placeholders are present", () => {
    const url: URL = URL.fromString("https://example.com/health");
    const result: URL = MonitorUtil.resolveUrlPlaceholders(url);

    expect(result.toString()).toBe("https://example.com/health");
  });

  it("should replace {{timestamp}} with a Unix timestamp", () => {
    const url: URL = URL.fromString(
      "https://example.com/health?cb={{timestamp}}",
    );
    const before: number = Math.floor(Date.now() / 1000);
    const result: URL = MonitorUtil.resolveUrlPlaceholders(url);
    const after: number = Math.floor(Date.now() / 1000);

    const resultString: string = result.toString();
    expect(resultString).not.toContain("{{timestamp}}");

    // Extract the timestamp value from the query string
    const match: RegExpMatchArray | null = resultString.match(/cb=(\d+)/);
    expect(match).not.toBeNull();

    const timestamp: number = parseInt(match![1]!);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });

  it("should replace {{random}} with a random string", () => {
    const url: URL = URL.fromString(
      "https://example.com/health?nocache={{random}}",
    );
    const result: URL = MonitorUtil.resolveUrlPlaceholders(url);

    const resultString: string = result.toString();
    expect(resultString).not.toContain("{{random}}");

    // The random value should be a hex string (UUID without dashes)
    const match: RegExpMatchArray | null =
      resultString.match(/nocache=([a-f0-9]+)/);
    expect(match).not.toBeNull();
    expect(match![1]!.length).toBeGreaterThan(0);
  });

  it("should replace both {{timestamp}} and {{random}} in the same URL", () => {
    const url: URL = URL.fromString(
      "https://example.com/health?ts={{timestamp}}&r={{random}}",
    );
    const result: URL = MonitorUtil.resolveUrlPlaceholders(url);

    const resultString: string = result.toString();
    expect(resultString).not.toContain("{{timestamp}}");
    expect(resultString).not.toContain("{{random}}");

    expect(resultString).toMatch(/ts=\d+/);
    expect(resultString).toMatch(/r=[a-f0-9]+/);
  });

  it("should replace multiple occurrences of the same placeholder in query params", () => {
    const url: URL = URL.fromString(
      "https://example.com/status?cb={{timestamp}}&verify={{timestamp}}",
    );
    const result: URL = MonitorUtil.resolveUrlPlaceholders(url);

    const resultString: string = result.toString();
    expect(resultString).not.toContain("{{timestamp}}");

    // Both occurrences should be replaced with the same timestamp
    const matches: RegExpMatchArray | null = resultString.match(/\d{10}/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(2);
    expect(matches![0]).toBe(matches![1]);
  });

  it("should generate different random values on each call", () => {
    const url: URL = URL.fromString(
      "https://example.com/health?nocache={{random}}",
    );
    const result1: URL = MonitorUtil.resolveUrlPlaceholders(url);
    const result2: URL = MonitorUtil.resolveUrlPlaceholders(url);

    expect(result1.toString()).not.toBe(result2.toString());
  });

  it("should handle {{random}} and {{timestamp}} in separate query params", () => {
    const url: URL = URL.fromString(
      "https://example.com/status?t={{timestamp}}&r={{random}}",
    );
    const result: URL = MonitorUtil.resolveUrlPlaceholders(url);

    const resultString: string = result.toString();
    expect(resultString).not.toContain("{{timestamp}}");
    expect(resultString).not.toContain("{{random}}");
    expect(resultString).toMatch(/t=\d+/);
    expect(resultString).toMatch(/r=[a-f0-9]+/);
  });

  it("should not modify URLs with single braces", () => {
    const url: URL = URL.fromString(
      "https://example.com/health?cb={timestamp}",
    );
    const result: URL = MonitorUtil.resolveUrlPlaceholders(url);

    expect(result.toString()).toBe("https://example.com/health?cb={timestamp}");
  });

  it("should not modify URLs with monitor secret placeholders", () => {
    const url: URL = URL.fromString(
      "https://example.com/health?key={{monitorSecrets.ApiKey}}",
    );
    const result: URL = MonitorUtil.resolveUrlPlaceholders(url);

    // monitorSecrets placeholder should be left untouched
    expect(result.toString()).toContain("{{monitorSecrets.ApiKey}}");
  });
});
