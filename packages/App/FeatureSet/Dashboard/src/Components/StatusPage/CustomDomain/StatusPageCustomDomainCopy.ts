import { CustomDomainCertificateStatus } from "Common/Types/StatusPage/CustomDomainVerification";
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
  // The domain serves its free certificate, which renews on its own.
  CertificateIssued = "CertificateIssued",
}

export interface StatusPageCustomDomainStateInput {
  isCnameVerified?: boolean | undefined;
  isCustomCertificate?: boolean | undefined;
  isSslProvisioned?: boolean | undefined;
}

export const getStatusPageCustomDomainState: (
  domain: StatusPageCustomDomainStateInput,
) => StatusPageCustomDomainState = (
  domain: StatusPageCustomDomainStateInput,
): StatusPageCustomDomainState => {
  if (!domain.isCnameVerified) {
    return StatusPageCustomDomainState.WaitingForDns;
  }

  if (domain.isCustomCertificate) {
    return StatusPageCustomDomainState.UsesUploadedCertificate;
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
  [StatusPageCustomDomainState.CertificateIssued]: translationKey(
    "Certificate issued, renews automatically.",
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
  [CustomDomainCertificateStatus.Failed]: translationKey(
    "We could not issue a free SSL certificate for {{domain}} yet. We try again every 15 minutes, so there is nothing else to do here.",
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
  verified: string;
  certificateError: string;
} = {
  record: "dns-setup-record",
  recordType: "dns-setup-record-type",
  recordName: "dns-setup-record-name",
  recordValue: "dns-setup-record-value",
  rootDomainNote: "dns-setup-root-domain",
  verified: "dns-setup-verified",
  certificateError: "dns-setup-certificate-error",
};
