import DnsLookup, { DnsLookupAnswer, DnsLookupFailure } from "./DnsLookup";
import Domain from "../../Types/Domain";
import logger, { LogAttributes } from "../Logger";
import OneUptimeDate from "../../../Types/Date";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import {
  DnsRecordCheck,
  DnsRecordCheckOutcome,
  DnsRecordType,
  normalizeDnsName,
} from "../../../Types/CustomDomain/DnsRecordCheck";

/*
 * The checks behind a custom domain's two records, answered as a
 * DnsRecordCheck: what was looked up, and what came back.
 *
 * The CNAME check is the one the status page, dashboard and form domains
 * share - it used to be three copies of the same 150 lines, each comparing
 * only the first CNAME record, with its trailing dot, to the installation's
 * target. A domain counts as pointed at this installation when either:
 *
 *   - a request to its verification address reaches this OneUptime (the
 *     address answers only here, only for this domain's token) - which is
 *     also how a name whose DNS provider hides the CNAME (Cloudflare's
 *     orange cloud, a flattened record) is verified, as long as requests
 *     for it are passed on to OneUptime; or
 *   - its CNAME chain, followed hop by hop, reaches the target. A record
 *     typed with the root's trailing dot ("statuspage.oneuptime.com."), or
 *     a chain through a name of the customer's own (status.example.com ->
 *     status-alias.example.com -> the target), counts (#1664).
 *
 * Nothing here writes: the services record the answer on the domain.
 */

export interface CnameCheckRequest {
  fullDomain: string;
  // What the CNAME must point to on this installation; empty when unset.
  expectedTarget: string;
  /*
   * The domain's verification address, by protocol. It answers only on
   * this installation, and only for this domain's token.
   */
  getVerificationUrl: (protocol: "http" | "https") => string;
  // How the request is named to the egress guard.
  targetLabel: string;
  /*
   * Look up the CNAME chain even when a request reached OneUptime, so
   * Check now can say what the record is. The sweeps leave it off: a
   * domain that answers needs no lookups.
   */
  lookUpDnsEvenWhenReached?: boolean | undefined;
}

interface ReachAnswer {
  reached: boolean;
  // The status of the first answer that was not this OneUptime's.
  httpStatus?: number | undefined;
}

export default class CustomDomainDnsCheck {
  /*
   * How many CNAME hops are followed before giving up: DNS resolvers stop
   * at about this many, and a chain longer than that never resolves.
   */
  public static readonly MAX_CNAME_HOPS: number = 8;

  // How many of a proxied name's addresses are shown.
  public static readonly MAX_ADDRESSES_SHOWN: number = 4;

  /*
   * Whether a request to the domain reaches this OneUptime: its
   * verification address, over http and then over https (a proxy that
   * sends http on to https is covered by the second).
   */
  public static async reachesOneUptime(
    request: CnameCheckRequest,
  ): Promise<ReachAnswer> {
    let httpStatus: number | undefined = undefined;

    for (const protocol of ["http", "https"] as const) {
      try {
        const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await Domain.getForDomainVerification({
            url: request.getVerificationUrl(protocol),
            targetLabel: request.targetLabel,
          });

        if (result.isSuccess()) {
          return { reached: true };
        }

        const status: number = result.statusCode;

        if (httpStatus === undefined && Number.isFinite(status) && status > 0) {
          httpStatus = status;
        }
      } catch (err) {
        logger.debug(
          `The ${protocol} verification request to ${request.fullDomain} got no answer`,
          { fullDomain: request.fullDomain } as LogAttributes,
        );
        logger.debug(err, { fullDomain: request.fullDomain } as LogAttributes);
      }
    }

    return { reached: false, httpStatus };
  }

  /*
   * The name's CNAME chain, hop by hop, until it reaches the target, ends
   * (a name with no CNAME of its own) or loops. The first hop's failure is
   * the name's.
   */
  public static async followCnameChain(
    name: string,
    target: string,
  ): Promise<{
    chain: Array<string>;
    reachesTarget: boolean;
    firstHopFailure?: DnsLookupAnswer | undefined;
  }> {
    const chain: Array<string> = [];
    let current: string = name;

    for (
      let hop: number = 0;
      hop < CustomDomainDnsCheck.MAX_CNAME_HOPS;
      hop++
    ) {
      const answer: DnsLookupAnswer = await DnsLookup.resolveCname(current);

      if (answer.values.length === 0) {
        return {
          chain,
          reachesTarget: false,
          firstHopFailure: hop === 0 ? answer : undefined,
        };
      }

      const next: string = normalizeDnsName(answer.values[0]);

      if (!next || next === current || chain.includes(next)) {
        break;
      }

      chain.push(next);

      if (target && next === target) {
        return { chain, reachesTarget: true };
      }

      current = next;
    }

    return { chain, reachesTarget: false };
  }

  /*
   * A CNAME check that looked nothing up: the domain is not in the table
   * (NotFound), or the check itself threw (LookupFailed).
   */
  public static unchecked(data: {
    fullDomain: string;
    expectedTarget: string;
    outcome: DnsRecordCheckOutcome;
  }): DnsRecordCheck {
    return {
      type: DnsRecordType.CNAME,
      name: normalizeDnsName(data.fullDomain),
      expectedValue: normalizeDnsName(data.expectedTarget),
      foundValues: [],
      outcome: data.outcome,
      checkedAt: OneUptimeDate.getCurrentDate(),
    };
  }

  public static async checkCname(
    request: CnameCheckRequest,
  ): Promise<DnsRecordCheck> {
    const name: string = normalizeDnsName(request.fullDomain);
    const target: string = normalizeDnsName(request.expectedTarget);

    const check: DnsRecordCheck = {
      type: DnsRecordType.CNAME,
      name: name,
      expectedValue: target,
      foundValues: [],
      outcome: DnsRecordCheckOutcome.NotFound,
      checkedAt: OneUptimeDate.getCurrentDate(),
    };

    const reach: ReachAnswer =
      await CustomDomainDnsCheck.reachesOneUptime(request);

    check.reachedOneUptime = reach.reached;

    if (reach.httpStatus !== undefined) {
      check.httpStatus = reach.httpStatus;
    }

    if (reach.reached && !request.lookUpDnsEvenWhenReached) {
      check.outcome = DnsRecordCheckOutcome.Found;
      return check;
    }

    /*
     * Without a target there is no record to compare: custom domains of
     * this kind are off, and only a request that reached OneUptime counts.
     */
    if (!target) {
      check.outcome = reach.reached
        ? DnsRecordCheckOutcome.Found
        : DnsRecordCheckOutcome.NotFound;
      return check;
    }

    const followed: {
      chain: Array<string>;
      reachesTarget: boolean;
      firstHopFailure?: DnsLookupAnswer | undefined;
    } = await CustomDomainDnsCheck.followCnameChain(name, target);

    check.foundValues = followed.chain;

    if (followed.reachesTarget || reach.reached) {
      check.outcome = DnsRecordCheckOutcome.Found;
      return check;
    }

    if (followed.chain.length > 0) {
      check.outcome = DnsRecordCheckOutcome.WrongValue;
      return check;
    }

    const failure: DnsLookupAnswer | undefined = followed.firstHopFailure;

    if (failure?.failure === DnsLookupFailure.NameNotFound) {
      check.outcome = DnsRecordCheckOutcome.NameNotFound;
      return check;
    }

    if (failure?.failure === DnsLookupFailure.NoAnswer) {
      check.outcome = DnsRecordCheckOutcome.LookupFailed;
      check.lookupError = failure.errorCode;
      return check;
    }

    /*
     * No CNAME. A name that answers with addresses anyway has an A record,
     * or a DNS provider that proxies or flattens it: say which addresses,
     * so the person sees why the CNAME they added is not what we see.
     */
    const addresses: DnsLookupAnswer = await DnsLookup.resolveAddresses(name);

    if (addresses.values.length > 0) {
      check.addresses = addresses.values.slice(
        0,
        CustomDomainDnsCheck.MAX_ADDRESSES_SHOWN,
      );
    }

    check.outcome = DnsRecordCheckOutcome.NotFound;
    return check;
  }

  /*
   * The TXT check of a project's domain: whether one of its TXT values is
   * the domain's verification text, exactly.
   */
  public static async checkTxt(data: {
    domain: string;
    expectedValue: string;
  }): Promise<DnsRecordCheck> {
    const name: string = normalizeDnsName(data.domain);
    const expectedValue: string = data.expectedValue.trim();

    const check: DnsRecordCheck = {
      type: DnsRecordType.TXT,
      name: name,
      expectedValue: expectedValue,
      foundValues: [],
      outcome: DnsRecordCheckOutcome.NotFound,
      checkedAt: OneUptimeDate.getCurrentDate(),
    };

    const answer: DnsLookupAnswer = await DnsLookup.resolveTxt(name);

    check.foundValues = answer.values;

    if (
      answer.values.some((value: string): boolean => {
        return value.trim() === expectedValue;
      })
    ) {
      check.outcome = DnsRecordCheckOutcome.Found;
      return check;
    }

    if (answer.values.length > 0) {
      check.outcome = DnsRecordCheckOutcome.WrongValue;
      return check;
    }

    if (answer.failure === DnsLookupFailure.NameNotFound) {
      check.outcome = DnsRecordCheckOutcome.NameNotFound;
    } else if (answer.failure === DnsLookupFailure.NoAnswer) {
      check.outcome = DnsRecordCheckOutcome.LookupFailed;
      check.lookupError = answer.errorCode;
    }

    return check;
  }
}
