import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { inlineCode } from "./DocsTranslationChecks";
import { flattened, otherChangesItems } from "./UpgradingDocsNotes";
import {
  ClusterKeyRoute,
  SERVICE_MIDDLEWARE,
  findClusterKeyRoutes,
} from "Common/Tests/Server/TestingUtils/ClusterKeyRoutes";
import {
  OPERATOR_CLUSTER_KEYS,
  restoreClusterKey,
  setClusterKey,
} from "Common/Tests/Server/TestingUtils/ShippedClusterKeys";
import { afterAll, describe, expect, it, jest } from "@jest/globals";
import fs from "fs";
import path from "path";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

/*
 * The upgrade note on the header ONEUPTIME_SECRET travels in
 * (installation/upgrading, "Other changes in 14"), held to the code it
 * describes:
 *
 *   - the header it names is the one OneUptime's services present
 *     (ClusterKeyAuthorization.getClusterKeyHeaders), and a request whose
 *     URL carries the key is refused;
 *   - no route reads a body for the key: every route ClusterKeyRoutes finds
 *     is handed the check that reads the header alone, which finds no key in
 *     a body, and no Runner registers with the key any more;
 *   - the routes it says are removed take the cluster key nowhere, and no
 *     router of the product serves them any more;
 *   - the support bundle it points at reads the queues;
 *   - it sits after the note on a placeholder ONEUPTIME_SECRET and before
 *     the note on PostgreSQL's port and password;
 *   - every translation carries it in the English note's place, under a
 *     lead of its own, with the English note's code.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPO_ROOT: string = path.resolve(PACKAGES_DIR, "..");

const NOTE_LEAD: string =
  "**OneUptime's own services send `ONEUPTIME_SECRET` in a header, and only to the routes that take it.**";
// The note before it (ClusterKeyUpgradeDocs).
const PREVIOUS_LEAD: string =
  "**OneUptime refuses a placeholder `ONEUPTIME_SECRET`.**";
// The note after it (DatabasePortDocs).
const NEXT_LEAD: string =
  "**PostgreSQL answers only on the server itself, and a new install starts with a database password of its own.**";

// The routes the note says are gone, as it writes them.
const REMOVED_QUEUE_ROUTES: Array<string> = [
  "GET .../queue/stats",
  "GET .../queue/size",
  "GET .../queue/failed",
];
const REMOVED_MONITOR_ROUTES: Array<string> = [
  "GET /monitor/pending-count/...",
  "GET /monitor/pending-list/...",
];

// Where the product's routers live.
const ROUTER_DIRECTORIES: Array<string> = [
  "packages/App/FeatureSet",
  "packages/Common/Server",
];

const CODE_FILE: RegExp = /\.(?:ts|tsx)$/;

const TRANSLATIONS: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

type AnyModule = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function source(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

// Every code file under a directory, from the repository root.
function codeFiles(relativeDirectory: string): Array<string> {
  const found: Array<string> = [];
  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(path.join(REPO_ROOT, directory), {
      withFileTypes: true,
    })) {
      const relativePath: string = `${directory}/${entry.name}`;

      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "build") {
          walk(relativePath);
        }
      } else if (CODE_FILE.test(entry.name)) {
        found.push(relativePath);
      }
    }
  };

  walk(relativeDirectory);

  return found;
}

// The path a removed route was served at, as a router would write it.
function servedPath(written: string): string {
  return written.replace("GET ", "").replace(".../", "/").replace("/...", "/");
}

/*
 * One app process of an installation whose operator set ONEUPTIME_SECRET:
 * its cluster key middleware, as it loads.
 */
function loadMiddleware(): AnyModule {
  setClusterKey(OPERATOR_CLUSTER_KEYS[0]!.value);

  let loaded: AnyModule = null;

  try {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      loaded = require("Common/Server/Middleware/ClusterKeyAuthorization");
    });
  } finally {
    restoreClusterKey();
  }

  return loaded;
}

afterAll(() => {
  restoreClusterKey();
});

const ENGLISH_ITEMS: Array<string> = otherChangesItems("en");
const NOTE_INDEX: number = ENGLISH_ITEMS.findIndex((item: string): boolean => {
  return flattened(item).startsWith(`- ${NOTE_LEAD}`);
});
const ENGLISH_NOTE: string = flattened(ENGLISH_ITEMS[NOTE_INDEX] || "");

describe("the English upgrade note on the header ONEUPTIME_SECRET travels in", () => {
  it("is a note of the 13 → 14 changes, once, after the note on a placeholder ONEUPTIME_SECRET and before the note on PostgreSQL's port and password", () => {
    expect(NOTE_INDEX).toBeGreaterThan(0);
    expect(
      ENGLISH_ITEMS.filter((item: string): boolean => {
        return flattened(item).includes(NOTE_LEAD);
      }),
    ).toHaveLength(1);
    expect(
      flattened(ENGLISH_ITEMS[NOTE_INDEX - 1]!).startsWith(
        `- ${PREVIOUS_LEAD}`,
      ),
    ).toBe(true);
    expect(
      flattened(ENGLISH_ITEMS[NOTE_INDEX + 1]!).startsWith(`- ${NEXT_LEAD}`),
    ).toBe(true);
  });

  it("names the header OneUptime's services present the key in, and says a URL that carries it is refused", async () => {
    const middleware: AnyModule = loadMiddleware();
    const ClusterKeyAuthorization: AnyModule = middleware.default;
    const headers: Record<string, string> =
      ClusterKeyAuthorization.getClusterKeyHeaders();

    expect(Object.keys(headers)).toEqual(["clusterkey"]);
    expect(inlineCode(ENGLISH_NOTE)).toContain("clusterkey");
    expect(ENGLISH_NOTE).toContain(
      "Those routes read it from the `clusterkey` request header alone. A request whose URL carries it is refused",
    );

    const sent: Array<unknown> = [];
    const res: Record<string, unknown> = {};

    res["status"] = (): unknown => {
      return res;
    };
    res["send"] = (body: unknown): void => {
      sent.push(body);
    };

    let passed: boolean = false;

    await ClusterKeyAuthorization.isAuthorizedServiceMiddleware(
      { headers: headers, query: { clusterKey: headers["clusterkey"] } },
      res,
      () => {
        passed = true;
      },
    );

    expect(passed).toBe(false);
    expect(sent).toEqual([
      expect.objectContaining({
        message: middleware.CLUSTER_KEY_IN_URL_MESSAGE,
      }),
    ]);
  });

  it("says the key is read from the header alone, never from a body", () => {
    expect(ENGLISH_NOTE).toContain(
      "Those routes read it from the `clusterkey` request header alone.",
    );
    // The in-cluster Runner's registration read a body for it; that Runner is gone.
    expect(ENGLISH_NOTE).not.toContain("a body is read");
  });

  it("is held to code in which no route reads a body for the key, and no Runner registers with it", async () => {
    const routes: Array<ClusterKeyRoute> = findClusterKeyRoutes();

    // Every route is handed the check that reads the header alone.
    expect(routes.length).toBeGreaterThan(0);
    expect(
      routes
        .filter((route: ClusterKeyRoute): boolean => {
          return route.middleware !== SERVICE_MIDDLEWARE;
        })
        .map((route: ClusterKeyRoute): string => {
          return `${route.method} ${route.file}`;
        }),
    ).toEqual([]);

    // That check finds no key in a body, the right one included.
    const middleware: AnyModule = loadMiddleware();
    const ClusterKeyAuthorization: AnyModule = middleware.default;
    const sent: Array<unknown> = [];
    const res: Record<string, unknown> = {};

    res["status"] = (): unknown => {
      return res;
    };
    res["send"] = (body: unknown): void => {
      sent.push(body);
    };

    let passed: boolean = false;

    await ClusterKeyAuthorization.isAuthorizedServiceMiddleware(
      {
        headers: {},
        query: {},
        params: {},
        body: { clusterKey: ClusterKeyAuthorization.getClusterKey() },
      },
      res,
      () => {
        passed = true;
      },
    );

    expect(passed).toBe(false);
    expect(sent).toEqual([
      expect.objectContaining({
        message: middleware.CLUSTER_KEY_NOT_FOUND_MESSAGE,
      }),
    ]);

    // The Runner's registration with the key is gone, from the Runner too.
    expect(source("packages/Runner/Services/RegisterRunner.ts")).not.toContain(
      "/api/ai-agent/register",
    );
  });

  it("names as removed routes that no router serves and that take the key nowhere", () => {
    expect(inlineCode(ENGLISH_NOTE)).toEqual(
      expect.arrayContaining([
        ...REMOVED_QUEUE_ROUTES,
        ...REMOVED_MONITOR_ROUTES,
      ]),
    );

    const routes: Array<ClusterKeyRoute> = findClusterKeyRoutes();

    expect(routes.length).toBeGreaterThan(0);

    for (const written of [
      ...REMOVED_QUEUE_ROUTES,
      ...REMOVED_MONITOR_ROUTES,
    ]) {
      const served: string = servedPath(written);

      expect({
        written,
        takesTheKey: routes.some((route: ClusterKeyRoute): boolean => {
          return route.path.includes(served);
        }),
      }).toEqual({ written, takesTheKey: false });

      const servers: Array<string> = ROUTER_DIRECTORIES.flatMap(codeFiles)
        .filter((relativePath: string): boolean => {
          return !relativePath.includes("/Tests/");
        })
        .filter((relativePath: string): boolean => {
          return source(relativePath).includes(served);
        });

      expect({ written, servers }).toEqual({ written, servers: [] });
    }
  });

  it("points at the support bundle, which reads the queues", () => {
    expect(ENGLISH_NOTE).toContain(
      "The support bundle in the Admin Dashboard shows the queues.",
    );

    const adminHealth: string = source("packages/App/API/AdminHealth.ts");

    expect(adminHealth).toContain('"/support-bundle"');
    expect(adminHealth).toContain("getQueueDiagnostics()");
  });

  it("tells a script's owner where the key goes now, and when to change it", () => {
    expect(ENGLISH_NOTE).toContain(
      "A script of yours that calls a route with `ONEUPTIME_SECRET` sends it in the `clusterkey` header now, and if it ever put it in a URL, change `ONEUPTIME_SECRET` on the app and on every service that uses it.",
    );
    expect(ENGLISH_NOTE).toContain(
      "An installation's own services need no change, during a rolling upgrade too.",
    );
  });
});

describe.each(TRANSLATIONS)(
  "the %s upgrade note on the header ONEUPTIME_SECRET travels in",
  (language: string) => {
    const items: Array<string> = otherChangesItems(language);
    const note: string = flattened(items[NOTE_INDEX] || "");

    it("is in the English note's place, under a lead of its own", () => {
      expect(note.startsWith("- **")).toBe(true);
      expect(note).not.toContain(NOTE_LEAD);
      expect(items.length).toBe(ENGLISH_ITEMS.length);
    });

    it("carries the English note's code, in the English order", () => {
      expect(inlineCode(note)).toEqual(inlineCode(ENGLISH_NOTE));
    });
  },
);
