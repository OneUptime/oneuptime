import http from "http";

/*
 * Egress proxies. Clusters that reach OneUptime only through a proxy set
 * HTTPS_PROXY / HTTP_PROXY / NO_PROXY on the agent (the chart's
 * aiAgent.extraEnv). The previous in-cluster Runner used axios, which reads
 * those by default; Node's built-in fetch does NOT, unless proxy support is
 * switched on — without this, a cluster behind a proxy silently stops
 * connecting after the upgrade to the AI agent.
 *
 * The agent switches it on itself, at start-up, with
 * http.setGlobalProxyFromEnv() (Node 26, the image's Node). That covers
 * fetch, and so every call IngestClient makes: an http:// target goes
 * through HTTP_PROXY, an https:// one is tunnelled with CONNECT through
 * HTTPS_PROXY, and NO_PROXY hosts bypass it.
 *
 * The image deliberately does NOT set NODE_USE_ENV_PROXY=1, which does the
 * same at process start: Node then parses the proxy variables before any
 * agent code runs, and a typo (proxy.corp:3128 without http://, a stray
 * bracket) kills the process on every start — a crash-looping pod, a
 * failed `helm upgrade --wait`, and Node's crash output printing the raw
 * value, password included. Here a bad value is one log line, without the
 * password, and the pod stays up. On an older Node (no
 * setGlobalProxyFromEnv) an operator can still set NODE_USE_ENV_PROXY=1.
 *
 * kubectl never sees any of this: on the in-cluster path its environment
 * carries no proxy variables (KubectlExecutor.buildSpawnEnv), because the
 * API server is the pod's own service address.
 */

export const PROXY_ENV_NAMES: ReadonlyArray<string> = [
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "NO_PROXY",
  "no_proxy",
];

// The variables that hold a proxy URL (and so, possibly, a password).
export const PROXY_URL_ENV_NAMES: ReadonlyArray<string> = [
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
];

// user:password@ inside a URL.
const URL_CREDENTIALS_PATTERN: RegExp = /\/\/[^\s/]*@/;

export type ProxySupport =
  // No proxy variable is set; nothing to do.
  | "none"
  // Switched on with http.setGlobalProxyFromEnv().
  | "enabled"
  // Already on: an older Node started with NODE_USE_ENV_PROXY=1.
  | "enabled_by_environment"
  // A proxy is configured but this Node cannot honour it for fetch.
  | "unsupported"
  // A proxy variable is not a URL Node accepts; nothing was switched on.
  | "invalid";

export interface ProxySetup {
  support: ProxySupport;
  // Why the configuration was refused, for "invalid". Never the URL.
  error?: string | undefined;
}

export function hasProxyEnvironment(env: NodeJS.ProcessEnv): boolean {
  return PROXY_URL_ENV_NAMES.some((name: string): boolean => {
    return Boolean((env[name] || "").trim());
  });
}

/*
 * A proxy URL for logs: scheme, host and port — never a username or
 * password someone put in it. A value without a scheme
 * (user:pass@proxy.corp:3128) parses as a URL with no host; it is not
 * echoed either, since whatever it holds may be a password.
 */
export function redactProxyUrl(value: string): string {
  try {
    const parsed: URL = new URL(value);

    if (!parsed.host) {
      return "(missing http:// or https://)";
    }

    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "(not a URL)";
  }
}

/*
 * Why Node refused the proxy settings, safe to log. Node's
 * ERR_PROXY_INVALID_CONFIG message IS the raw value it refused
 * (http://user:secret@[bad:3128 comes back word for word), so a message
 * that contains any proxy value, or anything shaped like URL credentials,
 * is replaced by the error code and a plain description.
 */
export function describeProxyError(
  err: unknown,
  env: NodeJS.ProcessEnv,
): string {
  const code: unknown =
    err && typeof err === "object"
      ? (err as Record<string, unknown>)["code"]
      : undefined;
  const prefix: string = typeof code === "string" && code ? `${code}: ` : "";
  const message: string = err instanceof Error ? err.message : String(err);
  const values: Array<string> = PROXY_URL_ENV_NAMES.map(
    (name: string): string => {
      return (env[name] || "").trim();
    },
  ).filter((value: string): boolean => {
    return value.length > 0;
  });
  const leaks: boolean =
    URL_CREDENTIALS_PATTERN.test(message) ||
    values.some((value: string): boolean => {
      return message.includes(value);
    });

  if (leaks) {
    return `${prefix}the proxy URL is not valid`;
  }

  return message.startsWith(prefix) ? message : `${prefix}${message}`;
}

// The proxy settings in effect, safe to log.
export function describeProxyEnvironment(
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const described: Record<string, string> = {};
  const httpsProxy: string = (
    env["HTTPS_PROXY"] ||
    env["https_proxy"] ||
    ""
  ).trim();
  const httpProxy: string = (
    env["HTTP_PROXY"] ||
    env["http_proxy"] ||
    ""
  ).trim();
  const noProxy: string = (env["NO_PROXY"] || env["no_proxy"] || "").trim();

  if (httpsProxy) {
    described["httpsProxy"] = redactProxyUrl(httpsProxy);
  }

  if (httpProxy) {
    described["httpProxy"] = redactProxyUrl(httpProxy);
  }

  if (noProxy) {
    described["noProxy"] = noProxy;
  }

  return described;
}

type SetGlobalProxyFromEnv = (env?: NodeJS.ProcessEnv) => unknown;

/*
 * Switch proxy support on for fetch when a proxy is configured. Never
 * throws: a proxy URL Node refuses (setGlobalProxyFromEnv throws
 * ERR_PROXY_INVALID_CONFIG, or undici's "Invalid URL protocol") is
 * reported as "invalid", with a reason safe to log, and fetch stays
 * direct.
 */
export function enableProxyFromEnvironment(
  env: NodeJS.ProcessEnv,
  httpModule: { setGlobalProxyFromEnv?: SetGlobalProxyFromEnv } = http as {
    setGlobalProxyFromEnv?: SetGlobalProxyFromEnv;
  },
): ProxySetup {
  if (!hasProxyEnvironment(env)) {
    return { support: "none" };
  }

  if (typeof httpModule.setGlobalProxyFromEnv === "function") {
    try {
      httpModule.setGlobalProxyFromEnv(env);
      return { support: "enabled" };
    } catch (err: unknown) {
      return { support: "invalid", error: describeProxyError(err, env) };
    }
  }

  if ((env["NODE_USE_ENV_PROXY"] || "").trim() === "1") {
    return { support: "enabled_by_environment" };
  }

  return { support: "unsupported" };
}
