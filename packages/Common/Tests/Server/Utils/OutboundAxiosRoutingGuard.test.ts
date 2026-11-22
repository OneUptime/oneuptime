import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * NO SERVER REQUEST LEAVES THE OUTBOUND PROXY TO AXIOS (issue #10442).
 *
 * Axios, left to read HTTPS_PROXY / HTTP_PROXY / ALL_PROXY itself, signs in
 * to the proxy with its user name and password as the URL percent-encodes
 * them: a password p@ss, written http://user:p%40ss@proxy:3128, reached the
 * proxy as p%40ss, and a proxy that checks it refused every such request
 * with 407. Every server request is routed by OneUptime now
 * (Server/Utils/OutboundProxyAgents): on agents that carry the route, with
 * axios's proxy off.
 *
 * This reads every server source file of the checkout - Common's server,
 * utilities and types, the App's server feature sets, ee's server, the
 * probe and the Runner - and fails on:
 *
 *   - a file that sends with axios and is not in ROUTED_SENDERS, which names
 *     how each one routes and is checked to still say so. A new sender
 *     routes as one of them does, and is added with a word on how;
 *   - an axios instance (axios.create) whose requests are not routed by the
 *     interceptor;
 *   - a library in the server's dependencies that sends with axios and is
 *     not in AXIOS_LIBRARIES, which says how each one's requests are routed
 *     (or why they need none). A new one is looked at before it ships.
 */

const PACKAGES_ROOT: string = path.join(__dirname, "..", "..", "..", "..");
const REPOSITORY_ROOT: string = path.join(PACKAGES_ROOT, "..");
const EE_PRESENT: boolean = fs.existsSync(path.join(REPOSITORY_ROOT, "ee"));

const SEARCHED: Array<string> = [
  path.join(PACKAGES_ROOT, "Common", "Server"),
  path.join(PACKAGES_ROOT, "Common", "Utils"),
  path.join(PACKAGES_ROOT, "Common", "Types"),
  path.join(PACKAGES_ROOT, "App", "FeatureSet"),
  path.join(PACKAGES_ROOT, "App", "Utils"),
  path.join(PACKAGES_ROOT, "Probe"),
  path.join(PACKAGES_ROOT, "Runner"),
  path.join(PACKAGES_ROOT, "TestServer"),
  path.join(PACKAGES_ROOT, "Nginx"),
  path.join(REPOSITORY_ROOT, "ee", "Server"),
];

const SKIPPED_FOLDERS: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
  "Scripts",
];

// Browser code: a browser sends through its own machine's proxy, if any.
const SKIPPED_PATHS: Array<string> = [
  "Dashboard",
  "AdminDashboard",
  "StatusPage",
  "Accounts",
  "PublicDashboard",
  "BrowserRecorder",
  "MobileRecorder",
].map((name: string): string => {
  return path.join(PACKAGES_ROOT, "App", "FeatureSet", name);
});

/*
 * Every server file that sends with axios, how it routes, and the words in
 * it that say so: each file must still hold them.
 */
const ROUTED_SENDERS: Record<string, { how: string; marker: string }> = {
  "packages/Common/Utils/API.ts": {
    how: "the shared API client: routed for its URL on a server, as it is in a browser",
    marker: "OutboundRequestRouting.route(axiosOptions);",
  },
  "packages/Common/Types/WebsiteRequest.ts": {
    how: "a website monitor's request: its own agents and proxy, or routed",
    marker: "OutboundRequestRouting.route(axiosOptions);",
  },
  "packages/Common/Server/Utils/Captcha.ts": {
    how: "hCaptcha's verification, routed by hand",
    marker: "OutboundProxyAgents.routeAxiosRequest({",
  },
  "packages/Common/Server/Utils/Marketing/GoogleAnalyticsMeasurementProtocol.ts":
    {
      how: "Google Analytics' Measurement Protocol, routed by hand",
      marker: "OutboundProxyAgents.routeAxiosRequest({",
    },
  "packages/Common/Server/Utils/Marketing/MarketingEventWebhook.ts": {
    how: "the marketing event webhook, routed by hand",
    marker: "OutboundProxyAgents.routeAxiosRequest({",
  },
  "packages/Common/Server/Utils/Workspace/Slack/SlackInlineImages.ts": {
    how: "an image uploaded to Slack, routed by hand",
    marker: "OutboundProxyAgents.routeAxiosRequest({",
  },
  "packages/Common/Server/Utils/ToolImport/ToolImportHttpClient.ts": {
    how: "a tool import: on its pinned agents, or routed",
    marker: "OutboundProxyAgents.routeAxiosRequest({",
  },
  "packages/Common/Server/Utils/DataSource/HttpFetch.ts": {
    how: "a data source: on pinned agents that go through the proxy themselves",
    marker: "proxy: false,",
  },
  "packages/Common/Server/Utils/Workflow/OAuth2TokenClient.ts": {
    how: "an OAuth token URL: on pinned agents that go through the proxy themselves",
    marker: "proxy: false,",
  },
  "packages/Common/Server/Utils/CodeRepository/CodeHost/CodeHostHttp.ts": {
    how: "a Git server: on pinned agents that never go through a proxy",
    marker: "proxy: false,",
  },
  "packages/Common/Server/Utils/Mattermost/MattermostWebhook.ts": {
    how: "a Mattermost server: on pinned agents that never go through a proxy",
    marker: "proxy: false,",
  },
  "packages/Common/Server/Utils/VM/VMHttpBridge.ts": {
    how: "the JavaScript sandbox's axios bridge: pinned, never through a proxy",
    marker: 'safeConfig["proxy"] = false;',
  },
  "packages/App/FeatureSet/Runbook/Services/StepExecutors.ts": {
    how: "a Runbook HTTP step: on pinned agents that go through the proxy themselves",
    marker: "proxy: false,",
  },
  "packages/Probe/Utils/Monitors/CertificateRevocation/RevocationHttpClient.ts":
    {
      how: "a certificate's revocation check: on the monitor's own agents",
      marker: "proxy: false,",
    },
  "packages/Probe/Utils/Monitors/MonitorTypes/ExternalStatusPageMonitor.ts": {
    how: "an external status page: on the monitor's own agents",
    marker: "proxy: false,",
  },
  "packages/Probe/Utils/Monitors/SyntheticRuntime/PlaywrightCapabilityBroker.ts":
    {
      how: "a synthetic monitor's axios bridge, routed by hand",
      marker: "OutboundProxyAgents.routeAxiosRequest(config)",
    },
  "packages/Runner/Services/KubernetesExecutor.ts": {
    how: "the Kubernetes API: on agents of its own that go through the proxy themselves",
    marker: "proxy: false,",
  },
  "packages/Runner/Services/RunnerClient.ts": {
    how: "the Runner's calls to the server: its axios instance's interceptor",
    marker:
      "http.interceptors.request.use(OutboundProxyAgents.routeAxiosRequest);",
  },
};

/*
 * The libraries of the server that send with axios, and why each one's
 * requests reach a proxy with its real password.
 */
const AXIOS_LIBRARIES: Record<string, string> = {
  "acme-client":
    "Let's Encrypt orders: its instance (acme.axios) is routed by an interceptor (Greenlock.routeAcmeRequests)",
  "@sendgrid/client":
    "SendGrid's mail: the client a send uses is routed (SendGridMailProvider.routeThroughOutboundProxy)",
  twilio:
    "sends with proxy: false, on an https-proxy-agent of its own for HTTP_PROXY, which decodes the password",
  botbuilder:
    "its axios client calls Skills, which OneUptime never does; Teams goes through @azure/core-rest-pipeline",
  "botframework-connector":
    "its axios client calls Skills, which OneUptime never does; Teams goes through @azure/core-rest-pipeline",
};

// How a hook that routes a library's requests reads in its file.
const LIBRARY_HOOKS: Record<string, Array<string>> = {
  "packages/Common/Server/Utils/Greenlock/Greenlock.ts": [
    "acme.axios.interceptors.request.use(OutboundProxyAgents.routeAxiosRequest);",
    "GreenlockUtil.routeAcmeRequests();",
  ],
  "packages/App/FeatureSet/Notification/Services/MailProviders/SendGridMailProvider.ts":
    [
      "SendGridMailProvider.routeThroughOutboundProxy(SendgridMail);",
      "SendGridMailProvider.routeThroughOutboundProxy(mailer);",
    ],
};

// The lockfiles of the server's packages.
const LOCKFILES: Array<string> = [
  "packages/Common/package-lock.json",
  "packages/App/package-lock.json",
  "packages/Probe/package-lock.json",
  "packages/Runner/package-lock.json",
];

const AXIOS_METHODS: string =
  "(?:get|post|put|patch|delete|head|options|request|postForm|putForm|patchForm|create)";

function sourceFiles(folder: string): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(folder)) {
    return files;
  }

  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const child: string = path.join(folder, entry.name);

    if (entry.isDirectory()) {
      if (
        !SKIPPED_FOLDERS.includes(entry.name) &&
        !SKIPPED_PATHS.includes(child)
      ) {
        files.push(...sourceFiles(child));
      }
      continue;
    }

    if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.includes(".test.")
    ) {
      files.push(child);
    }
  }

  return files;
}

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

// The code of a file, its comments left out.
function codeOf(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/*
 * The names a file gives axios's default export: import axios from "axios".
 * An import starts its line, which tells it from one written in a string,
 * as the API reference prints code that sends with axios
 * (APIReference/Utils/CodeExampleGenerator).
 */
function axiosNamesIn(code: string): Array<string> {
  const names: Array<string> = [];
  const importDefault: RegExp =
    /^import\s+(?!type\b)([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s+from\s+["']axios["']/gm;
  const required: RegExp =
    /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*["']axios["']\s*\)/gm;

  for (const pattern of [importDefault, required]) {
    let match: RegExpExecArray | null = pattern.exec(code);

    while (match) {
      names.push(match[1]!);
      match = pattern.exec(code);
    }
  }

  return names;
}

// Whether the code sends a request with axios, or makes an instance of it.
function sendsWithAxios(code: string): boolean {
  return axiosNamesIn(code).some((name: string): boolean => {
    return new RegExp(
      `(?<![\\w$.])${name}\\s*(?:\\.${AXIOS_METHODS}\\s*)?(?:<[^>]*>\\s*)?\\(`,
    ).test(code);
  });
}

const SERVER_FILES: Array<string> = SEARCHED.flatMap(sourceFiles);

const SENDERS_FOUND: Array<string> = SERVER_FILES.filter(
  (file: string): boolean => {
    return sendsWithAxios(codeOf(fs.readFileSync(file, "utf8")));
  },
)
  .map(relative)
  .sort();

describe("every server file that sends with axios routes its requests itself", () => {
  test("the search reads the server's code", () => {
    // The guard reads nothing if its folders move.
    expect(SERVER_FILES.length).toBeGreaterThan(1000);
    expect(SENDERS_FOUND).toContain("packages/Common/Utils/API.ts");
  });

  test("each one is in ROUTED_SENDERS, which says how it routes", () => {
    const unlisted: Array<string> = SENDERS_FOUND.filter(
      (file: string): boolean => {
        return !ROUTED_SENDERS[file];
      },
    );

    expect({
      unlisted,
      fix: "Send it through API, or route the request with OutboundProxyAgents.routeAxiosRequest (or agents that carry the route, with proxy: false), and add it to ROUTED_SENDERS.",
    }).toEqual({
      unlisted: [],
      fix: "Send it through API, or route the request with OutboundProxyAgents.routeAxiosRequest (or agents that carry the route, with proxy: false), and add it to ROUTED_SENDERS.",
    });
  });

  test("each listed one still sends with axios, and still says how it routes", () => {
    for (const [file, sender] of Object.entries(ROUTED_SENDERS)) {
      const text: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, file),
        "utf8",
      );

      expect({ file, sends: sendsWithAxios(codeOf(text)) }).toEqual({
        file,
        sends: true,
      });
      expect({ file, routes: text.includes(sender.marker) }).toEqual({
        file,
        routes: true,
      });
    }
  });

  test("an axios instance's requests are routed by the interceptor", () => {
    const unrouted: Array<string> = SERVER_FILES.filter(
      (file: string): boolean => {
        const code: string = codeOf(fs.readFileSync(file, "utf8"));

        return (
          axiosNamesIn(code).some((name: string): boolean => {
            return code.includes(`${name}.create(`);
          }) &&
          !code.includes(
            ".interceptors.request.use(OutboundProxyAgents.routeAxiosRequest)",
          )
        );
      },
    ).map(relative);

    expect(unrouted).toEqual([]);
  });
});

describe("the server's libraries that send with axios", () => {
  test("are each named in AXIOS_LIBRARIES, which says how their requests are routed", () => {
    const found: Set<string> = new Set<string>();

    for (const lockfile of LOCKFILES) {
      const lock: {
        packages?: Record<string, { dependencies?: Record<string, string> }>;
      } = JSON.parse(
        fs.readFileSync(path.join(REPOSITORY_ROOT, lockfile), "utf8"),
      );

      for (const [where, entry] of Object.entries(lock.packages || {})) {
        if (
          entry.dependencies?.["axios"] &&
          where.startsWith("node_modules/")
        ) {
          found.add(where.slice(where.lastIndexOf("node_modules/") + 13));
        }
      }
    }

    expect(Array.from(found).sort()).toEqual(
      Object.keys(AXIOS_LIBRARIES).sort(),
    );
  });

  test("whose hooks are where they route them", () => {
    for (const [file, hooks] of Object.entries(LIBRARY_HOOKS)) {
      const code: string = codeOf(
        fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
      );

      for (const hook of hooks) {
        expect({ file, hook, present: code.includes(hook) }).toEqual({
          file,
          hook,
          present: true,
        });
      }
    }
  });
});

describe("the guard reads a sender as it is written", () => {
  test.each([
    'import axios from "axios";\nawait axios.post(url, body);',
    'import axios, { AxiosResponse } from "axios";\nconst r: AxiosResponse = await axios(config);',
    'import Axios from "axios";\nawait Axios.request<string>({ url });',
    'const axios = require("axios");\naxios.get(url);',
    'import axios from "axios";\nconst http = axios.create({ baseURL });',
  ])("a sender: %s", (source: string) => {
    expect(sendsWithAxios(codeOf(source))).toBe(true);
  });

  test.each([
    'import axios, { AxiosError } from "axios";\nif (axios.isAxiosError(error)) {}',
    'import type { AxiosRequestConfig } from "axios";\nconst config: AxiosRequestConfig = {};',
    "/* axios.post(url) in a comment */",
    'const code = "await axios.post(url)";',
    "let code: string = `import axios from 'axios';\nconst response = await axios({ url });`;",
    'import axios from "axios";\n// axios.get(url) is how it used to read',
  ])("not a sender: %s", (source: string) => {
    expect(sendsWithAxios(codeOf(source))).toBe(false);
  });

  test("ee's server is read wherever ee is checked out", () => {
    expect(SEARCHED.includes(path.join(REPOSITORY_ROOT, "ee", "Server"))).toBe(
      true,
    );
    expect(typeof EE_PRESENT).toBe("boolean");
  });
});
