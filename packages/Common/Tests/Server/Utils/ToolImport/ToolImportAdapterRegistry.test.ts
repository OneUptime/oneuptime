import { describe, expect, test } from "@jest/globals";
import ToolImportAdapterRegistry from "../../../../Server/Utils/ToolImport/ToolImportAdapterRegistry";
import {
  ToolImportHttpRequest,
  ToolImportHttpResponse,
} from "../../../../Server/Utils/ToolImport/ToolImportHttpClient";
import {
  ToolImportAdapter,
  ToolImportReadError,
  ToolImportReadSettings,
} from "../../../../Server/Utils/ToolImport/Types";
import BadDataException from "../../../../Types/Exception/BadDataException";
import {
  getToolImportSourceDefinition,
  isToolImportAddressGiven,
  isToolImportFileUpload,
  ToolImportCredentialField,
  ToolImportRegion,
  ToolImportSourceDefinition,
} from "../../../../Types/ToolImport/ToolImportCatalog";
import ToolImportSource, {
  AllToolImportSources,
} from "../../../../Types/ToolImport/ToolImportSource";

/*
 * The rules every tool's adapter keeps, held for every adapter registered,
 * so a tool added later is covered without a line here: one adapter per
 * tool; a read calls only the host of the region the person picked (from
 * ToolImportCatalog, never typed) - or, for a tool whose address the
 * person gives, that address's host and path only; the key (and its ID,
 * where the tool has one) travels in a header, never in a URL, and is never
 * repeated in a message; a key the tool refuses is a plain message the
 * person can act on; nothing is called without a key, without the ID or
 * address the tool needs, or with a region the tool does not have. Each
 * tool's own fixture tests cover what it reads.
 */

const KEY: string = "contract-key-5f2c9a71d0b84e6f";
const KEY_ID: string = "contract-id-8d41";
const GIVEN_HOST: string = "oncall.contract-example.com";
const GIVEN_URL: string = `https://${GIVEN_HOST}/oncall`;

interface Recorded {
  requests: Array<ToolImportHttpRequest>;
  error: unknown;
}

// How the person connects the tool in the read: a region, or an address.
interface Connection {
  label: string;
  region: string;
  host: string;
  apiUrl?: string | undefined;
  // The path every request of a given address goes under.
  basePath: string;
}

function settingsFor(
  adapter: ToolImportAdapter,
  data: {
    apiKey: string;
    region: string;
    apiKeyId?: string | undefined;
    apiUrl?: string | undefined;
  },
): ToolImportReadSettings {
  const definition: ToolImportSourceDefinition = getToolImportSourceDefinition(
    adapter.source,
  );
  const settings: ToolImportReadSettings = {
    source: adapter.source,
    apiKey: data.apiKey,
    region: data.region,
  };

  if (
    definition.credentialFields.includes(ToolImportCredentialField.ApiKeyId)
  ) {
    settings.apiKeyId = data.apiKeyId;
  }

  if (definition.credentialFields.includes(ToolImportCredentialField.ApiUrl)) {
    settings.apiUrl = data.apiUrl;
  }

  return settings;
}

async function readWithRefusedKey(data: {
  adapter: ToolImportAdapter;
  apiKey: string;
  region: string;
  apiKeyId?: string | undefined;
  apiUrl?: string | undefined;
}): Promise<Recorded> {
  const requests: Array<ToolImportHttpRequest> = [];
  const now: number = Date.parse("2026-10-08T12:00:00Z");
  let error: unknown = null;

  try {
    await data.adapter.read(settingsFor(data.adapter, data), {
      transport: async (
        request: ToolImportHttpRequest,
      ): Promise<ToolImportHttpResponse> => {
        requests.push(request);
        const body: { message: string } = { message: "Unauthorized" };

        return {
          statusCode: 401,
          bodyText: JSON.stringify(body),
          bodyJson: body,
          headers: {},
        };
      },
      sleep: async (): Promise<void> => {},
      now: (): number => {
        return now;
      },
      maxRequests: 50,
      deadlineAt: now + 10 * 60 * 1000,
    });
  } catch (caught) {
    error = caught;
  }

  return { requests, error };
}

// The tool's regions, or its one API ("" picks it), or the address given.
function connectionsOf(source: ToolImportSource): Array<Connection> {
  const definition: ToolImportSourceDefinition =
    getToolImportSourceDefinition(source);

  if (isToolImportAddressGiven(definition)) {
    return [
      {
        label: "an address the person gives",
        region: "",
        host: GIVEN_HOST,
        apiUrl: GIVEN_URL,
        basePath: "/oncall",
      },
    ];
  }

  const regions: Array<ToolImportRegion> =
    definition.regions.length > 0
      ? definition.regions
      : [{ value: "", title: definition.title, host: definition.hosts[0]! }];

  return regions.map((region: ToolImportRegion): Connection => {
    return {
      label: `region '${region.value}'`,
      region: region.value,
      host: region.host,
      basePath: "",
    };
  });
}

// The tools read with their key, over their API.
const API_SOURCES: Array<ToolImportSource> = AllToolImportSources.filter(
  (source: ToolImportSource): boolean => {
    return !isToolImportFileUpload(getToolImportSourceDefinition(source));
  },
);

// The tools read from a file the person uploads.
const FILE_SOURCES: Array<ToolImportSource> = AllToolImportSources.filter(
  (source: ToolImportSource): boolean => {
    return isToolImportFileUpload(getToolImportSourceDefinition(source));
  },
);

describe("ToolImportAdapterRegistry", () => {
  test("every tool has exactly one adapter, and the registry hands out the one asked for", () => {
    const registered: Array<ToolImportSource> =
      ToolImportAdapterRegistry.getRegisteredSources();
    const registeredFiles: Array<ToolImportSource> =
      ToolImportAdapterRegistry.getRegisteredFileSources();

    // A tool read over its API has an API adapter; one read from a file, a file adapter.
    expect([...registered].sort()).toEqual([...API_SOURCES].sort());
    expect([...registeredFiles].sort()).toEqual([...FILE_SOURCES].sort());
    expect(new Set([...registered, ...registeredFiles]).size).toBe(
      AllToolImportSources.length,
    );

    for (const source of API_SOURCES) {
      expect(ToolImportAdapterRegistry.getAdapter(source).source).toBe(source);
      expect(() => {
        ToolImportAdapterRegistry.getFileAdapter(source);
      }).toThrow(BadDataException);
    }

    for (const source of FILE_SOURCES) {
      expect(ToolImportAdapterRegistry.getFileAdapter(source).source).toBe(
        source,
      );
      expect(() => {
        ToolImportAdapterRegistry.getAdapter(source);
      }).toThrow(BadDataException);
    }
  });

  test("Uptime Kuma, which has no API to read, is the one tool read from a file", () => {
    expect(FILE_SOURCES).toEqual([ToolImportSource.UptimeKuma]);
  });

  test("a tool without an adapter is refused, never guessed", () => {
    expect(() => {
      ToolImportAdapterRegistry.getAdapter("Elsewhere" as ToolImportSource);
    }).toThrow(BadDataException);
    expect(() => {
      ToolImportAdapterRegistry.getFileAdapter("Elsewhere" as ToolImportSource);
    }).toThrow(BadDataException);
  });
});

describe.each(API_SOURCES)(
  "the %s adapter keeps the rules every tool's adapter keeps",
  (source: ToolImportSource) => {
    const adapter: ToolImportAdapter =
      ToolImportAdapterRegistry.getAdapter(source);
    const definition: ToolImportSourceDefinition =
      getToolImportSourceDefinition(source);

    test.each(connectionsOf(source))(
      "for $label it calls only $host, with the key in a header and never in a URL",
      async (connection: Connection) => {
        const recorded: Recorded = await readWithRefusedKey({
          adapter,
          apiKey: KEY,
          apiKeyId: KEY_ID,
          region: connection.region,
          apiUrl: connection.apiUrl,
        });

        expect(recorded.requests.length).toBeGreaterThan(0);

        for (const request of recorded.requests) {
          const url: URL = new URL(request.url);

          expect(request.method).toBe("GET");
          expect(url.protocol).toBe("https:");
          expect(url.host).toBe(connection.host);
          expect(url.pathname.startsWith(`${connection.basePath}/`)).toBe(true);

          if (!isToolImportAddressGiven(definition)) {
            expect(definition.hosts).toContain(url.host);
          }

          expect(request.url).not.toContain(KEY);
          expect(request.url).not.toContain(KEY_ID);
          expect(
            Object.values(request.headers).some((value: string): boolean => {
              return value.includes(KEY);
            }),
          ).toBe(true);

          // The tool's own fixed headers go with every request.
          for (const [name, value] of Object.entries(
            definition.headers || {},
          )) {
            expect(request.headers[name]).toBe(value);
          }
        }
      },
    );

    test("a key the tool refuses is a plain message naming the tool, without the key", async () => {
      const connection: Connection = connectionsOf(source)[0]!;
      const recorded: Recorded = await readWithRefusedKey({
        adapter,
        apiKey: KEY,
        apiKeyId: KEY_ID,
        region: connection.region,
        apiUrl: connection.apiUrl,
      });

      expect(recorded.error).toBeInstanceOf(ToolImportReadError);

      const message: string = (recorded.error as Error).message;

      expect(message).toContain(definition.title);
      expect(message).toContain("API key");
      expect(message).not.toContain(KEY);
      expect(message).not.toContain(KEY_ID);
    });

    test("nothing is called without a key, without what else the tool needs, or for a region the tool does not have", async () => {
      const connection: Connection = connectionsOf(source)[0]!;
      const complete: {
        apiKey: string;
        apiKeyId: string;
        region: string;
        apiUrl?: string | undefined;
      } = {
        apiKey: KEY,
        apiKeyId: KEY_ID,
        region: connection.region,
        apiUrl: connection.apiUrl,
      };

      const attempts: Array<{
        apiKey: string;
        apiKeyId?: string | undefined;
        region: string;
        apiUrl?: string | undefined;
      }> = [
        { ...complete, apiKey: "   " },
        { ...complete, region: "MOON" },
        { ...complete, region: "https://elsewhere.example.com" },
      ];

      if (
        definition.credentialFields.includes(ToolImportCredentialField.ApiKeyId)
      ) {
        attempts.push({ ...complete, apiKeyId: "  " });
        attempts.push({ ...complete, apiKeyId: undefined });
      }

      if (
        definition.credentialFields.includes(ToolImportCredentialField.ApiUrl)
      ) {
        attempts.push({ ...complete, apiUrl: undefined });
        attempts.push({ ...complete, apiUrl: "not an address" });
        attempts.push({ ...complete, apiUrl: "ftp://oncall.example.com" });
        attempts.push({
          ...complete,
          apiUrl: "https://user:secret@oncall.example.com",
        });
      }

      for (const attempt of attempts) {
        const recorded: Recorded = await readWithRefusedKey({
          adapter,
          ...attempt,
        });

        expect({
          attempt,
          error: recorded.error instanceof ToolImportReadError,
        }).toEqual({ attempt, error: true });
        expect({ attempt, requests: recorded.requests }).toEqual({
          attempt,
          requests: [],
        });
      }
    });
  },
);
