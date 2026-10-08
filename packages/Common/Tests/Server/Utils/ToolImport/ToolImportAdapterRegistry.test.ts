import { describe, expect, test } from "@jest/globals";
import ToolImportAdapterRegistry from "../../../../Server/Utils/ToolImport/ToolImportAdapterRegistry";
import {
  ToolImportHttpRequest,
  ToolImportHttpResponse,
} from "../../../../Server/Utils/ToolImport/ToolImportHttpClient";
import {
  ToolImportAdapter,
  ToolImportReadError,
} from "../../../../Server/Utils/ToolImport/Types";
import BadDataException from "../../../../Types/Exception/BadDataException";
import {
  getToolImportSourceDefinition,
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
 * ToolImportCatalog, never typed); the key travels in a header, never in a
 * URL, and is never repeated in a message; a key the tool refuses is a
 * plain message the person can act on; nothing is called without a key or
 * with a region the tool does not have. Each tool's own fixture tests
 * cover what it reads.
 */

const KEY: string = "contract-key-5f2c9a71d0b84e6f";

interface Recorded {
  requests: Array<ToolImportHttpRequest>;
  error: unknown;
}

async function readWithRefusedKey(data: {
  adapter: ToolImportAdapter;
  apiKey: string;
  region: string;
}): Promise<Recorded> {
  const requests: Array<ToolImportHttpRequest> = [];
  const now: number = Date.parse("2026-10-08T12:00:00Z");
  let error: unknown = null;

  try {
    await data.adapter.read(
      { source: data.adapter.source, apiKey: data.apiKey, region: data.region },
      {
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
      },
    );
  } catch (caught) {
    error = caught;
  }

  return { requests, error };
}

// The tool's regions, or its one API ("" picks it).
function regionsOf(source: ToolImportSource): Array<ToolImportRegion> {
  const definition: ToolImportSourceDefinition =
    getToolImportSourceDefinition(source);

  return definition.regions.length > 0
    ? definition.regions
    : [{ value: "", title: definition.title, host: definition.hosts[0]! }];
}

describe("ToolImportAdapterRegistry", () => {
  test("every tool has exactly one adapter, and the registry hands out the one asked for", () => {
    const registered: Array<ToolImportSource> =
      ToolImportAdapterRegistry.getRegisteredSources();

    expect([...registered].sort()).toEqual([...AllToolImportSources].sort());
    expect(new Set(registered).size).toBe(registered.length);

    for (const source of AllToolImportSources) {
      expect(ToolImportAdapterRegistry.getAdapter(source).source).toBe(source);
    }
  });

  test("a tool without an adapter is refused, never guessed", () => {
    expect(() => {
      ToolImportAdapterRegistry.getAdapter("Elsewhere" as ToolImportSource);
    }).toThrow(BadDataException);
  });
});

describe.each(AllToolImportSources)(
  "the %s adapter keeps the rules every tool's adapter keeps",
  (source: ToolImportSource) => {
    const adapter: ToolImportAdapter =
      ToolImportAdapterRegistry.getAdapter(source);
    const definition: ToolImportSourceDefinition =
      getToolImportSourceDefinition(source);

    test.each(regionsOf(source))(
      "in region '$value' it calls only $host, with the key in a header and never in a URL",
      async (region: ToolImportRegion) => {
        const recorded: Recorded = await readWithRefusedKey({
          adapter,
          apiKey: KEY,
          region: region.value,
        });

        expect(recorded.requests.length).toBeGreaterThan(0);

        for (const request of recorded.requests) {
          const url: URL = new URL(request.url);

          expect(request.method).toBe("GET");
          expect(url.protocol).toBe("https:");
          expect(url.host).toBe(region.host);
          expect(definition.hosts).toContain(url.host);
          expect(request.url).not.toContain(KEY);
          expect(
            Object.values(request.headers).some((value: string): boolean => {
              return value.includes(KEY);
            }),
          ).toBe(true);
        }
      },
    );

    test("a key the tool refuses is a plain message naming the tool, without the key", async () => {
      const recorded: Recorded = await readWithRefusedKey({
        adapter,
        apiKey: KEY,
        region: regionsOf(source)[0]!.value,
      });

      expect(recorded.error).toBeInstanceOf(ToolImportReadError);

      const message: string = (recorded.error as Error).message;

      expect(message).toContain(definition.title);
      expect(message).toContain("API key");
      expect(message).not.toContain(KEY);
    });

    test("nothing is called without a key, or for a region the tool does not have", async () => {
      for (const attempt of [
        { apiKey: "   ", region: regionsOf(source)[0]!.value },
        { apiKey: KEY, region: "MOON" },
        { apiKey: KEY, region: "https://elsewhere.example.com" },
      ]) {
        const recorded: Recorded = await readWithRefusedKey({
          adapter,
          ...attempt,
        });

        expect(recorded.error).toBeInstanceOf(ToolImportReadError);
        expect(recorded.requests).toEqual([]);
      }
    });
  },
);
