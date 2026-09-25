import { ReverseDnsResolverLike } from "../../Utils/Discovery/ReverseDnsResolver";

/*
 * Stand-ins for dns.promises.Resolver, for the tests of buildDefaultLookup
 * and buildDefaultRetryLookup (OneUptime issue #3916).
 *
 * Those two functions are where the probe decides WHICH query to send
 * (resolvePtr for IPv4, reverse for anything else and for the hosts-file
 * fallback), WHICH server to send it to (the retry's one-server-at-a-time
 * walk) and WHEN to give up (the race, and the cancel() inside it). None of
 * that is observable from a result alone — a lookup that asked the wrong
 * question of the right server can still come back with a name — so these
 * fakes RECORD every call, in order, and the tests assert on the record.
 *
 * Nothing here touches the network. A method the test did not script
 * rejects with an error saying so, which surfaces as a failed lookup rather
 * than as a hang, so a test that forgot to script a path fails fast and
 * names the path.
 */

export interface FakeResolverCall {
  method: "resolvePtr" | "reverse" | "getServers" | "setServers" | "cancel";
  // The name, address or server list the method was called with.
  argument?: string | Array<string> | undefined;
}

export interface FakeReverseDnsResolver extends ReverseDnsResolverLike {
  // Every call made on THIS resolver, in order.
  calls: Array<FakeResolverCall>;
  cancelCount: number;
  // What getServers() returns; replaced by setServers().
  servers: Array<string>;
  // The per-attempt timeout the factory was asked for.
  timeoutInMs: number;
}

export interface FakeResolverScript {
  resolvePtr?:
    | ((
        hostname: string,
        resolver: FakeReverseDnsResolver,
      ) => Promise<Array<string>>)
    | undefined;
  reverse?:
    | ((
        ipAddress: string,
        resolver: FakeReverseDnsResolver,
      ) => Promise<Array<string>>)
    | undefined;
  // The configuration a fresh resolver starts with.
  servers?: Array<string> | undefined;
  // Called by setServers(); throw from it to refuse a server spelling.
  setServers?:
    | ((servers: Array<string>, resolver: FakeReverseDnsResolver) => void)
    | undefined;
  getServers?:
    | ((resolver: FakeReverseDnsResolver) => Array<string>)
    | undefined;
}

/*
 * A c-ares-shaped rejection: the classifier reads `code`, so that is what a
 * scripted failure must carry. The default message is the one Node's
 * resolvePtr really produces — "queryPtr ESERVFAIL 54.42.16.10.in-addr.arpa"
 * — which is also why the older suites' "queryPtr ESERVFAIL" errors are an
 * accurate picture of the query the probe now sends.
 */
export function fakeDnsError(code: string, message?: string): Error {
  const error: Error & { code?: string } = new Error(
    message || `queryPtr ${code}`,
  );
  error.code = code;
  return error;
}

// A promise that never settles: a server that accepts a query and says nothing.
export function neverSettles(): Promise<Array<string>> {
  return new Promise<Array<string>>(() => {});
}

function unscripted(method: string, argument: string): Promise<Array<string>> {
  return Promise.reject(
    new Error(`FakeReverseDnsResolver: unscripted ${method}(${argument})`),
  );
}

export function fakeReverseDnsResolver(
  script: FakeResolverScript = {},
  timeoutInMs: number = 0,
): FakeReverseDnsResolver {
  const resolver: FakeReverseDnsResolver = {
    calls: [],
    cancelCount: 0,
    servers: [...(script.servers ?? [])],
    timeoutInMs: timeoutInMs,
    resolvePtr: (hostname: string): Promise<Array<string>> => {
      resolver.calls.push({ method: "resolvePtr", argument: hostname });
      return script.resolvePtr
        ? script.resolvePtr(hostname, resolver)
        : unscripted("resolvePtr", hostname);
    },
    reverse: (ipAddress: string): Promise<Array<string>> => {
      resolver.calls.push({ method: "reverse", argument: ipAddress });
      return script.reverse
        ? script.reverse(ipAddress, resolver)
        : unscripted("reverse", ipAddress);
    },
    getServers: (): Array<string> => {
      resolver.calls.push({ method: "getServers" });
      return script.getServers
        ? script.getServers(resolver)
        : [...resolver.servers];
    },
    setServers: (servers: ReadonlyArray<string>): void => {
      resolver.calls.push({ method: "setServers", argument: [...servers] });

      if (script.setServers) {
        script.setServers([...servers], resolver);
      }

      resolver.servers = [...servers];
    },
    cancel: (): void => {
      resolver.calls.push({ method: "cancel" });
      resolver.cancelCount++;
    },
  };

  return resolver;
}

/*
 * A resolver FACTORY that builds a fresh fake per call, exactly as the real
 * default does, and keeps every one it built — so a test can say "the retry
 * built four resolvers, pinned three of them to one server each, and asked
 * the first two".
 */
export interface FakeResolverFactory {
  create: (timeoutInMs: number) => FakeReverseDnsResolver;
  created: Array<FakeReverseDnsResolver>;
}

export function fakeResolverFactory(
  script: FakeResolverScript = {},
): FakeResolverFactory {
  const created: Array<FakeReverseDnsResolver> = [];

  return {
    created: created,
    create: (timeoutInMs: number): FakeReverseDnsResolver => {
      const resolver: FakeReverseDnsResolver = fakeReverseDnsResolver(
        script,
        timeoutInMs,
      );
      created.push(resolver);
      return resolver;
    },
  };
}
