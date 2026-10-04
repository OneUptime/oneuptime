import { CustomDomainCertificateStatus } from "Common/Types/CustomDomain/CustomDomainVerification";
import { CustomDomainCertificate } from "Common/Types/CustomDomain/CustomDomainCertificates";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The Custom Domains pages - a status page's (Status Pages -> a page ->
 * Branding -> Custom Domains) and a dashboard's (Dashboards -> a dashboard ->
 * Branding -> Custom Domains) - and the DNS Setup dialog they open. Both are
 * one table (CustomDomainsTable), so the same job reads and works the same
 * on both.
 *
 * Putting a status page on your own domain used to take four actions in two
 * places: verify the domain in Project Settings, add the custom domain in two
 * steps, find "Add CNAME" (which added nothing - it showed the record and
 * had a Verify CNAME button), then find "Order Free SSL" while the Status
 * column said "Action Required: Please order SSL certificate." - for an
 * order the 15-minute worker placed on its own anyway. Dashboards kept that
 * flow, and their own wording, after status pages lost it.
 *
 * Now the domain is added in one step, from the domains the project has
 * verified, and the DNS Setup dialog opens on the new domain with the record
 * to add. Check now verifies it, and the free certificate is ordered the
 * moment the record is found; without a click the 15-minute sweeps do both.
 * Nothing on either page asks anyone to order a certificate.
 *
 * What the domain row cannot say - the certificate's expiry, and why the
 * last order failed - comes from the certificates route
 * (CustomDomainCertificates). With it the Status column says when an order
 * keeps failing, and why, where it used to say "Issuing" for good; when a
 * certificate has expired; and when a renewal failed.
 *
 * Kept free of React - and of Common/UI/Config - so the pages, the dialog
 * and App/Tests read these exact strings. Every sentence is wrapped in
 * translationKey() so npm run i18n:extract finds it, and is translated in
 * the Dashboard locale files.
 */

// Where a custom domain is on its way to being served over HTTPS.
export enum CustomDomainState {
  // The CNAME record is not found yet: the one step only its owner can take.
  WaitingForDns = "WaitingForDns",
  // Verified, and served with the certificate its owner uploaded.
  UsesUploadedCertificate = "UsesUploadedCertificate",
  // Verified; the free certificate is being ordered or written out.
  IssuingCertificate = "IssuingCertificate",
  // Verified, no certificate yet, and the last order failed.
  CertificateFailed = "CertificateFailed",
  // Its certificate has expired: its renewals have been failing.
  CertificateExpired = "CertificateExpired",
  // The domain serves its free certificate, which renews on its own.
  CertificateIssued = "CertificateIssued",
  // It serves its free certificate, but the last renewal failed.
  RenewalFailed = "RenewalFailed",
}

export interface CustomDomainStateInput {
  isCnameVerified?: boolean | undefined;
  isCustomCertificate?: boolean | undefined;
  isSslOrdered?: boolean | undefined;
  isSslProvisioned?: boolean | undefined;
}

/*
 * Where a domain is, from its own row and - when the page has it - its
 * certificate. Without the certificate (not loaded yet, or the request
 * failed) the row alone decides, as it always did.
 */
export const getCustomDomainState: (
  domain: CustomDomainStateInput,
  certificate?: CustomDomainCertificate | undefined,
  now?: Date | undefined,
) => CustomDomainState = (
  domain: CustomDomainStateInput,
  certificate?: CustomDomainCertificate | undefined,
  now?: Date | undefined,
): CustomDomainState => {
  if (!domain.isCnameVerified) {
    return CustomDomainState.WaitingForDns;
  }

  if (domain.isCustomCertificate) {
    return CustomDomainState.UsesUploadedCertificate;
  }

  if (certificate) {
    const expiresAt: Date | undefined = certificate.expiresAt;

    /*
     * No certificate in the table: nothing is issued, whatever the
     * provisioning flag last said - "Certificate issued" is only ever for a
     * certificate that exists and has not expired.
     */
    if (!expiresAt) {
      return certificate.lastOrderError
        ? CustomDomainState.CertificateFailed
        : CustomDomainState.IssuingCertificate;
    }

    if (expiresAt.getTime() <= (now || new Date()).getTime()) {
      return CustomDomainState.CertificateExpired;
    }

    if (certificate.lastOrderError && domain.isSslProvisioned) {
      return CustomDomainState.RenewalFailed;
    }
  }

  /*
   * Ordered or not, the owner has nothing to do: the order happens on its
   * own, and an ordered certificate is served within 15 minutes, when nginx
   * next writes certificates to disk. "Usually" because with a backlog the
   * capped order sweeps can take a run or two longer.
   */
  if (!domain.isSslProvisioned) {
    return CustomDomainState.IssuingCertificate;
  }

  return CustomDomainState.CertificateIssued;
};

/*
 * The reason the last order failed, to show under the state, for the states
 * that are about a failure.
 */
export const getCustomDomainCertificateError: (
  state: CustomDomainState,
  certificate?: CustomDomainCertificate | undefined,
) => string | undefined = (
  state: CustomDomainState,
  certificate?: CustomDomainCertificate | undefined,
): string | undefined => {
  if (
    state !== CustomDomainState.CertificateFailed &&
    state !== CustomDomainState.CertificateExpired &&
    state !== CustomDomainState.RenewalFailed
  ) {
    return undefined;
  }

  return certificate?.lastOrderError || undefined;
};

/*
 * Whether the domain's row offers DNS Setup, the dialog whose Check now
 * verifies the record and orders the certificate: until the record is
 * verified, and on a domain whose free certificate is not in place - not
 * ordered yet, an order that keeps failing, or one that has expired.
 */
export const isCustomDomainDnsSetupAvailable: (
  domain: CustomDomainStateInput,
  certificate?: CustomDomainCertificate | undefined,
  now?: Date | undefined,
) => boolean = (
  domain: CustomDomainStateInput,
  certificate?: CustomDomainCertificate | undefined,
  now?: Date | undefined,
): boolean => {
  if (!domain.isCnameVerified) {
    return true;
  }

  if (domain.isCustomCertificate) {
    return false;
  }

  if (!domain.isSslOrdered) {
    return true;
  }

  const state: CustomDomainState = getCustomDomainState(
    domain,
    certificate,
    now,
  );

  return (
    state === CustomDomainState.CertificateFailed ||
    state === CustomDomainState.CertificateExpired
  );
};

// The Status column, one whole sentence per state.
export const CUSTOM_DOMAIN_STATUS: Record<CustomDomainState, string> = {
  [CustomDomainState.WaitingForDns]: translationKey(
    "Waiting for DNS: add the CNAME record.",
  ),
  [CustomDomainState.UsesUploadedCertificate]: translationKey(
    "Uses your uploaded certificate.",
  ),
  [CustomDomainState.IssuingCertificate]: translationKey(
    "Issuing a free certificate, usually within 15 minutes.",
  ),
  [CustomDomainState.CertificateFailed]: translationKey(
    "Could not issue a free certificate yet. We keep trying.",
  ),
  [CustomDomainState.CertificateExpired]: translationKey(
    "Certificate expired. We keep trying to renew it.",
  ),
  [CustomDomainState.CertificateIssued]: translationKey(
    "Certificate issued, renews automatically.",
  ),
  [CustomDomainState.RenewalFailed]: translationKey(
    "Certificate issued, but renewing it failed. We keep trying.",
  ),
};

/*
 * What the DNS Setup dialog says once Check now has found the record, by
 * what happens to the domain's certificate next.
 */
export const CUSTOM_DOMAIN_VERIFIED_NEXT: Record<
  CustomDomainCertificateStatus,
  string
> = {
  [CustomDomainCertificateStatus.Issuing]: translationKey(
    "We are issuing a free SSL certificate for {{domain}}. It is usually live within 15 minutes.",
  ),
  [CustomDomainCertificateStatus.Issued]: translationKey(
    "{{domain}} already has its free SSL certificate, and we renew it automatically.",
  ),
  [CustomDomainCertificateStatus.Uploaded]: translationKey(
    "{{domain}} is served with the certificate you uploaded.",
  ),
  /*
   * "We keep trying" rather than a timing: the order of a domain that keeps
   * failing is retried less and less often (CertificateOrderFailures), so
   * that one failing domain does not spend an order of the installation's
   * shared Let's Encrypt account every 15 minutes.
   */
  [CustomDomainCertificateStatus.Failed]: translationKey(
    "We could not issue a free SSL certificate for {{domain}} yet. We keep trying automatically.",
  ),
};

// What every kind of custom domain says alike.
export const CustomDomainCopy: {
  // Where the installation has no CNAME record for this kind of domain.
  cardDescriptionNotEnabled: string;
  domainFieldDescription: string;
  domainFieldSideLink: string;
  // Under the folded Advanced section's title.
  advancedSummaryFreeCertificate: string;
  advancedSummaryUploadedCertificate: string;
  dnsSetupTitle: string;
  dnsSetupRecordType: string;
  dnsSetupRecordName: string;
  dnsSetupRecordValue: string;
  dnsSetupCopyRecordType: string;
  dnsSetupCopyRecordName: string;
  dnsSetupCopyRecordValue: string;
  dnsSetupRootDomain: string;
  dnsSetupWhatHappensNext: string;
  dnsSetupWhatHappensNextUploaded: string;
  // DNS Setup on a verified domain whose free certificate is not issued yet.
  dnsSetupVerifiedNotIssued: string;
  // DNS Setup on a verified domain whose free certificate has expired.
  dnsSetupVerifiedExpired: string;
  dnsSetupCheckNow: string;
  dnsSetupClose: string;
  dnsSetupDone: string;
  dnsSetupVerified: string;
  // The Reissue SSL dialog's second paragraph.
  reissueRateLimit: string;
} = {
  cardDescriptionNotEnabled: translationKey(
    "Custom Domains not enabled for this OneUptime installation. Please contact your server admin to enable this feature.",
  ),
  domainFieldDescription: translationKey(
    "Only domains verified in Project Settings → Domains are listed.",
  ),
  domainFieldSideLink: translationKey("Add a domain"),
  advancedSummaryFreeCertificate: translationKey(
    "We issue a free SSL certificate for this domain and renew it automatically.",
  ),
  advancedSummaryUploadedCertificate: translationKey(
    "Uses the certificate you upload.",
  ),
  dnsSetupTitle: translationKey("DNS Setup"),
  dnsSetupRecordType: translationKey("Type"),
  dnsSetupRecordName: translationKey("Name"),
  dnsSetupRecordValue: translationKey("Value"),
  dnsSetupCopyRecordType: translationKey("Copy record type"),
  dnsSetupCopyRecordName: translationKey("Copy record name"),
  dnsSetupCopyRecordValue: translationKey("Copy record value"),
  dnsSetupRootDomain: translationKey(
    "This is a root domain. If your DNS provider does not allow a CNAME record on it, add an ALIAS, ANAME or flattened CNAME record with the same value instead.",
  ),
  dnsSetupWhatHappensNext: translationKey(
    "We check for this record every 15 minutes, and once it is live we issue a free SSL certificate for this domain. Added it already? Click Check now.",
  ),
  dnsSetupWhatHappensNextUploaded: translationKey(
    "We check for this record every 15 minutes, and once it is live we serve this domain with the certificate you uploaded. Added it already? Click Check now.",
  ),
  dnsSetupVerifiedNotIssued: translationKey(
    "Your CNAME record is verified, but the free SSL certificate for this domain is not issued yet. Click Check now to try again and see why.",
  ),
  dnsSetupVerifiedExpired: translationKey(
    "Your CNAME record is verified, but the free SSL certificate for this domain has expired. Click Check now to try again and see why.",
  ),
  dnsSetupCheckNow: translationKey("Check now"),
  dnsSetupClose: translationKey("Close"),
  dnsSetupDone: translationKey("Done"),
  dnsSetupVerified: translationKey("Your CNAME record is verified."),
  reissueRateLimit: translationKey(
    "Certificates renew automatically well before they expire, so you do not need to do this to stay online. Because Let's Encrypt rate limits how often the same domain can be issued, a reissue can only be requested once every {{hours}} hours.",
  ),
};

/*
 * What one kind of custom domain says in words of its own: what its domains
 * point to, what its subdomain usually is, and where its CNAME record is
 * set on a self-hosted installation.
 */
export interface CustomDomainKindCopy {
  // The card's description, with {{cnameRecord}}.
  cardDescription: string;
  // DNS Setup's first sentence, with {{domain}}.
  dnsSetupIntro: string;
  // DNS Setup where the installation has no CNAME record, with {{variable}}.
  dnsSetupNotEnabled: string;
  subdomainPlaceholder: string;
  subdomainDescription: string;
  reissueTitle: string;
  reissueDescription: string;
}

export const STATUS_PAGE_CUSTOM_DOMAIN_COPY: CustomDomainKindCopy = {
  cardDescription: translationKey(
    "Serve this status page on your own domain. Point each domain's CNAME record to {{cnameRecord}}, and we issue its SSL certificate and renew it for you.",
  ),
  dnsSetupIntro: translationKey(
    "Add this record at your DNS provider to point {{domain}} to your status page.",
  ),
  dnsSetupNotEnabled: translationKey(
    "Custom Domains not enabled for this OneUptime installation. Please contact your server admin to enable this feature. To enable this feature, if you are using Docker compose, the {{variable}} environment variable must be set when starting the OneUptime cluster. If you are using Helm and Kubernetes then set statusPage.cnameRecord in the values.yaml file.",
  ),
  subdomainPlaceholder: translationKey("status (leave blank for root)"),
  subdomainDescription: translationKey(
    "Enter the subdomain label only (for example, status). Leave blank or enter @ to use the root/apex domain.",
  ),
  reissueTitle: translationKey("Reissue SSL Certificate for this Status Page"),
  reissueDescription: translationKey(
    "We will ask Let's Encrypt for a brand new certificate for this domain, and replace the one we currently serve with it. Your status page stays online on the existing certificate while this happens, and the new certificate is served within 15 minutes.",
  ),
};

export const DASHBOARD_CUSTOM_DOMAIN_COPY: CustomDomainKindCopy = {
  cardDescription: translationKey(
    "Serve this dashboard on your own domain. Point each domain's CNAME record to {{cnameRecord}}, and we issue its SSL certificate and renew it for you.",
  ),
  dnsSetupIntro: translationKey(
    "Add this record at your DNS provider to point {{domain}} to your dashboard.",
  ),
  dnsSetupNotEnabled: translationKey(
    "Custom Domains not enabled for this OneUptime installation. Please contact your server admin to enable this feature. To enable this feature, if you are using Docker compose, the {{variable}} environment variable must be set when starting the OneUptime cluster. If you are using Helm and Kubernetes then set dashboard.cnameRecord in the values.yaml file.",
  ),
  subdomainPlaceholder: translationKey("dashboard (leave blank for root)"),
  subdomainDescription: translationKey(
    "Enter the subdomain label only (for example, dashboard). Leave blank or enter @ to use the root/apex domain.",
  ),
  reissueTitle: translationKey("Reissue SSL Certificate for this Dashboard"),
  reissueDescription: translationKey(
    "We will ask Let's Encrypt for a brand new certificate for this domain, and replace the one we currently serve with it. Your dashboard stays online on the existing certificate while this happens, and the new certificate is served within 15 minutes.",
  ),
};

// The DNS record type a custom domain needs. Not translated: it is DNS.
export const CUSTOM_DOMAIN_RECORD_TYPE: string = "CNAME";

// data-testids of the DNS Setup dialog.
export const DNS_SETUP_TEST_IDS: {
  record: string;
  recordType: string;
  recordName: string;
  recordValue: string;
  rootDomainNote: string;
  whatHappensNext: string;
  verified: string;
  certificateError: string;
} = {
  record: "dns-setup-record",
  recordType: "dns-setup-record-type",
  recordName: "dns-setup-record-name",
  recordValue: "dns-setup-record-value",
  rootDomainNote: "dns-setup-root-domain",
  whatHappensNext: "dns-setup-what-happens-next",
  verified: "dns-setup-verified",
  certificateError: "dns-setup-certificate-error",
};

// data-testids of the Status column.
export const STATUS_TEST_IDS: {
  status: string;
  certificateError: string;
} = {
  status: "custom-domain-status",
  certificateError: "custom-domain-status-certificate-error",
};
