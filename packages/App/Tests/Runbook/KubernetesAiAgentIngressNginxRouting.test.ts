import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ---------------------------------------------------------------------------
 * Does the Kubernetes AI agent actually REACH its mount?
 *
 * The agent runs in a customer's cluster and calls the public URL, so its
 * first hop is nginx, not Express. A mount nginx does not route falls
 * through to the catch-all `location /` — the marketing Home service when
 * billing is enabled — and every registration gets a 404 the app never sees
 * (exactly how the Runner's /runner-ingest rename broke; see
 * RunnerIngressNginxRouting.test.ts, whose nginx reader this file reuses).
 *
 * Everything under test is read from source: the mount from the Runbook
 * feature set, the routes from the router, the location from the nginx
 * template, and the path and routes the agent itself calls from
 * agents/KubernetesAIAgent. Renaming any one of them without the others
 * fails here instead of in a customer's cluster.
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

const AGENT_INGRESS_API_SOURCE: string = fs.readFileSync(
  path.join(
    REPO_ROOT,
    "App/FeatureSet/Runbook/API/KubernetesAiAgentIngress.ts",
  ),
  "utf-8",
);

// The agent's HTTP client (agents/KubernetesAIAgent, outside packages/).
const AGENT_CLIENT_SOURCE: string = fs.readFileSync(
  path.join(REPO_ROOT, "../agents/KubernetesAIAgent/IngestClient.ts"),
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

const KUBERNETES_AI_AGENT_INGRESS_PATH: string = readStringConst(
  RUNBOOK_FEATURESET_SOURCE,
  "KUBERNETES_AI_AGENT_INGRESS_PATH",
);

// A route with its :params (or the agent's ${...} segments) made uniform.
function routeShape(route: string): string {
  return route
    .replace(/:[A-Za-z]+/g, ":param")
    .replace(/\$\{[^}]+\}/g, ":param");
}

/* Every route the agent's router declares, as declared. */
const DECLARED_ROUTES: Array<string> = ((): Array<string> => {
  const routes: Array<string> = [];
  const pattern: RegExp = /this\.router\.post\(\s*`([^`]+)`/g;

  let match: RegExpExecArray | null = pattern.exec(AGENT_INGRESS_API_SOURCE);

  while (match !== null) {
    routes.push(match[1]!);
    match = pattern.exec(AGENT_INGRESS_API_SOURCE);
  }

  return routes;
})();

/* The same routes with params filled in, as a request would carry them. */
const INGRESS_ROUTES: Array<string> = DECLARED_ROUTES.map(
  (route: string): string => {
    return route.replace(/:[A-Za-z]+/g, "1a2b3c4d-0000-4000-8000-000000000000");
  },
);

/* Every path the agent's client posts to (relative to its base path). */
const AGENT_CALLED_ROUTES: Array<string> = ((): Array<string> => {
  const routes: Array<string> = [];
  const pattern: RegExp = /this\.post\(\s*["`]([^"`]+)["`]/g;

  let match: RegExpExecArray | null = pattern.exec(AGENT_CLIENT_SOURCE);

  while (match !== null) {
    routes.push(match[1]!);
    match = pattern.exec(AGENT_CLIENT_SOURCE);
  }

  return routes;
})();

describe("what this file reads", () => {
  test("parses the nginx template into server blocks with locations", () => {
    expect(SERVERS.length).toBeGreaterThanOrEqual(3);
    expect(MAIN_SERVER.locations.length).toBeGreaterThan(20);
  });

  /*
   * If any of these came back empty the assertions below would pass
   * vacuously — the one way a source-derived test quietly stops testing.
   */
  test("the mount name was read out of the Runbook feature set", () => {
    expect(KUBERNETES_AI_AGENT_INGRESS_PATH).toBe("kubernetes-ai-agent-ingest");
  });

  test("the feature set mounts the agent's router at that name", () => {
    expect(RUNBOOK_FEATURESET_SOURCE).toMatch(
      /app\.use\(\s*`\/\$\{KUBERNETES_AI_AGENT_INGRESS_PATH\}`,\s*new KubernetesAiAgentIngressAPI\(\)\.router,?\s*\)/,
    );
  });

  test("every route was read out of the router source", () => {
    expect(DECLARED_ROUTES.sort()).toEqual(
      [
        "/register",
        "/heartbeat",
        "/claim-next-job",
        "/job/:jobId/heartbeat",
        "/job/:jobId/result",
        "/disconnect",
      ].sort(),
    );
  });

  test("every route the agent calls was read out of its client", () => {
    expect(AGENT_CALLED_ROUTES.length).toBeGreaterThanOrEqual(6);
  });
});

describe("the Kubernetes AI agent's mount is reachable through nginx", () => {
  test("has its own location block, routed only to the app", () => {
    const location: NginxLocation | undefined = MAIN_SERVER.locations.find(
      (candidate: NginxLocation) => {
        return candidate.pattern === `/${KUBERNETES_AI_AGENT_INGRESS_PATH}`;
      },
    );

    expect(location).toBeDefined();
    expect(location!.modifier).toBe("");
    expect(routesOnlyToApp(location!)).toBe(true);
  });

  test.each(INGRESS_ROUTES)(
    "POST %s reaches the app, not the marketing site",
    (route: string) => {
      const location: NginxLocation | null = matchLocation(
        `/${KUBERNETES_AI_AGENT_INGRESS_PATH}${route}`,
      );

      expect(location).not.toBeNull();
      expect(location!.pattern).not.toBe("/");
      expect(location!.pattern).toBe(`/${KUBERNETES_AI_AGENT_INGRESS_PATH}`);
      expect(routesOnlyToApp(location!)).toBe(true);
    },
  );

  test("the catch-all it would otherwise fall into serves the marketing site", () => {
    const catchAll: NginxLocation | undefined = MAIN_SERVER.locations.find(
      (location: NginxLocation) => {
        return location.modifier === "" && location.pattern === "/";
      },
    );

    expect(catchAll).toBeDefined();
    expect(upstreamsOf(catchAll!)).toContain("home");
  });

  /*
   * `location /heartbeat` rewrites to the incoming-request monitor API.
   * Longest prefix wins, so the agent's mount must beat it — otherwise its
   * heartbeat would be rewritten into an unrelated endpoint that might even
   * answer 200.
   */
  test("the agent's heartbeat is not captured by the monitor /heartbeat location", () => {
    const location: NginxLocation | null = matchLocation(
      `/${KUBERNETES_AI_AGENT_INGRESS_PATH}/heartbeat`,
    );

    expect(location!.body).not.toContain("rewrite ^/heartbeat");
  });

  test("is not captured by the Runner's /runner-ingest or /runbook locations", () => {
    const location: NginxLocation | null = matchLocation(
      `/${KUBERNETES_AI_AGENT_INGRESS_PATH}/register`,
    );

    expect(location!.pattern).not.toBe("/runner-ingest");
    expect(location!.pattern).not.toBe("/runbook");
  });

  // A job result carries kubectl's output; nginx's 1M default would 413 it.
  test("a job result may carry kubectl's full output without a 413", () => {
    const location: NginxLocation | null = matchLocation(
      `/${KUBERNETES_AI_AGENT_INGRESS_PATH}/job/abc/result`,
    );

    const size: RegExpMatchArray | null = location!.body.match(
      /client_max_body_size\s+(\d+)M;/,
    );

    expect(size).not.toBeNull();
    expect(Number(size![1])).toBeGreaterThanOrEqual(50);
  });

  test("forwards the client address and scheme like the Runner's mount", () => {
    const location: NginxLocation | null = matchLocation(
      `/${KUBERNETES_AI_AGENT_INGRESS_PATH}/register`,
    );

    for (const header of [
      "proxy_set_header Host $host;",
      "proxy_set_header X-Real-IP $remote_addr;",
      "proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
      "proxy_set_header X-Forwarded-Proto $scheme;",
    ]) {
      expect(location!.body).toContain(header);
    }
  });
});

describe("the agent calls what the server serves", () => {
  test("the agent's base path is the mount nginx routes", () => {
    expect(readStringConst(AGENT_CLIENT_SOURCE, "INGEST_PATH")).toBe(
      `/${KUBERNETES_AI_AGENT_INGRESS_PATH}`,
    );
  });

  test.each(AGENT_CALLED_ROUTES)(
    "the agent's POST %s is a route the server declares",
    (route: string) => {
      expect(DECLARED_ROUTES.map(routeShape)).toContain(routeShape(route));
    },
  );

  test("the server declares nothing the agent never calls", () => {
    expect(AGENT_CALLED_ROUTES.map(routeShape).sort()).toEqual(
      DECLARED_ROUTES.map(routeShape).sort(),
    );
  });
});
