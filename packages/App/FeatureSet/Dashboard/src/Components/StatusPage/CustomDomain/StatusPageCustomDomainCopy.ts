import { CustomDomainCertificateStatus } from "Common/Types/StatusPage/CustomDomainVerification";
import { CustomDomainCertificate } from "Common/Types/StatusPage/CustomDomainCertificates";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * A status page's Custom Domains page (Status Pages -> a page -> Branding ->
 * Custom Domains), and the DNS Setup dialog it opens.
 *
 * Putting a status page on your own domain used to take four actions in two
 * places: verify the domain in Project Settings, add the custom domain in two
 * steps, find "Add CNAME" (which added nothing - it showed the record and
 * had a Verify CNAME button), then find "Order Free SSL" while the Status
 * column said "Action Required: Please order SSL certificate." - for an
 * order the 15-minute worker placed on its own anyway.
 *
 * Now the domain is added in one step, from the domains the project has
 * verified, and the DNS Setup dialog opens on the new domain with the record
 * to add. Check now verifies it, and the free certificate is ordered the
 * moment the record is found; without a click the 15-minute sweeps do both.
 * Nothing on the page asks anyone to order a certificate.
 *
 * What the domain row cannot say - the certificate's expiry, and why the
 * last order failed - comes from the certificates route
 * (CustomDomainCertificates). With it the Status column says when an order
 * keeps failing, and why, where it used to say "Issuing" for good; when a
 * certificate has expired; and when a renewal failed.
 *
 * Kept free of React so the page, the dialog and App/Tests read these exact
 * strings. Every sentence is wrapped in translationKey() so
 * npm run i18n:extract finds it, and is translated in all seventeen
 * Dashboard locale files.
 */

// Where a custom domain is on its way to being served over HTTPS.
export enum StatusPageCustomDomainState {
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

export interface StatusPageCustomDomainStateInput {
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
export const getStatusPageCustomDomainState: (
  domain: StatusPageCustomDomainStateInput,
  certificate?: CustomDomainCertificate | undefined,
  now?: Date | undefined,
) => StatusPageCustomDomainState = (
  domain: StatusPageCustomDomainStateInput,
  certificate?: CustomDomainCertificate | undefined,
  now?: Date | undefined,
): StatusPageCustomDomainState => {
  if (!domain.isCnameVerified) {
    return StatusPageCustomDomainState.WaitingForDns;
  }

  if (domain.isCustomCertificate) {
    return StatusPageCustomDomainState.UsesUploadedCertificate;
  }

  if (certificate) {
    const expiresAt: Date | undefined = certificate.expiresAt;

    if (expiresAt && expiresAt.getTime() <= (now || new Date()).getTime()) {
      return StatusPageCustomDomainState.CertificateExpired;
    }

    if (!expiresAt && certificate.lastOrderError) {
      return StatusPageCustomDomainState.CertificateFailed;
    }

    if (expiresAt && certificate.lastOrderError && domain.isSslProvisioned) {
      return StatusPageCustomDomainState.RenewalFailed;
    }
  }

  /*
   * Ordered or not, the owner has nothing to do: the order happens on its
   * own, and an ordered certificate is served within 15 minutes, when nginx
   * next writes certificates to disk. "Usually" because with a backlog the
   * capped order sweeps can take a run or two longer.
   */
  if (!domain.isSslProvisioned) {
    return StatusPageCustomDomainState.IssuingCertificate;
  }

  return StatusPageCustomDomainState.CertificateIssued;
};

/*
 * The reason the last order failed, to show under the state, for the states
 * that are about a failure.
 */
export const getStatusPageCustomDomainCertificateError: (
  state: StatusPageCustomDomainState,
  certificate?: CustomDomainCertificate | undefined,
) => string | undefined = (
  state: StatusPageCustomDomainState,
  certificate?: CustomDomainCertificate | undefined,
): string | undefined => {
  if (
    state !== StatusPageCustomDomainState.CertificateFailed &&
    state !== StatusPageCustomDomainState.CertificateExpired &&
    state !== StatusPageCustomDomainState.RenewalFailed
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
export const isStatusPageCustomDomainDnsSetupAvailable: (
  domain: StatusPageCustomDomainStateInput,
  certificate?: CustomDomainCertificate | undefined,
  now?: Date | undefined,
) => boolean = (
  domain: StatusPageCustomDomainStateInput,
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

  const state: StatusPageCustomDomainState = getStatusPageCustomDomainState(
    domain,
    certificate,
    now,
  );

  return (
    state === StatusPageCustomDomainState.CertificateFailed ||
    state === StatusPageCustomDomainState.CertificateExpired
  );
};

// The Status column, one whole sentence per state.
export const STATUS_PAGE_CUSTOM_DOMAIN_STATUS: Record<
  StatusPageCustomDomainState,
  string
> = {
  [StatusPageCustomDomainState.WaitingForDns]: translationKey(
    "Waiting for DNS: add the CNAME record.",
  ),
  [StatusPageCustomDomainState.UsesUploadedCertificate]: translationKey(
    "Uses your uploaded certificate.",
  ),
  [StatusPageCustomDomainState.IssuingCertificate]: translationKey(
    "Issuing a free certificate, usually within 15 minutes.",
  ),
  [StatusPageCustomDomainState.CertificateFailed]: translationKey(
    "Could not issue a free certificate yet. We keep trying.",
  ),
  [StatusPageCustomDomainState.CertificateExpired]: translationKey(
    "Certificate expired. We keep trying to renew it.",
  ),
  [StatusPageCustomDomainState.CertificateIssued]: translationKey(
    "Certificate issued, renews automatically.",
  ),
  [StatusPageCustomDomainState.RenewalFailed]: translationKey(
    "Certificate issued, but renewing it failed. We keep trying.",
  ),
};

/*
 * What the DNS Setup dialog says once Check now has found the record, by
 * what happens to the domain's certificate next.
 */
export const STATUS_PAGE_CUSTOM_DOMAIN_VERIFIED_NEXT: Record<
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
   * "We keep trying" rather than a timing: a domain whose orders keep
   * failing is ordered less and less often (CertificateOrderFailures), so
   * one order of a failing name does not cost the whole installation an
   * order every 15 minutes.
   */
  [CustomDomainCertificateStatus.Failed]: translationKey(
    "We could not issue a free SSL certificate for {{domain}} yet. We keep trying automatically.",
  ),
};

export const StatusPageCustomDomainCopy: {
  cardDescription: string;
  // Card description where the installation has no status page CNAME record.
  cardDescriptionNotEnabled: string;
  domainFieldDescription: string;
  domainFieldSideLink: string;
  // Under the folded Advanced section's title.
  advancedSummaryFreeCertificate: string;
  advancedSummaryUploadedCertificate: string;
  dnsSetupTitle: string;
  dnsSetupIntro: string;
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
  dnsSetupNotEnabled: string;
} = {
  cardDescription: translationKey(
    "Serve this status page on your own domain. Point each domain's CNAME record to {{cnameRecord}}, and we issue its SSL certificate and renew it for you.",
  ),
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
  dnsSetupIntro: translationKey(
    "Add this record at your DNS provider to point {{domain}} to your status page.",
  ),
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
  dnsSetupNotEnabled: translationKey(
    "Custom Domains not enabled for this OneUptime installation. Please contact your server admin to enable this feature. To enable this feature, if you are using Docker compose, the {{variable}} environment variable must be set when starting the OneUptime cluster. If you are using Helm and Kubernetes then set statusPage.cnameRecord in the values.yaml file.",
  ),
};

// The DNS record type a custom domain needs. Not translated: it is DNS.
export const STATUS_PAGE_CUSTOM_DOMAIN_RECORD_TYPE: string = "CNAME";

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
