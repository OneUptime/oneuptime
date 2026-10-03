import {
  IsBillingEnabled,
  LetsEncryptAccountKey,
  LetsEncryptNotificationEmail,
} from "../../../Server/EnvironmentConfig";
import AcmeCertificateService from "../../Services/AcmeCertificateService";
import AcmeChallengeService from "../../Services/AcmeChallengeService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Logger";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ServerException from "../../../Types/Exception/ServerException";
import Text from "../../../Types/Text";
import AcmeCertificate from "../../../Models/DatabaseModels/AcmeCertificate";
import AcmeChallenge from "../../../Models/DatabaseModels/AcmeChallenge";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ArrayUtil from "../../../Utils/Array";
import acme from "acme-client";
import { Challenge } from "acme-client/types/rfc8555";
import CaptureSpan from "../Telemetry/CaptureSpan";

export default class GreenlockUtil {
  /*
   * How early a certificate is renewed, as a range rather than a single value.
   *
   * Let's Encrypt issues for 90 days, so every domain ordered on the same day
   * expires on the same day. Renewing them all at one fixed lead time keeps
   * that batch together for every cycle that follows, and a single bad day -
   * an upstream outage, a rate limit, a run that does not finish - then expires
   * the whole batch at once instead of one domain.
   *
   * Spreading the lead time across a range pulls the batch apart: domains that
   * expire on the same day come due days apart, and having been renewed days
   * apart they expire days apart next cycle too. The offset is derived from the
   * domain name so it is stable - a domain must not drift in and out of
   * eligibility between two runs, which would leave it renewed by neither.
   */
  public static readonly RENEW_LEAD_TIME_MAX_IN_DAYS: number = 40;
  public static readonly RENEW_LEAD_TIME_MIN_IN_DAYS: number = 25;

  /*
   * A run renews at most this many domains, at most this many at a time.
   *
   * Both bound how much of a backlog is dispatched at once. Let's Encrypt
   * allows 300 new orders per account per three hours, and the reactive
   * provisioning sweep spends from the same allowance, so a run that tried to
   * clear a large backlog in one pass would spend the account's budget and get
   * the renewals behind it refused. At the schedule this job runs on the cap
   * still clears far more per day than one sequential daily pass ever did,
   * while leaving room under the limit.
   */
  public static readonly RENEW_MAX_PER_RUN: number = 10;
  public static readonly RENEW_CONCURRENCY: number = 5;

  /*
   * Lookups by domain name (an owner asked which domains are its own, the
   * certificates of a list of domains) take at most this many names at once,
   * so a long list becomes several short IN (...) lookups rather than one
   * statement with thousands of parameters.
   */
  public static readonly DOMAIN_LOOKUP_CHUNK_SIZE: number = 500;

  /*
   * A certificate nobody owns is deleted once it has been expired this long,
   * at most REMOVE_UNOWNED_MAX_PER_RUN per run.
   *
   * Such certificates are left behind when a project, status page, dashboard
   * or parent domain is deleted: those deletes remove the domain rows through
   * the database's ON DELETE CASCADE, which skips the hook that removes the
   * certificate. An expired certificate serves nobody, and every owner orders
   * a fresh one when its own is missing, so deleting one cannot take a
   * working domain down. The month of grace is for a domain that is deleted
   * and added back.
   */
  public static readonly REMOVE_UNOWNED_AFTER_EXPIRY_IN_DAYS: number = 30;
  public static readonly REMOVE_UNOWNED_MAX_PER_RUN: number = 100;

  /*
   * Stable per-domain lead time, somewhere in the range above. Same domain,
   * same answer, on every run and every replica.
   */
  public static getRenewalLeadTimeInDays(domain: string): number {
    const spanInDays: number =
      GreenlockUtil.RENEW_LEAD_TIME_MAX_IN_DAYS -
      GreenlockUtil.RENEW_LEAD_TIME_MIN_IN_DAYS;

    let hash: number = 0;

    for (let i: number = 0; i < domain.length; i++) {
      hash = (hash * 31 + domain.charCodeAt(i)) % 1000003;
    }

    return (
      GreenlockUtil.RENEW_LEAD_TIME_MIN_IN_DAYS + (hash % (spanInDays + 1))
    );
  }

  /*
   * Whether this certificate has reached its own renewal lead time. Expired
   * certificates are due too.
   */
  public static isDueForRenewal(
    certificate: { domain?: string | undefined; expiresAt?: Date | undefined },
    now: Date,
  ): boolean {
    if (!certificate.domain || !certificate.expiresAt) {
      return false;
    }

    const renewAt: Date = OneUptimeDate.addRemoveDays(
      certificate.expiresAt,
      -GreenlockUtil.getRenewalLeadTimeInDays(certificate.domain),
    );

    return !OneUptimeDate.isAfter(renewAt, now);
  }

  /*
   * The items a capped sweep works on in this run: at most max of them,
   * chosen by a shuffle that is the same for every replica within one
   * 15-minute window and different in the next, so an item whose work keeps
   * failing cannot hold a slot run after run while the others wait. Every
   * item has the same chance in every run, however the list grows, shrinks
   * or is ordered, and whatever schedule the sweep runs on - a fixed
   * rotation would skip items whenever earlier ones left the list.
   */
  public static pickForThisRun<T>(data: {
    items: Array<T>;
    max: number;
    now: Date;
    getKey: (item: T) => string;
  }): Array<T> {
    const max: number = Math.max(Math.floor(data.max), 0);

    const window: number = Math.floor(
      data.now.getTime() / OneUptimeDate.convertMinutesToMilliseconds(15),
    );

    return data.items
      .map((item: T) => {
        const key: string = data.getKey(item);

        return {
          item: item,
          key: key,
          rank:
            data.items.length <= max
              ? 0
              : GreenlockUtil.hashText(`${window}:${key}`),
        };
      })
      .sort(
        (
          a: { key: string; rank: number },
          b: { key: string; rank: number },
        ) => {
          if (a.rank !== b.rank) {
            return a.rank - b.rank;
          }

          if (a.key === b.key) {
            return 0;
          }

          return a.key < b.key ? -1 : 1;
        },
      )
      .slice(0, max)
      .map((ranked: { item: T }) => {
        return ranked.item;
      });
  }

  // 32-bit FNV-1a: a stable, well-spread hash of a string.
  private static hashText(text: string): number {
    let hash: number = 0x811c9dc5;

    for (let i: number = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }

    return hash;
  }

  /*
   * The certificate each of these domains has in AcmeCertificate, if any,
   * looked up DOMAIN_LOOKUP_CHUNK_SIZE names at a time. Where a name has more
   * than one row, the one that expires last. A row without an expiry is no
   * certificate at all: it is never due, so nothing would ever replace it if
   * it counted as one.
   *
   * The sweeps that order first certificates and re-order missing ones read
   * this to tell a domain that needs an order from one that only needs to be
   * recorded as ordered.
   */
  @CaptureSpan()
  public static async findCertificatesByDomain(
    domains: Array<string>,
  ): Promise<Map<string, AcmeCertificate>> {
    const certificates: Map<string, AcmeCertificate> = new Map<
      string,
      AcmeCertificate
    >();

    const uniqueDomains: Array<string> = Array.from(
      new Set<string>(
        domains.filter((domain: string) => {
          return domain.length > 0;
        }),
      ),
    );

    for (
      let offset: number = 0;
      offset < uniqueDomains.length;
      offset += GreenlockUtil.DOMAIN_LOOKUP_CHUNK_SIZE
    ) {
      const chunk: Array<string> = uniqueDomains.slice(
        offset,
        offset + GreenlockUtil.DOMAIN_LOOKUP_CHUNK_SIZE,
      );

      const rows: Array<AcmeCertificate> = await AcmeCertificateService.findBy({
        query: {
          domain: QueryHelper.any(chunk),
        },
        select: {
          domain: true,
          expiresAt: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      for (const row of rows) {
        if (!row.domain || !row.expiresAt) {
          continue;
        }

        const existing: AcmeCertificate | undefined = certificates.get(
          row.domain,
        );

        if (
          !existing ||
          OneUptimeDate.isAfter(row.expiresAt, existing.expiresAt as Date)
        ) {
          certificates.set(row.domain, row);
        }
      }
    }

    return certificates;
  }

  /*
   * Ask one owner which of these domains are its own, a chunk at a time.
   */
  private static async getOwnedAmong(data: {
    domains: Array<string>;
    getOwnedDomains: (domains: Array<string>) => Promise<Array<string>>;
  }): Promise<Set<string>> {
    const owned: Set<string> = new Set<string>();
    const domains: Array<string> = Array.from(new Set<string>(data.domains));

    for (
      let offset: number = 0;
      offset < domains.length;
      offset += GreenlockUtil.DOMAIN_LOOKUP_CHUNK_SIZE
    ) {
      const chunk: Array<string> = domains.slice(
        offset,
        offset + GreenlockUtil.DOMAIN_LOOKUP_CHUNK_SIZE,
      );

      for (const domain of await data.getOwnedDomains(chunk)) {
        owned.add(domain);
      }
    }

    return owned;
  }

  /*
   * Renew the caller's certificates that are due, at most maxPerRun of them
   * per run (RENEW_MAX_PER_RUN unless the caller asks for fewer).
   *
   * AcmeCertificate is one table shared by every owner of a certificate:
   * status page domains, dashboard domains and the installation's own
   * primary host (CoreSSL). Each owner runs this on its own schedule and can
   * only judge its own domains - its validateCname reports false for every
   * domain it has no row for. So a run must never act on a certificate it
   * does not own. Before getOwnedDomains existed, the status page run
   * treated every dashboard certificate (and the primary host's, whenever
   * its lead time came before CoreSSL's 30-day renewal) as a status page
   * whose CNAME had stopped validating, and deleted it.
   *
   * getOwnedDomains is handed the due domains (a chunk at a time) and
   * returns the ones the caller owns. Every due certificate is read, not a
   * first page of them, and ownership is settled before the cap, so neither
   * another owner's backlog nor a pile of expired certificates nobody owns
   * can take this caller's slots. A certificate nobody claims is left exactly
   * as it is: neither renewed nor removed
   * (removeExpiredCertificatesNobodyOwns cleans those up once they are dead).
   */
  @CaptureSpan()
  public static async renewAllCertsWhichAreExpiringSoon(data: {
    getOwnedDomains: (domains: Array<string>) => Promise<Array<string>>;
    validateCname: (domain: string) => Promise<boolean>;
    notifyDomainRemoved: (domain: string) => Promise<void>;
    maxPerRun?: number | undefined;
  }): Promise<void> {
    try {
      logger.debug("Renewing all certificates");

      /*
       * Read the widest window any domain's lead time can make it due in, then
       * keep only the domains whose own lead time has actually been reached.
       */
      const certificates: AcmeCertificate[] =
        await AcmeCertificateService.findAllBy({
          query: {
            expiresAt: QueryHelper.lessThanEqualTo(
              OneUptimeDate.addRemoveDays(
                OneUptimeDate.getCurrentDate(),
                GreenlockUtil.RENEW_LEAD_TIME_MAX_IN_DAYS,
              ),
            ),
          },
          skip: 0,
          select: {
            domain: true,
            expiresAt: true,
          },
          sort: {
            expiresAt: SortOrder.Ascending,
          },
          props: {
            isRoot: true,
          },
        });

      const now: Date = OneUptimeDate.getCurrentDate();

      /*
       * One renewal per name: a name can have more than one row, and a row
       * renewed between two page reads can come back on both.
       */
      const dueDomains: Set<string> = new Set<string>();

      const dueCertificates: AcmeCertificate[] = certificates.filter(
        (certificate: AcmeCertificate) => {
          if (
            !GreenlockUtil.isDueForRenewal(certificate, now) ||
            dueDomains.has(certificate.domain as string)
          ) {
            return false;
          }

          dueDomains.add(certificate.domain as string);
          return true;
        },
      );

      /*
       * A lookup that fails throws out of the run before anything is renewed
       * or removed: not knowing who owns a certificate is never a reason to
       * touch it.
       */
      const ownedDomains: Set<string> = await GreenlockUtil.getOwnedAmong({
        domains: dueCertificates.map((certificate: AcmeCertificate) => {
          return certificate.domain as string;
        }),
        getOwnedDomains: data.getOwnedDomains,
      });

      const ownedDueCertificates: AcmeCertificate[] = dueCertificates.filter(
        (certificate: AcmeCertificate) => {
          return ownedDomains.has(certificate.domain as string);
        },
      );

      const maxPerRun: number = Math.max(
        Math.min(
          data.maxPerRun ?? GreenlockUtil.RENEW_MAX_PER_RUN,
          GreenlockUtil.RENEW_MAX_PER_RUN,
        ),
        0,
      );

      /*
       * Still sorted by expiry, so a run that cannot take the whole backlog
       * spends itself on the domains closest to expiring and leaves the rest -
       * which by construction still have weeks of lead time - to the next run.
       *
       * Certificates that have already expired come after every one that can
       * still be saved, and take turns among themselves. Such a domain has
       * been failing to renew since its lead time began - a CAA record that
       * leaves Let's Encrypt out, a name Let's Encrypt has paused - and,
       * sorting first by expiry, it would otherwise take a slot in every run
       * and starve the renewals behind it. It is still tried whenever slots
       * are left, which in a run without a backlog is every run.
       */
      const stillValid: AcmeCertificate[] = ownedDueCertificates.filter(
        (certificate: AcmeCertificate) => {
          return OneUptimeDate.isAfter(certificate.expiresAt as Date, now);
        },
      );

      const alreadyExpired: AcmeCertificate[] = ownedDueCertificates.filter(
        (certificate: AcmeCertificate) => {
          return !OneUptimeDate.isAfter(certificate.expiresAt as Date, now);
        },
      );

      const firstInLine: AcmeCertificate[] = stillValid.slice(0, maxPerRun);

      const batch: AcmeCertificate[] = [
        ...firstInLine,
        ...GreenlockUtil.pickForThisRun({
          items: alreadyExpired,
          max: maxPerRun - firstInLine.length,
          now: now,
          getKey: (certificate: AcmeCertificate): string => {
            return certificate.domain as string;
          },
        }),
      ];

      logger.debug(
        `Found ${dueCertificates.length} certificates due for renewal, ${ownedDueCertificates.length} of them owned by this caller, renewing ${batch.length} in this run`,
        {
          dueCount: dueCertificates.length,
          ownedDueCount: ownedDueCertificates.length,
          batchCount: batch.length,
        },
      );

      await ArrayUtil.forEachWithConcurrency(
        batch,
        GreenlockUtil.RENEW_CONCURRENCY,
        async (certificate: AcmeCertificate): Promise<void> => {
          await GreenlockUtil.renewCertForDomain({
            domain: certificate.domain as string,
            validateCname: data.validateCname,
            notifyDomainRemoved: data.notifyDomainRemoved,
          });
        },
      );
    } catch (e) {
      logger.error("Error renewing all certificates");
      logger.error(e);

      throw e;
    }
  }

  /*
   * Delete certificates that have been expired for more than
   * REMOVE_UNOWNED_AFTER_EXPIRY_IN_DAYS and that no owner claims, at most
   * REMOVE_UNOWNED_MAX_PER_RUN per run. Returns how many were deleted.
   *
   * owners must name every kind of certificate owner there is (see
   * CertificateOwners). A certificate is deleted only when all of them have
   * answered and none claims it; if any lookup fails, nothing is deleted.
   *
   * The delete names the row's id AND that it is still expired, and
   * hardDeleteBy keeps those conditions in the DELETE statement itself:
   * orderCert renews a name by updating its row in place, so a row renewed at
   * any point before the delete no longer matches and is kept. A newer row for
   * the same name never matches either.
   */
  @CaptureSpan()
  public static async removeExpiredCertificatesNobodyOwns(data: {
    owners: Array<{
      name: string;
      getOwnedDomains: (domains: Array<string>) => Promise<Array<string>>;
    }>;
  }): Promise<number> {
    const expiredBefore: Date = OneUptimeDate.addRemoveDays(
      OneUptimeDate.getCurrentDate(),
      -GreenlockUtil.REMOVE_UNOWNED_AFTER_EXPIRY_IN_DAYS,
    );

    const expiredCertificates: Array<AcmeCertificate> =
      await AcmeCertificateService.findAllBy({
        query: {
          expiresAt: QueryHelper.lessThan(expiredBefore),
        },
        select: {
          _id: true,
          domain: true,
          expiresAt: true,
        },
        sort: {
          expiresAt: SortOrder.Ascending,
        },
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const candidates: Array<AcmeCertificate> = expiredCertificates.filter(
      (certificate: AcmeCertificate) => {
        return Boolean(certificate.domain) && Boolean(certificate.id);
      },
    );

    if (candidates.length === 0) {
      return 0;
    }

    const domains: Array<string> = candidates.map(
      (certificate: AcmeCertificate) => {
        return certificate.domain as string;
      },
    );

    const ownedDomains: Set<string> = new Set<string>();

    for (const owner of data.owners) {
      const ownedByThisOwner: Set<string> = await GreenlockUtil.getOwnedAmong({
        domains: domains,
        getOwnedDomains: owner.getOwnedDomains,
      });

      for (const domain of ownedByThisOwner) {
        ownedDomains.add(domain);
      }
    }

    const abandoned: Array<AcmeCertificate> = candidates
      .filter((certificate: AcmeCertificate) => {
        return !ownedDomains.has(certificate.domain as string);
      })
      .slice(0, GreenlockUtil.REMOVE_UNOWNED_MAX_PER_RUN);

    let removedCount: number = 0;

    for (const certificate of abandoned) {
      logger.debug(
        `Deleting the certificate of ${certificate.domain}: it expired on ${certificate.expiresAt?.toISOString()} and no status page, dashboard or primary host claims it.`,
        { domain: certificate.domain } as LogAttributes,
      );

      const deletedCount: number = await AcmeCertificateService.hardDeleteBy({
        query: {
          _id: certificate.id!.toString(),
          domain: certificate.domain as string,
          expiresAt: QueryHelper.lessThan(expiredBefore),
        },
        limit: 1,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      removedCount += deletedCount;
    }

    return removedCount;
  }

  /*
   * Renew one domain. Never throws: one domain that cannot be renewed - a CNAME
   * that no longer points here, a challenge the CA would not accept - must not
   * take down the rest of the run with it.
   */
  private static async renewCertForDomain(data: {
    domain: string;
    validateCname: (domain: string) => Promise<boolean>;
    notifyDomainRemoved: (domain: string) => Promise<void>;
  }): Promise<void> {
    const { domain } = data;

    const certLogAttributes: LogAttributes = {
      domain: domain,
    };

    logger.debug(
      `Renewing certificate for domain: ${domain}`,
      certLogAttributes,
    );

    try {
      //validate cname
      const isValidCname: boolean = await data.validateCname(domain);

      if (!isValidCname) {
        logger.debug(
          `CNAME is not valid for domain: ${domain}`,
          certLogAttributes,
        );

        // if cname is not valid then remove the domain
        await GreenlockUtil.removeDomain(domain);
        await data.notifyDomainRemoved(domain);

        logger.error(
          `Cname is not valid for domain: ${domain}`,
          certLogAttributes,
        );
      } else {
        logger.debug(`CNAME is valid for domain: ${domain}`, certLogAttributes);

        await GreenlockUtil.orderCert({
          domain: domain,
          validateCname: data.validateCname,
        });

        logger.debug(
          `Certificate renewed for domain: ${domain}`,
          certLogAttributes,
        );
      }
    } catch (e) {
      logger.error(
        `Error renewing certificate for domain: ${domain}`,
        certLogAttributes,
      );
      logger.error(e, certLogAttributes);
    }
  }

  @CaptureSpan()
  public static async removeDomain(domain: string): Promise<void> {
    try {
      // remove certificate for this domain.
      await AcmeCertificateService.deleteBy({
        query: {
          domain: domain,
        },
        limit: 1,
        skip: 0,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      logger.error(`Error removing domain: ${domain}`, { domain });
      throw err;
    }
  }

  @CaptureSpan()
  public static async orderCert(data: {
    domain: string;
    validateCname: (domain: string) => Promise<boolean>;
    /*
     * Whether a failed CNAME check removes the name's certificate before
     * the order is refused. True unless a caller says otherwise: renewal
     * relies on it. A caller ordering for a name that may be serving a
     * certificate it means to keep (a reissue) passes false.
     */
    removeCertificateIfCnameIsInvalid?: boolean | undefined;
  }): Promise<void> {
    const orderLogAttributes: LogAttributes = {
      domain: data.domain,
    };

    try {
      logger.debug(
        `GreenlockUtil - Ordering certificate for domain: ${data.domain}`,
        orderLogAttributes,
      );

      let { domain } = data;

      domain = domain.trim().toLowerCase();
      orderLogAttributes["domain"] = domain;

      const acmeAccountKeyInBase64: string = LetsEncryptAccountKey;

      if (!acmeAccountKeyInBase64) {
        throw new ServerException(
          "No lets encrypt account key found in environment variables. Please add one.",
        );
      }

      let acmeAccountKey: string = Buffer.from(
        acmeAccountKeyInBase64,
        "base64",
      ).toString();

      acmeAccountKey = Text.replaceAll(acmeAccountKey, "\\n", "\n");

      //validate cname

      logger.debug(
        `Validating cname for domain: ${domain}`,
        orderLogAttributes,
      );

      const isValidCname: boolean = await data.validateCname(domain);

      if (!isValidCname) {
        logger.debug(
          `CNAME is not valid for domain: ${domain}`,
          orderLogAttributes,
        );

        if (data.removeCertificateIfCnameIsInvalid !== false) {
          logger.debug(`Removing domain: ${domain}`, orderLogAttributes);
          await GreenlockUtil.removeDomain(domain);
        }

        logger.error(
          `Cname is not valid for domain: ${domain}`,
          orderLogAttributes,
        );
        throw new BadDataException("Cname is not valid for domain " + domain);
      }

      logger.debug(`Cname is valid for domain: ${domain}`, orderLogAttributes);

      const client: acme.Client = new acme.Client({
        directoryUrl: acme.directory.letsencrypt.production,
        accountKey: acmeAccountKey,
      });

      const [certificateKey, certificateRequest] = await acme.crypto.createCsr({
        commonName: domain,
      });

      logger.debug(
        `Ordering certificate for domain: ${domain}`,
        orderLogAttributes,
      );

      const certificate: string = await client.auto({
        csr: certificateRequest,
        email: LetsEncryptNotificationEmail.toString(),
        termsOfServiceAgreed: true,
        challengePriority: ["http-01"], // only http-01 challenge is supported by oneuptime
        challengeCreateFn: async (
          authz: acme.Authorization,
          challenge: Challenge,
          keyAuthorization: string,
        ) => {
          // Satisfy challenge here
          /* http-01 */
          if (challenge.type === "http-01") {
            logger.debug(
              `Creating challenge for domain: ${authz.identifier.value}`,
              orderLogAttributes,
            );

            const acmeChallenge: AcmeChallenge = new AcmeChallenge();
            acmeChallenge.challenge = keyAuthorization;
            acmeChallenge.token = challenge.token;
            acmeChallenge.domain = authz.identifier.value;

            await AcmeChallengeService.create({
              data: acmeChallenge,
              props: {
                isRoot: true,
              },
            });

            logger.debug(
              `Challenge created for domain: ${authz.identifier.value}`,
              orderLogAttributes,
            );
          }
        },
        challengeRemoveFn: async (
          authz: acme.Authorization,
          challenge: Challenge,
        ) => {
          // Clean up challenge here

          logger.debug(
            `Removing challenge for domain: ${authz.identifier.value}`,
            orderLogAttributes,
          );

          if (challenge.type === "http-01") {
            await AcmeChallengeService.deleteBy({
              query: {
                domain: authz.identifier.value,
              },
              limit: 1,
              skip: 0,
              props: {
                isRoot: true,
              },
            });
          }

          logger.debug(
            `Challenge removed for domain: ${authz.identifier.value}`,
            orderLogAttributes,
          );
        },
      });

      logger.debug(
        `Certificate ordered for domain: ${domain}`,
        orderLogAttributes,
      );

      // get expires at date from certificate
      const cert: acme.CertificateInfo =
        acme.crypto.readCertificateInfo(certificate);
      const issuedAt: Date = cert.notBefore;
      const expiresAt: Date = cert.notAfter;

      logger.debug(`Certificate expires at: ${expiresAt}`, orderLogAttributes);
      logger.debug(`Certificate issued at: ${issuedAt}`, orderLogAttributes);

      // check if the certificate is already in the database.
      const existingCertificate: AcmeCertificate | null =
        await AcmeCertificateService.findOneBy({
          query: {
            domain: domain,
          },
          select: {
            _id: true,
          },
          props: {
            isRoot: true,
          },
        });

      /*
       * The row can be removed between the look-up above and this write (a
       * domain deleted meanwhile, or the cleanup of expired certificates
       * nobody owned). Then the update finds nothing, and the certificate
       * the CA has just issued is stored in a new row instead of being lost.
       */
      const updatedCount: number = existingCertificate
        ? await AcmeCertificateService.updateBy({
            query: {
              domain: domain,
            },
            limit: 1,
            skip: 0,
            data: {
              certificate: certificate.toString(),
              certificateKey: certificateKey.toString(),
              issuedAt: issuedAt,
              expiresAt: expiresAt,
            },
            props: {
              isRoot: true,
            },
          })
        : 0;

      if (updatedCount > 0) {
        logger.debug(
          `Certificate updated for domain: ${domain}`,
          orderLogAttributes,
        );
      } else {
        logger.debug(
          `Creating certificate for domain: ${domain}`,
          orderLogAttributes,
        );
        // create the certificate
        const acmeCertificate: AcmeCertificate = new AcmeCertificate();

        acmeCertificate.domain = domain;
        acmeCertificate.certificate = certificate.toString();
        acmeCertificate.certificateKey = certificateKey.toString();
        acmeCertificate.issuedAt = issuedAt;
        acmeCertificate.expiresAt = expiresAt;

        await AcmeCertificateService.create({
          data: acmeCertificate,
          props: {
            isRoot: true,
          },
        });

        logger.debug(
          `Certificate created for domain: ${domain}`,
          orderLogAttributes,
        );
      }
    } catch (e) {
      logger.error(
        `Error ordering certificate for domain: ${data.domain}`,
        orderLogAttributes,
      );
      logger.error(e, orderLogAttributes);

      if (e instanceof Exception) {
        throw e;
      }

      if (IsBillingEnabled) {
        throw new ServerException(
          `Unable to order certificate for ${data.domain}. Please contact support at support@oneuptime.com for more information.`,
        );
      } else {
        throw new ServerException(
          `Unable to order certificate for ${data.domain}. Please make sure that your server can be accessed publicly over port 80 (HTTP) and port 443 (HTTPS). If the problem persists, please refer to server logs for more information. Please also set up LOG_LEVEL=DEBUG to get more detailed server logs.`,
        );
      }
    }
  }
}
