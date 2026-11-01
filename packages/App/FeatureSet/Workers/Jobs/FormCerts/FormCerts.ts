import RunCron from "../../Utils/Cron";
import { EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
import { FormCNameRecord } from "Common/Server/EnvironmentConfig";
import FormDomainService from "Common/Server/Services/FormDomainService";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";

/*
 * Certificates for a form's own domains (FormDomain), the twin of
 * StatusPageCerts and DashboardCerts, step for step: a form's domain is
 * verified, ordered, provisioned and renewed exactly as theirs are, from the
 * same shared Let's Encrypt allowance.
 *
 * Every job runs every 15 minutes, and every job that orders certificates -
 * renewals included - orders at most FormDomainService.ORDER_MAX_PER_RUN per
 * run, because each order spends from the Let's Encrypt account the whole
 * installation shares.
 *
 * FormCNameRecord - FORM_CNAME_RECORD, else the status page CNAME record:
 * one ingress serves every custom domain - is the switch for forms on custom
 * domains: without it the Custom Domains API refuses to verify or order
 * anything, so these jobs do nothing either.
 */

const FORM_CERTS_JOB_NAMES: {
  VerifyCname: string;
  OrderSsl: string;
  CheckOrderStatus: string;
  CheckSslProvisioningStatus: string;
  RenewCerts: string;
} = {
  VerifyCname: "FormCerts:VerifyCnameWhoseCnameisNotVerified",
  OrderSsl: "FormCerts:OrderSSL",
  CheckOrderStatus: "FormCerts:CheckOrderStatus",
  CheckSslProvisioningStatus: "FormCerts:CheckSslProvisioningStatus",
  RenewCerts: "FormCerts:RenewCerts",
};

type FormCertsJobFunction = () => Promise<void>;

type RunWhenCustomDomainsAreOnFunction = (
  jobName: string,
  job: FormCertsJobFunction,
) => FormCertsJobFunction;

const runWhenCustomDomainsAreOn: RunWhenCustomDomainsAreOnFunction = (
  jobName: string,
  job: FormCertsJobFunction,
): FormCertsJobFunction => {
  return async (): Promise<void> => {
    if (!FormCNameRecord) {
      logger.debug(
        `${jobName}: neither FORM_CNAME_RECORD nor STATUS_PAGE_CNAME_RECORD is set, so forms on custom domains are off on this installation. Skipping.`,
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
 * (FormDomainService.ORDER_MAX_PER_RUN at most), so a form is on its own
 * domain's certificate within about 15 minutes of the record going live,
 * whether or not anyone clicked Check now.
 */
RunCron(
  FORM_CERTS_JOB_NAMES.VerifyCname,
  {
    schedule: EVERY_FIFTEEN_MINUTE,
    runOnStartup: false,
    // An HTTP, an HTTPS and a DNS lookup per domain, then the orders.
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(30),
  },
  runWhenCustomDomainsAreOn(
    FORM_CERTS_JOB_NAMES.VerifyCname,
    async (): Promise<void> => {
      await FormDomainService.verifyCnameWhoseCnameisNotVerified();
    },
  ),
);

/*
 * Orders the first certificate of every verified domain still without one,
 * FormDomainService.ORDER_MAX_PER_RUN at most: the fallback for a domain
 * whose order at Check now, or in the verification run, failed.
 */
RunCron(
  FORM_CERTS_JOB_NAMES.OrderSsl,
  {
    schedule: EVERY_FIFTEEN_MINUTE,
    runOnStartup: false,
    // Ordering can involve domain validation challenges and upstream rate limits.
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(30),
  },
  runWhenCustomDomainsAreOn(
    FORM_CERTS_JOB_NAMES.OrderSsl,
    async (): Promise<void> => {
      await FormDomainService.orderSSLForDomainsWhichAreNotOrderedYet();
    },
  ),
);

// Re-orders the certificate of a domain marked ordered whose certificate is gone.
RunCron(
  FORM_CERTS_JOB_NAMES.CheckOrderStatus,
  {
    schedule: EVERY_FIFTEEN_MINUTE,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(30),
  },
  runWhenCustomDomainsAreOn(
    FORM_CERTS_JOB_NAMES.CheckOrderStatus,
    async (): Promise<void> => {
      await FormDomainService.checkOrderStatus();
    },
  ),
);

// Marks a certificate provisioned once the domain serves it over HTTPS.
RunCron(
  FORM_CERTS_JOB_NAMES.CheckSslProvisioningStatus,
  {
    schedule: EVERY_FIFTEEN_MINUTE,
    runOnStartup: false,
    // One HTTPS request out to every ordered domain, plus a CNAME check on failure.
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(30),
  },
  runWhenCustomDomainsAreOn(
    FORM_CERTS_JOB_NAMES.CheckSslProvisioningStatus,
    async (): Promise<void> => {
      await FormDomainService.updateSslProvisioningStatusForAllDomains();
    },
  ),
);

/*
 * Renews form domain certificates before they expire. Renews and removes
 * only certificates of form domains: status page, dashboard and primary host
 * certificates are left to their own jobs.
 */
RunCron(
  FORM_CERTS_JOB_NAMES.RenewCerts,
  {
    schedule: EVERY_FIFTEEN_MINUTE,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(15),
  },
  runWhenCustomDomainsAreOn(
    FORM_CERTS_JOB_NAMES.RenewCerts,
    async (): Promise<void> => {
      await FormDomainService.renewCertsWhichAreExpiringSoon();
    },
  ),
);
