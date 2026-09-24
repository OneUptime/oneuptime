import { afterAll, describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { URL } from "url";
import vm from "vm";
import { FRONTEND_ENVIRONMENT_CACHE_CONTROL } from "../../Server/Utils/FrontendEnvironment";

/*
 * Common/Scripts/generate-service-worker.js turns the Dashboard's
 * sw.js.template into public/sw.js at build time, and the Enterprise split
 * gives it two new jobs:
 *
 *   1. The cache version carries the EDITION. The Community and Enterprise
 *      images of one release share APP_VERSION and GIT_SHA but bundle a
 *      different Dashboard, and the worker serves /dist/ assets cache-first, so
 *      without the edition a browser keeps the other edition's bundle after a
 *      deployment switches images. The edition is decided exactly as the
 *      frontend build decides it (Common/UI/esbuild-enterprise.js):
 *      ONEUPTIME_EDITION, else "is ee/<Frontend>/Index.tsx on disk".
 *
 *   2. env.js is network-only: never written to a cache, never answered
 *      from one. The server renders it per deployment (the edition among it)
 *      and sends it Cache-Control: no-store; as a .js path it used to fall
 *      into the cache-first static-asset strategy, and then into a
 *      network-first one that still kept a copy.
 *
 *   3. More generally, no strategy writes a response the server marked
 *      Cache-Control: no-store to a cache.
 *
 * The generator runs in a node subprocess, the way the build runs it. The
 * generated worker then runs for real in a vm context against fake caches and
 * a fake network, so the caching assertions are about behaviour, not text.
 * Every ee/ here is a fixture (ONEUPTIME_EE_DIR, or a fake repository or image
 * layout): the Common Test job runs with ee/ removed.
 */

const GENERATOR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "Scripts",
  "generate-service-worker.js",
);

const DASHBOARD_TEMPLATE: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "sw.js.template",
);

const CACHE_VERSION_LINE: RegExp = /const CACHE_VERSION = '([^']+)';/;
const UNREPLACED_PLACEHOLDER: RegExp = /\{\{[A-Z_]+\}\}/;

const temporaryRoots: Array<string> = [];

function makeTempDir(prefix: string): string {
  const root: string = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

type ChildEnvironment = Record<string, string>;

/*
 * The child's environment: this process's, minus anything that would decide
 * the edition or the version for it, plus the overrides.
 */
function childEnvironment(overrides: ChildEnvironment): ChildEnvironment {
  const environment: ChildEnvironment = {};

  for (const key of Object.keys(process.env)) {
    const value: string | undefined = process.env[key];

    if (typeof value === "string") {
      environment[key] = value;
    }
  }

  delete environment["ONEUPTIME_EDITION"];
  delete environment["ONEUPTIME_EE_DIR"];
  delete environment["APP_VERSION"];
  delete environment["GIT_SHA"];

  return { ...environment, ...overrides };
}

// An ee/ fixture holding the plugin entry of the given frontends.
function makeEnterpriseDir(frontends: Array<string>): string {
  const eeDir: string = makeTempDir("sw-ee-");

  for (const frontend of frontends) {
    fs.mkdirSync(path.join(eeDir, frontend), { recursive: true });
    fs.writeFileSync(
      path.join(eeDir, frontend, "Index.tsx"),
      "export default {};\n",
    );
  }

  return eeDir;
}

interface EditionResult {
  edition: string | null;
  error: string | null;
}

// getEdition(frontendDir, env), run in a subprocess.
function readEdition(
  frontendDir: string,
  env: ChildEnvironment,
): EditionResult {
  const script: string = `
    const generator = require(${JSON.stringify(GENERATOR)});
    try {
      console.log(JSON.stringify({ edition: generator.getEdition(${JSON.stringify(frontendDir)}, ${JSON.stringify(env)}), error: null }));
    } catch (error) {
      console.log(JSON.stringify({ edition: null, error: error.message }));
    }
  `;

  return JSON.parse(
    childProcess
      .execFileSync(process.execPath, ["-e", script], {
        encoding: "utf8",
        env: childEnvironment({}),
      })
      .trim(),
  ) as EditionResult;
}

// A frontend directory holding a copy of the real Dashboard template.
function makeFrontendDir(parent: string, frontendName: string): string {
  const frontendDir: string = path.join(parent, frontendName);
  fs.mkdirSync(frontendDir, { recursive: true });
  fs.copyFileSync(DASHBOARD_TEMPLATE, path.join(frontendDir, "sw.js.template"));
  return frontendDir;
}

interface GenerateResult {
  status: number;
  output: string;
  worker: string;
}

// Runs the generator's CLI the way the Dashboard build does.
function generate(
  env: ChildEnvironment,
  frontendName: string = "Dashboard",
): GenerateResult {
  const frontendDir: string = makeFrontendDir(
    makeTempDir("sw-frontend-"),
    frontendName,
  );
  const outputPath: string = path.join(frontendDir, "public", "sw.js");

  const result: childProcess.SpawnSyncReturns<string> = childProcess.spawnSync(
    process.execPath,
    [
      GENERATOR,
      path.join(frontendDir, "sw.js.template"),
      outputPath,
      "OneUptime Dashboard",
    ],
    {
      encoding: "utf8",
      env: childEnvironment({
        APP_VERSION: "13.1.0",
        GIT_SHA: "0123abcd99887766",
        ...env,
      }),
    },
  );

  return {
    status: result.status ?? -1,
    output: `${result.stdout}${result.stderr}`,
    worker: fs.existsSync(outputPath)
      ? fs.readFileSync(outputPath, "utf8")
      : "",
  };
}

function cacheVersionOf(worker: string): string {
  const match: RegExpMatchArray | null = worker.match(CACHE_VERSION_LINE);
  return match?.[1] ?? "";
}

/*
 * ---------------------------------------------------------------------------
 * A minimal service-worker runtime: fake caches, a fake network, and the
 * event plumbing the worker uses.
 * ---------------------------------------------------------------------------
 */

interface FakeResponse {
  body: string;
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  clone: () => FakeResponse;
}

// Response headers by lower-case name, as the fake server sends them.
type FakeHeaders = Record<string, string>;

function makeResponse(
  body: string,
  date: Date = new Date(),
  headers: FakeHeaders = {},
  status: number = 200,
): FakeResponse {
  const response: FakeResponse = {
    body,
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string): string | null => {
        const key: string = name.toLowerCase();

        if (key in headers) {
          return headers[key] as string;
        }

        return key === "date" ? date.toUTCString() : null;
      },
    },
    clone: (): FakeResponse => {
      return response;
    },
  };
  return response;
}

interface FakeRequest {
  url: string;
  method: string;
  mode: string;
}

type RequestKey = FakeRequest | string;

function keyOf(request: RequestKey): string {
  return typeof request === "string" ? request : request.url;
}

class FakeCaches {
  public readonly stores: Map<string, Map<string, FakeResponse>> = new Map();

  public open(name: string): Promise<{
    put: (request: RequestKey, response: FakeResponse) => Promise<void>;
    addAll: (urls: Array<string>) => Promise<void>;
  }> {
    let store: Map<string, FakeResponse> | undefined = this.stores.get(name);

    if (!store) {
      store = new Map();
      this.stores.set(name, store);
    }

    const target: Map<string, FakeResponse> = store;

    return Promise.resolve({
      put: (request: RequestKey, response: FakeResponse): Promise<void> => {
        target.set(keyOf(request), response);
        return Promise.resolve();
      },
      addAll: (): Promise<void> => {
        return Promise.resolve();
      },
    });
  }

  public match(request: RequestKey): Promise<FakeResponse | undefined> {
    for (const store of this.stores.values()) {
      const hit: FakeResponse | undefined = store.get(keyOf(request));

      if (hit) {
        return Promise.resolve(hit);
      }
    }

    return Promise.resolve(undefined);
  }

  public keys(): Promise<Array<string>> {
    return Promise.resolve(Array.from(this.stores.keys()));
  }

  public delete(name: string): Promise<boolean> {
    return Promise.resolve(this.stores.delete(name));
  }
}

class FakeNetwork {
  public online: boolean = true;
  public readonly requests: Array<string> = [];
  // What the fake server sends for a URL beyond a plain 200.
  public readonly headersByUrl: Map<string, FakeHeaders> = new Map();
  public readonly statusByUrl: Map<string, number> = new Map();

  public fetch(request: RequestKey): Promise<FakeResponse> {
    const url: string = keyOf(request);
    this.requests.push(url);

    if (!this.online) {
      return Promise.reject(new Error("Failed to fetch"));
    }

    return Promise.resolve(
      makeResponse(
        `network:${url}`,
        new Date(),
        this.headersByUrl.get(url) || {},
        this.statusByUrl.get(url) || 200,
      ),
    );
  }
}

type Listener = (event: Record<string, unknown>) => void;

interface RunningWorker {
  listeners: Record<string, Listener>;
  caches: FakeCaches;
  network: FakeNetwork;
}

function startWorker(source: string): RunningWorker {
  const listeners: Record<string, Listener> = {};
  const caches: FakeCaches = new FakeCaches();
  const network: FakeNetwork = new FakeNetwork();
  const noop: () => void = (): void => {};

  class SandboxResponse {
    public readonly body: string;
    public readonly ok: boolean = false;
    public readonly status: number;

    public constructor(body: string, init: { status: number }) {
      this.body = body;
      this.status = init.status;
    }
  }

  vm.runInNewContext(source, {
    self: {
      addEventListener: (type: string, listener: Listener): void => {
        listeners[type] = listener;
      },
      skipWaiting: (): Promise<void> => {
        return Promise.resolve();
      },
      clients: {
        claim: (): Promise<void> => {
          return Promise.resolve();
        },
      },
      location: { origin: "https://oneuptime.example" },
    },
    caches,
    fetch: (request: RequestKey): Promise<FakeResponse> => {
      return network.fetch(request);
    },
    clients: {},
    Response: SandboxResponse,
    URL,
    console: { log: noop, error: noop, warn: noop },
  });

  return { listeners, caches, network };
}

async function fetchThroughWorker(
  worker: RunningWorker,
  url: string,
): Promise<FakeResponse> {
  const holder: { response: Promise<FakeResponse> | null } = { response: null };

  worker.listeners["fetch"]?.({
    request: { url, method: "GET", mode: "cors" },
    respondWith: (response: Promise<FakeResponse>): void => {
      holder.response = response;
    },
  });

  if (holder.response === null) {
    throw new Error(`the worker did not respond to ${url}`);
  }

  return await holder.response;
}

async function seedCache(
  worker: RunningWorker,
  cacheName: string,
  url: string,
  body: string,
  date: Date = new Date(),
): Promise<void> {
  const cache: {
    put: (request: RequestKey, response: FakeResponse) => Promise<void>;
  } = await worker.caches.open(cacheName);
  await cache.put(url, makeResponse(body, date));
}

// The names of the caches holding a copy of `url`.
function cachesHolding(worker: RunningWorker, url: string): Array<string> {
  return Array.from(worker.caches.stores.entries())
    .filter((entry: [string, Map<string, FakeResponse>]) => {
      return entry[1].has(url);
    })
    .map((entry: [string, Map<string, FakeResponse>]) => {
      return entry[0];
    });
}

// Lets the worker's un-awaited background cache refresh finish.
function settle(): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 20);
  });
}

const ORIGIN: string = "https://oneuptime.example";
// Older than the worker's 7-day static cache duration.
const EIGHT_DAYS_AGO: Date = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

describe("generate-service-worker.js", () => {
  afterAll(() => {
    while (temporaryRoots.length > 0) {
      fs.rmSync(temporaryRoots.pop() as string, {
        recursive: true,
        force: true,
      });
    }
  });

  describe("the edition, decided like the frontend build decides it", () => {
    test("auto: enterprise when this frontend's ee plugin exists", () => {
      const eeDir: string = makeEnterpriseDir(["Dashboard"]);
      const frontendDir: string = makeFrontendDir(
        makeTempDir("sw-edition-"),
        "Dashboard",
      );

      expect(readEdition(frontendDir, { ONEUPTIME_EE_DIR: eeDir })).toEqual({
        edition: "enterprise",
        error: null,
      });
    });

    test("auto: community when there is no ee plugin", () => {
      const eeDir: string = makeEnterpriseDir([]);
      const frontendDir: string = makeFrontendDir(
        makeTempDir("sw-edition-"),
        "Dashboard",
      );

      expect(
        readEdition(frontendDir, { ONEUPTIME_EE_DIR: eeDir }).edition,
      ).toBe("community");
    });

    test("auto: the plugin must be THIS frontend's (ee/<Frontend>/Index.tsx)", () => {
      const eeDir: string = makeEnterpriseDir(["AdminDashboard"]);
      const parent: string = makeTempDir("sw-edition-");

      expect(
        readEdition(makeFrontendDir(parent, "Dashboard"), {
          ONEUPTIME_EE_DIR: eeDir,
        }).edition,
      ).toBe("community");
      expect(
        readEdition(makeFrontendDir(parent, "AdminDashboard"), {
          ONEUPTIME_EE_DIR: eeDir,
        }).edition,
      ).toBe("enterprise");
      expect(
        readEdition(makeFrontendDir(parent, "Accounts"), {
          ONEUPTIME_EE_DIR: makeEnterpriseDir(["Dashboard", "AdminDashboard"]),
        }).edition,
      ).toBe("community");
    });

    test("auto: finds ee/ in the repository layout (packages/App/FeatureSet/<Frontend> -> <repo>/ee)", () => {
      const repository: string = makeTempDir("sw-repo-");
      const frontendDir: string = makeFrontendDir(
        path.join(repository, "packages", "App", "FeatureSet"),
        "Dashboard",
      );

      expect(readEdition(frontendDir, {}).edition).toBe("community");

      fs.mkdirSync(path.join(repository, "ee", "Dashboard"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(repository, "ee", "Dashboard", "Index.tsx"),
        "export default {};\n",
      );

      expect(readEdition(frontendDir, {}).edition).toBe("enterprise");
    });

    test("auto: finds ee/ in the image layout (/usr/src/app/FeatureSet/<Frontend> -> /usr/src/ee)", () => {
      const usrSrc: string = makeTempDir("sw-image-");
      const frontendDir: string = makeFrontendDir(
        path.join(usrSrc, "app", "FeatureSet"),
        "Dashboard",
      );
      fs.mkdirSync(path.join(usrSrc, "ee", "Dashboard"), { recursive: true });
      fs.writeFileSync(
        path.join(usrSrc, "ee", "Dashboard", "Index.tsx"),
        "export default {};\n",
      );

      expect(readEdition(frontendDir, {}).edition).toBe("enterprise");
    });

    test("auto: a directory named Index.tsx is not a plugin", () => {
      const eeDir: string = makeTempDir("sw-ee-dir-");
      fs.mkdirSync(path.join(eeDir, "Dashboard", "Index.tsx"), {
        recursive: true,
      });
      const frontendDir: string = makeFrontendDir(
        makeTempDir("sw-edition-"),
        "Dashboard",
      );

      expect(
        readEdition(frontendDir, { ONEUPTIME_EE_DIR: eeDir }).edition,
      ).toBe("community");
    });

    test("ONEUPTIME_EDITION=community wins even with the plugin on disk", () => {
      const eeDir: string = makeEnterpriseDir(["Dashboard"]);
      const frontendDir: string = makeFrontendDir(
        makeTempDir("sw-edition-"),
        "Dashboard",
      );

      expect(
        readEdition(frontendDir, {
          ONEUPTIME_EE_DIR: eeDir,
          ONEUPTIME_EDITION: "community",
        }).edition,
      ).toBe("community");
    });

    test("ONEUPTIME_EDITION=enterprise is enterprise (the bundle step fails if ee/ is missing)", () => {
      const frontendDir: string = makeFrontendDir(
        makeTempDir("sw-edition-"),
        "Dashboard",
      );

      expect(
        readEdition(frontendDir, {
          ONEUPTIME_EE_DIR: makeEnterpriseDir([]),
          ONEUPTIME_EDITION: " Enterprise ",
        }).edition,
      ).toBe("enterprise");
    });

    test("an unknown ONEUPTIME_EDITION is an error, not a guess", () => {
      const frontendDir: string = makeFrontendDir(
        makeTempDir("sw-edition-"),
        "Dashboard",
      );
      const result: EditionResult = readEdition(frontendDir, {
        ONEUPTIME_EDITION: "premium",
      });

      expect(result.edition).toBeNull();
      expect(result.error).toContain("ONEUPTIME_EDITION must be one of");
    });
  });

  describe("the generated worker", () => {
    test("puts the edition into the cache version: enterprise", () => {
      const result: GenerateResult = generate({
        ONEUPTIME_EE_DIR: makeEnterpriseDir(["Dashboard"]),
      });

      expect(result.status).toBe(0);
      expect(cacheVersionOf(result.worker)).toBe(
        "oneuptime-v13.1.0-enterprise-0123abcd",
      );
      expect(result.worker).toContain(" * Edition: enterprise");
      expect(result.output).toContain(
        "Cache version: oneuptime-v13.1.0-enterprise-0123abcd",
      );
    });

    test("puts the edition into the cache version: community", () => {
      const result: GenerateResult = generate({
        ONEUPTIME_EE_DIR: makeEnterpriseDir([]),
      });

      expect(result.status).toBe(0);
      expect(cacheVersionOf(result.worker)).toBe(
        "oneuptime-v13.1.0-community-0123abcd",
      );
    });

    test("the two editions of one release never share a cache version", () => {
      const community: string = cacheVersionOf(
        generate({ ONEUPTIME_EDITION: "community" }).worker,
      );
      const enterprise: string = cacheVersionOf(
        generate({
          ONEUPTIME_EDITION: "enterprise",
          ONEUPTIME_EE_DIR: makeEnterpriseDir(["Dashboard"]),
        }).worker,
      );

      expect(community).not.toBe("");
      expect(enterprise).not.toBe("");
      expect(community).not.toBe(enterprise);
      // And neither is a prefix of the other, which the activate clean-up relies on.
      expect(enterprise.startsWith(community)).toBe(false);
      expect(community.startsWith(enterprise)).toBe(false);
    });

    test("leaves no placeholder unreplaced", () => {
      const result: GenerateResult = generate({
        ONEUPTIME_EDITION: "community",
      });

      expect(result.worker).not.toMatch(UNREPLACED_PLACEHOLDER);
    });

    test("fails the build on an unknown ONEUPTIME_EDITION", () => {
      const result: GenerateResult = generate({ ONEUPTIME_EDITION: "premium" });

      expect(result.status).toBe(1);
      expect(result.output).toContain("ONEUPTIME_EDITION must be one of");
      expect(result.worker).toBe("");
    });
  });

  describe("the generated worker at runtime", () => {
    interface StartedWorker {
      worker: RunningWorker;
      cacheVersion: string;
    }

    function startEnterpriseWorker(): StartedWorker {
      const source: string = generate({
        ONEUPTIME_EE_DIR: makeEnterpriseDir(["Dashboard"]),
      }).worker;

      return {
        worker: startWorker(source),
        cacheVersion: cacheVersionOf(source),
      };
    }

    test("serves env.js from the network even when a cached copy exists", async () => {
      const started: StartedWorker = startEnterpriseWorker();
      const worker: RunningWorker = started.worker;
      const cacheVersion: string = started.cacheVersion;
      const url: string = `${ORIGIN}/dashboard/env.js`;
      await seedCache(worker, `${cacheVersion}-static`, url, "stale env.js");

      const response: FakeResponse = await fetchThroughWorker(worker, url);

      expect(response.body).toBe(`network:${url}`);
      expect(worker.network.requests).toEqual([url]);
    });

    test.each<[string, FakeHeaders]>([
      [
        "with the server's Cache-Control",
        { "cache-control": FRONTEND_ENVIRONMENT_CACHE_CONTROL },
      ],
      // A proxy that strips the header must not make env.js cacheable.
      ["with no Cache-Control at all", {}],
    ])(
      "never writes env.js to a cache (%s)",
      async (_label: string, headers: FakeHeaders) => {
        const worker: RunningWorker = startEnterpriseWorker().worker;
        const url: string = `${ORIGIN}/dashboard/env.js`;
        worker.network.headersByUrl.set(url, headers);

        const first: FakeResponse = await fetchThroughWorker(worker, url);
        const second: FakeResponse = await fetchThroughWorker(worker, url);
        await settle();

        expect(first.body).toBe(`network:${url}`);
        expect(second.body).toBe(`network:${url}`);
        expect(worker.network.requests).toEqual([url, url]);
        expect(cachesHolding(worker, url)).toEqual([]);
      },
    );

    test("offline, env.js is not answered from a copy an older worker cached", async () => {
      const started: StartedWorker = startEnterpriseWorker();
      const worker: RunningWorker = started.worker;
      const cacheVersion: string = started.cacheVersion;
      const url: string = `${ORIGIN}/dashboard/env.js`;
      await seedCache(
        worker,
        `${cacheVersion}-dynamic`,
        url,
        "last known env.js",
      );
      worker.network.online = false;

      const response: FakeResponse = await fetchThroughWorker(worker, url);

      expect(response.body).not.toBe("last known env.js");
      expect(response.status).toBe(503);
      expect(worker.network.requests).toEqual([url]);
    });

    test("treats every frontend's env.js the same way", async () => {
      const started: StartedWorker = startEnterpriseWorker();
      const worker: RunningWorker = started.worker;
      const cacheVersion: string = started.cacheVersion;
      const url: string = `${ORIGIN}/admin/env.js`;
      await seedCache(worker, `${cacheVersion}-static`, url, "stale env.js");

      expect((await fetchThroughWorker(worker, url)).body).toBe(
        `network:${url}`,
      );

      const fresh: string = `${ORIGIN}/status-page/env.js`;
      await fetchThroughWorker(worker, fresh);
      await settle();

      expect(cachesHolding(worker, fresh)).toEqual([]);
    });

    test("a page the server marks no-store is served but not cached (network first)", async () => {
      const started: StartedWorker = startEnterpriseWorker();
      const worker: RunningWorker = started.worker;
      const cacheVersion: string = started.cacheVersion;
      const noStore: string = `${ORIGIN}/dashboard/settings`;
      const cacheable: string = `${ORIGIN}/dashboard/home`;
      worker.network.headersByUrl.set(noStore, {
        "cache-control": FRONTEND_ENVIRONMENT_CACHE_CONTROL,
      });

      expect((await fetchThroughWorker(worker, noStore)).body).toBe(
        `network:${noStore}`,
      );
      await fetchThroughWorker(worker, cacheable);
      await settle();

      expect(cachesHolding(worker, noStore)).toEqual([]);
      // Negative control: the same strategy still caches a normal page.
      expect(cachesHolding(worker, cacheable)).toEqual([
        `${cacheVersion}-dynamic`,
      ]);
    });

    test("an asset the server marks no-store is served but not cached (cache first)", async () => {
      const started: StartedWorker = startEnterpriseWorker();
      const worker: RunningWorker = started.worker;
      const cacheVersion: string = started.cacheVersion;
      const noStore: string = `${ORIGIN}/dashboard/dist/Private.js`;
      const cacheable: string = `${ORIGIN}/dashboard/dist/Index.js`;
      worker.network.headersByUrl.set(noStore, { "cache-control": "no-store" });

      expect((await fetchThroughWorker(worker, noStore)).body).toBe(
        `network:${noStore}`,
      );
      await fetchThroughWorker(worker, cacheable);
      await settle();

      expect(cachesHolding(worker, noStore)).toEqual([]);
      expect(cachesHolding(worker, cacheable)).toEqual([
        `${cacheVersion}-static`,
      ]);

      // Not cached, so the next request goes to the network again.
      await fetchThroughWorker(worker, noStore);
      expect(
        worker.network.requests.filter((url: string) => {
          return url === noStore;
        }),
      ).toHaveLength(2);
    });

    test.each<[string, boolean]>([
      ["no-store", false],
      ["private, no-store", false],
      ["private, max-age=0", true],
    ])(
      "the background refresh of a stale asset (Cache-Control %p) replaces the cached copy: %p",
      async (cacheControl: string, replaced: boolean) => {
        const started: StartedWorker = startEnterpriseWorker();
        const worker: RunningWorker = started.worker;
        const cacheVersion: string = started.cacheVersion;
        const url: string = `${ORIGIN}/dashboard/dist/Index.js`;
        await seedCache(
          worker,
          `${cacheVersion}-static`,
          url,
          "stale bundle",
          EIGHT_DAYS_AGO,
        );
        worker.network.headersByUrl.set(url, {
          "cache-control": cacheControl,
        });

        // Served from the cache at once; the refresh runs behind it.
        expect((await fetchThroughWorker(worker, url)).body).toBe(
          "stale bundle",
        );
        await settle();

        expect(worker.network.requests).toEqual([url]);
        expect(
          worker.caches.stores.get(`${cacheVersion}-static`)?.get(url)?.body,
        ).toBe(replaced ? `network:${url}` : "stale bundle");
      },
    );

    test.each<[string, boolean]>([
      [FRONTEND_ENVIRONMENT_CACHE_CONTROL, false],
      ["no-store", false],
      ["No-Store", false],
      ["public, max-age=0,  NO-STORE ", false],
      ["no-cache", true],
      ["private, max-age=600", true],
      ["max-age=60, must-revalidate", true],
    ])(
      "reads no-store as a Cache-Control directive: %p -> cached: %p",
      async (cacheControl: string, cached: boolean) => {
        const worker: RunningWorker = startEnterpriseWorker().worker;
        const url: string = `${ORIGIN}/dashboard/incidents`;
        worker.network.headersByUrl.set(url, {
          "cache-control": cacheControl,
        });

        await fetchThroughWorker(worker, url);
        await settle();

        expect(cachesHolding(worker, url).length > 0).toBe(cached);
      },
    );

    test("never caches an error response", async () => {
      const worker: RunningWorker = startEnterpriseWorker().worker;
      const url: string = `${ORIGIN}/dashboard/missing`;
      worker.network.statusByUrl.set(url, 404);

      expect((await fetchThroughWorker(worker, url)).status).toBe(404);
      await settle();

      expect(cachesHolding(worker, url)).toEqual([]);
    });

    test("still serves bundles cache-first (the cache version is what invalidates them)", async () => {
      const started: StartedWorker = startEnterpriseWorker();
      const worker: RunningWorker = started.worker;
      const cacheVersion: string = started.cacheVersion;
      const url: string = `${ORIGIN}/dashboard/dist/Index.js`;
      await seedCache(worker, `${cacheVersion}-static`, url, "cached bundle");

      const response: FakeResponse = await fetchThroughWorker(worker, url);

      expect(response.body).toBe("cached bundle");
      expect(worker.network.requests).toEqual([]);
    });

    test("drops the other edition's caches on activate", async () => {
      const started: StartedWorker = startEnterpriseWorker();
      const worker: RunningWorker = started.worker;
      const cacheVersion: string = started.cacheVersion;
      const communityVersion: string = cacheVersion.replace(
        "-enterprise-",
        "-community-",
      );
      await seedCache(
        worker,
        `${communityVersion}-static`,
        `${ORIGIN}/dashboard/dist/Index.js`,
        "community bundle",
      );
      await seedCache(
        worker,
        `${cacheVersion}-static`,
        `${ORIGIN}/dashboard/dist/Index.js`,
        "enterprise bundle",
      );
      await seedCache(worker, "someone-elses-cache", `${ORIGIN}/x`, "x");

      const holder: { done: Promise<unknown> | null } = { done: null };
      worker.listeners["activate"]?.({
        waitUntil: (done: Promise<unknown>): void => {
          holder.done = done;
        },
      });
      await holder.done;

      expect(Array.from(worker.caches.stores.keys()).sort()).toEqual(
        [`${cacheVersion}-static`, "someone-elses-cache"].sort(),
      );
    });

    test("reports its edition-qualified cache version to the page", () => {
      const started: StartedWorker = startEnterpriseWorker();
      const worker: RunningWorker = started.worker;
      const cacheVersion: string = started.cacheVersion;
      const posted: Array<unknown> = [];

      worker.listeners["message"]?.({
        data: { type: "GET_VERSION" },
        ports: [
          {
            postMessage: (message: unknown): void => {
              posted.push(message);
            },
          },
        ],
      });

      expect(posted).toEqual([{ version: cacheVersion }]);
      expect(cacheVersion).toContain("-enterprise-");
    });
  });
});
