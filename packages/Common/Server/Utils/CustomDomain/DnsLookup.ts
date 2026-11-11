import dns from "dns";
import logger, { LogAttributes } from "../Logger";

/*
 * DNS lookups for the custom domain checks, answered as data rather than as
 * an exception's sentence: the values found, or why there were none. The
 * caller says it in words (DnsRecordCheckWords); this only looks.
 *
 * Each lookup is bounded. Node's default resolver retries four times with a
 * growing timeout, and a DNS server that drops packets held Check now - and
 * the request behind it - for most of a minute, long enough for a proxy in
 * front of a self-hosted server to give up with "Error connecting to
 * server" (#1692). Three seconds and one retry is well past a working
 * resolver and well inside every proxy's timeout.
 *
 * The lookups go to the servers this installation resolves with, as the
 * certificate orders and the sweeps do: what matters is what this server
 * sees.
 */

export enum DnsLookupFailure {
  // The name exists, but has no record of the type asked for (ENODATA).
  NoRecords = "NoRecords",
  // The name does not exist (NXDOMAIN: ENOTFOUND).
  NameNotFound = "NameNotFound",
  // No answer: a timeout, a refusal, a server failure.
  NoAnswer = "NoAnswer",
}

export interface DnsLookupAnswer {
  values: Array<string>;
  failure?: DnsLookupFailure | undefined;
  // The resolver's own code, when it failed (ETIMEOUT, ESERVFAIL).
  errorCode?: string | undefined;
}

export default class DnsLookup {
  public static readonly TIMEOUT_IN_MS: number = 3000;
  public static readonly TRIES: number = 2;

  private static getResolver(): dns.promises.Resolver {
    return new dns.promises.Resolver({
      timeout: DnsLookup.TIMEOUT_IN_MS,
      tries: DnsLookup.TRIES,
    });
  }

  // What a resolver's error means for a check.
  public static toFailedAnswer(err: unknown): DnsLookupAnswer {
    const code: string =
      (err as { code?: string } | undefined)?.code?.toString() || "";

    if (code === "ENODATA") {
      return {
        values: [],
        failure: DnsLookupFailure.NoRecords,
        errorCode: code,
      };
    }

    if (code === "ENOTFOUND") {
      return {
        values: [],
        failure: DnsLookupFailure.NameNotFound,
        errorCode: code,
      };
    }

    return {
      values: [],
      failure: DnsLookupFailure.NoAnswer,
      errorCode: code || "EUNKNOWN",
    };
  }

  private static async run(
    name: string,
    type: string,
    lookUp: (resolver: dns.promises.Resolver) => Promise<Array<string>>,
  ): Promise<DnsLookupAnswer> {
    try {
      const values: Array<string> = await lookUp(DnsLookup.getResolver());

      if (values.length === 0) {
        return { values: [], failure: DnsLookupFailure.NoRecords };
      }

      return { values };
    } catch (err) {
      const answer: DnsLookupAnswer = DnsLookup.toFailedAnswer(err);

      logger.debug(
        `DNS ${type} lookup of ${name} found nothing: ${answer.errorCode}`,
        { domain: name } as LogAttributes,
      );

      return answer;
    }
  }

  // The name's CNAME record: one hop.
  public static async resolveCname(name: string): Promise<DnsLookupAnswer> {
    return await DnsLookup.run(
      name,
      "CNAME",
      async (resolver: dns.promises.Resolver): Promise<Array<string>> => {
        return await resolver.resolveCname(name);
      },
    );
  }

  // Every TXT value of the name, each one's strings joined as DNS splits them.
  public static async resolveTxt(name: string): Promise<DnsLookupAnswer> {
    return await DnsLookup.run(
      name,
      "TXT",
      async (resolver: dns.promises.Resolver): Promise<Array<string>> => {
        const records: Array<Array<string>> = await resolver.resolveTxt(name);

        return records.map((chunks: Array<string> | string): string => {
          return Array.isArray(chunks) ? chunks.join("") : String(chunks);
        });
      },
    );
  }

  // The name's IPv4 and IPv6 addresses, following any CNAME.
  public static async resolveAddresses(name: string): Promise<DnsLookupAnswer> {
    const [ipv4, ipv6] = await Promise.all([
      DnsLookup.run(
        name,
        "A",
        async (resolver: dns.promises.Resolver): Promise<Array<string>> => {
          return await resolver.resolve4(name);
        },
      ),
      DnsLookup.run(
        name,
        "AAAA",
        async (resolver: dns.promises.Resolver): Promise<Array<string>> => {
          return await resolver.resolve6(name);
        },
      ),
    ]);

    const values: Array<string> = [...ipv4.values, ...ipv6.values];

    if (values.length > 0) {
      return { values };
    }

    // The A lookup decides why there are none: it is the one people add.
    return {
      values: [],
      failure: ipv4.failure || ipv6.failure || DnsLookupFailure.NoRecords,
      errorCode: ipv4.errorCode || ipv6.errorCode,
    };
  }
}
