import { escapeRegExp } from "../../../Utils/RegExpEscape";
import {
  EE_PRESENT,
  REPOSITORY_ROOT,
  SEARCHED,
  codeOf,
  relative,
  serverSourceFiles,
} from "../TestingUtils/ServerSourceFiles";
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
 * probe, the Runner and the rest TestingUtils/ServerSourceFiles lists, which
 * OutboundFetchRoutingGuard reads too - and fails on:
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
    "SMS and calls: every Twilio client is handed a RequestClient whose axios instance routes each request (TwilioHttpClient), HTTP_PROXY kept as the fallback Twilio's own client read",
  botbuilder:
    "its axios client calls Skills (BotFrameworkHttpClient), which OneUptime never does; the Teams bot's own requests are routed by BotFrameworkRouting (#10763): its keys with OutboundFetch, its tokens and its replies on OutboundProxyAgents' agents",
  "botframework-connector":
    "its axios client calls Skills (BotFrameworkClientImpl), which OneUptime never does; the Teams bot's own requests are routed by BotFrameworkRouting (#10763): its keys with OutboundFetch, its tokens and its replies on OutboundProxyAgents' agents",
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
  "packages/App/FeatureSet/Notification/Utils/TwilioHttpClient.ts": [
    "client.axios.interceptors.request.use(",
    "return TwilioHttpClient.route({",
    "const proxy: URL | null = OutboundProxyAgents.getProxyFor(url);",
  ],
};

/*
 * What every Twilio client of the server is handed, so its requests are
 * routed (#10721): Twilio's own client reads HTTP_PROXY alone.
 */
const TWILIO_HTTP_CLIENT: string = "httpClient: TwilioHttpClient.create()";

// The lockfiles of the server's packages.
const LOCKFILES: Array<string> = [
  "packages/Common/package-lock.json",
  "packages/App/package-lock.json",
  "packages/Probe/package-lock.json",
  "packages/Runner/package-lock.json",
];

const AXIOS_METHODS: string =
  "(?:get|post|put|patch|delete|head|options|request|postForm|putForm|patchForm|create)";

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

const SERVER_FILES: Array<string> = serverSourceFiles();

const ROUTED_BY_HAND: string = "OutboundProxyAgents.routeAxiosRequest({";

/*
 * The object literal each routeAxiosRequest({ ... }) in a file is handed,
 * read to its closing brace.
 */
function configsRoutedByHandIn(code: string): Array<string> {
  const configs: Array<string> = [];
  let from: number = code.indexOf(ROUTED_BY_HAND);

  while (from !== -1) {
    const start: number = from + ROUTED_BY_HAND.length - 1;
    let depth: number = 0;
    let end: number = start;

    for (; end < code.length; end++) {
      if (code[end] === "{") {
        depth++;
      } else if (code[end] === "}") {
        depth--;

        if (depth === 0) {
          break;
        }
      }
    }

    configs.push(code.slice(start, end + 1));
    from = code.indexOf(ROUTED_BY_HAND, end);
  }

  return configs;
}

// A url property, written out or as shorthand.
const URL_PROPERTY: RegExp = /(^|[{,\s])url\s*[:,}]/;

// The names a file gives twilio's default export: import Twilio from "twilio".
function twilioNamesIn(code: string): Array<string> {
  const names: Array<string> = [];
  const importDefault: RegExp =
    /^import\s+(?!type\b)([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s+from\s+["']twilio["']/gm;
  let match: RegExpExecArray | null = importDefault.exec(code);

  while (match) {
    names.push(match[1]!);
    match = importDefault.exec(code);
  }

  return names;
}

/*
 * The arguments of each Twilio client a file makes - Twilio(...) or
 * new Twilio.Twilio(...) - read to their closing parenthesis.
 */
function twilioClientArgumentsIn(code: string): Array<string> {
  const clients: Array<string> = [];

  for (const name of twilioNamesIn(code)) {
    const call: RegExp = new RegExp(
      `(?<![\\w$.])${escapeRegExp(name)}\\s*(?:\\.Twilio\\s*)?\\(`,
      "g",
    );
    let match: RegExpExecArray | null = call.exec(code);

    while (match) {
      const start: number = match.index + match[0].length - 1;
      let depth: number = 0;
      let end: number = start;

      for (; end < code.length; end++) {
        if (code[end] === "(") {
          depth++;
        } else if (code[end] === ")") {
          depth--;

          if (depth === 0) {
            break;
          }
        }
      }

      clients.push(code.slice(start, end + 1));
      match = call.exec(code);
    }
  }

  return clients;
}

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

  /*
   * The route is decided for the config's URL. A config routed by hand
   * without one is left to axios (OutboundProxyAgents.routeAxiosRequest),
   * which signs in to the proxy with its password still percent-encoded.
   */
  test("each config routed by hand names its URL, so its route is decided for it", () => {
    const routingFiles: Array<string> = SERVER_FILES.filter(
      (file: string): boolean => {
        return fs.readFileSync(file, "utf8").includes(ROUTED_BY_HAND);
      },
    );
    const withoutUrl: Array<string> = routingFiles.flatMap(
      (file: string): Array<string> => {
        return configsRoutedByHandIn(codeOf(fs.readFileSync(file, "utf8")))
          .filter((config: string): boolean => {
            return !URL_PROPERTY.test(config);
          })
          .map((): string => {
            return path.relative(REPOSITORY_ROOT, file);
          });
      },
    );

    expect(routingFiles.length).toBeGreaterThan(3);
    expect({
      withoutUrl,
      fix: "Hand routeAxiosRequest the request's url (and baseURL, if it has one) with the rest of its config.",
    }).toEqual({
      withoutUrl: [],
      fix: "Hand routeAxiosRequest the request's url (and baseURL, if it has one) with the rest of its config.",
    });
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

  /*
   * Twilio's own client reads HTTP_PROXY alone and decides once for every
   * host (#10721): a Twilio client made without the http client that
   * routes its requests sends SMS and calls past HTTPS_PROXY and NO_PROXY.
   */
  test("every Twilio client is handed the http client that routes its requests", () => {
    const clients: Array<{ file: string; routed: boolean }> =
      SERVER_FILES.flatMap(
        (file: string): Array<{ file: string; routed: boolean }> => {
          return twilioClientArgumentsIn(
            codeOf(fs.readFileSync(file, "utf8")),
          ).map(
            (clientArguments: string): { file: string; routed: boolean } => {
              return {
                file: relative(file),
                routed: clientArguments.includes(TWILIO_HTTP_CLIENT),
              };
            },
          );
        },
      );

    // SMS, calls, the call provider's numbers, and a voicemail's message.
    expect(clients.length).toBeGreaterThanOrEqual(4);
    expect({
      unrouted: clients.filter((client: { routed: boolean }): boolean => {
        return !client.routed;
      }),
      fix: `Hand the client { ${TWILIO_HTTP_CLIENT} } as its third argument.`,
    }).toEqual({
      unrouted: [],
      fix: `Hand the client { ${TWILIO_HTTP_CLIENT} } as its third argument.`,
    });
  });
});

describe("the guard reads a Twilio client as it is written", () => {
  test.each([
    'import Twilio from "twilio";\nconst client = Twilio(sid, token);',
    'import Twilio from "twilio";\nthis.client = new Twilio.Twilio(sid, token);',
  ])("an unrouted client: %s", (source: string) => {
    const clients: Array<string> = twilioClientArgumentsIn(codeOf(source));

    expect(clients).toHaveLength(1);
    expect(clients[0]!.includes(TWILIO_HTTP_CLIENT)).toBe(false);
  });

  test("a routed client, its arguments read whole", () => {
    const clients: Array<string> = twilioClientArgumentsIn(
      codeOf(
        'import Twilio from "twilio";\nconst client = Twilio(\n  config.accountSid,\n  config.authToken,\n  { httpClient: TwilioHttpClient.create() },\n);',
      ),
    );

    expect(clients).toHaveLength(1);
    expect(clients[0]!.includes(TWILIO_HTTP_CLIENT)).toBe(true);
  });

  test.each([
    'import Twilio from "twilio";\nconst client: Twilio.Twilio | null = null;',
    'import { validateRequest } from "twilio";\nvalidateRequest(token, signature, url, params);',
    'import Twilio from "twilio";\nconst response = new Twilio.twiml.VoiceResponse();',
    'import Twilio from "twilio";\n// Twilio(sid, token) is how it used to read',
  ])("not a client: %s", (source: string) => {
    expect(twilioClientArgumentsIn(codeOf(source))).toEqual([]);
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
