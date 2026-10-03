import GlobalCache from "../../Infrastructure/GlobalCache";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import OneUptimeDate from "../../../Types/Date";

export interface CertificateOrderFailure {
  // What the order threw, as the person who placed it was told.
  error: string;
  failedAt: Date;
  // How many orders for the name have failed in a row.
  failures: number;
}

/*
 * The last failed certificate order of each name, kept in Redis.
 *
 * An order that fails leaves nothing behind in the database: the domain
 * stays unordered, and the sweeps order it again. So a domain whose order
 * keeps failing - a CAA record that leaves Let's Encrypt out, a server Let's
 * Encrypt cannot reach - said "Issuing a free certificate" for days, and the
 * reason was only in the worker's log. GreenlockUtil.orderCert records every
 * failed order here and clears the record when an order for the name
 * succeeds, so:
 *
 *   - the domain's Status column shows that the order failed, and why;
 *   - the sweeps and renewal runs, which would otherwise order a failing name
 *     again every 15 minutes, wait longer after each failure in a row
 *     (getRetryDelayInMinutes). Every failed order still counts against the
 *     installation's shared Let's Encrypt account, and Let's Encrypt allows
 *     five failed validations per name per hour.
 *
 * Check now and the order API do not wait: somebody who has just fixed the
 * cause should not have to. They have a window of their own per domain
 * (CertificateOrder.claimOnDemandOrder).
 *
 * Kept in Redis rather than on the domain row, so neither table changes:
 * losing a record (a Redis restart) only means the next failure is recorded
 * again. Every method here never throws.
 */
export default class CertificateOrderFailures {
  public static readonly NAMESPACE: string =
    "CustomDomainCertificateOrderFailure";

  /*
   * How long a record is kept without another failure. The sweeps retry a
   * failing name at least every LONGEST_RETRY_DELAY_IN_HOURS, which renews
   * it well before this.
   */
  public static readonly KEEP_FOR_IN_DAYS: number = 7;

  // How long the automatic attempts wait after one failure...
  public static readonly FIRST_RETRY_DELAY_IN_MINUTES: number = 15;

  // ...doubling with each further failure in a row, up to this.
  public static readonly LONGEST_RETRY_DELAY_IN_HOURS: number = 6;

  /*
   * A failure is recorded when the order ends, which can be a minute or two
   * after the sweep started it. Without this, the sweep on the tick the
   * delay ends on would find the name still waiting, and the first retry
   * would come a tick late.
   */
  public static readonly RETRY_GRACE_IN_MINUTES: number = 2;

  private static readonly LOOKUP_CHUNK_SIZE: number = 500;

  public static getRetryDelayInMinutes(failures: number): number {
    const failuresInARow: number = Math.max(1, Math.floor(failures || 1));

    const longest: number =
      CertificateOrderFailures.LONGEST_RETRY_DELAY_IN_HOURS * 60;

    // Past this many doublings the delay is the longest one anyway.
    if (failuresInARow > 20) {
      return longest;
    }

    return Math.min(
      CertificateOrderFailures.FIRST_RETRY_DELAY_IN_MINUTES *
        Math.pow(2, failuresInARow - 1),
      longest,
    );
  }

  // When the sweeps and renewal runs order this name again.
  public static getRetryAt(failure: CertificateOrderFailure): Date {
    return OneUptimeDate.addRemoveMinutes(
      failure.failedAt,
      CertificateOrderFailures.getRetryDelayInMinutes(failure.failures),
    );
  }

  public static isWaitingToRetry(
    failure: CertificateOrderFailure | undefined,
    now: Date,
  ): boolean {
    if (!failure) {
      return false;
    }

    return OneUptimeDate.isAfter(
      OneUptimeDate.addRemoveMinutes(
        CertificateOrderFailures.getRetryAt(failure),
        -CertificateOrderFailures.RETRY_GRACE_IN_MINUTES,
      ),
      now,
    );
  }

  @CaptureSpan()
  public static async record(data: {
    domain: string;
    error: string;
    now: Date;
  }): Promise<void> {
    const name: string = CertificateOrderFailures.normalizeDomain(data.domain);

    try {
      const previous: CertificateOrderFailure | null =
        CertificateOrderFailures.parse(
          await GlobalCache.getString(CertificateOrderFailures.NAMESPACE, name),
        );

      const failure: CertificateOrderFailure = {
        error:
          data.error.trim() ||
          "We could not order an SSL certificate for this domain.",
        failedAt: data.now,
        failures: (previous?.failures || 0) + 1,
      };

      await GlobalCache.setString(
        CertificateOrderFailures.NAMESPACE,
        name,
        JSON.stringify({
          error: failure.error,
          failedAt: failure.failedAt.toISOString(),
          failures: failure.failures,
        }),
        {
          expiresInSeconds: OneUptimeDate.getSecondsInDays(
            CertificateOrderFailures.KEEP_FOR_IN_DAYS,
          ),
        },
      );
    } catch (err) {
      logger.error(
        `Could not record the failed certificate order of ${name}`,
        { fullDomain: name } as LogAttributes,
      );
      logger.error(err, { fullDomain: name } as LogAttributes);
    }
  }

  // An order for the name succeeded: forget its failures.
  @CaptureSpan()
  public static async clear(domain: string): Promise<void> {
    const name: string = CertificateOrderFailures.normalizeDomain(domain);

    try {
      await GlobalCache.deleteKey(CertificateOrderFailures.NAMESPACE, name);
    } catch (err) {
      logger.error(err, { fullDomain: name } as LogAttributes);
    }
  }

  /*
   * The recorded failure of each of these names that has one, by normalized
   * name, a few hundred names per round trip. Empty when Redis cannot be
   * read: then nothing waits, and nothing shows a failure.
   */
  @CaptureSpan()
  public static async get(
    domains: Array<string>,
  ): Promise<Map<string, CertificateOrderFailure>> {
    const failures: Map<string, CertificateOrderFailure> = new Map<
      string,
      CertificateOrderFailure
    >();

    const names: Array<string> = Array.from(
      new Set<string>(
        domains
          .map((domain: string) => {
            return CertificateOrderFailures.normalizeDomain(domain);
          })
          .filter((name: string) => {
            return name.length > 0;
          }),
      ),
    );

    try {
      for (
        let offset: number = 0;
        offset < names.length;
        offset += CertificateOrderFailures.LOOKUP_CHUNK_SIZE
      ) {
        const chunk: Array<string> = names.slice(
          offset,
          offset + CertificateOrderFailures.LOOKUP_CHUNK_SIZE,
        );

        const values: Array<string | null> = await GlobalCache.getStrings(
          CertificateOrderFailures.NAMESPACE,
          chunk,
        );

        chunk.forEach((name: string, index: number) => {
          const failure: CertificateOrderFailure | null =
            CertificateOrderFailures.parse(values[index] ?? null);

          if (failure) {
            failures.set(name, failure);
          }
        });
      }
    } catch (err) {
      logger.error("Could not read the failed certificate orders");
      logger.error(err);

      return new Map<string, CertificateOrderFailure>();
    }

    return failures;
  }

  /*
   * The items whose name is not waiting after a failed order - what a sweep
   * or a renewal run may order now.
   */
  public static async withoutThoseWaitingToRetry<T>(data: {
    items: Array<T>;
    getDomain: (item: T) => string;
    now: Date;
  }): Promise<Array<T>> {
    if (data.items.length === 0) {
      return [];
    }

    const failures: Map<string, CertificateOrderFailure> =
      await CertificateOrderFailures.get(data.items.map(data.getDomain));

    return data.items.filter((item: T) => {
      return !CertificateOrderFailures.isWaitingToRetry(
        failures.get(
          CertificateOrderFailures.normalizeDomain(data.getDomain(item)),
        ),
        data.now,
      );
    });
  }

  public static normalizeDomain(domain: string): string {
    return (domain || "").trim().toLowerCase();
  }

  private static parse(value: string | null): CertificateOrderFailure | null {
    if (!value) {
      return null;
    }

    try {
      const json: {
        error?: unknown;
        failedAt?: unknown;
        failures?: unknown;
      } = JSON.parse(value);

      const failedAt: Date = new Date(String(json.failedAt));

      if (typeof json.error !== "string" || isNaN(failedAt.getTime())) {
        return null;
      }

      const failures: number = Number(json.failures);

      return {
        error: json.error,
        failedAt: failedAt,
        failures: Number.isFinite(failures) && failures > 0 ? failures : 1,
      };
    } catch {
      return null;
    }
  }
}
