import { describe, expect, test } from "@jest/globals";
import {
  decodeToolImportCredentials,
  encodeToolImportCredentials,
  getToolImportSecrets,
  isToolImportApiKeyId,
  readToolImportApiUrl,
  TOOL_IMPORT_MAX_API_KEY_ID_LENGTH,
  TOOL_IMPORT_MAX_API_URL_LENGTH,
  ToolImportApiAddress,
} from "../../../Types/ToolImport/ToolImportCredentials";
import ToolImportSource from "../../../Types/ToolImport/ToolImportSource";

/*
 * What a person gives the page to connect a tool besides its key - Splunk
 * On-Call's API ID, Grafana OnCall's API address - and how a run keeps
 * them while it reads: the key alone as every run always has for a tool
 * that needs only a key, and JSON for a tool that needs more, in the same
 * encrypted column, read back defensively. And the address rules: what
 * counts as a tool's API address, cleaned the same way on the page and the
 * server.
 */

describe("readToolImportApiUrl: a tool's API address, as a person pastes it", () => {
  test("Grafana Cloud's OnCall API URL keeps its path", () => {
    const address: ToolImportApiAddress | null = readToolImportApiUrl(
      "  https://oncall-prod-us-central-0.grafana.net/oncall  ",
    );

    expect(address).toEqual({
      url: "https://oncall-prod-us-central-0.grafana.net/oncall",
      origin: "https://oncall-prod-us-central-0.grafana.net",
      basePath: "/oncall",
      hostname: "oncall-prod-us-central-0.grafana.net",
      isHttps: true,
    });
  });

  test("a trailing slash, and the API's own /api/v1, are taken off", () => {
    for (const pasted of [
      "https://oncall.example.com/oncall/",
      "https://oncall.example.com/oncall/api/v1",
      "https://oncall.example.com/oncall/api/v1/",
      "https://oncall.example.com/oncall/API/V1/",
    ]) {
      expect(readToolImportApiUrl(pasted)?.url).toBe(
        "https://oncall.example.com/oncall",
      );
    }

    expect(readToolImportApiUrl("https://oncall.example.com/")).toMatchObject({
      url: "https://oncall.example.com",
      basePath: "",
    });
  });

  test("a self-hosted install's port is kept, its host lowercased, and plain http said so", () => {
    expect(readToolImportApiUrl("http://OnCall.Acme.Internal:8080")).toEqual({
      url: "http://oncall.acme.internal:8080",
      origin: "http://oncall.acme.internal:8080",
      basePath: "",
      hostname: "oncall.acme.internal",
      isHttps: false,
    });
  });

  test.each([
    ["nothing", undefined],
    ["an empty value", "   "],
    ["not text", 42],
    ["not an address", "oncall.example.com"],
    ["another scheme", "ftp://oncall.example.com"],
    ["a file", "file:///etc/passwd"],
    ["a user name and password", "https://user:pass@oncall.example.com"],
    ["a query", "https://oncall.example.com/oncall?next=https://evil.example"],
    ["a fragment", "https://oncall.example.com/oncall#x"],
    [
      "a path of characters an API path never has",
      "https://oncall.example.com/a|b",
    ],
    [
      "an address too long to be one",
      `https://oncall.example.com/${"a".repeat(TOOL_IMPORT_MAX_API_URL_LENGTH)}`,
    ],
  ] as Array<[string, unknown]>)(
    "refuses %s",
    (_label: string, value: unknown) => {
      expect(readToolImportApiUrl(value)).toBeNull();
    },
  );

  test("a space in the path is escaped, as the address bar would", () => {
    expect(
      readToolImportApiUrl("https://oncall.example.com/on call")?.basePath,
    ).toBe("/on%20call");
  });

  test("a path cannot step out of itself", () => {
    // The URL parser resolves dot segments, so what is left is plain.
    expect(
      readToolImportApiUrl("https://oncall.example.com/a/../b")?.basePath,
    ).toBe("/b");
    expect(
      readToolImportApiUrl("https://oncall.example.com/a/%2e%2e/b")?.basePath,
    ).toBe("/b");
    expect(readToolImportApiUrl("https://oncall.example.com//x")).toBeNull();
  });
});

describe("the key's ID", () => {
  test("is a short identifier on its own", () => {
    expect(isToolImportApiKeyId("8f2a6c1e")).toBe(true);
    expect(isToolImportApiKeyId("a.b_c-D9")).toBe(true);
    expect(isToolImportApiKeyId("")).toBe(false);
    expect(isToolImportApiKeyId("two words")).toBe(false);
    expect(isToolImportApiKeyId("id\nnext")).toBe(false);
    expect(
      isToolImportApiKeyId("a".repeat(TOOL_IMPORT_MAX_API_KEY_ID_LENGTH)),
    ).toBe(true);
    expect(
      isToolImportApiKeyId("a".repeat(TOOL_IMPORT_MAX_API_KEY_ID_LENGTH + 1)),
    ).toBe(false);
  });
});

describe("how a run keeps what the person gave while it reads", () => {
  test("a tool that needs only a key keeps the key alone, as every run always has", () => {
    for (const source of [
      ToolImportSource.OpsGenie,
      ToolImportSource.IncidentIo,
      ToolImportSource.PagerDuty,
    ]) {
      expect(encodeToolImportCredentials(source, { apiKey: "k-123" })).toBe(
        "k-123",
      );
      expect(decodeToolImportCredentials(source, "k-123")).toEqual({
        apiKey: "k-123",
      });
    }

    // A key that happens to look like JSON is still just the key.
    expect(
      decodeToolImportCredentials(ToolImportSource.OpsGenie, '{"apiKey":"x"}'),
    ).toEqual({ apiKey: '{"apiKey":"x"}' });
  });

  test("Splunk On-Call keeps its API ID with the key, and Grafana OnCall its address", () => {
    const splunk: string = encodeToolImportCredentials(
      ToolImportSource.SplunkOnCall,
      { apiKey: "key-1", apiKeyId: "id-1", apiUrl: undefined },
    );

    expect(JSON.parse(splunk)).toEqual({ apiKey: "key-1", apiKeyId: "id-1" });
    expect(
      decodeToolImportCredentials(ToolImportSource.SplunkOnCall, splunk),
    ).toEqual({ apiKey: "key-1", apiKeyId: "id-1" });

    const grafana: string = encodeToolImportCredentials(
      ToolImportSource.GrafanaOnCall,
      { apiKey: "token-1", apiUrl: "https://oncall.example.com" },
    );

    expect(
      decodeToolImportCredentials(ToolImportSource.GrafanaOnCall, grafana),
    ).toEqual({ apiKey: "token-1", apiUrl: "https://oncall.example.com" });
  });

  test("nothing kept, or something that is not what the tool keeps, reads as nothing", () => {
    for (const stored of [null, undefined, ""]) {
      expect(
        decodeToolImportCredentials(ToolImportSource.OpsGenie, stored),
      ).toBeNull();
      expect(
        decodeToolImportCredentials(ToolImportSource.SplunkOnCall, stored),
      ).toBeNull();
    }

    for (const stored of [
      "a bare key from before",
      "[1,2]",
      "null",
      '{"apiKeyId":"id-without-key"}',
      '{"apiKey":""}',
      '{"apiKey":42}',
    ]) {
      expect(
        decodeToolImportCredentials(ToolImportSource.SplunkOnCall, stored),
      ).toBeNull();
    }

    // Fields of the wrong type are left out, not passed on.
    expect(
      decodeToolImportCredentials(
        ToolImportSource.GrafanaOnCall,
        '{"apiKey":"k","apiUrl":7,"apiKeyId":""}',
      ),
    ).toEqual({ apiKey: "k" });
  });

  test("the values no message may repeat are the key and its ID; the address is the person's own", () => {
    expect(
      getToolImportSecrets({
        apiKey: "key-123456",
        apiKeyId: "id-987654",
        apiUrl: "https://oncall.example.com",
      }),
    ).toEqual(["key-123456", "id-987654"]);
    // Too short to cut out of a sentence without cutting words.
    expect(getToolImportSecrets({ apiKey: "abc" })).toEqual([]);
    expect(getToolImportSecrets(null)).toEqual([]);
  });
});
