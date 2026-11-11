import { PROBE_CERTIFICATE_REVOCATION_CHECK_ENABLED } from "../../../Config";
import CertificateInfoParser, { CertificateInfo } from "./CertificateInfo";
import Crl, { CrlVerification } from "./Crl";
import Ocsp from "./Ocsp";
import RevocationAnswerUtil, {
  NoRevocationAnswer,
  RevocationAnswer,
  SignedRevocationAnswer,
} from "./RevocationAnswer";
import RevocationHttpClient from "./RevocationHttpClient";
import Signature from "./Signature";
import CertificateRevocationCheckMethod from "Common/Types/Monitor/SSLMonitor/CertificateRevocationCheckMethod";
import CertificateRevocationStatus from "Common/Types/Monitor/SSLMonitor/CertificateRevocationStatus";
import logger from "Common/Server/Utils/Logger";
import { X509Certificate } from "crypto";

/*
 * Asks a certificate's issuer whether it has revoked the certificate, the
 * way a browser does - which Node's TLS validation never does. A customer's
 * WAF served a revoked certificate for five hours while every check read it
 * as valid, because a revoked certificate still has a trusted issuer, a
 * matching host name and current dates.
 *
 * In order, stopping at the first signed, current answer:
 *   1. the OCSP response the server stapled to its handshake (no request);
 *   2. the issuer's OCSP responders named in the certificate;
 *   3. the issuer's CRLs named in the certificate.
 *
 * No answer is NOT a revocation: like browsers, the check "soft-fails", so a
 * responder that is down or a probe without internet access never takes a
 * healthy site down. Answers are cached until the issuer's next update (an
 * hour at most) and shared by every monitor on this probe; a failed lookup
 * is tried again after five minutes, so an unreachable responder costs one
 * wait every five minutes rather than one per check.
 */

export interface CertificateRevocationCheckInput {
  // DER of the server's certificate, and of the certificate that issued it.
  certificate: Buffer;
  issuer: Buffer;
  // What the server stapled in the handshake, if anything.
  stapledOcspResponse?: Buffer | null | undefined;
  // How long the caller waits for an answer. Lookups go on in the background.
  timeoutInMs?: number | undefined;
}

export interface CertificateRevocationCheckResult {
  status: CertificateRevocationStatus;
  method?: CertificateRevocationCheckMethod | undefined;
  revokedAt?: Date | undefined;
  reason?: string | undefined;
  // Why the status is Unknown.
  error?: string | undefined;
}

// What a check waits for at most, on top of the TLS handshake.
export const DEFAULT_REVOCATION_CHECK_TIMEOUT_IN_MS: number = 10000;

// One OCSP request, and one CRL download.
export const OCSP_REQUEST_TIMEOUT_IN_MS: number = 5000;
export const CRL_DOWNLOAD_TIMEOUT_IN_MS: number = 10000;

// An OCSP response is a few kilobytes; most CRLs are well under a megabyte.
export const MAX_OCSP_RESPONSE_BYTES: number = 64 * 1024;
export const MAX_CRL_BYTES: number = 10 * 1024 * 1024;

/*
 * How long an answer is reused: until the issuer's next update, but never
 * more than an hour - so a certificate revoked while it is in service is
 * caught within an hour - and never less than a minute.
 */
export const MAX_ANSWER_CACHE_TIME_IN_MS: number = 60 * 60 * 1000;
export const MIN_ANSWER_CACHE_TIME_IN_MS: number = 60 * 1000;

// How long a lookup that got no answer is remembered before trying again.
export const FAILED_LOOKUP_RETRY_AFTER_IN_MS: number = 5 * 60 * 1000;

// Responders and CRLs asked per certificate; real certificates name one or two.
const MAX_SOURCES_PER_KIND: number = 2;

const MAX_CACHED_OCSP_ANSWERS: number = 10000;
const MAX_CACHED_CRLS: number = 64;

/*
 * What the cached CRLs may hold in all, estimated as their bytes plus about
 * 100 bytes per serial number in their lookup map. Public CAs' CRLs are
 * mostly well under a megabyte, so this keeps dozens of them; a probe that
 * watches many issuers with huge CRLs downloads the least recent again.
 */
const MAX_CACHED_CRL_BYTES: number = 256 * 1024 * 1024;
const ESTIMATED_BYTES_PER_CRL_ENTRY: number = 100;

const CRL_REDIRECTS_FOLLOWED: number = 3;

/*
 * A small map whose entries expire, holding at most maxEntries: the oldest
 * entry goes when a new one would not fit.
 */
class ExpiringCache<T> {
  private readonly entries: Map<
    string,
    { value: T; expiresAt: number; size: number }
  > = new Map<string, { value: T; expiresAt: number; size: number }>();

  private totalSize: number = 0;

  /*
   * sizeOf and maxTotalSize bound what the entries hold in all, as well as
   * how many there are: a CRL can be megabytes.
   */
  public constructor(
    private readonly maxEntries: number,
    private readonly sizeOf: (value: T) => number = (): number => {
      return 0;
    },
    private readonly maxTotalSize: number = Number.POSITIVE_INFINITY,
  ) {}

  public get(key: string): T | undefined {
    const entry: { value: T; expiresAt: number; size: number } | undefined =
      this.entries.get(key);

    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      this.delete(key);
      return undefined;
    }

    return entry.value;
  }

  public set(key: string, value: T, expiresAt: number): void {
    this.delete(key);

    const size: number = this.sizeOf(value);

    while (
      this.entries.size > 0 &&
      (this.entries.size >= this.maxEntries ||
        this.totalSize + size > this.maxTotalSize)
    ) {
      const oldestKey: string | undefined = this.entries.keys().next().value;

      if (oldestKey === undefined) {
        break;
      }

      this.delete(oldestKey);
    }

    // A value that alone is over the budget is not kept at all.
    if (size > this.maxTotalSize) {
      return;
    }

    this.entries.set(key, { value: value, expiresAt: expiresAt, size: size });
    this.totalSize += size;
  }

  public clear(): void {
    this.entries.clear();
    this.totalSize = 0;
  }

  private delete(key: string): void {
    const entry: { value: T; expiresAt: number; size: number } | undefined =
      this.entries.get(key);

    if (entry) {
      this.totalSize -= entry.size;
      this.entries.delete(key);
    }
  }
}

export default class CertificateRevocationChecker {
  private static readonly ocspAnswers: ExpiringCache<RevocationAnswer> =
    new ExpiringCache<RevocationAnswer>(MAX_CACHED_OCSP_ANSWERS);
  private static readonly ocspLookupsInFlight: Map<
    string,
    Promise<RevocationAnswer>
  > = new Map<string, Promise<RevocationAnswer>>();

  private static readonly crls: ExpiringCache<CrlVerification> =
    new ExpiringCache<CrlVerification>(
      MAX_CACHED_CRLS,
      (verification: CrlVerification): number => {
        return verification.isVerified
          ? verification.crl.der.length +
              verification.crl.entries.size * ESTIMATED_BYTES_PER_CRL_ENTRY
          : 0;
      },
      MAX_CACHED_CRL_BYTES,
    );
  private static readonly crlDownloadsInFlight: Map<
    string,
    Promise<CrlVerification>
  > = new Map<string, Promise<CrlVerification>>();

  public static isEnabled(): boolean {
    return PROBE_CERTIFICATE_REVOCATION_CHECK_ENABLED;
  }

  // Never throws: anything that goes wrong is an Unknown status with a reason.
  public static async check(
    input: CertificateRevocationCheckInput,
  ): Promise<CertificateRevocationCheckResult> {
    const timeoutInMs: number = Math.max(
      0,
      input.timeoutInMs ?? DEFAULT_REVOCATION_CHECK_TIMEOUT_IN_MS,
    );
    const deadline: number = Date.now() + timeoutInMs;

    let certificate: CertificateInfo;
    let issuer: CertificateInfo;
    let issuerCertificate: X509Certificate;

    try {
      certificate = CertificateInfoParser.parse(input.certificate);
      issuer = CertificateInfoParser.parse(input.issuer);
      issuerCertificate = new X509Certificate(input.issuer);

      /*
       * The issuer's key is what every answer is checked against, so make
       * sure this really is the certificate that signed the server's.
       */
      if (
        !new X509Certificate(input.certificate).verify(
          issuerCertificate.publicKey,
        )
      ) {
        return CertificateRevocationChecker.unknown(
          "The certificate the server sent as its issuer did not sign it, so the issuer could not be asked.",
        );
      }
    } catch (error) {
      return CertificateRevocationChecker.unknown(
        `The certificate could not be read: ${(error as Error).message}`,
      );
    }

    try {
      return await CertificateRevocationChecker.askIssuer({
        certificate: certificate,
        issuer: issuer,
        issuerCertificate: issuerCertificate,
        stapledOcspResponse: input.stapledOcspResponse,
        deadline: deadline,
        timeoutInMs: timeoutInMs,
      });
    } catch (error) {
      logger.debug(
        `Certificate revocation check failed unexpectedly: ${(error as Error).message}`,
      );

      return CertificateRevocationChecker.unknown(
        `The revocation check failed: ${(error as Error).message}`,
      );
    }
  }

  /*
   * The sentence that says a certificate is revoked, for the failure cause
   * of a Website / API check and the certificate problem of an SSL check.
   * Starts the way Node's own TLS errors do ("certificate has expired").
   */
  public static describeRevocation(
    result: CertificateRevocationCheckResult,
  ): string {
    let sentence: string = "certificate has been revoked by its issuer";

    if (result.revokedAt) {
      sentence += ` on ${result.revokedAt.toISOString().replace("T", " ").slice(0, 19)} UTC`;
    }

    if (result.reason) {
      sentence += ` (reason: ${result.reason})`;
    }

    switch (result.method) {
      case CertificateRevocationCheckMethod.StapledOcsp:
        sentence += ", according to the OCSP response the server sent";
        break;
      case CertificateRevocationCheckMethod.Ocsp:
        sentence += ", according to the issuer's OCSP responder";
        break;
      case CertificateRevocationCheckMethod.Crl:
        sentence += ", according to the issuer's certificate revocation list";
        break;
      default:
        break;
    }

    return `${sentence}. Browsers refuse a revoked certificate.`;
  }

  // Forgets every cached answer. For tests.
  public static clearCache(): void {
    CertificateRevocationChecker.ocspAnswers.clear();
    CertificateRevocationChecker.crls.clear();
    CertificateRevocationChecker.ocspLookupsInFlight.clear();
    CertificateRevocationChecker.crlDownloadsInFlight.clear();
  }

  private static async askIssuer(data: {
    certificate: CertificateInfo;
    issuer: CertificateInfo;
    issuerCertificate: X509Certificate;
    stapledOcspResponse?: Buffer | null | undefined;
    deadline: number;
    timeoutInMs: number;
  }): Promise<CertificateRevocationCheckResult> {
    const problems: Array<string> = [];

    if (data.stapledOcspResponse && data.stapledOcspResponse.length > 0) {
      const answer: RevocationAnswer = Ocsp.verifyResponse({
        response: data.stapledOcspResponse,
        certificate: data.certificate,
        issuer: data.issuer,
        issuerCertificate: data.issuerCertificate,
        now: new Date(),
      });

      if (answer.isAnswer) {
        return CertificateRevocationChecker.fromAnswer(
          answer,
          CertificateRevocationCheckMethod.StapledOcsp,
        );
      }

      problems.push(`The OCSP response the server sent ${answer.problem}.`);
    }

    for (const url of data.certificate.ocspUrls.slice(
      0,
      MAX_SOURCES_PER_KIND,
    )) {
      const answer: RevocationAnswer =
        await CertificateRevocationChecker.waitUntil(
          CertificateRevocationChecker.lookupOcsp({
            url: url,
            certificate: data.certificate,
            issuer: data.issuer,
            issuerCertificate: data.issuerCertificate,
          }),
          data.deadline,
          data.timeoutInMs,
        );

      if (answer.isAnswer) {
        return CertificateRevocationChecker.fromAnswer(
          answer,
          CertificateRevocationCheckMethod.Ocsp,
        );
      }

      problems.push(`The OCSP responder at ${url} ${answer.problem}.`);
    }

    for (const url of data.certificate.crlUrls.slice(0, MAX_SOURCES_PER_KIND)) {
      const verification: CrlVerification | NoRevocationAnswer =
        await CertificateRevocationChecker.waitUntil(
          CertificateRevocationChecker.loadCrl({
            url: url,
            certificate: data.certificate,
            issuerCertificate: data.issuerCertificate,
          }),
          data.deadline,
          data.timeoutInMs,
        );

      if ("isAnswer" in verification) {
        problems.push(`The CRL at ${url} ${verification.problem}.`);
        continue;
      }

      if (!verification.isVerified) {
        problems.push(`The CRL at ${url} ${verification.problem}.`);
        continue;
      }

      const answer: RevocationAnswer = Crl.lookup({
        crl: verification.crl,
        certificate: data.certificate,
        now: new Date(),
      });

      if (answer.isAnswer) {
        return CertificateRevocationChecker.fromAnswer(
          answer,
          CertificateRevocationCheckMethod.Crl,
        );
      }

      problems.push(`The CRL at ${url} ${answer.problem}.`);
    }

    if (problems.length === 0) {
      return CertificateRevocationChecker.unknown(
        "The certificate names no OCSP responder and no certificate revocation list, so there is nowhere to ask.",
      );
    }

    return CertificateRevocationChecker.unknown(problems.join(" "));
  }

  private static async lookupOcsp(data: {
    url: string;
    certificate: CertificateInfo;
    issuer: CertificateInfo;
    issuerCertificate: X509Certificate;
  }): Promise<RevocationAnswer> {
    const key: string = [
      data.url,
      Signature.hash("sha256", data.issuer.subjectPublicKey).toString("hex"),
      CertificateInfoParser.serialNumberHex(data.certificate.serialNumber),
    ].join(" ");

    const cached: RevocationAnswer | undefined =
      CertificateRevocationChecker.ocspAnswers.get(key);

    if (cached) {
      return cached;
    }

    const inFlight: Promise<RevocationAnswer> | undefined =
      CertificateRevocationChecker.ocspLookupsInFlight.get(key);

    if (inFlight) {
      return inFlight;
    }

    const lookup: Promise<RevocationAnswer> =
      (async (): Promise<RevocationAnswer> => {
        let answer: RevocationAnswer;

        try {
          const response: Buffer = await RevocationHttpClient.fetch({
            url: data.url,
            method: "POST",
            body: Ocsp.buildRequest(data.certificate, data.issuer),
            headers: {
              "Content-Type": "application/ocsp-request",
              Accept: "application/ocsp-response",
            },
            timeoutInMs: OCSP_REQUEST_TIMEOUT_IN_MS,
            maxResponseBytes: MAX_OCSP_RESPONSE_BYTES,
            maxRedirects: 0,
          });

          answer = Ocsp.verifyResponse({
            response: response,
            certificate: data.certificate,
            issuer: data.issuer,
            issuerCertificate: data.issuerCertificate,
            now: new Date(),
          });
        } catch (error) {
          answer = RevocationAnswerUtil.noAnswer(
            RevocationHttpClient.describeFailure(error),
          );
        }

        if (!answer.isAnswer) {
          logger.debug(
            `Certificate revocation: the OCSP responder at ${data.url} ${answer.problem}`,
          );
        }

        CertificateRevocationChecker.ocspAnswers.set(
          key,
          answer,
          CertificateRevocationChecker.cacheUntil(
            answer.isAnswer ? answer.nextUpdate : undefined,
            answer.isAnswer,
          ),
        );

        return answer;
      })().finally(() => {
        CertificateRevocationChecker.ocspLookupsInFlight.delete(key);
      });

    CertificateRevocationChecker.ocspLookupsInFlight.set(key, lookup);

    return lookup;
  }

  private static async loadCrl(data: {
    url: string;
    certificate: CertificateInfo;
    issuerCertificate: X509Certificate;
  }): Promise<CrlVerification> {
    const key: string = `${data.url} ${data.issuerCertificate.fingerprint256}`;

    const cached: CrlVerification | undefined =
      CertificateRevocationChecker.crls.get(key);

    if (cached) {
      return cached;
    }

    const inFlight: Promise<CrlVerification> | undefined =
      CertificateRevocationChecker.crlDownloadsInFlight.get(key);

    if (inFlight) {
      return inFlight;
    }

    const download: Promise<CrlVerification> =
      (async (): Promise<CrlVerification> => {
        let verification: CrlVerification;

        try {
          const body: Buffer = await RevocationHttpClient.fetch({
            url: data.url,
            method: "GET",
            headers: {
              Accept: "application/pkix-crl, application/x-pkcs7-crl, */*",
            },
            timeoutInMs: CRL_DOWNLOAD_TIMEOUT_IN_MS,
            maxResponseBytes: MAX_CRL_BYTES,
            maxRedirects: CRL_REDIRECTS_FOLLOWED,
          });

          verification = Crl.verify({
            der: Crl.toDer(body),
            certificate: data.certificate,
            issuerCertificate: data.issuerCertificate,
          });
        } catch (error) {
          verification = {
            isVerified: false,
            problem: RevocationHttpClient.describeFailure(error),
          };
        }

        if (!verification.isVerified) {
          logger.debug(
            `Certificate revocation: the CRL at ${data.url} ${verification.problem}`,
          );
        }

        CertificateRevocationChecker.crls.set(
          key,
          verification,
          CertificateRevocationChecker.cacheUntil(
            verification.isVerified ? verification.crl.nextUpdate : undefined,
            verification.isVerified,
          ),
        );

        return verification;
      })().finally(() => {
        CertificateRevocationChecker.crlDownloadsInFlight.delete(key);
      });

    CertificateRevocationChecker.crlDownloadsInFlight.set(key, download);

    return download;
  }

  private static cacheUntil(
    nextUpdate: Date | undefined,
    isAnswer: boolean,
  ): number {
    const now: number = Date.now();

    if (!isAnswer) {
      return now + FAILED_LOOKUP_RETRY_AFTER_IN_MS;
    }

    const untilNextUpdate: number = nextUpdate
      ? nextUpdate.getTime() - now
      : MAX_ANSWER_CACHE_TIME_IN_MS;

    return (
      now +
      Math.min(
        MAX_ANSWER_CACHE_TIME_IN_MS,
        Math.max(MIN_ANSWER_CACHE_TIME_IN_MS, untilNextUpdate),
      )
    );
  }

  /*
   * Waits for a lookup until the check's deadline. A lookup still running
   * then is left to finish on its own and fill the cache for the next check.
   */
  private static async waitUntil<T>(
    lookup: Promise<T>,
    deadline: number,
    timeoutInMs: number,
  ): Promise<T | NoRevocationAnswer> {
    const remainingInMs: number = deadline - Date.now();
    const noTimeLeft: NoRevocationAnswer = RevocationAnswerUtil.noAnswer(
      `did not answer within the ${Math.round(timeoutInMs / 100) / 10} seconds the check waits`,
    );

    if (remainingInMs <= 0) {
      return noTimeLeft;
    }

    let timer: ReturnType<typeof setTimeout> | undefined = undefined;

    const expired: Promise<NoRevocationAnswer> =
      new Promise<NoRevocationAnswer>(
        (resolve: (value: NoRevocationAnswer) => void) => {
          timer = setTimeout(() => {
            resolve(noTimeLeft);
          }, remainingInMs);
        },
      );

    try {
      return await Promise.race([lookup, expired]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private static fromAnswer(
    answer: SignedRevocationAnswer,
    method: CertificateRevocationCheckMethod,
  ): CertificateRevocationCheckResult {
    if (!answer.isRevoked) {
      return {
        status: CertificateRevocationStatus.NotRevoked,
        method: method,
      };
    }

    return {
      status: CertificateRevocationStatus.Revoked,
      method: method,
      revokedAt: answer.revokedAt,
      reason: answer.reason,
    };
  }

  private static unknown(error: string): CertificateRevocationCheckResult {
    return { status: CertificateRevocationStatus.Unknown, error: error };
  }
}
