import OutboundProxy from "../../../Server/Utils/OutboundProxy";
import { describe, expect, test } from "@jest/globals";
import { spawnSync, SpawnSyncReturns } from "child_process";
import path from "path";

/*
 * ONE ANSWER FOR EVERY OUTBOUND REQUEST: THROUGH THE PROXY, OR NOT (issue
 * #8932).
 *
 * Every axios request of the server goes through the outbound proxy the
 * environment names, unless NO_PROXY names its host; a request sent with
 * Node's own http client (external calendars, MCP servers, backups, OIDC)
 * now does too, decided by OutboundProxy.getProxyFor. These hold that
 * decision to axios's own: axios's code - proxy-from-env's getProxyForUrl
 * and axios's lib/helpers/shouldBypassProxy.js, exactly as axios's http
 * adapter calls them - runs in a child Node.js process (they are ES
 * modules, which this suite cannot load) over every kind of proxy setting,
 * NO_PROXY entry and URL, and each answer must be OutboundProxy's.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "../../..");

const VARIABLES: Array<string> = [
  "http_proxy",
  "HTTP_PROXY",
  "https_proxy",
  "HTTPS_PROXY",
  "all_proxy",
  "ALL_PROXY",
  "no_proxy",
  "NO_PROXY",
];

interface ProxyCase {
  env: Record<string, string>;
  url: string;
}

// What axios's http adapter does with a URL (setProxy), in a child process.
const AXIOS_DECIDES: string = `
const shouldBypassProxy = (await import("axios/unsafe/helpers/shouldBypassProxy.js")).default;
const { getProxyForUrl } = await import("proxy-from-env");
const VARIABLES = ${JSON.stringify(VARIABLES)};
let input = "";
for await (const chunk of process.stdin) { input += chunk; }
const answers = JSON.parse(input).map((proxyCase) => {
  for (const name of VARIABLES) { delete process.env[name]; }
  Object.assign(process.env, proxyCase.env);
  const parsed = new URL(proxyCase.url);
  const location = parsed.protocol + "//" + parsed.hostname + (parsed.port ? ":" + parsed.port : "") + parsed.pathname + parsed.search;
  const proxyUrl = getProxyForUrl(location);
  if (!proxyUrl || shouldBypassProxy(location)) { return null; }
  try { return new URL(proxyUrl).href; } catch { return "not a URL"; }
});
process.stdout.write(JSON.stringify(answers));
`;

function axiosAnswers(cases: Array<ProxyCase>): Array<string | null> {
  const child: SpawnSyncReturns<string> = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", AXIOS_DECIDES],
    {
      cwd: COMMON_ROOT,
      input: JSON.stringify(cases),
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      env: { PATH: process.env["PATH"] || "" },
    },
  );

  expect({ status: child.status, stderr: child.stderr }).toEqual({
    status: 0,
    stderr: "",
  });

  return JSON.parse(child.stdout) as Array<string | null>;
}

function outboundProxyAnswer(proxyCase: ProxyCase): string | null {
  const saved: Map<string, string | undefined> = new Map<
    string,
    string | undefined
  >();

  for (const name of VARIABLES) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }

  Object.assign(process.env, proxyCase.env);

  try {
    const proxy: URL | null = OutboundProxy.getProxyFor(new URL(proxyCase.url));
    return proxy ? proxy.href : null;
  } catch {
    return "not a URL";
  } finally {
    for (const name of VARIABLES) {
      const value: string | undefined = saved.get(name);

      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

function disagreements(cases: Array<ProxyCase>): Array<string> {
  const axios: Array<string | null> = axiosAnswers(cases);

  expect(axios).toHaveLength(cases.length);

  return cases
    .map((proxyCase: ProxyCase, index: number): string | null => {
      const ours: string | null = outboundProxyAnswer(proxyCase);

      return ours === axios[index]
        ? null
        : `${JSON.stringify(proxyCase.env)} ${proxyCase.url}: axios ${String(
            axios[index],
          )}, OutboundProxy ${String(ours)}`;
    })
    .filter((line: string | null): line is string => {
      return line !== null;
    });
}

const HOSTS: Array<string> = [
  "example.com",
  "api.example.com",
  "badexample.com",
  "example.com.",
  "EXAMPLE.com",
  "a.svc.cluster.local",
  "internal",
  "x.internal",
  "10.1.2.3",
  "10.200.0.1",
  "192.168.1.10",
  "8.8.8.8",
  "127.0.0.1",
  "127.0.0.2",
  "localhost",
  "0x7f.0.0.1",
  "[::1]",
  "[2001:db8::1]",
  "[2001:db8::2]",
  "[fd00::5]",
  "[::ffff:10.1.2.3]",
  "[0:0:0:0:0:ffff:192.168.1.10]",
  "[64:ff9b::a01:203]",
  "[2606:4700::1]",
];

const URLS: Array<string> = HOSTS.flatMap((host: string): Array<string> => {
  return ["http", "https"].flatMap((scheme: string): Array<string> => {
    return ["", ":8080", ":443", ":80"].map((port: string): string => {
      return `${scheme}://${host}${port}/path?query=1`;
    });
  });
});

const NO_PROXY_VALUES: Array<string> = [
  "",
  "*",
  "example.com",
  "EXAMPLE.COM",
  ".example.com",
  "*.example.com",
  "*example.com",
  "example.com:8080",
  "example.com:443",
  "example.com:80",
  "example.com.",
  "api.example.com",
  ".com",
  "10.0.0.0/8",
  "10.1.2.3",
  "10.1.2.3:8080",
  "192.168.0.0/16",
  "8.8.8.0/24",
  "0.0.0.0/0",
  "10.0.0.0/33",
  "10.0.0.0/08",
  "10.0.0/8",
  "[10.0.0.0]/8",
  "::/0",
  "2001:db8::/32",
  "[2001:db8::]/32",
  "2001:db8::1",
  "[2001:db8::1]",
  "[2001:db8::1]:8080",
  "fd00::/8",
  "::ffff:10.0.0.0/104",
  "::ffff:10.0.0.0/64",
  "::ffff:10.1.2.3",
  "[::ffff:a01:203]",
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "127.1",
  "0x7f.0.0.1",
  "0177.0.0.1",
  "0.0.0.0",
  "svc.cluster.local",
  ".svc.cluster.local",
  ".cluster.local",
  "internal",
  "*.internal",
  "example.com, 10.0.0.0/8",
  "foo,,example.com",
  " example.com ",
  "example.com\t10.1.2.3",
  "other.org,*.internal,10.0.0.0/8,.svc.cluster.local",
];

const PROXY_SETTINGS: Array<Record<string, string>> = [
  {
    HTTPS_PROXY: "http://proxy.corp:3128",
    HTTP_PROXY: "http://proxy.corp:3128",
  },
  {
    https_proxy: "http://lower.corp:3128",
    HTTPS_PROXY: "http://upper.corp:3128",
    http_proxy: "http://lower.corp:3128",
  },
  { ALL_PROXY: "proxy.corp:3128" },
  { http_proxy: "proxy.corp:8080" },
  { HTTPS_PROXY: "https://user:p%40ss@proxy.corp:8443" },
  { HTTP_PROXY: "http://proxy.corp:3128", all_proxy: "http://all.corp:1080" },
  { HTTPS_PROXY: "http://[fd00::3]:3128", HTTP_PROXY: "http://10.9.9.9:3128" },
  { HTTPS_PROXY: "::not a url" },
  {},
];

describe("OutboundProxy decides as axios decides", () => {
  test("for every NO_PROXY entry and URL", () => {
    const cases: Array<ProxyCase> = NO_PROXY_VALUES.flatMap(
      (noProxy: string): Array<ProxyCase> => {
        return URLS.map((url: string): ProxyCase => {
          return {
            env: { ...PROXY_SETTINGS[0]!, NO_PROXY: noProxy },
            url,
          };
        });
      },
    );

    expect(cases.length).toBeGreaterThan(5000);
    expect(disagreements(cases)).toEqual([]);
  });

  test("for every way to name the proxy, with and without NO_PROXY", () => {
    const cases: Array<ProxyCase> = PROXY_SETTINGS.flatMap(
      (settings: Record<string, string>): Array<ProxyCase> => {
        return [
          {},
          { NO_PROXY: "example.com" },
          { no_proxy: ".svc.cluster.local,10.0.0.0/8" },
          { NO_PROXY: "example.com", no_proxy: "other.org" },
        ].flatMap((noProxy: Record<string, string>): Array<ProxyCase> => {
          return URLS.map((url: string): ProxyCase => {
            return { env: { ...settings, ...noProxy }, url };
          });
        });
      },
    );

    expect(disagreements(cases)).toEqual([]);
  });

  test("the corpus holds both answers, and every kind of proxy", () => {
    const answers: Array<string | null> = PROXY_SETTINGS.map(
      (settings: Record<string, string>): string | null => {
        return outboundProxyAnswer({
          env: settings,
          url: "https://example.com/",
        });
      },
    );

    expect(answers).toEqual([
      "http://proxy.corp:3128/",
      "http://lower.corp:3128/",
      // A proxy written without a scheme takes the URL's, as axios reads it.
      "https://proxy.corp:3128/",
      null,
      "https://user:p%40ss@proxy.corp:8443/",
      "http://all.corp:1080/",
      "http://[fd00::3]:3128/",
      "not a URL",
      null,
    ]);
  });
});

describe("what OutboundProxy answers, read plainly", () => {
  function answer(env: Record<string, string>, url: string): string | null {
    return outboundProxyAnswer({ env, url });
  }

  const PROXY: Record<string, string> = {
    HTTPS_PROXY: "http://proxy.corp:3128",
    HTTP_PROXY: "http://proxy.corp:3128",
  };

  test("an https URL goes through HTTPS_PROXY, an http one through HTTP_PROXY", () => {
    expect(
      answer(
        { HTTPS_PROXY: "http://s.corp:1", HTTP_PROXY: "http://p.corp:2" },
        "https://calendar.google.com/x.ics",
      ),
    ).toBe("http://s.corp:1/");
    expect(
      answer(
        { HTTPS_PROXY: "http://s.corp:1", HTTP_PROXY: "http://p.corp:2" },
        "http://calendar.example/x.ics",
      ),
    ).toBe("http://p.corp:2/");
  });

  test("ALL_PROXY is the proxy for a scheme with none of its own", () => {
    expect(
      answer({ ALL_PROXY: "http://all.corp:3128" }, "https://a.example/"),
    ).toBe("http://all.corp:3128/");
  });

  test("with no proxy set, every URL goes directly", () => {
    expect(answer({}, "https://a.example/")).toBeNull();
    expect(answer({ NO_PROXY: "*" }, "https://a.example/")).toBeNull();
  });

  test.each([
    ["minio.internal.corp", "minio.internal.corp"],
    [".internal.corp", "minio.internal.corp"],
    ["*.internal.corp", "minio.internal.corp"],
    ["10.0.0.0/8", "10.20.30.40"],
    ["fd00::/8", "[fd00::12]"],
    ["*", "anything.example"],
  ])(
    "NO_PROXY=%s sends a request to %s directly",
    (noProxy: string, host: string) => {
      expect(
        answer({ ...PROXY, NO_PROXY: noProxy }, `https://${host}/`),
      ).toBeNull();
    },
  );

  test("anything but an http or https URL is no business of the proxy's", () => {
    expect(answer(PROXY, "ftp://files.example/x")).toBeNull();
  });
});
