import {
  DEFAULT_REVERSE_DNS_TIMEOUT_IN_MS,
  HostsFileLookup,
  ReverseDnsLookupFunction,
  ReverseDnsResolverLike,
  buildDefaultLookup,
  buildSystemHostsFileLookup,
  classifyReverseDnsLookupError,
} from "../Discovery/ReverseDnsResolver";
import NetworkFlowRecord from "Common/Types/NetFlow/NetworkFlowRecord";
import { normalizeReverseDnsName } from "Common/Utils/NetworkDiscovery/ReverseDnsNameUtil";
import {
  SecurityAddressScope,
  getSecurityAddressScope,
} from "Common/Utils/SecurityCase/SecurityConnectionMatch";
import NetworkAddressBlockUtil from "Common/Utils/NetworkTraffic/NetworkAddressBlock";
import dns from "dns";
import net from "net";

/*
 * NAMES FOR THE ADDRESSES IN A PROBE'S FLOWS (issue #5340).
 *
 * The Traffic pages show an address by name where the project knows one.
 * The project's inventory and the names people give addresses are the
 * server's to read; DNS is this probe's, because only a resolver inside the
 * customer's network knows its private addresses - 10.18.167.35 means
 * nothing to a resolver anywhere else, and asking one there would hand it
 * the network's addresses for nothing. So the probe that received the flows
 * looks their addresses up, on the resolver its host is set to use (or the
 * ones PROBE_FLOW_NAME_DNS_SERVERS names), and sends the names it found with
 * the flows (`addressNames` on the forward). The server keeps each name on
 * the flow rows, so a name read later is the name the address had then.
 *
 * What it asks, and what it never does:
 *
 *   - Only the busiest addresses: each forward's addresses wait by the bytes
 *     they carried, and the most first - the ones a Traffic page shows -
 *     are looked up, at most maxLookupsPerMinute a minute and
 *     `concurrency` at a time. Nothing a flow carries can make it ask more.
 *   - Never an address that names no machine (loopback, link-local,
 *     multicast, broadcast, unspecified): nobody's PTR record is theirs.
 *   - A PTR answer is kept only when it is forward-confirmed - the name's
 *     own A or AAAA records include the address - so a stale record (an
 *     address since given to another machine) or a forged one (anyone can
 *     point their own address's PTR at "payroll.example.com") names
 *     nothing. A name in the probe host's hosts file is the operator's own,
 *     and kept as it is.
 *   - Every answer goes through normalizeReverseDnsName, as discovery's do:
 *     a DNS name, never markup, spaces or the address restated.
 *   - Answers are cached: a name for positiveTtlMs, "no name" for
 *     negativeTtlMs, a lookup that failed (timeout, SERVFAIL) for
 *     failureTtlMs; at most maxCacheEntries addresses are remembered. A
 *     known name keeps being sent while it is looked up again, and a lookup
 *     that fails keeps the name it had.
 *   - The lookups never hold up a forward: a forward carries the names
 *     already known, and an address looked up meanwhile is named from the
 *     next one on.
 */

export type ForwardLookupFunction = (
  name: string,
  family: 4 | 6,
) => Promise<Array<string>>;

export interface FlowAddressNamerOptions {
  isEnabled: boolean;
  // A PTR lookup (ReverseDnsResolver's default lookup, on the probe's resolver).
  lookup: ReverseDnsLookupFunction;
  // The name's A (4) or AAAA (6) records, for the forward confirmation.
  forwardLookup: ForwardLookupFunction;
  // The probe host's hosts file; absent: not read.
  hostsFileLookup?: HostsFileLookup | undefined;
  now?: (() => number) | undefined;
  maxLookupsPerMinute: number;
  concurrency: number;
  positiveTtlMs: number;
  negativeTtlMs: number;
  failureTtlMs: number;
  maxCacheEntries: number;
  // Addresses waiting for a lookup, at most (the busiest are kept).
  maxWaiting: number;
}

// The names of a PTR answer tried for a forward confirmation, at most.
export const MAX_NAMES_CONFIRMED_PER_ADDRESS: number = 3;

export const DEFAULT_FLOW_NAME_LOOKUPS_PER_MINUTE: number = 300;
export const DEFAULT_FLOW_NAME_LOOKUP_CONCURRENCY: number = 8;
export const DEFAULT_FLOW_NAME_POSITIVE_TTL_MS: number = 60 * 60 * 1000;
export const DEFAULT_FLOW_NAME_NEGATIVE_TTL_MS: number = 30 * 60 * 1000;
export const DEFAULT_FLOW_NAME_FAILURE_TTL_MS: number = 5 * 60 * 1000;
export const DEFAULT_FLOW_NAME_MAX_CACHE_ENTRIES: number = 20000;
export const DEFAULT_FLOW_NAME_MAX_WAITING: number = 5000;

// What one lookup came to.
export interface FlowAddressLookupResult {
  // The confirmed name; null when the address has none.
  name: string | null;
  // The lookup could not be done (no answer, SERVFAIL): ask again sooner.
  hasFailed: boolean;
}

interface CacheEntry {
  name: string | null;
  expiresAt: number;
}

export interface ParsedFlowNameDnsServers {
  // As dns.Resolver#setServers takes them.
  servers: Array<string>;
  // Entries that are not a server's address, as written.
  invalid: Array<string>;
}

// The most servers PROBE_FLOW_NAME_DNS_SERVERS keeps.
export const MAX_FLOW_NAME_DNS_SERVERS: number = 3;

function isPort(text: string): boolean {
  if (!text || text.length > 5) {
    return false;
  }

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code < 48 || code > 57) {
      return false;
    }
  }

  const port: number = Number(text);

  return port >= 1 && port <= 65535;
}

/*
 * PROBE_FLOW_NAME_DNS_SERVERS, read: IP addresses separated by commas, each
 * with a port when it is not 53 - "10.0.0.53", "10.0.0.53:5353",
 * "fd00::53", "[fd00::53]:5353". Anything else (a host name: a resolver
 * cannot be found by name before there is one) is left out and said.
 */
export function parseFlowNameDnsServers(
  value: string | undefined | null,
): ParsedFlowNameDnsServers {
  const servers: Array<string> = [];
  const invalid: Array<string> = [];

  for (const part of (value || "").split(",")) {
    const entry: string = part.trim();

    if (!entry) {
      continue;
    }

    let isValid: boolean = net.isIP(entry) !== 0;

    if (!isValid && entry.startsWith("[")) {
      const close: number = entry.indexOf("]");
      isValid =
        close > 1 &&
        net.isIPv6(entry.slice(1, close)) &&
        entry[close + 1] === ":" &&
        isPort(entry.slice(close + 2));
    } else if (!isValid && entry.indexOf(":") === entry.lastIndexOf(":")) {
      const colon: number = entry.indexOf(":");
      isValid =
        colon > 0 &&
        net.isIPv4(entry.slice(0, colon)) &&
        isPort(entry.slice(colon + 1));
    }

    if (!isValid) {
      invalid.push(entry);
      continue;
    }

    if (!servers.includes(entry) && servers.length < MAX_FLOW_NAME_DNS_SERVERS) {
      servers.push(entry);
    }
  }

  return { servers: servers, invalid: invalid };
}

// Whether an address may be looked up at all.
export function isNameableAddress(address: string): boolean {
  const scope: SecurityAddressScope | null = getSecurityAddressScope(address);

  return scope !== null && scope !== SecurityAddressScope.Local;
}

/*
 * One fresh resolver per query, as discovery's lookups use (one learned
 * channel would cut the next query's timeout short), on the servers asked
 * for when there are any.
 */
export function buildResolverFactory(
  servers: ReadonlyArray<string>,
): (timeoutInMs: number) => ReverseDnsResolverLike {
  return (timeoutInMs: number): ReverseDnsResolverLike => {
    const resolver: dns.promises.Resolver = new dns.promises.Resolver({
      timeout: timeoutInMs,
      tries: 1,
    });

    if (servers.length > 0) {
      try {
        resolver.setServers([...servers]);
      } catch {
        // Not a spelling it takes: the host's own resolver answers instead.
      }
    }

    return resolver;
  };
}

/*
 * A forward lookup on a fresh resolver, raced against the timeout so a
 * resolver that never answers cannot hold a lookup slot.
 */
export function buildDefaultForwardLookup(
  timeoutInMs: number,
  servers: ReadonlyArray<string>,
): ForwardLookupFunction {
  const createResolver: (timeoutInMs: number) => ReverseDnsResolverLike =
    buildResolverFactory(servers);

  return async (name: string, family: 4 | 6): Promise<Array<string>> => {
    const resolver: dns.promises.Resolver = createResolver(
      timeoutInMs,
    ) as unknown as dns.promises.Resolver;
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;

    const timeout: Promise<never> = new Promise<never>(
      (_resolve: (value: never) => void, reject: (reason: Error) => void) => {
        timer = setTimeout(() => {
          resolver.cancel();
          const error: Error & { code?: string } = new Error(
            `Forward lookup of ${name} timed out after ${timeoutInMs}ms`,
          );
          error.code = "ETIMEOUT";
          reject(error);
        }, timeoutInMs);
        timer.unref?.();
      },
    );

    try {
      return await Promise.race([
        family === 4 ? resolver.resolve4(name) : resolver.resolve6(name),
        timeout,
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  };
}

export default class FlowAddressNamer {
  private readonly options: FlowAddressNamerOptions;
  private readonly now: () => number;
  private cache: Map<string, CacheEntry> = new Map();
  private waiting: Map<string, number> = new Map();
  private inFlight: Set<string> = new Set();
  private lookupsThisMinute: number = 0;
  private minuteStartedAt: number = 0;

  public constructor(options: FlowAddressNamerOptions) {
    this.options = options;
    this.now =
      options.now ||
      ((): number => {
        return Date.now();
      });
  }

  /*
   * The namer the probe runs with: its own resolver (or the servers named),
   * its hosts file, and the limits above.
   */
  public static create(data: {
    isEnabled: boolean;
    maxLookupsPerMinute: number;
    servers: ReadonlyArray<string>;
  }): FlowAddressNamer {
    return new FlowAddressNamer({
      isEnabled: data.isEnabled && data.maxLookupsPerMinute > 0,
      lookup: buildDefaultLookup(
        DEFAULT_REVERSE_DNS_TIMEOUT_IN_MS,
        buildResolverFactory(data.servers),
      ),
      forwardLookup: buildDefaultForwardLookup(
        DEFAULT_REVERSE_DNS_TIMEOUT_IN_MS,
        data.servers,
      ),
      hostsFileLookup: buildSystemHostsFileLookup(),
      maxLookupsPerMinute: data.maxLookupsPerMinute,
      concurrency: DEFAULT_FLOW_NAME_LOOKUP_CONCURRENCY,
      positiveTtlMs: DEFAULT_FLOW_NAME_POSITIVE_TTL_MS,
      negativeTtlMs: DEFAULT_FLOW_NAME_NEGATIVE_TTL_MS,
      failureTtlMs: DEFAULT_FLOW_NAME_FAILURE_TTL_MS,
      maxCacheEntries: DEFAULT_FLOW_NAME_MAX_CACHE_ENTRIES,
      maxWaiting: DEFAULT_FLOW_NAME_MAX_WAITING,
    });
  }

  public get isEnabled(): boolean {
    return this.options.isEnabled;
  }

  public get cacheSize(): number {
    return this.cache.size;
  }

  public get waitingCount(): number {
    return this.waiting.size;
  }

  public get inFlightCount(): number {
    return this.inFlight.size;
  }

  public clear(): void {
    this.cache.clear();
    this.waiting.clear();
    this.inFlight.clear();
    this.lookupsThisMinute = 0;
    this.minuteStartedAt = 0;
  }

  /*
   * A forward's addresses, each with the bytes it carried, waiting for a
   * lookup when no answer for it is known or its answer is due again.
   */
  public note(records: ReadonlyArray<NetworkFlowRecord>): void {
    if (!this.options.isEnabled) {
      return;
    }

    const now: number = this.now();

    for (const record of records) {
      for (const address of [
        record.sourceIpAddress,
        record.destinationIpAddress,
      ]) {
        this.noteAddress(address, record.octets || 0, now);
      }
    }
  }

  private noteAddress(address: string, octets: number, now: number): void {
    const canonical: string | null =
      NetworkAddressBlockUtil.canonicalAddress(address);

    if (!canonical || this.inFlight.has(canonical)) {
      return;
    }

    const known: CacheEntry | undefined = this.cache.get(canonical);

    if (known && known.expiresAt > now) {
      return;
    }

    const waitingBytes: number | undefined = this.waiting.get(canonical);

    if (waitingBytes !== undefined) {
      this.waiting.set(canonical, waitingBytes + Math.max(0, octets));
      return;
    }

    if (!isNameableAddress(canonical)) {
      return;
    }

    // Full: the newcomer waits for the next forward, unless it is busier.
    if (this.waiting.size >= this.options.maxWaiting) {
      this.trimWaiting(Math.floor(this.options.maxWaiting * 0.9));
    }

    this.waiting.set(canonical, Math.max(0, octets));
  }

  // Keeps the `keep` busiest waiting addresses.
  private trimWaiting(keep: number): void {
    if (this.waiting.size <= keep) {
      return;
    }

    const busiest: Array<[string, number]> = Array.from(
      this.waiting.entries(),
    )
      .sort((a: [string, number], b: [string, number]): number => {
        return b[1] - a[1];
      })
      .slice(0, keep);

    this.waiting = new Map(busiest);
  }

  /*
   * The names known for a forward's addresses, as the server reads them:
   * { address: name }, each address as the records write it. An address
   * whose answer is due again keeps its name until the new answer says
   * otherwise.
   */
  public namesFor(
    records: ReadonlyArray<NetworkFlowRecord>,
  ): Record<string, string> {
    const names: Record<string, string> = {};

    if (!this.options.isEnabled || this.cache.size === 0) {
      return names;
    }

    for (const record of records) {
      for (const address of [
        record.sourceIpAddress,
        record.destinationIpAddress,
      ]) {
        if (names[address] !== undefined) {
          continue;
        }

        const canonical: string | null =
          NetworkAddressBlockUtil.canonicalAddress(address);
        const known: CacheEntry | undefined = canonical
          ? this.cache.get(canonical)
          : undefined;

        if (known && known.name) {
          names[address] = known.name;
        }
      }
    }

    return names;
  }

  // Lookups started this minute, against maxLookupsPerMinute.
  private takeLookupSlot(now: number): boolean {
    if (now - this.minuteStartedAt >= 60000) {
      this.minuteStartedAt = now;
      this.lookupsThisMinute = 0;
    }

    if (this.lookupsThisMinute >= this.options.maxLookupsPerMinute) {
      return false;
    }

    this.lookupsThisMinute++;
    return true;
  }

  /*
   * Starts lookups for the busiest waiting addresses, while a lookup slot
   * is free and the minute's allowance lasts; resolves when the lookups it
   * started have answered. The collector does not wait for it.
   */
  public async pump(): Promise<void> {
    if (!this.options.isEnabled || this.waiting.size === 0) {
      return;
    }

    const now: number = this.now();
    const started: Array<Promise<void>> = [];
    const queue: Array<string> = Array.from(this.waiting.entries())
      .sort((a: [string, number], b: [string, number]): number => {
        return b[1] - a[1];
      })
      .map((entry: [string, number]): string => {
        return entry[0];
      });

    for (const address of queue) {
      if (this.inFlight.size >= this.options.concurrency) {
        break;
      }

      if (!this.takeLookupSlot(now)) {
        break;
      }

      this.waiting.delete(address);
      this.inFlight.add(address);
      started.push(this.lookUpAndKeep(address));
    }

    this.trimWaiting(this.options.maxWaiting);

    await Promise.all(started);
  }

  private async lookUpAndKeep(address: string): Promise<void> {
    let result: FlowAddressLookupResult;

    try {
      result = await this.resolve(address);
    } catch {
      result = { name: null, hasFailed: true };
    } finally {
      this.inFlight.delete(address);
    }

    const now: number = this.now();
    const known: CacheEntry | undefined = this.cache.get(address);

    if (result.hasFailed) {
      // Ask again sooner; a name it had stays while the resolver is away.
      this.keep(address, {
        name: known?.name || null,
        expiresAt: now + this.options.failureTtlMs,
      });
      return;
    }

    this.keep(address, {
      name: result.name,
      expiresAt:
        now +
        (result.name ? this.options.positiveTtlMs : this.options.negativeTtlMs),
    });
  }

  private keep(address: string, entry: CacheEntry): void {
    // Newest last: the oldest answer is the first to go.
    this.cache.delete(address);
    this.cache.set(address, entry);

    while (this.cache.size > this.options.maxCacheEntries) {
      const oldest: string | undefined = this.cache.keys().next().value;

      if (oldest === undefined) {
        break;
      }

      this.cache.delete(oldest);
    }
  }

  /*
   * The address's name, now: the hosts file's, else a PTR name its own A or
   * AAAA records point back from (the first of up to
   * MAX_NAMES_CONFIRMED_PER_ADDRESS). An address that names no machine is
   * never asked about.
   */
  public async resolve(address: string): Promise<FlowAddressLookupResult> {
    const canonical: string | null =
      NetworkAddressBlockUtil.canonicalAddress(address);

    if (!canonical || !isNameableAddress(canonical)) {
      return { name: null, hasFailed: false };
    }

    if (this.options.hostsFileLookup) {
      let listed: Array<string> | undefined = undefined;

      try {
        listed = this.options.hostsFileLookup(canonical);
      } catch {
        listed = undefined;
      }

      for (const name of listed || []) {
        const normalized: string | undefined = normalizeReverseDnsName(name);

        if (normalized) {
          return { name: normalized, hasFailed: false };
        }
      }
    }

    let answers: Array<string>;

    try {
      answers = await this.options.lookup(canonical);
    } catch (error) {
      return {
        name: null,
        hasFailed: classifyReverseDnsLookupError(error).kind === "failure",
      };
    }

    const family: 4 | 6 = canonical.includes(":") ? 6 : 4;
    const names: Array<string> = [];

    for (const answer of Array.isArray(answers) ? answers : []) {
      const normalized: string | undefined = normalizeReverseDnsName(answer);

      if (normalized && !names.includes(normalized)) {
        names.push(normalized);
      }

      if (names.length >= MAX_NAMES_CONFIRMED_PER_ADDRESS) {
        break;
      }
    }

    let hasFailed: boolean = false;

    for (const name of names) {
      try {
        const addresses: Array<string> = await this.options.forwardLookup(
          name,
          family,
        );

        if (
          (Array.isArray(addresses) ? addresses : []).some(
            (value: string): boolean => {
              return (
                NetworkAddressBlockUtil.canonicalAddress(value) === canonical
              );
            },
          )
        ) {
          return { name: name, hasFailed: false };
        }
      } catch (error) {
        if (classifyReverseDnsLookupError(error).kind === "failure") {
          hasFailed = true;
        }
      }
    }

    // A name that could not be confirmed is no name; a lookup that failed is asked again sooner.
    return { name: null, hasFailed: hasFailed };
  }
}
