import {
  CUSTOM_DOMAIN_STATUS,
  CustomDomainInstallation,
  CustomDomainState,
} from "../../FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainCopy";
import PublicAddressCopy, {
  getAddressParts,
  getAddressText,
  getCustomDomainUrl,
  getFirstLiveAddress,
  getNotLiveReason,
  getPublicAddresses,
  isCertificateNeededFor,
  isCustomDomainLive,
  isDnsSetupOffered,
  LIVE_CUSTOM_DOMAIN_STATES,
  PublicAddress,
  PublicAddressDomainInput,
  PublicAddressKind,
} from "../../FeatureSet/Dashboard/src/Components/CustomDomain/PublicAddressCopy";
import Protocol from "Common/Types/API/Protocol";
import { CustomDomainCertificate } from "Common/Types/CustomDomain/CustomDomainCertificates";
import { describe, expect, test } from "@jest/globals";

/*
 * Where visitors find a status page or a public dashboard: every address it
 * answers at, its custom domains first, then its address on OneUptime's own
 * domain (Components/CustomDomain/PublicAddressCopy). A status page's
 * Overview showed only that last address, whatever custom domains the page
 * had, and said nothing about whether a domain worked yet.
 *
 * These hold the rules the list is drawn by: which custom domain is live (a
 * link to open and copy) and which is not yet (no link, and why), the order
 * the addresses come in, what each row shows, when the certificates are
 * read, and when DNS Setup is offered - the same rules as the Custom Domains
 * page's Status column and DNS Setup action.
 */

const ONEUPTIME_URL: string =
  "https://oneuptime.com/status-page/5ba0193d-c333-48c3-9e94-ca8fa487dd4a";

const NOW: Date = new Date("2026-10-19T12:00:00.000Z");
const DAY: number = 24 * 60 * 60 * 1000;

interface Domain extends PublicAddressDomainInput {
  id: string;
}

// A domain's row, by where it is on its way to HTTPS.
function domain(
  id: string,
  fullDomain: string,
  state:
    | "live"
    | "dns"
    | "issuing"
    | "unordered"
    | "failed"
    | "expired"
    | "uploaded"
    | "renewal"
    | "uploadedBeforeDns",
): Domain {
  return {
    id: id,
    fullDomain: fullDomain,
    isCnameVerified: !["dns", "uploadedBeforeDns"].includes(state),
    isSslOrdered: ![
      "dns",
      "unordered",
      "uploaded",
      "uploadedBeforeDns",
    ].includes(state),
    isSslProvisioned: ["live", "expired", "renewal"].includes(state),
    isCustomCertificate: ["uploaded", "uploadedBeforeDns"].includes(state),
  };
}

// The certificate each state's domain has, as the certificates route says.
function certificateFor(
  row: Domain,
  state: string,
): CustomDomainCertificate | undefined {
  switch (state) {
    case "live":
      return {
        domainId: row.id,
        expiresAt: new Date(NOW.getTime() + 60 * DAY),
      };
    case "issuing":
      return { domainId: row.id };
    case "failed":
      return {
        domainId: row.id,
        lastOrderError: "CAA record forbids letsencrypt.org",
      };
    case "expired":
      return { domainId: row.id, expiresAt: new Date(NOW.getTime() - DAY) };
    case "renewal":
      return {
        domainId: row.id,
        expiresAt: new Date(NOW.getTime() + 10 * DAY),
        lastOrderError: "Timeout during connect",
      };
    default:
      return undefined;
  }
}

function addressesOf(
  rows: Array<[string, string, Parameters<typeof domain>[2]]>,
): Array<PublicAddress<Domain>> {
  const certificates: Map<string, CustomDomainCertificate> = new Map<
    string,
    CustomDomainCertificate
  >();
  const domains: Array<Domain> = rows.map(
    ([id, fullDomain, state]: [
      string,
      string,
      Parameters<typeof domain>[2],
    ]) => {
      const row: Domain = domain(id, fullDomain, state);
      const certificate: CustomDomainCertificate | undefined = certificateFor(
        row,
        state,
      );

      if (certificate) {
        certificates.set(id, certificate);
      }

      return row;
    },
  );

  return getPublicAddresses<Domain>({
    domains: domains,
    getCertificate: (row: Domain): CustomDomainCertificate | undefined => {
      return certificates.get(row.id);
    },
    oneUptimeUrl: ONEUPTIME_URL,
    now: NOW,
  });
}

function summary(addresses: Array<PublicAddress<Domain>>): Array<string> {
  return addresses.map((address: PublicAddress<Domain>): string => {
    return `${address.isLive ? "live" : "not live"} ${getAddressText(address)}`;
  });
}

describe("which custom domain is live", () => {
  test("every state the Custom Domains page knows is either live or not", () => {
    const live: Array<CustomDomainState> =
      Object.values(CustomDomainState).filter(isCustomDomainLive);

    expect([...live].sort()).toEqual([...LIVE_CUSTOM_DOMAIN_STATES].sort());
    expect(new Set(LIVE_CUSTOM_DOMAIN_STATES)).toEqual(
      new Set([
        CustomDomainState.CertificateIssued,
        CustomDomainState.RenewalFailed,
        CustomDomainState.UsesUploadedCertificate,
        // Where the installation issues none: its own proxy's HTTPS.
        CustomDomainState.VerifiedWithoutFreeCertificate,
      ]),
    );
  });

  test.each([
    ["its free certificate is issued", "live", true],
    [
      "a renewal failed, but the certificate in place has not expired",
      "renewal",
      true,
    ],
    ["it serves the certificate its owner uploaded", "uploaded", true],
    ["its CNAME record is not found yet", "dns", false],
    ["its certificate is being issued", "issuing", false],
    ["it is verified, its certificate not ordered yet", "unordered", false],
    ["its certificate order keeps failing", "failed", false],
    ["its certificate has expired", "expired", false],
    [
      "it has an uploaded certificate but no CNAME record yet",
      "uploadedBeforeDns",
      false,
    ],
  ])("%s: %s", (_label: string, state: string, isLive: boolean) => {
    const addresses: Array<PublicAddress<Domain>> = addressesOf([
      ["d1", "status.acme.com", state as Parameters<typeof domain>[2]],
    ]);

    expect(addresses[0]!.kind).toBe(PublicAddressKind.CustomDomain);
    expect(addresses[0]!.isLive).toBe(isLive);
  });

  test("without its certificate (not read, or the read failed), the row's own flags decide", () => {
    const provisioned: Domain = domain("d1", "status.acme.com", "live");
    const waiting: Domain = domain("d2", "status-eu.acme.com", "issuing");

    const addresses: Array<PublicAddress<Domain>> = getPublicAddresses<Domain>({
      domains: [provisioned, waiting],
      oneUptimeUrl: ONEUPTIME_URL,
      now: NOW,
    });

    expect(summary(addresses)).toEqual([
      "live status.acme.com",
      "not live status-eu.acme.com",
      "live oneuptime.com/status-page/5ba0193d-c333-48c3-9e94-ca8fa487dd4a",
    ]);
  });

  test("a certificate that expired a moment ago is not live, though the row still says provisioned", () => {
    const row: Domain = domain("d1", "status.acme.com", "live");
    const addresses: Array<PublicAddress<Domain>> = getPublicAddresses<Domain>({
      domains: [row],
      getCertificate: (): CustomDomainCertificate => {
        return { domainId: "d1", expiresAt: new Date(NOW.getTime() - 1000) };
      },
      oneUptimeUrl: ONEUPTIME_URL,
      now: NOW,
    });

    expect(addresses[0]!.isLive).toBe(false);
    expect(addresses[0]!.state).toBe(CustomDomainState.CertificateExpired);
  });
});

describe("the order of the addresses", () => {
  test("with no custom domain, the OneUptime address alone", () => {
    const addresses: Array<PublicAddress<Domain>> = addressesOf([]);

    expect(addresses).toHaveLength(1);
    expect(addresses[0]).toEqual({
      kind: PublicAddressKind.OneUptime,
      url: ONEUPTIME_URL,
      host: "oneuptime.com",
      path: "/status-page/5ba0193d-c333-48c3-9e94-ca8fa487dd4a",
      isLive: true,
    });
  });

  test("custom domains first - the live ones, then those not live yet, each in alphabetical order - then the OneUptime address", () => {
    const addresses: Array<PublicAddress<Domain>> = addressesOf([
      ["d1", "status-old.acme.com", "failed"],
      ["d2", "status.acme.io", "uploaded"],
      ["d3", "status-eu.acme.com", "dns"],
      ["d4", "Status.Acme.com", "live"],
      ["d5", "status-apac.acme.com", "issuing"],
      ["d6", "status-legacy.acme.com", "expired"],
      ["d7", "a-status.acme.com", "renewal"],
    ]);

    expect(summary(addresses)).toEqual([
      "live a-status.acme.com",
      "live Status.Acme.com",
      "live status.acme.io",
      "not live status-apac.acme.com",
      "not live status-eu.acme.com",
      "not live status-legacy.acme.com",
      "not live status-old.acme.com",
      "live oneuptime.com/status-page/5ba0193d-c333-48c3-9e94-ca8fa487dd4a",
    ]);

    // The OneUptime address is always last, and the only one of its kind.
    expect(
      addresses.map((address: PublicAddress<Domain>): PublicAddressKind => {
        return address.kind;
      }),
    ).toEqual([
      ...Array(7).fill(PublicAddressKind.CustomDomain),
      PublicAddressKind.OneUptime,
    ]);
  });

  test("the order does not depend on the order the domains were read in", () => {
    const rows: Array<[string, string, Parameters<typeof domain>[2]]> = [
      ["d1", "b.acme.com", "dns"],
      ["d2", "c.acme.com", "live"],
      ["d3", "a.acme.com", "issuing"],
      ["d4", "d.acme.com", "live"],
    ];

    const forwards: Array<string> = summary(addressesOf(rows));
    const backwards: Array<string> = summary(addressesOf([...rows].reverse()));

    expect(backwards).toEqual(forwards);
    expect(forwards).toEqual([
      "live c.acme.com",
      "live d.acme.com",
      "not live a.acme.com",
      "not live b.acme.com",
      "live oneuptime.com/status-page/5ba0193d-c333-48c3-9e94-ca8fa487dd4a",
    ]);
  });

  test("a row without a domain name is left out: there is nothing to show or open", () => {
    const addresses: Array<PublicAddress<Domain>> = getPublicAddresses<Domain>({
      domains: [
        { ...domain("d1", "", "live") },
        { ...domain("d2", "   ", "live") },
        { id: "d3", isCnameVerified: true },
        domain("d4", " status.acme.com ", "live"),
      ],
      oneUptimeUrl: ONEUPTIME_URL,
      now: NOW,
    });

    expect(summary(addresses)).toEqual([
      "live status.acme.com",
      "live oneuptime.com/status-page/5ba0193d-c333-48c3-9e94-ca8fa487dd4a",
    ]);
    expect(addresses[0]!.url).toBe("https://status.acme.com");
  });
});

describe("what a row shows and opens", () => {
  test("a custom domain opens over HTTPS at its root", () => {
    expect(getCustomDomainUrl("status.acme.com")).toBe(
      "https://status.acme.com",
    );

    const [address] = addressesOf([["d1", "status.acme.com", "live"]]);

    expect(address!.url).toBe("https://status.acme.com");
    expect(address!.host).toBe("status.acme.com");
    expect(address!.path).toBe("");
    expect(address!.domain?.id).toBe("d1");
    expect(address!.state).toBe(CustomDomainState.CertificateIssued);
  });

  test.each([
    ["https://status.acme.com", "status.acme.com", ""],
    ["https://status.acme.com/", "status.acme.com", ""],
    [
      "https://oneuptime.com/status-page/5ba0193d",
      "oneuptime.com",
      "/status-page/5ba0193d",
    ],
    [
      "http://localhost:3002/public-dashboard/6b6b",
      "localhost:3002",
      "/public-dashboard/6b6b",
    ],
    ["status.acme.com/a/b", "status.acme.com", "/a/b"],
  ])(
    "%s reads as the host %s and the rest %s",
    (url: string, host: string, rest: string) => {
      expect(getAddressParts(url)).toEqual({ host: host, path: rest });
      expect(getAddressText(getAddressParts(url))).toBe(`${host}${rest}`);
    },
  );

  test("the OneUptime address keeps its scheme where it is opened and copied, not where it is read", () => {
    const http: string = "http://oneuptime.internal/status-page/abc";
    const [address] = getPublicAddresses<Domain>({
      domains: [],
      oneUptimeUrl: http,
    });

    expect(address!.url).toBe(http);
    expect(getAddressText(address!)).toBe("oneuptime.internal/status-page/abc");
  });
});

describe("why a custom domain is not live yet", () => {
  test.each([
    ["dns", CustomDomainState.WaitingForDns],
    ["issuing", CustomDomainState.IssuingCertificate],
    ["unordered", CustomDomainState.IssuingCertificate],
    ["failed", CustomDomainState.CertificateFailed],
    ["expired", CustomDomainState.CertificateExpired],
  ])(
    "%s says what its Status column on Custom Domains says",
    (state: string, expected: CustomDomainState) => {
      const [address] = addressesOf([
        ["d1", "status.acme.com", state as Parameters<typeof domain>[2]],
      ]);

      expect(address!.state).toBe(expected);
      expect(getNotLiveReason(address!)).toBe(CUSTOM_DOMAIN_STATUS[expected]);
    },
  );

  test("a live address has no reason to give", () => {
    const addresses: Array<PublicAddress<Domain>> = addressesOf([
      ["d1", "status.acme.com", "live"],
    ]);

    for (const address of addresses) {
      expect(getNotLiveReason(address)).toBe("");
    }
  });

  test("the reasons are plain: what is missing, and what happens next", () => {
    expect(CUSTOM_DOMAIN_STATUS[CustomDomainState.WaitingForDns]).toBe(
      "Waiting for DNS: add the CNAME record.",
    );
    expect(CUSTOM_DOMAIN_STATUS[CustomDomainState.IssuingCertificate]).toBe(
      "Issuing a free certificate, usually within 15 minutes.",
    );
  });
});

describe("DNS Setup on a domain that is not live", () => {
  test.each([
    ["dns", true],
    ["unordered", true],
    ["failed", true],
    ["expired", true],
    ["uploadedBeforeDns", true],
    // A certificate being issued only needs waiting for.
    ["issuing", false],
    // Live: nothing to set up.
    ["live", false],
    ["renewal", false],
    ["uploaded", false],
  ])("%s offers DNS Setup: %s", (state: string, offered: boolean) => {
    const [address] = addressesOf([
      ["d1", "status.acme.com", state as Parameters<typeof domain>[2]],
    ]);

    expect(isDnsSetupOffered(address!)).toBe(offered);
  });

  test("never on the OneUptime address", () => {
    const addresses: Array<PublicAddress<Domain>> = addressesOf([]);

    expect(isDnsSetupOffered(addresses[0]!)).toBe(false);
  });
});

describe("when the certificates are read", () => {
  test.each([
    ["waiting for its DNS record", "dns", false],
    ["on an uploaded certificate", "uploaded", false],
    ["verified, on the free certificate", "live", true],
    ["verified, its certificate being issued", "issuing", true],
    ["verified, not ordered yet", "unordered", true],
  ])("a domain %s: %s", (_label: string, state: string, needed: boolean) => {
    expect(
      isCertificateNeededFor(
        domain("d1", "status.acme.com", state as Parameters<typeof domain>[2]),
      ),
    ).toBe(needed);
  });
});

describe("the words", () => {
  test("whole names and sentences, each a translation key", () => {
    expect(PublicAddressCopy).toEqual({
      customDomain: "Custom domain",
      oneUptimeAddress: "OneUptime address",
      notLiveYet: "Not live yet",
      copyLink: "Copy link",
      copyLinkTo: "Copy link to {{address}}",
      copied: "Copied!",
      // DNS Setup's name, naming the domain it sets up (UI review).
      dnsSetupFor: "DNS Setup for {{address}}",
      opensInNewTab: "(opens in a new tab)",
      addCustomDomainSentence: "Use your own domain, such as {{example}}.",
      addCustomDomainLink: "Add a custom domain",
      loadError: "The custom domains could not be loaded.",
      tryAgain: "Try again",
      listLabel: "Addresses",
      loading: "Loading addresses",
    });
  });
});

/*
 * An installation that issues no free certificates (no Let's Encrypt
 * account key: a self-hosted one that ends TLS at its own proxy). A
 * verified domain there read "Issuing a free certificate" for ever, so the
 * Status Page Link card never offered it, although the server links to it
 * in every email (getUsableCustomDomain, rule 3). It is live there, opened
 * as the installation itself is reached, and its certificate is never read.
 */
describe("on an installation that issues no free certificates", () => {
  const OVER_HTTPS: CustomDomainInstallation = {
    issuesFreeCertificates: false,
    protocol: Protocol.HTTPS,
  };
  const OVER_HTTP: CustomDomainInstallation = {
    issuesFreeCertificates: false,
    protocol: Protocol.HTTP,
  };

  const addressesWithout: (
    installation: CustomDomainInstallation,
    rows: Array<Domain>,
  ) => Array<PublicAddress<Domain>> = (
    installation: CustomDomainInstallation,
    rows: Array<Domain>,
  ): Array<PublicAddress<Domain>> => {
    return getPublicAddresses<Domain>({
      domains: rows,
      oneUptimeUrl: ONEUPTIME_URL,
      now: NOW,
      installation: installation,
    });
  };

  test("a verified domain is live, a link on the installation's protocol", () => {
    const [first] = addressesWithout(OVER_HTTPS, [
      domain("d1", "status.acme.com", "unordered"),
    ]);

    expect(first!.state).toBe(CustomDomainState.VerifiedWithoutFreeCertificate);
    expect(first!.isLive).toBe(true);
    expect(first!.url).toBe("https://status.acme.com");

    const [overHttp] = addressesWithout(OVER_HTTP, [
      domain("d1", "status.acme.com", "unordered"),
    ]);

    expect(overHttp!.url).toBe("http://status.acme.com");
    // The row shows the host alone either way.
    expect(getAddressText(overHttp!)).toBe("status.acme.com");
  });

  test("a domain on an uploaded certificate is HTTPS, whatever the installation", () => {
    const [first] = addressesWithout(OVER_HTTP, [
      domain("d1", "status.acme.com", "uploaded"),
    ]);

    expect(first!.isLive).toBe(true);
    expect(first!.url).toBe("https://status.acme.com");
  });

  test("a domain whose record is not found yet is still not live, with DNS Setup", () => {
    const [first] = addressesWithout(OVER_HTTPS, [
      domain("d1", "status.acme.com", "dns"),
    ]);

    expect(first!.isLive).toBe(false);
    expect(getNotLiveReason(first!)).toBe(
      CUSTOM_DOMAIN_STATUS[CustomDomainState.WaitingForDns],
    );
    expect(isDnsSetupOffered(first!, OVER_HTTPS)).toBe(true);
  });

  test("its certificates are never read: no verified domain needs one to say where it is", () => {
    for (const state of ["unordered", "issuing", "failed", "live"] as const) {
      expect([
        state,
        isCertificateNeededFor(domain("d1", "a.acme.com", state), OVER_HTTPS),
      ]).toEqual([state, false]);
    }

    // On an installation that issues them, as before.
    expect(
      isCertificateNeededFor(domain("d1", "a.acme.com", "unordered")),
    ).toBe(true);
  });

  test("the order is the same: live custom domains first, alphabetically, then OneUptime", () => {
    expect(
      summary(
        addressesWithout(OVER_HTTPS, [
          domain("d1", "zeta.acme.com", "unordered"),
          domain("d2", "waiting.acme.com", "dns"),
          domain("d3", "alpha.acme.com", "failed"),
        ]),
      ),
    ).toEqual([
      "live alpha.acme.com",
      "live zeta.acme.com",
      "not live waiting.acme.com",
      "live oneuptime.com/status-page/5ba0193d-c333-48c3-9e94-ca8fa487dd4a",
    ]);
  });
});

/*
 * The address visitors are sent to first - what the embedded status badge
 * links to: the first live one in the list's order.
 */
describe("the first live address", () => {
  test("a live custom domain, alphabetically first", () => {
    expect(
      getFirstLiveAddress(
        addressesOf([
          ["d1", "zeta.acme.com", "live"],
          ["d2", "issuing.acme.com", "issuing"],
          ["d3", "alpha.acme.com", "uploaded"],
        ]),
      )!.url,
    ).toBe("https://alpha.acme.com");
  });

  test("the address on OneUptime when no custom domain is live", () => {
    expect(
      getFirstLiveAddress(
        addressesOf([
          ["d1", "a.acme.com", "dns"],
          ["d2", "b.acme.com", "failed"],
        ]),
      )!.url,
    ).toBe(ONEUPTIME_URL);
  });

  test("getCustomDomainUrl names the protocol only for a domain the installation serves itself", () => {
    expect(getCustomDomainUrl("status.acme.com")).toBe(
      "https://status.acme.com",
    );
    expect(
      getCustomDomainUrl(
        "status.acme.com",
        CustomDomainState.CertificateIssued,
        { issuesFreeCertificates: false, protocol: Protocol.HTTP },
      ),
    ).toBe("https://status.acme.com");
    expect(
      getCustomDomainUrl(
        "status.acme.com",
        CustomDomainState.VerifiedWithoutFreeCertificate,
        { issuesFreeCertificates: false, protocol: Protocol.HTTP },
      ),
    ).toBe("http://status.acme.com");
  });
});
