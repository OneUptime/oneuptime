import { canonicalizeEntityValue } from "./EntityKey";

/*
 * Network-host helpers shared by the dependency discovery job and the trace
 * propagation allowlist. Isomorphic and dependency-free on purpose: both
 * callers sit low in the server import graph.
 */

const IPV4_LOOPBACK_REGEX: RegExp = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/**
 * Normalize a network address attribute to a bare, lowercase host: no
 * scheme, credentials, path, port, IPv6 brackets or trailing dot. Returns
 * null when nothing host-like is left.
 */
export function normalizeHost(value: string | undefined | null): string | null {
  let host: string = canonicalizeEntityValue(value || "");
  if (!host) {
    return null;
  }
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  host = host.split("/")[0] || "";
  host = host.includes("@") ? host.substring(host.lastIndexOf("@") + 1) : host;
  if (host.startsWith("[")) {
    const closing: number = host.indexOf("]");
    host = closing > 0 ? host.substring(1, closing) : host.substring(1);
  } else if ((host.match(/:/g) || []).length === 1) {
    host = host.split(":")[0] || "";
  }
  host = host.replace(/\.+$/, "");
  return host.length > 0 ? host : null;
}

/** Loopback targets differ per caller, so they can never be one shared node. */
export function isLoopbackHost(host: string): boolean {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    host === "0.0.0.0" ||
    IPV4_LOOPBACK_REGEX.test(host)
  );
}
