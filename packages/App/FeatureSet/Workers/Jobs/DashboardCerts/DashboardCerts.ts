import RunCron from "../../Utils/Cron";
import { EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
import { DashboardCNameRecord } from "Common/Server/EnvironmentConfig";
import DashboardDomainService from "Common/Server/Services/DashboardDomainService";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";

/*
 * Certificates for dashboard custom domains, the twin of StatusPageCerts.
 *
 * Until this file existed none of this ran for dashboards. A dashboard domain
 * was only verified and ordered when someone pressed the buttons, nothing
 * ever marked its certificate as provisioned, and nothing renewed it - worse,
 * the status page renewal job deleted it once it came due, because the status
 * page job took every certificate in the shared AcmeCertificate table for one
 * of its own. The buttons are gone now: a domain's Check now orders its
 * certificate the moment it finds the record, and these jobs do the rest on
 * their own.
 *
 * Every job runs every 15 minutes, like the status page ones, and every
 * job that orders certificates - renewals included - orders at most
 * DashboardDomainService.ORDER_MAX_PER_RUN per run, because each order
 * spends from the Let's Encrypt account the whole installation shares.
 *
 * DASHBOARD_CNAME_RECORD is the switch for dashboard custom domains: without
 * it the Custom Domains API refuses to verify or order anything, so these
 * jobs do nothing either.
 */

const DASHBOARD_CERTS_JOB_NAMES: {
  VerifyCname: string;
  OrderSsl: string;
  CheckOrderStatus: string;
  CheckSslProvisioningStatus: string;
  RenewCerts: string;
} = {
  VerifyCname: "DashboardCerts:VerifyCnameWhoseCnameisNotVerified",
  OrderSsl: "DashboardCerts:OrderSSL",
  CheckOrderStatus: "DashboardCerts:CheckOrderStatus",
  CheckSslProvisioningStatus: "DashboardCerts:CheckSslProvisioningStatus",
  RenewCerts: "DashboardCerts:RenewCerts",
};

type DashboardCertsJobFunction = () => Promise<void>;

type RunWhenCustomDomainsAreOnFunction = (
  jobName: string,
  job: DashboardCertsJobFunction,
) => DashboardCertsJobFunction;

const runWhenCustomDomainsAreOn: RunWhenCustomDomainsAreOnFunction = (
  jobName: string,
  job: DashboardCertsJobFunction,
): DashboardCertsJobFunction => {
  return async (): Promise<void> => {
    if (!DashboardCNameRecord) {
      logger.debug(
        `${jobName}: DASHBOARD_CNAME_RECORD is not set, so dashboard custom domains are off on this installation. Skipping.`,
        { service: "workers" },
      );
      return;
    }

    await job();
  };
};

/*
 * Verifies the domains whose CNAME record is not verified yet, and orders
 * the free certificate of each one verified in this run straight away
 * (DashboardDomainService.ORDER_MAX_PER_RUN at most), so a domain is on its
 * own certificate within about 15 minutes of its record going live whether
 * or not anyone clicked Check now. An order can take a while, hence a
 * timeout of its own.
 */
RunCron(
  DASHBOARD_CERTS_JOB_NAMES.VerifyCname,
  {
    schedule: EVERY_FIFTEEN_MINUTE,
    runOnStartup: false,
    // An HTTP, an HTTPS and a DNS lookup per domain, then the orders.
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(30),
  },
  runWhenCustomDomainsAreOn(
    DASHBOARD_CERTS_JOB_NAMES.VerifyCname,
    async (): Promise<void> => {
      await DashboardDomainService.verifyCnameWhoseCnameisNotVerified();
    },
  ),
);

/*
 * Orders the first certificate of every verified domain still without one,
 * DashboardDomainService.ORDER_MAX_PER_RUN at most: the fallback for a
 * domain whose order at Check now, or in the verification run, failed.
 */
RunCron(
  DASHBOARD_CERTS_JOB_NAMES.OrderSsl,
  {
    schedule: EVERY_FIFTEEN_MINUTE,
    runOnStartup: false,
    // Ordering can involve domain validation challenges and upstream rate limits.
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(30),
  },
  runWhenCustomDomainsAreOn(
    DASHBOARD_CERTS_JOB_NAMES.OrderSsl,
    async (): Promise<void> => {
      await DashboardDomainService.orderSSLForDomainsWhichAreNotOrderedYet();
    },
  ),
);

/*
 * Re-orders the certificate of a domain that is marked ordered but whose
 * certificate is gone. This is what repairs the dashboard domains whose
 * certificates the status page renewal job deleted before it checked
 * ownership.
 */
RunCron(
  DASHBOARD_CERTS_JOB_NAMES.CheckOrderStatus,
  {
    schedule: EVERY_FIFTEEN_MINUTE,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(30),
  },
  runWhenCustomDomainsAreOn(
    DASHBOARD_CERTS_JOB_NAMES.CheckOrderStatus,
    async (): Promise<void> => {
      await DashboardDomainService.checkOrderStatus();
    },
  ),
);

// Marks a certificate provisioned once the domain serves it over HTTPS.
RunCron(
  DASHBOARD_CERTS_JOB_NAMES.CheckSslProvisioningStatus,
  {
    schedule: EVERY_FIFTEEN_MINUTE,
    runOnStartup: false,
    // One HTTPS request out to every ordered domain, plus a CNAME check on failure.
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(30),
  },
  runWhenCustomDomainsAreOn(
    DASHBOARD_CERTS_JOB_NAMES.CheckSslProvisioningStatus,
    async (): Promise<void> => {
      await DashboardDomainService.updateSslProvisioningStatusForAllDomains();
    },
  ),
);

/*
 * Renews dashboard certificates before they expire. Renews and removes only
 * certificates of dashboard domains: status page and primary host
 * certificates are left to their own jobs.
 */
RunCron(
  DASHBOARD_CERTS_JOB_NAMES.RenewCerts,
  {
    schedule: EVERY_FIFTEEN_MINUTE,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(15),
  },
  runWhenCustomDomainsAreOn(
    DASHBOARD_CERTS_JOB_NAMES.RenewCerts,
    async (): Promise<void> => {
      await DashboardDomainService.renewCertsWhichAreExpiringSoon();
    },
  ),
);
