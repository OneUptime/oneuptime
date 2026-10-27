import ExternalStatusPageComponentCatalog, {
  CATALOG_REQUEST_INIT,
  CatalogAnswer,
  CatalogFetch,
  ExternalStatusPageCatalog,
  ExternalStatusPageCatalogError,
  ExternalStatusPageCatalogProblem,
  MAX_ANSWER_BYTES,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ExternalStatusPageComponentCatalog";
import ExternalStatusPageProviderType from "../../../Types/Monitor/ExternalStatusPageProviderType";
import { ExternalStatusPageComponent } from "../../../Utils/Monitor/ExternalStatusPageReading";
import {
  GITHUB_PAGE,
  OPENAI_PAGE,
  atlassianComponentsJSON,
  incidentIoProxyJSON,
  withStatuses,
} from "../../Helpers/ExternalStatusPageFixtures";
import {
  FAKE_STATUSES,
  fakeSummaryJSON,
} from "../../Helpers/FakeStatusPageOverview";
import { describe, expect, test } from "@jest/globals";

/*
 * THE COMPONENTS OF A STATUS PAGE, AS THE MONITOR FORM'S PICKER READS THEM
 * (issue #5156).
 *
 * The picker reads a page in the person's browser - the providers that
 * list components answer any web page - in the probe's order for Auto:
 * incident.io, Atlassian Statuspage, then a OneUptime status page. A
 * provider whose address the browser cannot reach or read (the request
 * throws, as a fetch the page does not allow does) is passed over. Nothing
 * of OneUptime's goes with a request, an answer is read for at most
 * MAX_ANSWER_BYTES, and a page that cannot be read says why.
 *
 * The browser's fetch is replaced by fake pages that answer as each
 * provider does (ExternalStatusPageFixtures, FakeStatusPageOverview).
 */

const GITHUB: string = "https://www." + "githubstatus.com";
const OPENAI: string = "https://status.openai.com";
const ONEUPTIME: string = "https://status.upstream.example";

interface FakePage {
  // Path -> JSON answer; anything else is a 404.
  answers: Record<string, unknown>;
  // The browser cannot read this origin at all (no CORS, or unreachable).
  isUnreadable?: boolean;
}

interface Asked {
  url: string;
  init: RequestInit;
}

function answer(status: number, body: string): CatalogAnswer {
  return {
    ok: status >= 200 && status < 300,
    status: status,
    headers: { get: (): string | null => null },
    body: null,
    text: async (): Promise<string> => {
      return body;
    },
  };
}

function fakeFetch(
  pages: Record<string, FakePage>,
  asked: Array<Asked> = [],
): CatalogFetch {
  return async (url: string, init: RequestInit): Promise<CatalogAnswer> => {
    asked.push({ url, init });

    const parsed: URL = new URL(url);
    const page: FakePage | undefined = pages[parsed.origin];

    if (!page || page.isUnreadable) {
      // As window.fetch fails a request the browser may not read.
      throw new TypeError("Failed to fetch");
    }

    const body: unknown = page.answers[parsed.pathname];

    return body === undefined
      ? answer(404, "<!DOCTYPE html><html></html>")
      : answer(200, JSON.stringify(body));
  };
}

const PAGES: Record<string, FakePage> = {
  [GITHUB]: {
    answers: {
      "/api/v2/components.json": atlassianComponentsJSON(
        withStatuses(GITHUB_PAGE, { Copilot: "major_outage" }),
      ),
    },
  },
  [OPENAI]: {
    answers: {
      "/proxy/status.openai.com": incidentIoProxyJSON(OPENAI_PAGE, []),
      // The Statuspage-shaped shim incident.io pages serve.
      "/api/v2/status.json": { status: { indicator: "none" } },
    },
  },
  [ONEUPTIME]: {
    answers: {
      "/status-page-api/summary/status.upstream.example": fakeSummaryJSON({
        resources: [
          {
            id: "5e300000-0000-4000-8000-000000000d01",
            name: "Checkout API",
            monitorId: "5e300000-0000-4000-8000-000000000a01",
            statusId: FAKE_STATUSES.offline.id,
          },
        ],
      }),
    },
  },
};

async function read(
  statusPageUrl: string,
  provider: ExternalStatusPageProviderType = ExternalStatusPageProviderType.Auto,
  pages: Record<string, FakePage> = PAGES,
  asked: Array<Asked> = [],
): Promise<ExternalStatusPageCatalog> {
  return ExternalStatusPageComponentCatalog.read({
    statusPageUrl: statusPageUrl,
    provider: provider,
    fetch: fakeFetch(pages, asked),
  });
}

async function problemOf(
  promise: Promise<ExternalStatusPageCatalog>,
): Promise<ExternalStatusPageCatalogProblem | string> {
  try {
    await promise;
    return "read";
  } catch (error: unknown) {
    return error instanceof ExternalStatusPageCatalogError
      ? error.problem
      : String(error);
  }
}

function names(catalog: ExternalStatusPageCatalog): Array<string> {
  return catalog.components.map(
    (component: ExternalStatusPageComponent): string => {
      return component.name;
    },
  );
}

describe("a page whose provider lists components", () => {
  test("GitHub's Statuspage: incident.io asked first, then its components, as the probe reads them", async () => {
    const asked: Array<Asked> = [];
    const catalog: ExternalStatusPageCatalog = await read(
      GITHUB,
      ExternalStatusPageProviderType.Auto,
      PAGES,
      asked,
    );

    expect(
      asked.map((entry: Asked): string => {
        return entry.url;
      }),
    ).toEqual([
      `${GITHUB}/proxy/www.${"githubstatus.com"}`,
      `${GITHUB}/api/v2/components.json`,
    ]);
    expect(catalog.provider).toBe(
      ExternalStatusPageProviderType.AtlassianStatuspage,
    );
    expect(catalog.host).toBe("www." + "githubstatus.com");
    expect(names(catalog)).toEqual(
      GITHUB_PAGE.components.map((component: { name: string }): string => {
        return component.name;
      }),
    );
    expect(
      catalog.components.find(
        (component: ExternalStatusPageComponent): boolean => {
          return component.name === "Copilot";
        },
      )?.status,
    ).toBe("major_outage");
  });

  test("OpenAI's incident.io page: its components in their groups, from one request", async () => {
    const asked: Array<Asked> = [];
    const catalog: ExternalStatusPageCatalog = await read(
      OPENAI,
      ExternalStatusPageProviderType.Auto,
      PAGES,
      asked,
    );

    expect(asked).toHaveLength(1);
    expect(catalog.provider).toBe(ExternalStatusPageProviderType.IncidentIo);
    expect(catalog.components[0]).toEqual(
      expect.objectContaining({ name: "Chat Completions", groupName: "APIs" }),
    );
  });

  test("a OneUptime status page: its resources, by its summary", async () => {
    const catalog: ExternalStatusPageCatalog = await read(ONEUPTIME);

    expect(catalog.provider).toBe(ExternalStatusPageProviderType.OneUptime);
    expect(catalog.components).toEqual([
      expect.objectContaining({
        name: "Checkout API",
        status: "major_outage",
      }),
    ]);
  });

  test("the provider chosen is the only one asked", async () => {
    const asked: Array<Asked> = [];

    await read(
      GITHUB,
      ExternalStatusPageProviderType.AtlassianStatuspage,
      PAGES,
      asked,
    );

    expect(
      asked.map((entry: Asked): string => {
        return entry.url;
      }),
    ).toEqual([`${GITHUB}/api/v2/components.json`]);
    expect(
      await problemOf(
        read(GITHUB, ExternalStatusPageProviderType.IncidentIo),
      ),
    ).toBe(ExternalStatusPageCatalogProblem.NotRead);
  });

  test("an address typed without https:// is read as https", async () => {
    expect(names(await read("www." + "githubstatus.com"))).toHaveLength(12);
  });

  test("an address with a path is read where the probe reads it: the Statuspage under it, incident.io at its origin", async () => {
    const asked: Array<Asked> = [];

    expect(
      await problemOf(
        read(`${GITHUB}/history`, ExternalStatusPageProviderType.Auto, PAGES, asked),
      ),
    ).toBe(ExternalStatusPageCatalogProblem.NotRead);
    expect(
      asked.map((entry: Asked): string => {
        return entry.url;
      }),
    ).toEqual([
      `${GITHUB}/proxy/www.${"githubstatus.com"}`,
      `${GITHUB}/history/api/v2/components.json`,
      `${GITHUB}/status-page-api/summary/www.${"githubstatus.com"}`,
    ]);
  });
});

describe("a request carries nothing of OneUptime's", () => {
  test("no cookies, no referrer, nothing but Accept, and a signal to stop it", async () => {
    const asked: Array<Asked> = [];

    await read(GITHUB, ExternalStatusPageProviderType.Auto, PAGES, asked);

    for (const entry of asked) {
      expect(entry.init).toEqual(
        expect.objectContaining({
          method: "GET",
          mode: "cors",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          headers: { Accept: "application/json" },
        }),
      );
      expect(entry.init.signal).toBeDefined();
    }

    expect(CATALOG_REQUEST_INIT.credentials).toBe("omit");
  });
});

describe("a page that cannot be read says why", () => {
  test("no address, or not an http(s) one", async () => {
    for (const address of ["", "   ", "ftp://status.example.com", "status", "https://"]) {
      expect({
        address,
        problem: await problemOf(read(address)),
      }).toEqual({
        address,
        problem: ExternalStatusPageCatalogProblem.NoAddress,
      });
    }
  });

  test("an RSS or Atom feed: no components to read, and nothing asked", async () => {
    for (const provider of [
      ExternalStatusPageProviderType.RSS,
      ExternalStatusPageProviderType.Atom,
    ]) {
      const asked: Array<Asked> = [];

      expect(
        await problemOf(read(`${GITHUB}/history.rss`, provider, PAGES, asked)),
      ).toBe(ExternalStatusPageCatalogProblem.Feed);
      expect(asked).toEqual([]);
    }
  });

  test("a page the browser cannot read: every provider tried, then why", async () => {
    const asked: Array<Asked> = [];

    expect(
      await problemOf(
        read(
          GITHUB,
          ExternalStatusPageProviderType.Auto,
          { [GITHUB]: { answers: {}, isUnreadable: true } },
          asked,
        ),
      ),
    ).toBe(ExternalStatusPageCatalogProblem.NotRead);
    expect(asked).toHaveLength(3);
  });

  test("a page that answers, but in no format that lists components", async () => {
    expect(
      await problemOf(
        read("https://status.plain.example", ExternalStatusPageProviderType.Auto, {
          "https://status.plain.example": { answers: {} },
        }),
      ),
    ).toBe(ExternalStatusPageCatalogProblem.NotRead);
  });

  test("a page that lists no components", async () => {
    expect(
      await problemOf(
        read(GITHUB, ExternalStatusPageProviderType.Auto, {
          [GITHUB]: {
            answers: { "/api/v2/components.json": { components: [] } },
          },
        }),
      ),
    ).toBe(ExternalStatusPageCatalogProblem.NoComponents);
  });

  test("a page that takes too long", async () => {
    const never: CatalogFetch = (
      _url: string,
      init: RequestInit,
    ): Promise<CatalogAnswer> => {
      return new Promise<CatalogAnswer>(
        (_resolve: (value: CatalogAnswer) => void, reject: (error: unknown) => void) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        },
      );
    };

    expect(
      await problemOf(
        ExternalStatusPageComponentCatalog.read({
          statusPageUrl: GITHUB,
          provider: ExternalStatusPageProviderType.Auto,
          fetch: never,
          timeoutInMs: 20,
        }),
      ),
    ).toBe(ExternalStatusPageCatalogProblem.TimedOut);
  });

  test("a read the caller stops is stopped, its requests with it", async () => {
    const controller: AbortController = new AbortController();
    const signals: Array<AbortSignal> = [];
    const hanging: CatalogFetch = (
      _url: string,
      init: RequestInit,
    ): Promise<CatalogAnswer> => {
      signals.push(init.signal as AbortSignal);

      return new Promise<CatalogAnswer>(
        (_resolve: (value: CatalogAnswer) => void, reject: (error: unknown) => void) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        },
      );
    };

    const reading: Promise<ExternalStatusPageCatalogProblem | string> =
      problemOf(
        ExternalStatusPageComponentCatalog.read({
          statusPageUrl: GITHUB,
          provider: ExternalStatusPageProviderType.Auto,
          fetch: hanging,
          signal: controller.signal,
        }),
      );

    controller.abort();

    expect(await reading).toBe(ExternalStatusPageCatalogProblem.NotRead);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(true);
  });
});

describe("an answer is read for at most so much", () => {
  function streamed(chunks: Array<Uint8Array>): CatalogAnswer {
    let index: number = 0;
    let cancelled: boolean = false;

    return {
      ok: true,
      status: 200,
      headers: { get: (): string | null => null },
      body: {
        getReader: () => {
          return {
            read: async (): Promise<{
              done: boolean;
              value?: Uint8Array | undefined;
            }> => {
              if (cancelled || index >= chunks.length) {
                return { done: true };
              }

              return { done: false, value: chunks[index++] };
            },
            cancel: async (): Promise<void> => {
              cancelled = true;
            },
          };
        },
      },
      text: async (): Promise<string> => {
        throw new Error("A streamed answer is read by its reader.");
      },
    };
  }

  test("an answer said to be longer is not read", async () => {
    let wasRead: boolean = false;

    expect(
      await ExternalStatusPageComponentCatalog.readText({
        ok: true,
        status: 200,
        headers: {
          get: (name: string): string | null => {
            return name === "content-length" ? String(MAX_ANSWER_BYTES + 1) : null;
          },
        },
        body: null,
        text: async (): Promise<string> => {
          wasRead = true;
          return "{}";
        },
      }),
    ).toBeNull();
    expect(wasRead).toBe(false);
  });

  test("an answer that turns out longer is stopped where it passes the limit", async () => {
    const chunk: Uint8Array = new Uint8Array(1024 * 1024).fill(0x20);

    expect(
      await ExternalStatusPageComponentCatalog.readText(
        streamed([chunk, chunk, chunk, chunk, chunk, chunk]),
      ),
    ).toBeNull();
  });

  test("an answer within the limit is read whole, in UTF-8", async () => {
    const encoder: TextEncoder = new TextEncoder();
    const text: string = JSON.stringify({ name: "Zürich — 東京" });
    const bytes: Uint8Array = encoder.encode(text);

    expect(
      await ExternalStatusPageComponentCatalog.readText(
        streamed([bytes.slice(0, 5), bytes.slice(5)]),
      ),
    ).toBe(text);
  });

  test("a page whose answer is too long lists nothing", async () => {
    const huge: CatalogFetch = async (): Promise<CatalogAnswer> => {
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name: string): string | null => {
            return name === "content-length" ? String(MAX_ANSWER_BYTES * 2) : null;
          },
        },
        body: null,
        text: async (): Promise<string> => {
          return "{}";
        },
      };
    };

    expect(
      await problemOf(
        ExternalStatusPageComponentCatalog.read({
          statusPageUrl: GITHUB,
          provider: ExternalStatusPageProviderType.AtlassianStatuspage,
          fetch: huge,
        }),
      ),
    ).toBe(ExternalStatusPageCatalogProblem.NotRead);
  });
});

describe("the address a page is read at", () => {
  test.each([
    ["https://www.example.com", "www.example.com"],
    ["www.example.com", "www.example.com"],
    ["  https://status.example.com/incidents  ", "status.example.com"],
    ["http://localhost:8080", "localhost:8080"],
    ["https://10.0.0.5", "10.0.0.5"],
  ])("%s is read at %s", (url: string, host: string) => {
    expect(ExternalStatusPageComponentCatalog.getAddress(url)?.host).toBe(host);
  });

  test.each([[""], ["status"], ["mailto:someone@example.com"], ["javascript:alert(1)"]])(
    "%p is no address to read",
    (url: string) => {
      expect(ExternalStatusPageComponentCatalog.getAddress(url)).toBeNull();
    },
  );

  test("Auto asks the providers in the probe's order; a feed provider, none", () => {
    expect(
      ExternalStatusPageComponentCatalog.getProvidersToAsk(
        ExternalStatusPageProviderType.Auto,
      ),
    ).toEqual([
      ExternalStatusPageProviderType.IncidentIo,
      ExternalStatusPageProviderType.AtlassianStatuspage,
      ExternalStatusPageProviderType.OneUptime,
    ]);
    expect(
      ExternalStatusPageComponentCatalog.getProvidersToAsk(
        ExternalStatusPageProviderType.RSS,
      ),
    ).toEqual([]);
  });
});
