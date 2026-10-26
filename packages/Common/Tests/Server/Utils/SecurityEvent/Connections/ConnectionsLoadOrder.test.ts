import IncidentSecurity from "../../../../../Server/Utils/SecurityEvent/Connections/IncidentSecurity";
import {
  loadIncidentSecurity,
  loadSecurityConnectedRecords,
  loadSecurityConnections,
} from "../../../../../Server/Utils/SecurityEvent/Connections/ConnectionsLoader";
import SecurityConnectedRecords from "../../../../../Server/Utils/SecurityEvent/Connections/SecurityConnectedRecords";
import SecurityConnections, {
  linkIncidentToConnectedRecords,
} from "../../../../../Server/Utils/SecurityEvent/Connections/SecurityConnections";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE CONNECTIONS LOAD AFTER THE SERVICES THEY READ.
 *
 * SecurityConnectedRecords, SecurityConnections, ResourceSecurity and
 * IncidentSecurity read the project's hosts, container hosts, clusters,
 * devices, services, members, incidents and alerts, and those services' own
 * imports reach far: HostService's reach IncidentService, whose
 * investigation runner reads a security case's context. When that context
 * imported the connections at its top, loading IncidentService loaded
 * HostService part way through, and ResourceAiAccessService - which keeps
 * the reference to HostService it takes while it loads - kept undefined:
 * every host's AI access test failed with a TypeError
 * (Tests/Server/API/ResourceAiAccessAPI and
 * Tests/Server/Services/AiConversationViewableInfrastructure caught it).
 *
 * So nothing a service the connections read imports at load may import the
 * connections at load: the code those imports reach (the AI contexts, the
 * playbook's Declare Incident) takes them from ConnectionsLoader when it
 * first reads them. This walks the top-level imports - not `import type`,
 * which TypeScript drops, and not a require inside a function, which runs
 * when it is called - from each service the connections import.
 */

const COMMON: string = path.resolve(__dirname, "../../../../..");
const CONNECTIONS: string = path.join(
  COMMON,
  "Server/Utils/SecurityEvent/Connections",
);

const CONNECTION_MODULES: ReadonlyArray<string> = [
  "SecurityConnectedRecords.ts",
  "SecurityConnections.ts",
  "ResourceSecurity.ts",
  "IncidentSecurity.ts",
].map((name: string): string => {
  return path.join(CONNECTIONS, name);
});

// `import ... from "x"` and `export ... from "x"` at a line's start, over lines.
const STATIC_IMPORT: RegExp =
  /^(import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["'];?/gm;
const SIDE_EFFECT_IMPORT: RegExp = /^import\s+["']([^"']+)["'];?/gm;

function resolveImport(fromFile: string, specifier: string): string | null {
  let base: string | null = null;

  if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else if (specifier.startsWith("Common/")) {
    base = path.join(COMMON, specifier.slice("Common/".length));
  }

  if (!base) {
    return null;
  }

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "Index.ts"),
    path.join(base, "index.ts"),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

const importsOf: Map<string, Array<string>> = new Map();

// The files a file imports at load: what TypeScript keeps of its imports.
function loadTimeImports(file: string): Array<string> {
  const known: Array<string> | undefined = importsOf.get(file);

  if (known) {
    return known;
  }

  const text: string = fs.readFileSync(file, "utf-8");
  const found: Array<string> = [];

  for (const match of text.matchAll(STATIC_IMPORT)) {
    const isTypeOnly: boolean = Boolean(match[2]);
    const clause: string = match[3] || "";
    // `import { type A, type B } from` imports nothing at load either.
    const named: RegExpMatchArray | null = clause.match(/^\{([\s\S]*)\}$/);
    const onlyTypes: boolean = Boolean(
      named &&
        named[1]!
          .split(",")
          .map((part: string): string => {
            return part.trim();
          })
          .filter(Boolean)
          .every((part: string): boolean => {
            return part.startsWith("type ");
          }),
    );

    if (isTypeOnly || onlyTypes) {
      continue;
    }

    const resolved: string | null = resolveImport(file, match[4]!);

    if (resolved) {
      found.push(resolved);
    }
  }

  for (const match of text.matchAll(SIDE_EFFECT_IMPORT)) {
    const resolved: string | null = resolveImport(file, match[1]!);

    if (resolved) {
      found.push(resolved);
    }
  }

  importsOf.set(file, found);

  return found;
}

// The shortest chain of load-time imports from a file to any of the targets.
function chainTo(
  start: string,
  targets: ReadonlyArray<string>,
): Array<string> | null {
  const previous: Map<string, string | null> = new Map([[start, null]]);
  const queue: Array<string> = [start];

  while (queue.length > 0) {
    const current: string = queue.shift()!;

    if (current !== start && targets.includes(current)) {
      const chain: Array<string> = [];
      let step: string | null = current;

      while (step) {
        chain.unshift(path.relative(COMMON, step));
        step = previous.get(step) || null;
      }

      return chain;
    }

    for (const next of loadTimeImports(current)) {
      if (!previous.has(next)) {
        previous.set(next, current);
        queue.push(next);
      }
    }
  }

  return null;
}

// The services the connections import at load.
function servicesTheConnectionsRead(): Array<string> {
  const services: Set<string> = new Set();

  for (const module of CONNECTION_MODULES) {
    for (const imported of loadTimeImports(module)) {
      if (
        imported.startsWith(path.join(COMMON, "Server/Services") + path.sep)
      ) {
        services.add(imported);
      }
    }
  }

  return Array.from(services).sort();
}

describe("the connections' load order", () => {
  test("the scan reads the services the connections read", () => {
    const services: Array<string> = servicesTheConnectionsRead().map(
      (file: string): string => {
        return path.basename(file, ".ts");
      },
    );

    for (const service of [
      "HostService",
      "DockerHostService",
      "KubernetesClusterService",
      "NetworkDeviceService",
      "TeamMemberService",
      "UserService",
      "IncidentService",
      "SecurityCaseService",
    ]) {
      expect(services).toContain(service);
    }
  });

  test("no service the connections read imports the connections back at load", () => {
    const cycles: Array<string> = [];

    for (const service of servicesTheConnectionsRead()) {
      const chain: Array<string> | null = chainTo(service, CONNECTION_MODULES);

      if (chain) {
        cycles.push(chain.join(" -> "));
      }
    }

    expect(cycles).toEqual([]);
  });

  test("the scan finds such a chain: the incident investigation's security context, imported at load", () => {
    /*
     * The chain this guards against, as it was: IncidentService's
     * investigation runner, the security case context, the connections.
     */
    const context: string = path.join(
      COMMON,
      "Server/Utils/AI/Security/SecurityCaseIncidentContext.ts",
    );
    const runner: string = path.join(
      COMMON,
      "Server/Utils/AI/SRE/IncidentInvestigationRunner.ts",
    );

    expect(
      chainTo(path.join(COMMON, "Server/Services/IncidentService.ts"), [
        runner,
      ]),
    ).not.toBeNull();
    expect(chainTo(runner, [context])).not.toBeNull();

    // Were the context to import IncidentSecurity at load, the scan sees it.
    importsOf.set(context, [
      ...loadTimeImports(context),
      path.join(CONNECTIONS, "IncidentSecurity.ts"),
    ]);

    try {
      expect(
        chainTo(
          path.join(COMMON, "Server/Services/IncidentService.ts"),
          CONNECTION_MODULES,
        ),
      ).not.toBeNull();
    } finally {
      importsOf.delete(context);
    }
  });

  test("the loader imports nothing at load, and hands over the modules themselves", () => {
    expect(
      loadTimeImports(path.join(CONNECTIONS, "ConnectionsLoader.ts")),
    ).toEqual([]);

    expect(loadSecurityConnections().default).toBe(SecurityConnections);
    expect(loadSecurityConnections().linkIncidentToConnectedRecords).toBe(
      linkIncidentToConnectedRecords,
    );
    expect(loadSecurityConnectedRecords()).toBe(SecurityConnectedRecords);
    expect(loadIncidentSecurity()).toBe(IncidentSecurity);
  });
});
