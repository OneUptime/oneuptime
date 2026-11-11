import DnsLookup, { DnsLookupAnswer } from "./DnsLookup";
import Domain from "../../Types/Domain";
import logger, { LogAttributes } from "../Logger";
import {
  EncryptionSecret,
  issuesFreeCustomDomainCertificates,
} from "../../EnvironmentConfig";
import OneUptimeDate from "../../../Types/Date";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import {
  CustomDomainReadinessCheck,
  CustomDomainReadinessCheckId,
  CustomDomainReadinessOutcome,
  CustomDomainReadinessReason,
  CustomDomainServerReadinessResult,
} from "../../../Types/CustomDomain/CustomDomainServerReadiness";
import { normalizeDnsName } from "../../../Types/CustomDomain/DnsRecordCheck";
import crypto from "crypto";
import net from "net";

/*
 * Whether this self-hosted server can serve a custom domain, checked before
 * anybody changes their DNS (see Types/CustomDomain/CustomDomainServerReadiness
 * for what is checked and why).
 *
 * Port 80 is checked with a request only this installation answers: the
 * status page API's custom-domain-readiness address answers 200 to a proof
 * signed with this installation's ENCRYPTION_SECRET (createProof,
 * isValidProof). So a proxy that answers the target itself - a 404 page, a
 * redirect, another site - is told apart from this OneUptime, which is what
 * #1521 and #1774 ran into: requests for the custom domain reached a proxy
 * that did not pass them on.
 *
 * The answer is kept for a few minutes per target: the Custom Domains page
 * asks whenever it opens, and each answer costs requests out of the server.
 */

// A proof's nonce: 16 random bytes, as hex.
const NONCE: RegExp = /^[0-9a-f]{32}$/;

export interface ReadinessRequest {
  // The address CNAME records point to: STATUS_PAGE_CNAME_RECORD.
  target: string;
  // The variable that sets it, and its Helm value, named when it is unset.
  variable: string;
  helmValue: string;
}

export default class CustomDomainServerReadiness {
  public static readonly CACHE_IN_MS: number = 5 * 60 * 1000;
  public static readonly CONNECT_TIMEOUT_IN_MS: number = 5000;
  // How many targets' answers are kept: one per kind of custom domain.
  public static readonly MAX_CACHED_TARGETS: number = 8;
  // The path, after the host, that answers a proof.
  public static readonly PROOF_PATH: string =
    "/status-page-api/custom-domain-readiness/";

  private static readonly cache: Map<
    string,
    { at: number; result: CustomDomainServerReadinessResult }
  > = new Map();

  private static sign(nonce: string): string {
    return crypto
      .createHmac("sha256", EncryptionSecret.toString())
      .update(`custom-domain-readiness:${nonce}`)
      .digest("hex");
  }

  // A proof this installation answers: a nonce and its signature.
  public static createProof(): string {
    const nonce: string = crypto.randomBytes(16).toString("hex");

    return `${nonce}.${CustomDomainServerReadiness.sign(nonce)}`;
  }

  public static isValidProof(proof: string | undefined): boolean {
    if (!proof || typeof proof !== "string" || proof.length > 200) {
      return false;
    }

    const parts: Array<string> = proof.split(".");

    if (parts.length !== 2 || !NONCE.test(parts[0]!)) {
      return false;
    }

    const expected: Buffer = Buffer.from(
      CustomDomainServerReadiness.sign(parts[0]!),
    );
    const given: Buffer = Buffer.from(parts[1]!);

    return (
      expected.length === given.length &&
      crypto.timingSafeEqual(expected, given)
    );
  }

  // Whether the host accepts a TCP connection on the port, within a bound.
  public static async canConnect(host: string, port: number): Promise<boolean> {
    return await new Promise<boolean>((resolve: (value: boolean) => void) => {
      const socket: net.Socket = net.connect({ host, port });
      let settled: boolean = false;

      const finish: (value: boolean) => void = (value: boolean): void => {
        if (settled) {
          return;
        }

        settled = true;
        socket.destroy();
        resolve(value);
      };

      socket.setTimeout(CustomDomainServerReadiness.CONNECT_TIMEOUT_IN_MS);
      socket.once("connect", () => {
        finish(true);
      });
      socket.once("timeout", () => {
        finish(false);
      });
      socket.once("error", () => {
        finish(false);
      });
    });
  }

  /*
   * A request to the target on port 80 with a fresh proof: whether it
   * reached this OneUptime, and if something else answered, its status.
   */
  public static async probePort80(
    target: string,
  ): Promise<{ reached: boolean; httpStatus?: number | undefined }> {
    try {
      const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await Domain.getForDomainVerification({
          url: `http://${target}${CustomDomainServerReadiness.PROOF_PATH}${CustomDomainServerReadiness.createProof()}`,
          targetLabel: "Custom domain readiness",
        });

      if (result.isSuccess()) {
        return { reached: true };
      }

      const status: number = result.statusCode;

      return {
        reached: false,
        httpStatus: Number.isFinite(status) && status > 0 ? status : undefined,
      };
    } catch (err) {
      logger.debug(`Custom domain readiness: ${target} got no answer`, {
        domain: target,
      } as LogAttributes);
      logger.debug(err, { domain: target } as LogAttributes);

      return { reached: false };
    }
  }

  public static async check(
    request: ReadinessRequest,
    options?: { useCache?: boolean | undefined },
  ): Promise<CustomDomainServerReadinessResult> {
    const target: string = normalizeDnsName(request.target);
    const cacheKey: string = `${target}|${request.variable}`;
    const now: number = OneUptimeDate.getCurrentDate().getTime();

    if (options?.useCache !== false) {
      const cached:
        | { at: number; result: CustomDomainServerReadinessResult }
        | undefined = CustomDomainServerReadiness.cache.get(cacheKey);

      if (cached && now - cached.at < CustomDomainServerReadiness.CACHE_IN_MS) {
        return cached.result;
      }
    }

    const result: CustomDomainServerReadinessResult =
      await CustomDomainServerReadiness.runChecks(target, request);

    if (
      CustomDomainServerReadiness.cache.size >=
      CustomDomainServerReadiness.MAX_CACHED_TARGETS
    ) {
      CustomDomainServerReadiness.cache.clear();
    }

    CustomDomainServerReadiness.cache.set(cacheKey, { at: now, result });

    return result;
  }

  public static clearCache(): void {
    CustomDomainServerReadiness.cache.clear();
  }

  private static async runChecks(
    target: string,
    request: ReadinessRequest,
  ): Promise<CustomDomainServerReadinessResult> {
    const checks: Array<CustomDomainReadinessCheck> = [];

    const freeCertificates: CustomDomainReadinessCheck = {
      id: CustomDomainReadinessCheckId.FreeCertificates,
      outcome: issuesFreeCustomDomainCertificates()
        ? CustomDomainReadinessOutcome.Pass
        : CustomDomainReadinessOutcome.Warn,
      values: {},
    };

    const result: CustomDomainServerReadinessResult = {
      target: target,
      checks: checks,
      checkedAt: OneUptimeDate.getCurrentDate(),
    };

    if (!target) {
      checks.push({
        id: CustomDomainReadinessCheckId.TargetSet,
        outcome: CustomDomainReadinessOutcome.Fail,
        values: { variable: request.variable, helmValue: request.helmValue },
      });
      checks.push(freeCertificates);
      return result;
    }

    checks.push({
      id: CustomDomainReadinessCheckId.TargetSet,
      outcome: CustomDomainReadinessOutcome.Pass,
      values: { target, variable: request.variable },
    });

    const addresses: DnsLookupAnswer = await DnsLookup.resolveAddresses(target);

    if (addresses.values.length === 0) {
      checks.push({
        id: CustomDomainReadinessCheckId.TargetResolves,
        outcome: CustomDomainReadinessOutcome.Fail,
        values: { target },
      });
      checks.push(freeCertificates);
      return result;
    }

    checks.push({
      id: CustomDomainReadinessCheckId.TargetResolves,
      outcome: CustomDomainReadinessOutcome.Pass,
      values: { target, addresses: addresses.values.slice(0, 4).join(", ") },
    });

    const [port80, port443] = await Promise.all([
      CustomDomainServerReadiness.probePort80(target),
      CustomDomainServerReadiness.canConnect(target, 443),
    ]);

    if (port80.reached) {
      checks.push({
        id: CustomDomainReadinessCheckId.Port80,
        outcome: CustomDomainReadinessOutcome.Pass,
        values: { target },
      });
    } else if (port80.httpStatus !== undefined) {
      checks.push({
        id: CustomDomainReadinessCheckId.Port80,
        outcome: CustomDomainReadinessOutcome.Fail,
        reason: CustomDomainReadinessReason.NotThisServer,
        values: { target, status: String(port80.httpStatus) },
      });
    } else {
      checks.push({
        id: CustomDomainReadinessCheckId.Port80,
        outcome: CustomDomainReadinessOutcome.Fail,
        reason: CustomDomainReadinessReason.NoAnswer,
        values: { target },
      });
    }

    checks.push({
      id: CustomDomainReadinessCheckId.Port443,
      outcome: port443
        ? CustomDomainReadinessOutcome.Pass
        : CustomDomainReadinessOutcome.Fail,
      values: { target },
    });

    checks.push(freeCertificates);

    return result;
  }
}
