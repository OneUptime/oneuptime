import { listProductFiles } from "../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../Helpers/TagStripScan";
import {
  SharedClientCall,
  callKeepsRedirectsOnServer,
  codeOf,
  keepsRedirectsOnServer,
  parseFile,
  placeOfCall,
  propertyOf,
  sharedClientCallsIn,
} from "../TestingUtils/KeyCarryingRequests";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * A REQUEST THAT CARRIES ONE OF ONEUPTIME'S KEYS KEEPS ITS REDIRECTS ON THE
 * SERVER IT WAS SENT TO.
 *
 * An HTTP client follows a redirect wherever it points and sends the
 * redirected request with the original's headers and, for a 307 or 308, its
 * body. So every request carrying the cluster key, a probe's key (or the key
 * that registers a global probe), a Runner's key or an Enterprise
 * installation's licence key follows a redirect only on its own server
 * (sameServerRedirectsOnly, Common/Utils/SameServerRedirect)
 * - read here from the source, across all product code (ee/ too, when it is
 * checked out), comments removed:
 *
 *   - every request the probe and the Runner send through the shared request
 *     client keeps its redirects on its server, but those of the files listed
 *     below that call other services and name no key;
 *   - every other HTTP client they use is in a listed file, and the one that
 *     carries the Runner's key (RunnerClient) checks its redirects the same
 *     way;
 *   - anywhere else, a request whose body or headers name one of the keys
 *     keeps its redirects on its server, but those the browser sends (it
 *     follows redirects itself, and they go to OneUptime's own API).
 *
 * ClusterKeyGuard holds the requests that present the cluster key to the
 * same rule, one by one.
 */

const CODE_FILE: RegExp = /\.(?:ts|tsx)$/;

const PROBE: string = "packages/Probe";
const RUNNER: string = "packages/Runner";

/*
 * The names a key of OneUptime's own components goes by in the code that
 * sends one: the values and helpers that hold it, the body fields and the
 * headers that carry it.
 */
const KEY_IN_CODE: RegExp =
  /\b(?:PROBE_KEY|RegisterProbeKey|RUNNER_KEY|KUBERNETES_AGENT_INGESTION_KEY|getRunnerKey|getDefaultRequestBody|getClusterKeyHeaders|probeKey|registerProbeKey|aiAgentKey|agentKey|previousAgentKey|previousRunnerKey|runnerKey|licenseKey)\b|["'`](?:x-oneuptime-token|x-oneuptime-ingestion-key|x-agent-key|clusterkey|x-clusterkey)["'`]/i;

/*
 * Files of the probe and the Runner whose shared-client requests go to
 * services other than OneUptime, and so follow redirects as those services
 * need. None of them names a key.
 */
const SHARED_CLIENT_CALLS_TO_OTHER_SERVICES: Record<string, string> = {
  "packages/Probe/Utils/Monitors/MonitorTypes/ApiMonitor.ts":
    "an API monitor's request, to the address the monitor checks",
  "packages/Probe/Utils/Domain/RdapHttp.ts":
    "registration data lookups for domain monitors, to RDAP servers",
  "packages/Probe/Utils/ProbeApiDiagnostics.ts":
    "a reachability check of the OneUptime server that carries no key",
  "packages/Runner/Utils/PullRequestCreator.ts":
    "GitHub's API, with the repository's own GitHub token",
};

/*
 * Files of the probe and the Runner that use an HTTP client other than the
 * shared one. None of them names a key, but the one in
 * KEY_CARRYING_OTHER_CLIENTS.
 */
const OTHER_CLIENTS: Record<string, string> = {
  "packages/Probe/Utils/HttpTimingAgents.ts":
    "the agents that time a monitor's own requests",
  "packages/Probe/Utils/Monitors/HttpMonitorRequest.ts":
    "a monitor's own request, to the address it checks",
  "packages/Probe/Utils/Monitors/MonitorTypes/ExternalStatusPageMonitor.ts":
    "an external status page monitor's request",
  "packages/Probe/Utils/Monitors/MonitorTypes/SslMonitor.ts":
    "an SSL monitor's handshake with the host it checks",
  "packages/Probe/Utils/Monitors/MonitorTypes/WebsiteMonitor.ts":
    "a website monitor's request, to the address it checks",
  "packages/Probe/Utils/Monitors/SyntheticRuntime/PlaywrightCapabilityBroker.ts":
    "a synthetic monitor's browser requests",
  "packages/Probe/Utils/VMware/VSphereHttp.ts": "a vCenter's API",
  "packages/Probe/Utils/VMware/VSphereTls.ts": "a vCenter's TLS handshake",
  "packages/Runner/Services/KubernetesExecutor.ts":
    "a Kubernetes API, with the cluster credential a project assigned",
  "packages/Runner/Services/RunnerClient.ts":
    "OneUptime's runbook mount, with this Runner's key",
};

/*
 * The one other client that carries a key, and the check it is made with:
 * the `beforeRedirect` of the axios client it makes.
 */
const KEY_CARRYING_OTHER_CLIENTS: Record<string, string> = {
  "packages/Runner/Services/RunnerClient.ts":
    "getSameServerRedirectCheck(RUNNER_INGEST_URL.toString())",
};

/*
 * Requests the browser sends that name a key: a browser follows redirects
 * itself, and these go to OneUptime's own API, on the page's own server.
 */
const BROWSER_REQUESTS_WITH_A_KEY: Record<string, string> = {
  "ee/AdminDashboard/License/LicenseManager.tsx":
    "the admin dashboard activating a licence key with OneUptime's own API",
};

// Whether ee/ is checked out: Common Test runs without it.
const EE_IS_PRESENT: boolean = fs.existsSync(
  path.join(REPOSITORY_DIRECTORY, "ee"),
);

// A request sent through axios itself rather than a client made from it.
const AXIOS_CALLED_DIRECTLY: RegExp =
  /\baxios\s*\(|\baxios\.(?:get|post|put|patch|delete|head|request)\(/;

const OTHER_CLIENT_MODULES: Array<string> = [
  "axios",
  "got",
  "http",
  "http2",
  "https",
  "node-fetch",
  "node:http",
  "node:http2",
  "node:https",
  "undici",
];

/*
 * The `beforeRedirect` of every axios client a file makes (axios.create), as
 * written - an empty string for a client made without one.
 */
function redirectChecksOfClientsMadeIn(relativePath: string): Array<string> {
  const sourceFile: ts.SourceFile = parseFile(relativePath);
  const checks: Array<string> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sourceFile) === "axios.create"
    ) {
      const config: ts.Expression | undefined = node.arguments[0];
      const check: ts.Expression | undefined =
        config && ts.isObjectLiteralExpression(config)
          ? propertyOf(config, "beforeRedirect", sourceFile)
          : undefined;

      checks.push(check ? check.getText(sourceFile) : "");
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return checks;
}

function codeFilesUnder(folders: Array<string>): Array<string> {
  return listProductFiles(undefined, folders).filter(
    (relativePath: string): boolean => {
      return CODE_FILE.test(relativePath);
    },
  );
}

/*
 * Whether a file uses an HTTP client other than the shared one: imports one
 * (not for its types alone), requires one, or calls the global fetch.
 */
function usesAnotherHttpClient(relativePath: string): boolean {
  const sourceFile: ts.SourceFile = parseFile(relativePath);
  let uses: boolean = false;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      OTHER_CLIENT_MODULES.includes(node.moduleSpecifier.text) &&
      !node.importClause?.isTypeOnly
    ) {
      uses = true;
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === "fetch" ||
        (node.expression.text === "require" &&
          node.arguments.some((argument: ts.Expression): boolean => {
            return (
              ts.isStringLiteral(argument) &&
              OTHER_CLIENT_MODULES.includes(argument.text)
            );
          })))
    ) {
      uses = true;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return uses;
}

/*
 * The text a request's body and headers are written with, a constant of the
 * same file followed to what it holds.
 */
function bodyAndHeadersOf(call: SharedClientCall): string {
  if (!call.argument) {
    return "";
  }

  const texts: Array<string> = [];

  for (const name of ["data", "headers"]) {
    const value: ts.Expression | undefined = propertyOf(
      call.argument,
      name,
      call.sourceFile,
    );

    if (!value) {
      continue;
    }

    texts.push(value.getText(call.sourceFile));

    if (ts.isIdentifier(value)) {
      const visit: (node: ts.Node) => void = (node: ts.Node): void => {
        if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.name.text === value.text &&
          node.initializer
        ) {
          texts.push(node.initializer.getText(call.sourceFile));
        }

        ts.forEachChild(node, visit);
      };

      visit(call.sourceFile);
    }
  }

  return texts.join("\n");
}

describe("the probe's and the Runner's requests", () => {
  const files: Array<string> = codeFilesUnder([PROBE, RUNNER]);
  const calls: Array<SharedClientCall> = files.flatMap(sharedClientCallsIn);

  test("are read from the source: the probe's and the Runner's own calls are all found", () => {
    // Every control-plane job of the probe, the Runner's registration, runbook and code-fix calls.
    expect(
      calls.filter((call: SharedClientCall): boolean => {
        return call.file.startsWith(`${PROBE}/`);
      }).length,
    ).toBeGreaterThanOrEqual(30);
    expect(
      calls.filter((call: SharedClientCall): boolean => {
        return call.file.startsWith(`${RUNNER}/`);
      }).length,
    ).toBeGreaterThanOrEqual(25);
  });

  test("every request through the shared client keeps its redirects on its server, but those to the listed other services", () => {
    expect(
      calls
        .filter((call: SharedClientCall): boolean => {
          return (
            !SHARED_CLIENT_CALLS_TO_OTHER_SERVICES[call.file] &&
            !callKeepsRedirectsOnServer(call)
          );
        })
        .map(placeOfCall),
    ).toEqual([]);
  });

  test("every file listed as calling other services through the shared client still does, and names no key", () => {
    for (const relativePath of Object.keys(
      SHARED_CLIENT_CALLS_TO_OTHER_SERVICES,
    )) {
      expect({
        relativePath,
        calls: sharedClientCallsIn(relativePath).length > 0,
        namesAKey: KEY_IN_CODE.test(codeOf(relativePath)),
      }).toEqual({ relativePath, calls: true, namesAKey: false });
    }
  });

  test("every other HTTP client they use is in a listed file", () => {
    expect(files.filter(usesAnotherHttpClient)).toEqual(
      Object.keys(OTHER_CLIENTS).sort(),
    );
  });

  test("no file with another HTTP client names a key, but the one that checks its redirects", () => {
    for (const relativePath of Object.keys(OTHER_CLIENTS)) {
      const code: string = codeOf(relativePath);
      const check: string | undefined =
        KEY_CARRYING_OTHER_CLIENTS[relativePath];

      if (check) {
        expect({
          relativePath,
          checks: redirectChecksOfClientsMadeIn(relativePath),
        }).toEqual({ relativePath, checks: [check] });
        continue;
      }

      expect({ relativePath, namesAKey: KEY_IN_CODE.test(code) }).toEqual({
        relativePath,
        namesAKey: false,
      });
    }
  });

  test("the Runner's own HTTP client checks its redirects where it is made, and nothing makes another", () => {
    const relativePath: string = "packages/Runner/Services/RunnerClient.ts";

    expect(redirectChecksOfClientsMadeIn(relativePath)).toEqual([
      KEY_CARRYING_OTHER_CLIENTS[relativePath],
    ]);
    // Requests go through that client alone: never axios itself.
    expect(codeOf(relativePath)).not.toMatch(AXIOS_CALLED_DIRECTLY);
  });
});

describe("requests anywhere else", () => {
  test("keep their redirects on their server when their body or headers name a key", () => {
    const calls: Array<SharedClientCall> = codeFilesUnder(["packages", "ee"])
      .filter((relativePath: string): boolean => {
        return (
          !relativePath.startsWith(`${PROBE}/`) &&
          !relativePath.startsWith(`${RUNNER}/`) &&
          !BROWSER_REQUESTS_WITH_A_KEY[relativePath]
        );
      })
      .flatMap(sharedClientCallsIn);

    const carryingAKey: Array<SharedClientCall> = calls.filter(
      (call: SharedClientCall): boolean => {
        return KEY_IN_CODE.test(bodyAndHeadersOf(call));
      },
    );

    // The services that present the cluster key, at least.
    expect(carryingAKey.length).toBeGreaterThanOrEqual(11);
    expect(
      carryingAKey
        .filter((call: SharedClientCall): boolean => {
          return !callKeepsRedirectsOnServer(call);
        })
        .map(placeOfCall),
    ).toEqual([]);

    // An Enterprise installation's licence checks with the licence server, with ee/ checked out.
    expect(
      carryingAKey
        .filter((call: SharedClientCall): boolean => {
          return call.file.startsWith("ee/Server/License/");
        })
        .map((call: SharedClientCall): string => {
          return call.file;
        }),
    ).toEqual(
      EE_IS_PRESENT
        ? [
            "ee/Server/License/Jobs/ReportUserCount.ts",
            "ee/Server/License/LicenseClient.ts",
          ]
        : [],
    );
  });

  test("every browser request listed still sends a key, from the browser", () => {
    for (const relativePath of Object.keys(BROWSER_REQUESTS_WITH_A_KEY)) {
      // A file under ee/ is there to read only when ee/ is checked out.
      if (relativePath.startsWith("ee/") && !EE_IS_PRESENT) {
        continue;
      }

      expect({
        relativePath,
        component: relativePath.endsWith(".tsx"),
        sendsAKey: sharedClientCallsIn(relativePath).some(
          (call: SharedClientCall): boolean => {
            return KEY_IN_CODE.test(bodyAndHeadersOf(call));
          },
        ),
      }).toEqual({ relativePath, component: true, sendsAKey: true });
    }
  });
});

/*
 * The reading above, held to what it must see: options written out, spread
 * from a helper, kept in a constant - and what takes the rule back.
 */
describe("how a request's options are read", () => {
  function optionsOf(source: string): boolean {
    const sourceFile: ts.SourceFile = ts.createSourceFile(
      "example.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    let options: ts.Expression | undefined = undefined;

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(sourceFile) === "API.post" &&
        node.arguments[0] &&
        ts.isObjectLiteralExpression(node.arguments[0])
      ) {
        options = propertyOf(node.arguments[0], "options", sourceFile);
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return keepsRedirectsOnServer(options, sourceFile);
  }

  test.each([
    [
      "written out",
      "API.post({ url, options: { sameServerRedirectsOnly: true } });",
    ],
    [
      "written out after other options",
      "API.post({ url, options: { timeout: 5, sameServerRedirectsOnly: true } });",
    ],
    [
      "written out after a spread of something else",
      "API.post({ url, options: { ...extra, sameServerRedirectsOnly: true } });",
    ],
    [
      "a probe's helper",
      "API.post({ url, options: ProbeAPIRequest.getDefaultRequestOptions(url) });",
    ],
    [
      "a Runner's helper",
      "API.post({ url, options: RunnerAPIRequest.getDefaultRequestOptions({ retries: 3 }) });",
    ],
    [
      "a helper spread, with more options after it",
      "API.post({ url, options: { ...ProbeAPIRequest.getDefaultRequestOptions(url), timeout: 5 } });",
    ],
    [
      "a constant of the file",
      "const requestOptions = { sameServerRedirectsOnly: true }; API.post({ url, options: requestOptions });",
    ],
  ])("keep redirects on the server: %s", (_label: string, source: string) => {
    expect(optionsOf(source)).toBe(true);
  });

  test.each([
    ["none at all", "API.post({ url, data });"],
    ["other options only", "API.post({ url, options: { timeout: 5 } });"],
    [
      "turned off",
      "API.post({ url, options: { sameServerRedirectsOnly: false } });",
    ],
    [
      "taken back by a spread after it",
      "API.post({ url, options: { sameServerRedirectsOnly: true, ...extra } });",
    ],
    [
      "taken back after a helper",
      "API.post({ url, options: { ...RunnerAPIRequest.getDefaultRequestOptions(), sameServerRedirectsOnly: false } });",
    ],
    [
      "a value read at run time",
      "API.post({ url, options: { sameServerRedirectsOnly: keep } });",
    ],
    ["a helper of another name", "API.post({ url, options: getOptions() });"],
    [
      "a variable that is not a constant",
      "let requestOptions = { sameServerRedirectsOnly: true }; API.post({ url, options: requestOptions });",
    ],
  ])("do not: %s", (_label: string, source: string) => {
    expect(optionsOf(source)).toBe(false);
  });
});
