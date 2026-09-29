import { RESOURCE_AI_AGENT_INGEST_PATH } from "Common/Types/ResourceAiAgent/ResourceAiAccess";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ---------------------------------------------------------------------------
 * Does the resource AI agent actually REACH its mount?
 *
 * The agent runs next to a customer's Docker host, cluster, vCenter,
 * database or host and calls the public URL, so its first hop is nginx, not
 * Express. A mount nginx does not route falls through to the catch-all
 * `location /` — the marketing Home service when billing is enabled — and
 * every registration gets a 404 the app never sees (see
 * KubernetesAiAgentIngressNginxRouting.test.ts, whose nginx reader this file
 * reuses).
 *
 * Everything under test is read from source: the mount from the Runbook
 * feature set, the routes from the router, the location from the nginx
 * template, and the routes the agent itself calls from agents/ResourceAIAgent
 * (whose base path is the shared RESOURCE_AI_AGENT_INGEST_PATH). Renaming any
 * one of them without the others fails here instead of on a customer's host.
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
  path.join(REPO_ROOT, "App/FeatureSet/Runbook/API/ResourceAiAgentIngress.ts"),
  "utf-8",
);

// The agent's HTTP client (agents/ResourceAIAgent, outside packages/).
const AGENT_CLIENT_SOURCE: string = fs.readFileSync(
  path.join(REPO_ROOT, "../agents/ResourceAIAgent/IngestClient.ts"),
  "utf-8",
);

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
 * quoted strings and comments replaced by "x", so braces inside them are
 * never read as block delimiters.
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

// The body of the brace-delimited block that starts at or after fromIndex.
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

    pattern.lastIndex = block.endIndex;
    match = pattern.exec(maskedBody);
  }

  return locations;
}

function parseServers(source: string): Array<NginxServer> {
  const servers: Array<NginxServer> = [];
  const pattern: RegExp = /(^|\n)server\s*\{/g;
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

// The public-facing server block.
const MAIN_SERVER: NginxServer = ((): NginxServer => {
  const server: NginxServer | undefined = SERVERS.find((s: NginxServer) => {
    return s.serverName.includes("${HOST}");
  });

  if (!server) {
    throw new Error("No server block with server_name containing ${HOST}.");
  }

  return server;
})();

/*
 * nginx location matching: exact "=" wins; else the longest matching prefix
 * is remembered (and wins at once with "^~"); else regex locations in order;
 * else the remembered prefix.
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

function readStringConst(source: string, name: string): string {
  const match: RegExpMatchArray | null = source.match(
    new RegExp(`const ${name}:\\s*string\\s*=\\s*"([^"]+)"`),
  );

  if (!match) {
    throw new Error(`Could not read ${name} from source`);
  }

  return match[1]!;
}

const RESOURCE_AI_AGENT_INGRESS_PATH: string = readStringConst(
  RUNBOOK_FEATURESET_SOURCE,
  "RESOURCE_AI_AGENT_INGRESS_PATH",
);

function routeShape(route: string): string {
  return route
    .replace(/:[A-Za-z]+/g, ":param")
    .replace(/\$\{[^}]+\}/g, ":param");
}

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

const INGRESS_ROUTES: Array<string> = DECLARED_ROUTES.map(
  (route: string): string => {
    return route.replace(/:[A-Za-z]+/g, "1a2b3c4d-0000-4000-8000-000000000000");
  },
);

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

  test("the mount name was read out of the Runbook feature set, and is the shared ingest path", () => {
    expect(RESOURCE_AI_AGENT_INGRESS_PATH).toBe("resource-ai-agent-ingest");
    expect(`/${RESOURCE_AI_AGENT_INGRESS_PATH}`).toBe(
      RESOURCE_AI_AGENT_INGEST_PATH,
    );
  });

  test("the feature set mounts the agent's router at that name", () => {
    expect(RUNBOOK_FEATURESET_SOURCE).toMatch(
      /app\.use\(\s*`\/\$\{RESOURCE_AI_AGENT_INGRESS_PATH\}`,\s*new ResourceAiAgentIngressAPI\(\)\.router,?\s*\)/,
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

describe("the resource AI agents' mount is reachable through nginx", () => {
  test("has its own location block, routed only to the app", () => {
    const location: NginxLocation | undefined = MAIN_SERVER.locations.find(
      (candidate: NginxLocation) => {
        return candidate.pattern === `/${RESOURCE_AI_AGENT_INGRESS_PATH}`;
      },
    );

    expect(location).toBeDefined();
    expect(location!.modifier).toBe("");
    expect(routesOnlyToApp(location!)).toBe(true);
  });

  test("its block is the Kubernetes AI agent's, line for line", () => {
    const own: NginxLocation | undefined = MAIN_SERVER.locations.find(
      (candidate: NginxLocation) => {
        return candidate.pattern === `/${RESOURCE_AI_AGENT_INGRESS_PATH}`;
      },
    );
    const kubernetes: NginxLocation | undefined = MAIN_SERVER.locations.find(
      (candidate: NginxLocation) => {
        return candidate.pattern === "/kubernetes-ai-agent-ingest";
      },
    );

    function directives(location: NginxLocation): Array<string> {
      return location.body
        .split("\n")
        .map((line: string) => {
          return line.trim();
        })
        .filter((line: string) => {
          return line !== "" && !line.startsWith("#");
        });
    }

    expect(kubernetes).toBeDefined();
    expect(directives(own!)).toEqual(directives(kubernetes!));
  });

  test.each(INGRESS_ROUTES)(
    "POST %s reaches the app, not the marketing site",
    (route: string) => {
      const location: NginxLocation | null = matchLocation(
        `/${RESOURCE_AI_AGENT_INGRESS_PATH}${route}`,
      );

      expect(location).not.toBeNull();
      expect(location!.pattern).toBe(`/${RESOURCE_AI_AGENT_INGRESS_PATH}`);
      expect(routesOnlyToApp(location!)).toBe(true);
    },
  );

  test("the agent's heartbeat is not captured by the monitor /heartbeat location", () => {
    const location: NginxLocation | null = matchLocation(
      `/${RESOURCE_AI_AGENT_INGRESS_PATH}/heartbeat`,
    );

    expect(location!.body).not.toContain("rewrite ^/heartbeat");
  });

  test("is not captured by the Runner's or the Kubernetes AI agent's locations", () => {
    const location: NginxLocation | null = matchLocation(
      `/${RESOURCE_AI_AGENT_INGRESS_PATH}/register`,
    );

    expect(location!.pattern).not.toBe("/runner-ingest");
    expect(location!.pattern).not.toBe("/runbook");
    expect(location!.pattern).not.toBe("/kubernetes-ai-agent-ingest");
  });

  // A job result carries a command's output; nginx's 1M default would 413 it.
  test("a job result may carry a command's full output without a 413", () => {
    const location: NginxLocation | null = matchLocation(
      `/${RESOURCE_AI_AGENT_INGRESS_PATH}/job/abc/result`,
    );

    const size: RegExpMatchArray | null = location!.body.match(
      /client_max_body_size\s+(\d+)M;/,
    );

    expect(size).not.toBeNull();
    expect(Number(size![1])).toBeGreaterThanOrEqual(50);
  });

  test("forwards the client address and scheme like the other agent mounts", () => {
    const location: NginxLocation | null = matchLocation(
      `/${RESOURCE_AI_AGENT_INGRESS_PATH}/register`,
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

  test("the Kubernetes AI agent's mount still routes to its own block", () => {
    const location: NginxLocation | null = matchLocation(
      "/kubernetes-ai-agent-ingest/register",
    );

    expect(location!.pattern).toBe("/kubernetes-ai-agent-ingest");
  });
});

describe("the agent calls what the server serves", () => {
  test("the agent's base path is the shared ingest path nginx routes", () => {
    expect(AGENT_CLIENT_SOURCE).toMatch(
      /export const INGEST_PATH: string = RESOURCE_AI_AGENT_INGEST_PATH;/,
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
