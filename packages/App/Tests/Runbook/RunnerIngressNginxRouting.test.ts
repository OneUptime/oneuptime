import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ---------------------------------------------------------------------------
 * Does a customer's Runner actually REACH the Runner work mount?
 *
 * A project-scoped Runner runs on the customer's own host and talks to the
 * public URL, so its first hop is nginx — not Express. Every other test in
 * this directory asserts what the app mounts; none of them could tell you
 * whether a request from outside the cluster ever arrives.
 *
 * It did not. The Runner merge renamed the mount from /runbook-agent-ingest to
 * /runner-ingest. The old name was routed only by accident — nginx prefix
 * matching means `location /runbook` also matches `/runbook-agent-ingest` —
 * and the new name shares no prefix with any location, so it fell through to
 * the catch-all `location /`, which proxies to the marketing Home service when
 * billing is enabled. Every heartbeat got a 404 from the marketing site:
 *
 *     Error: Failed to register Runner: 404
 *
 * Nothing in the app would ever see that request, so no app-level test could
 * fail. Hence this file: it models nginx's location-matching rules and asserts
 * that each route the ingress router declares resolves to the APP backend.
 *
 * The paths are read out of the app's own source rather than hardcoded, so
 * renaming a mount without updating nginx fails here instead of in production.
 * ---------------------------------------------------------------------------
 */

const REPO_ROOT: string = path.join(__dirname, "../../..");

const NGINX_SOURCE: string = fs.readFileSync(
  path.join(REPO_ROOT, "Nginx/default.conf.template"),
  "utf-8",
);

const RUNBOOK_FEATURESET_SOURCE: string = fs.readFileSync(
  path.join(REPO_ROOT, "App/FeatureSet/Runbook/Index.ts"),
  "utf-8",
);

const RUNNER_INGRESS_API_SOURCE: string = fs.readFileSync(
  path.join(REPO_ROOT, "App/FeatureSet/Runbook/API/RunnerIngress.ts"),
  "utf-8",
);

const RUNNER_CONFIG_SOURCE: string = fs.readFileSync(
  path.join(REPO_ROOT, "Runner/Config.ts"),
  "utf-8",
);

/*
 * A small nginx config reader.
 */

interface NginxLocation {
  /* "", "=", "^~", "~" or "~*" */
  modifier: string;
  pattern: string;
  body: string;
}

interface NginxServer {
  serverName: string;
  locations: Array<NginxLocation>;
}

/*
 * Returns a string of IDENTICAL length to `source` with the contents of
 * quoted strings and comments replaced by "x".
 *
 * A location spec may be quoted, and a quoted regex may contain braces -- the
 * content-hashed asset location uses `[A-Z0-9]{8,}`. Comments in this config
 * discuss braces too. Neither is a block delimiter, but a plain brace counter
 * sees them as one and desynchronises for the rest of the file. Masking keeps
 * every index valid, so callers scan the mask and still slice the original.
 */
function maskLiterals(source: string): string {
  const out: Array<string> = source.split("");

  let quote: string = "";
  let inComment: boolean = false;

  for (let i: number = 0; i < source.length; i++) {
    const character: string = source[i]!;

    if (inComment) {
      if (character === "\n") {
        inComment = false;
      } else {
        out[i] = "x";
      }
      continue;
    }

    if (quote !== "") {
      out[i] = "x";

      if (character === "\\") {
        /* Skip the escaped character so an escaped quote does not close. */
        if (i + 1 < source.length) {
          out[i + 1] = "x";
          i++;
        }
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "#") {
      inComment = true;
      out[i] = "x";
    }
  }

  return out.join("");
}

/*
 * Returns the body of the brace-delimited block that starts at or after
 * `fromIndex`, counting nested braces (the config nests `if` blocks inside
 * locations, so indexOf("}") is not enough). Braces inside quoted strings and
 * comments are ignored.
 */
function readBlock(
  source: string,
  fromIndex: number,
): { body: string; endIndex: number } {
  const masked: string = maskLiterals(source);
  const open: number = masked.indexOf("{", fromIndex);

  if (open === -1) {
    throw new Error(`No opening brace after index ${fromIndex}`);
  }

  let depth: number = 0;

  for (let i: number = open; i < source.length; i++) {
    if (masked[i] === "{") {
      depth++;
    } else if (masked[i] === "}") {
      depth--;

      if (depth === 0) {
        return { body: source.substring(open + 1, i), endIndex: i };
      }
    }
  }

  throw new Error(`Unbalanced braces starting at index ${open}`);
}

function parseLocations(serverBody: string): Array<NginxLocation> {
  const locations: Array<NginxLocation> = [];
  const pattern: RegExp = /(^|\n)\s*location\s+([^{]+?)\s*\{/g;

  /*
   * Matched against the mask so a quoted spec containing braces is not cut
   * short at its own `{`; the declaration is then sliced from the original at
   * the same offsets, which the mask preserves exactly.
   */
  const maskedBody: string = maskLiterals(serverBody);

  let match: RegExpExecArray | null = pattern.exec(maskedBody);

  while (match !== null) {
    const declaration: string = serverBody
      .substring(match.index, match.index + match[0].length)
      .replace(/^\s*/, "")
      .replace(/^location\s+/, "")
      .replace(/\{\s*$/, "")
      .trim();

    let modifier: string = "";
    let locationPattern: string = declaration;

    const modifierMatch: RegExpMatchArray | null = declaration.match(
      /^(=|\^~|~\*|~)\s+(.*)$/,
    );

    if (modifierMatch) {
      modifier = modifierMatch[1]!;
      locationPattern = modifierMatch[2]!.trim();
    }

    const block: { body: string; endIndex: number } = readBlock(
      serverBody,
      match.index + match[0].length - 1,
    );

    locations.push({ modifier, pattern: locationPattern, body: block.body });

    /* Resume past this block so nested braces are never re-scanned. */
    pattern.lastIndex = block.endIndex;
    match = pattern.exec(maskedBody);
  }

  return locations;
}

function parseServers(source: string): Array<NginxServer> {
  const servers: Array<NginxServer> = [];
  const pattern: RegExp = /(^|\n)server\s*\{/g;

  /* Matched against the mask so a commented-out block is never read as real. */
  const maskedSource: string = maskLiterals(source);

  let match: RegExpExecArray | null = pattern.exec(maskedSource);

  while (match !== null) {
    const block: { body: string; endIndex: number } = readBlock(
      source,
      match.index + match[0].length - 1,
    );

    const serverNameMatch: RegExpMatchArray | null = block.body.match(
      /\n\s*server_name\s+([^;]+);/,
    );

    servers.push({
      serverName: serverNameMatch ? serverNameMatch[1]!.trim() : "",
      locations: parseLocations(block.body),
    });

    pattern.lastIndex = block.endIndex;
    match = pattern.exec(maskedSource);
  }

  return servers;
}

const SERVERS: Array<NginxServer> = parseServers(NGINX_SOURCE);

/*
 * The public-facing server block — the one a Runner's HTTPS request lands on.
 * The other blocks in this file serve status pages on their own ports.
 */
const MAIN_SERVER: NginxServer = ((): NginxServer => {
  const server: NginxServer | undefined = SERVERS.find((s: NginxServer) => {
    return s.serverName.includes("${HOST}");
  });

  if (!server) {
    throw new Error(
      `No server block with server_name containing \${HOST}. Found: ${SERVERS.map(
        (s: NginxServer) => {
          return `"${s.serverName}"`;
        },
      ).join(", ")}`,
    );
  }

  return server;
})();

/*
 * nginx location matching.
 *
 * http://nginx.org/en/docs/http/ngx_http_core_module.html#location:
 *   1. exact "=" match wins outright;
 *   2. otherwise the LONGEST matching prefix is remembered — if it carries
 *      "^~", matching stops there;
 *   3. otherwise regex locations are tried in declaration order and the first
 *      match wins;
 *   4. if no regex matches, the remembered longest prefix is used.
 */

function matchLocation(uri: string): NginxLocation | null {
  const exact: NginxLocation | undefined = MAIN_SERVER.locations.find(
    (location: NginxLocation) => {
      return location.modifier === "=" && location.pattern === uri;
    },
  );

  if (exact) {
    return exact;
  }

  let longestPrefix: NginxLocation | null = null;

  for (const location of MAIN_SERVER.locations) {
    if (location.modifier !== "" && location.modifier !== "^~") {
      continue;
    }

    if (!uri.startsWith(location.pattern)) {
      continue;
    }

    if (
      longestPrefix === null ||
      location.pattern.length > longestPrefix.pattern.length
    ) {
      longestPrefix = location;
    }
  }

  if (longestPrefix && longestPrefix.modifier === "^~") {
    return longestPrefix;
  }

  for (const location of MAIN_SERVER.locations) {
    if (location.modifier !== "~" && location.modifier !== "~*") {
      continue;
    }

    const flags: string = location.modifier === "~*" ? "i" : "";

    if (new RegExp(location.pattern, flags).test(uri)) {
      return location;
    }
  }

  return longestPrefix;
}

/*
 * Which upstream a location hands the request to. `location /` names both —
 * home when billing is on, the app otherwise — which is precisely why an
 * unrouted path 404s on the marketing site for a hosted customer.
 */
function upstreamsOf(location: NginxLocation): Array<string> {
  const upstreams: Array<string> = [];

  if (
    location.body.includes("proxy_pass ${BACKEND_APP_TARGET}") ||
    location.body.includes("proxy_pass $backend_app")
  ) {
    upstreams.push("app");
  }

  if (location.body.includes("proxy_pass $backend_home")) {
    upstreams.push("home");
  }

  return upstreams;
}

function routesOnlyToApp(location: NginxLocation): boolean {
  const upstreams: Array<string> = upstreamsOf(location);

  return upstreams.length === 1 && upstreams[0] === "app";
}

/*
 * The paths under test, read from the app's own source.
 */

function readStringConst(source: string, name: string): string {
  const match: RegExpMatchArray | null = source.match(
    new RegExp(`const ${name}:\\s*string\\s*=\\s*"([^"]+)"`),
  );

  if (!match) {
    throw new Error(`Could not read ${name} from source`);
  }

  return match[1]!;
}

const AGENT_INGRESS_PATH: string = readStringConst(
  RUNBOOK_FEATURESET_SOURCE,
  "AGENT_INGRESS_PATH",
);

const LEGACY_AGENT_INGRESS_PATH: string = readStringConst(
  RUNBOOK_FEATURESET_SOURCE,
  "LEGACY_AGENT_INGRESS_PATH",
);

/* Every route the ingress router declares, with params filled in. */
const INGRESS_ROUTES: Array<string> = ((): Array<string> => {
  const routes: Array<string> = [];
  const pattern: RegExp = /this\.router\.post\(\s*`([^`]+)`/g;

  let match: RegExpExecArray | null = pattern.exec(RUNNER_INGRESS_API_SOURCE);

  while (match !== null) {
    routes.push(
      match[1]!.replace(/:[A-Za-z]+/g, "1a2b3c4d-0000-4000-8000-000000000000"),
    );
    match = pattern.exec(RUNNER_INGRESS_API_SOURCE);
  }

  return routes;
})();

describe("the nginx config the Runner's routes are read from", () => {
  test("parses into server blocks with locations", () => {
    expect(SERVERS.length).toBeGreaterThanOrEqual(3);
    expect(MAIN_SERVER.locations.length).toBeGreaterThan(20);
  });

  /*
   * If these ever come back empty the assertions below would pass vacuously,
   * which is the one way a source-derived test can quietly stop testing.
   */
  test("the mount names were actually read out of the app source", () => {
    expect(AGENT_INGRESS_PATH).toBe("runner-ingest");
    expect(LEGACY_AGENT_INGRESS_PATH).toBe("runbook-agent-ingest");
  });

  test("every ingress route was actually read out of the router source", () => {
    expect(INGRESS_ROUTES.length).toBeGreaterThanOrEqual(4);
    expect(INGRESS_ROUTES).toContain("/heartbeat");
    expect(INGRESS_ROUTES).toContain("/claim-next-job");
  });

  /*
   * The mechanism behind the outage: an unrouted path is not a 404 from the
   * app, it is a 404 from the marketing site. Pinning this keeps the rest of
   * the file meaningful — without it, "falls through to /" sounds harmless.
   */
  test("the catch-all location serves the marketing Home service", () => {
    const catchAll: NginxLocation | undefined = MAIN_SERVER.locations.find(
      (location: NginxLocation) => {
        return location.modifier === "" && location.pattern === "/";
      },
    );

    expect(catchAll).toBeDefined();
    expect(upstreamsOf(catchAll!)).toContain("home");
  });
});

describe("the Runner work mount is reachable through nginx", () => {
  test("has its own location block", () => {
    const location: NginxLocation | undefined = MAIN_SERVER.locations.find(
      (candidate: NginxLocation) => {
        return candidate.pattern === `/${AGENT_INGRESS_PATH}`;
      },
    );

    expect(location).toBeDefined();
    expect(routesOnlyToApp(location!)).toBe(true);
  });

  test.each(INGRESS_ROUTES)(
    "POST %s reaches the app, not the marketing site",
    (route: string) => {
      const uri: string = `/${AGENT_INGRESS_PATH}${route}`;
      const location: NginxLocation | null = matchLocation(uri);

      expect(location).not.toBeNull();

      /*
       * The exact failure that produced "Failed to register Runner: 404":
       * the request matched only the catch-all and was answered by Home.
       */
      expect(location!.pattern).not.toBe("/");
      expect(routesOnlyToApp(location!)).toBe(true);
    },
  );

  /*
   * The registration call specifically. Called out separately from the
   * parameterised sweep because this is the one an operator sees fail — it is
   * the first request a Runner ever makes, and it is where the bug surfaced.
   */
  test("the registration heartbeat resolves to the runner-ingest location", () => {
    const location: NginxLocation | null = matchLocation(
      `/${AGENT_INGRESS_PATH}/heartbeat`,
    );

    expect(location!.pattern).toBe(`/${AGENT_INGRESS_PATH}`);
  });

  /*
   * `location /heartbeat` exists in this config and rewrites to the incoming
   * request (monitor) API. Prefix matching is longest-wins, so /runner-ingest
   * must beat it — if it did not, a Runner heartbeat would be rewritten into
   * an unrelated endpoint, which is worse than a 404 because it might answer
   * 200.
   */
  test("the Runner heartbeat is not captured by the monitor /heartbeat location", () => {
    const location: NginxLocation | null = matchLocation(
      `/${AGENT_INGRESS_PATH}/heartbeat`,
    );

    expect(location!.body).not.toContain("rewrite ^/heartbeat");
  });

  test("a job result may carry a script's full output without a 413", () => {
    const location: NginxLocation | null = matchLocation(
      `/${AGENT_INGRESS_PATH}/job/abc/result`,
    );

    /*
     * nginx's default is 1M and a job result carries the step's stdout and
     * stderr, so the default would reject a chatty script's result — and the
     * execution would fail with no output to explain why.
     */
    expect(location!.body).toMatch(/client_max_body_size\s+\d+M;/);
  });
});

describe("the pre-merge runbook-agent-ingest path stays reachable", () => {
  /*
   * The app deliberately mounts this for containers that have not been
   * redeployed (LegacyAgentIngressPath.test.ts pins the mount). That mount is
   * dead weight if nginx does not route the path to the app.
   */
  test.each(INGRESS_ROUTES)(
    "POST %s on the legacy path reaches the app",
    (route: string) => {
      const uri: string = `/${LEGACY_AGENT_INGRESS_PATH}${route}`;
      const location: NginxLocation | null = matchLocation(uri);

      expect(location).not.toBeNull();
      expect(location!.pattern).not.toBe("/");
      expect(routesOnlyToApp(location!)).toBe(true);
    },
  );

  /*
   * The legacy path used to be routed only because `location /runbook` is a
   * prefix that happens to cover `/runbook-agent-ingest`. Depending on that
   * coincidence is what let the rename slip through, so the path now has its
   * own block: tightening /runbook to /runbook/ must not silently unroute it
   * a second time.
   */
  test("is routed by its own location, not by the /runbook prefix", () => {
    const location: NginxLocation | null = matchLocation(
      `/${LEGACY_AGENT_INGRESS_PATH}/heartbeat`,
    );

    expect(location!.pattern).toBe(`/${LEGACY_AGENT_INGRESS_PATH}`);
    expect(location!.pattern).not.toBe("/runbook");
  });
});

describe("the URL the Runner is told to call is the one nginx routes", () => {
  /*
   * Config.ts builds the ingest base as ONEUPTIME_URL + this literal. If the
   * two ever disagree the Runner would call a path nginx does not know, which
   * is the same 404 by a different route.
   */
  test("Runner/Config.ts posts to the path nginx routes", () => {
    expect(RUNNER_CONFIG_SOURCE).toContain(
      `addRoute("/${AGENT_INGRESS_PATH}")`,
    );
  });

  /*
   * Everything else the Runner calls lives under /api, which has always been
   * routed. Listing them here means a new Runner endpoint on a new prefix has
   * to be considered rather than discovered in production.
   */
  test.each([
    "/api/ai-agent/register",
    "/api/ai-agent/alive",
    "/api/ai-agent-task/get-pending-task",
    "/api/ai-agent-data/get-exception-details",
  ])("%s reaches the app", (uri: string) => {
    const location: NginxLocation | null = matchLocation(uri);

    expect(location!.pattern).not.toBe("/");
    expect(routesOnlyToApp(location!)).toBe(true);
  });
});
