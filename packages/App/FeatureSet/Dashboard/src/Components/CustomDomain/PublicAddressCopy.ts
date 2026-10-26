import {
  CUSTOM_DOMAIN_STATUS,
  CustomDomainInstallation,
  CustomDomainState,
  CustomDomainStateInput,
  FREE_CERTIFICATE_INSTALLATION,
  getCustomDomainState,
  isCustomDomainDnsSetupAvailable,
} from "./CustomDomainCopy";
import { CustomDomainCertificate } from "Common/Types/CustomDomain/CustomDomainCertificates";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHERE VISITORS FIND A STATUS PAGE OR A PUBLIC DASHBOARD.
 *
 * A status page's Overview opened on "Status Page Link - Open it to see your
 * status page as visitors do." and one underlined monospace address,
 * https://<OneUptime>/status-page/<id>, with Copy link beside it - whatever
 * custom domains the page had. A page served on status.acme.com showed only
 * the OneUptime address, and nothing on the Overview said whether the
 * domain worked yet. A dashboard's Sharing page drew its public link the
 * same way, under the public choice.
 *
 * Now both list every address the page or dashboard answers at, the same
 * way (PublicAddresses):
 *
 *   - its custom domains first: each one that is live as a link to
 *     https://<domain>, opened in a new tab, with Copy link; each one that
 *     is not live yet without a link, saying so and why, in the words of
 *     the Custom Domains page's Status column - with DNS Setup where there
 *     is something to do, as on that page;
 *   - then the OneUptime address, which always works;
 *   - with no custom domain, one quiet line offering to add one, for whoever
 *     may add one, where the installation has custom domains.
 *
 * A custom domain is live once visitors can open it over HTTPS: its free
 * certificate is issued (a renewal that failed still serves the certificate
 * in place until it expires), or it serves the certificate its owner
 * uploaded. Until then - no CNAME record yet, the certificate still being
 * issued, an order that keeps failing, an expired certificate - opening it
 * shows a browser warning or nothing at all, so it is not offered as a link.
 * On an installation that issues no free certificates, a verified domain is
 * live too: its HTTPS is the installation's own proxy's, and the server
 * links to it the same way (StatusPageService.getUsableCustomDomain).
 *
 * Kept free of React and of the browser's config, so the components and
 * App/Tests read these exact rules and strings. Every string is a whole
 * sentence or name, wrapped in translationKey() so npm run i18n:extract
 * finds it, and translated in all seventeen Dashboard locale files.
 */

export enum PublicAddressKind {
  // One of the page's custom domains, such as status.acme.com.
  CustomDomain = "CustomDomain",
  // The address on OneUptime's own domain, which every page has.
  OneUptime = "OneUptime",
}

// What the list reads of a custom domain's row.
export interface PublicAddressDomainInput extends CustomDomainStateInput {
  fullDomain?: string | undefined;
}

export interface PublicAddress<TDomain extends PublicAddressDomainInput> {
  kind: PublicAddressKind;
  // The address itself: what Copy link copies, and what the link opens.
  url: string;
  /*
   * What the row shows: the host, and the rest of the address after it
   * (drawn quieter), without the scheme.
   */
  host: string;
  path: string;
  // Whether visitors can open it now: only a live address is a link.
  isLive: boolean;
  // A custom domain's: where it is on its way, its row and its certificate.
  state?: CustomDomainState | undefined;
  domain?: TDomain | undefined;
  certificate?: CustomDomainCertificate | undefined;
}

// The custom domain states visitors can open.
export const LIVE_CUSTOM_DOMAIN_STATES: ReadonlyArray<CustomDomainState> = [
  CustomDomainState.CertificateIssued,
  CustomDomainState.RenewalFailed,
  CustomDomainState.UsesUploadedCertificate,
  CustomDomainState.VerifiedWithoutFreeCertificate,
];

export const isCustomDomainLive: (state: CustomDomainState) => boolean = (
  state: CustomDomainState,
): boolean => {
  return LIVE_CUSTOM_DOMAIN_STATES.includes(state);
};

/*
 * A live custom domain is served over HTTPS - it is live because it has a
 * certificate - at its root: a status page and a dashboard both answer at
 * the root of their own domain. One the installation issues no certificate
 * for is opened as the installation itself is reached - https, or http on
 * an installation without TLS - as the server links to it.
 */
export const getCustomDomainUrl: (
  fullDomain: string,
  state?: CustomDomainState | undefined,
  installation?: CustomDomainInstallation | undefined,
) => string = (
  fullDomain: string,
  state?: CustomDomainState | undefined,
  installation?: CustomDomainInstallation | undefined,
): string => {
  if (state === CustomDomainState.VerifiedWithoutFreeCertificate) {
    return `${(installation || FREE_CERTIFICATE_INSTALLATION).protocol}${fullDomain}`;
  }

  return `https://${fullDomain}`;
};

const SCHEME_SEPARATOR: string = "://";

/*
 * The host and the rest of an address, for the row: "status.acme.com" and
 * "", or "oneuptime.com" and "/status-page/<id>". Read with indexOf, not a
 * pattern: it is the address the page built, never anyone's text.
 */
export const getAddressParts: (url: string) => {
  host: string;
  path: string;
} = (url: string): { host: string; path: string } => {
  const schemeEnd: number = url.indexOf(SCHEME_SEPARATOR);
  const afterScheme: string =
    schemeEnd === -1 ? url : url.slice(schemeEnd + SCHEME_SEPARATOR.length);
  const pathStart: number = afterScheme.indexOf("/");

  if (pathStart === -1) {
    return { host: afterScheme, path: "" };
  }

  const path: string = afterScheme.slice(pathStart);

  return {
    host: afterScheme.slice(0, pathStart),
    // A bare "/" after the host says nothing.
    path: path === "/" ? "" : path,
  };
};

// The address as the row writes it: host and path, without the scheme.
export const getAddressText: (address: {
  host: string;
  path: string;
}) => string = (address: { host: string; path: string }): string => {
  return `${address.host}${address.path}`;
};

const compareDomains: (first: string, second: string) => number = (
  first: string,
  second: string,
): number => {
  const a: string = first.toLowerCase();
  const b: string = second.toLowerCase();

  if (a < b) {
    return -1;
  }

  return a > b ? 1 : 0;
};

/*
 * Every address the page answers at, in the order the list shows them: its
 * live custom domains, then those not live yet - each group in alphabetical
 * order, so the list reads the same on every visit - then the OneUptime
 * address. A row without a domain name is left out: there is nothing to
 * show or open.
 */
export const getPublicAddresses: <
  TDomain extends PublicAddressDomainInput,
>(data: {
  domains: ReadonlyArray<TDomain>;
  getCertificate?:
    | ((domain: TDomain) => CustomDomainCertificate | undefined)
    | undefined;
  oneUptimeUrl: string;
  now?: Date | undefined;
  installation?: CustomDomainInstallation | undefined;
}) => Array<PublicAddress<TDomain>> = <
  TDomain extends PublicAddressDomainInput,
>(data: {
  domains: ReadonlyArray<TDomain>;
  getCertificate?:
    | ((domain: TDomain) => CustomDomainCertificate | undefined)
    | undefined;
  oneUptimeUrl: string;
  now?: Date | undefined;
  installation?: CustomDomainInstallation | undefined;
}): Array<PublicAddress<TDomain>> => {
  const customDomains: Array<PublicAddress<TDomain>> = [];

  for (const domain of data.domains) {
    const fullDomain: string = (domain.fullDomain || "").trim();

    if (!fullDomain) {
      continue;
    }

    const certificate: CustomDomainCertificate | undefined = data.getCertificate
      ? data.getCertificate(domain)
      : undefined;
    const state: CustomDomainState = getCustomDomainState(
      domain,
      certificate,
      data.now,
      data.installation,
    );
    const url: string = getCustomDomainUrl(
      fullDomain,
      state,
      data.installation,
    );

    customDomains.push({
      kind: PublicAddressKind.CustomDomain,
      url: url,
      ...getAddressParts(url),
      isLive: isCustomDomainLive(state),
      state: state,
      domain: domain,
      certificate: certificate,
    });
  }

  customDomains.sort(
    (first: PublicAddress<TDomain>, second: PublicAddress<TDomain>): number => {
      if (first.isLive !== second.isLive) {
        return first.isLive ? -1 : 1;
      }

      return compareDomains(first.host, second.host);
    },
  );

  return [
    ...customDomains,
    {
      kind: PublicAddressKind.OneUptime,
      url: data.oneUptimeUrl,
      ...getAddressParts(data.oneUptimeUrl),
      isLive: true,
    },
  ];
};

/*
 * Whether a custom domain needs its certificate to say where it is: a
 * verified domain on the free certificate, on an installation that issues
 * them. The list asks for the certificates only when one does.
 */
export const isCertificateNeededFor: (
  domain: CustomDomainStateInput,
  installation?: CustomDomainInstallation | undefined,
) => boolean = (
  domain: CustomDomainStateInput,
  installation?: CustomDomainInstallation | undefined,
): boolean => {
  return (
    (installation || FREE_CERTIFICATE_INSTALLATION).issuesFreeCertificates &&
    Boolean(domain.isCnameVerified) &&
    !domain.isCustomCertificate
  );
};

/*
 * Why a custom domain is not live yet, in the words its Status column on
 * the Custom Domains page uses, so the two pages say the same thing. An
 * address with no state of its own (the OneUptime one, which is always
 * live) has none to give.
 */
export const getNotLiveReason: <TDomain extends PublicAddressDomainInput>(
  address: PublicAddress<TDomain>,
) => string = <TDomain extends PublicAddressDomainInput>(
  address: PublicAddress<TDomain>,
): string => {
  if (address.isLive || !address.state) {
    return "";
  }

  return CUSTOM_DOMAIN_STATUS[address.state];
};

/*
 * Whether a custom domain that is not live offers DNS Setup: when its
 * record is not verified, or its free certificate is not in place and Check
 * now can try again - exactly when its row on the Custom Domains page does.
 * A certificate being issued has nothing to do but wait.
 */
export const isDnsSetupOffered: <TDomain extends PublicAddressDomainInput>(
  address: PublicAddress<TDomain>,
  installation?: CustomDomainInstallation | undefined,
) => boolean = <TDomain extends PublicAddressDomainInput>(
  address: PublicAddress<TDomain>,
  installation?: CustomDomainInstallation | undefined,
): boolean => {
  if (
    address.kind !== PublicAddressKind.CustomDomain ||
    address.isLive ||
    !address.domain
  ) {
    return false;
  }

  return isCustomDomainDnsSetupAvailable(
    address.domain,
    address.certificate,
    undefined,
    installation,
  );
};

/*
 * The address visitors are sent to first: the first live address in the
 * list's order - a live custom domain, alphabetically first, or else the
 * OneUptime address, which is always live. What the embedded status badge
 * links to, as the Status Page Link card lists it.
 */
export const getFirstLiveAddress: <TDomain extends PublicAddressDomainInput>(
  addresses: ReadonlyArray<PublicAddress<TDomain>>,
) => PublicAddress<TDomain> | undefined = <
  TDomain extends PublicAddressDomainInput,
>(
  addresses: ReadonlyArray<PublicAddress<TDomain>>,
): PublicAddress<TDomain> | undefined => {
  return addresses.find((address: PublicAddress<TDomain>): boolean => {
    return address.isLive;
  });
};

export const PublicAddressCopy: {
  // Under each address: what it is.
  customDomain: string;
  oneUptimeAddress: string;
  // Beside a custom domain visitors cannot open yet.
  notLiveYet: string;
  copyLink: string;
  // Copy link's accessible name and tooltip, naming the address it copies.
  copyLinkTo: string;
  copied: string;
  // DNS Setup's accessible name and tooltip, naming the domain it sets up.
  dnsSetupFor: string;
  // Read out after the link: it leaves the Dashboard.
  opensInNewTab: string;
  // With no custom domain: one quiet line, and its link.
  addCustomDomainSentence: string;
  addCustomDomainLink: string;
  // The custom domains could not be read.
  loadError: string;
  tryAgain: string;
  // The list's name, read out by screen readers.
  listLabel: string;
  loading: string;
} = {
  customDomain: translationKey("Custom domain"),
  oneUptimeAddress: translationKey("OneUptime address"),
  notLiveYet: translationKey("Not live yet"),
  copyLink: translationKey("Copy link"),
  copyLinkTo: translationKey("Copy link to {{address}}"),
  copied: translationKey("Copied!"),
  dnsSetupFor: translationKey("DNS Setup for {{address}}"),
  opensInNewTab: translationKey("(opens in a new tab)"),
  addCustomDomainSentence: translationKey(
    "Use your own domain, such as {{example}}.",
  ),
  addCustomDomainLink: translationKey("Add a custom domain"),
  loadError: translationKey("The custom domains could not be loaded."),
  tryAgain: translationKey("Try again"),
  listLabel: translationKey("Addresses"),
  loading: translationKey("Loading addresses"),
};

// data-testids of the list and its rows.
export const PUBLIC_ADDRESS_TEST_IDS: {
  list: string;
  row: string;
  // The tile beside an address, saying what kind it is (not on a phone).
  tile: string;
  link: string;
  notLive: string;
  reason: string;
  dnsSetup: string;
  loading: string;
  error: string;
  addCustomDomain: string;
} = {
  list: "public-addresses",
  row: "public-address",
  tile: "public-address-tile",
  link: "public-address-link",
  notLive: "public-address-not-live",
  reason: "public-address-reason",
  dnsSetup: "public-address-dns-setup",
  loading: "public-addresses-loading",
  error: "public-addresses-error",
  addCustomDomain: "public-addresses-add-custom-domain",
};

export default PublicAddressCopy;
