import {
  CUSTOM_DOMAIN_RECORD_TYPE,
  CUSTOM_DOMAIN_STATUS,
  CUSTOM_DOMAIN_VERIFIED_NEXT,
  CustomDomainCopy,
  CustomDomainKindCopy,
  CustomDomainState,
  CustomDomainStateInput,
  DASHBOARD_CUSTOM_DOMAIN_COPY,
  DNS_SETUP_TEST_IDS,
  getCustomDomainCertificateError,
  getCustomDomainState,
  isCustomDomainDnsSetupAvailable,
  STATUS_PAGE_CUSTOM_DOMAIN_COPY,
  STATUS_TEST_IDS,
} from "../../FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainCopy";
import { CustomDomainCertificateStatus } from "Common/Types/CustomDomain/CustomDomainVerification";
import { CustomDomainCertificate } from "Common/Types/CustomDomain/CustomDomainCertificates";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A custom domain - a status page's or a dashboard's: add it, the DNS record
 * opens right away, and the free certificate is issued without a button.
 *
 * It took four actions in two places: verify the domain in Project
 * Settings, add the custom domain in two steps, find "Add CNAME" - which
 * added nothing - and then "Order Free SSL", while the Status column said
 * "Action Required: Please order SSL certificate." for an order the worker
 * placed on its own anyway. Three timings disagreed: three hours in the
 * order dialog, one hour in the Status column, thirty minutes for an
 * uploaded certificate. Status pages lost all of that first, and dashboards
 * kept it, because each page had its own copy of the table.
 *
 * This holds both pages, their one shared table, its copy and its
 * translations to the flow: one state machine, one timing, no button to
 * order a certificate, and every sentence in all seventeen languages.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const STATUS_PAGE_PAGE: string = path.join(
  DASHBOARD_SRC,
  "Pages",
  "StatusPages",
  "View",
  "Domains.tsx",
);

const DASHBOARD_PAGE: string = path.join(
  DASHBOARD_SRC,
  "Pages",
  "Dashboards",
  "View",
  "CustomDomains.tsx",
);

const COMPONENT_DIR: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "CustomDomain",
);

const TABLE: string = path.join(COMPONENT_DIR, "CustomDomainsTable.tsx");
const KINDS: string = path.join(COMPONENT_DIR, "CustomDomainKinds.ts");
const DIALOG: string = path.join(
  COMPONENT_DIR,
  "CustomDomainDnsSetupModal.tsx",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const OTHER_LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

// Without its comments, collapsed to one line.
function readSource(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ");
}

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const KIND_COPIES: Array<[string, CustomDomainKindCopy]> = [
  ["status page", STATUS_PAGE_CUSTOM_DOMAIN_COPY],
  ["dashboard", DASHBOARD_CUSTOM_DOMAIN_COPY],
];

// Every sentence this flow shows, from the copy module.
const SENTENCES: Array<string> = [
  ...Object.values(CUSTOM_DOMAIN_STATUS),
  ...Object.values(CUSTOM_DOMAIN_VERIFIED_NEXT),
  ...Object.values(CustomDomainCopy),
  ...Object.values(STATUS_PAGE_CUSTOM_DOMAIN_COPY),
  ...Object.values(DASHBOARD_CUSTOM_DOMAIN_COPY),
];

/*
 * Words and sentences the flow shares with the rest of the Dashboard, or
 * took over from the pages it replaced, whose translations were there - or
 * not - before it: "Name" reads "Name" in German.
 */
const SHARED: Array<string> = [
  CustomDomainCopy.dnsSetupRecordType,
  CustomDomainCopy.dnsSetupRecordName,
  CustomDomainCopy.dnsSetupRecordValue,
  CustomDomainCopy.dnsSetupClose,
  CustomDomainCopy.dnsSetupDone,
  CustomDomainCopy.cardDescriptionNotEnabled,
  CustomDomainCopy.reissueRateLimit,
  ...KIND_COPIES.flatMap(([, copy]: [string, CustomDomainKindCopy]) => {
    return [
      copy.dnsSetupNotEnabled,
      copy.subdomainPlaceholder,
      copy.subdomainDescription,
      copy.reissueTitle,
      copy.reissueDescription,
    ];
  }),
];

// The sentences this flow brought, each translated in every language.
const NEW_SENTENCES: Array<string> = SENTENCES.filter((sentence: string) => {
  return !SHARED.includes(sentence);
});

describe("where a custom domain is on its way to HTTPS", () => {
  test.each([
    [
      "not verified yet",
      { isCnameVerified: false },
      CustomDomainState.WaitingForDns,
    ],
    [
      "not verified yet, with an uploaded certificate",
      { isCnameVerified: false, isCustomCertificate: true },
      CustomDomainState.WaitingForDns,
    ],
    [
      "verified, on an uploaded certificate",
      { isCnameVerified: true, isCustomCertificate: true },
      CustomDomainState.UsesUploadedCertificate,
    ],
    [
      "verified, its certificate not ordered yet",
      { isCnameVerified: true },
      CustomDomainState.IssuingCertificate,
    ],
    [
      "verified, its certificate ordered but not served yet",
      { isCnameVerified: true, isSslProvisioned: false },
      CustomDomainState.IssuingCertificate,
    ],
    [
      "verified and served",
      { isCnameVerified: true, isSslProvisioned: true },
      CustomDomainState.CertificateIssued,
    ],
  ])("%s", (_name: string, domain: CustomDomainStateInput, state: string) => {
    expect(getCustomDomainState(domain)).toBe(state);
  });

  test("the Status column reads one sentence per state: the brief's four, and three that say what failed", () => {
    expect(CUSTOM_DOMAIN_STATUS).toEqual({
      [CustomDomainState.WaitingForDns]:
        "Waiting for DNS: add the CNAME record.",
      [CustomDomainState.UsesUploadedCertificate]:
        "Uses your uploaded certificate.",
      [CustomDomainState.IssuingCertificate]:
        "Issuing a free certificate, usually within 15 minutes.",
      [CustomDomainState.CertificateFailed]:
        "Could not issue a free certificate yet. We keep trying.",
      [CustomDomainState.CertificateExpired]:
        "Certificate expired. We keep trying to renew it.",
      [CustomDomainState.CertificateIssued]:
        "Certificate issued, renews automatically.",
      [CustomDomainState.RenewalFailed]:
        "Certificate issued, but renewing it failed. We keep trying.",
    });
  });

  test("Check now has a sentence for every certificate status the server answers", () => {
    expect(Object.keys(CUSTOM_DOMAIN_VERIFIED_NEXT).sort()).toEqual(
      Object.values(CustomDomainCertificateStatus).sort(),
    );
  });

  /*
   * A failing domain is no longer retried every 15 minutes - it waits longer
   * after each failure - so the dialog no longer promises that timing.
   */
  test("a failed order says the certificate is retried automatically, without promising a timing", () => {
    const failed: string =
      CUSTOM_DOMAIN_VERIFIED_NEXT[CustomDomainCertificateStatus.Failed];

    expect(failed).toBe(
      "We could not issue a free SSL certificate for {{domain}} yet. We keep trying automatically.",
    );
    expect(failed).not.toMatch(/\d+ (?:minutes?|hours?)/);
  });
});

/*
 * What the domain row cannot say comes from the certificates route: the
 * certificate's expiry and the last failed order. Without it - not loaded
 * yet, or the request failed - the row alone decides, as it always did.
 */
describe("where a custom domain is, with its certificate", () => {
  const NOW: Date = new Date("2026-10-03T12:00:00.000Z");
  const IN_TWO_MONTHS: Date = new Date("2026-12-03T12:00:00.000Z");
  const YESTERDAY: Date = new Date("2026-10-02T12:00:00.000Z");
  const ERROR: string = "Unable to order certificate for status.acme.com.";

  const VERIFIED: CustomDomainStateInput = { isCnameVerified: true };
  const SERVED: CustomDomainStateInput = {
    isCnameVerified: true,
    isSslOrdered: true,
    isSslProvisioned: true,
  };

  function certificate(
    data: Partial<CustomDomainCertificate>,
  ): CustomDomainCertificate {
    return { domainId: "domain-id", ...data };
  }

  test.each([
    [
      "verified, no certificate, and its last order failed",
      VERIFIED,
      certificate({ lastOrderError: ERROR }),
      CustomDomainState.CertificateFailed,
    ],
    [
      "verified, no certificate, nothing failed",
      VERIFIED,
      certificate({}),
      CustomDomainState.IssuingCertificate,
    ],
    [
      "its certificate has expired",
      SERVED,
      certificate({ expiresAt: YESTERDAY }),
      CustomDomainState.CertificateExpired,
    ],
    [
      "its certificate has expired, and its renewal failed",
      SERVED,
      certificate({ expiresAt: YESTERDAY, lastOrderError: ERROR }),
      CustomDomainState.CertificateExpired,
    ],
    [
      "served, and its last renewal failed",
      SERVED,
      certificate({ expiresAt: IN_TWO_MONTHS, lastOrderError: ERROR }),
      CustomDomainState.RenewalFailed,
    ],
    [
      "served, nothing failed",
      SERVED,
      certificate({ expiresAt: IN_TWO_MONTHS }),
      CustomDomainState.CertificateIssued,
    ],
    [
      "a certificate not written out yet",
      { isCnameVerified: true, isSslOrdered: true },
      certificate({ expiresAt: IN_TWO_MONTHS }),
      CustomDomainState.IssuingCertificate,
    ],
    [
      "marked provisioned, but no certificate in the table: never issued",
      SERVED,
      certificate({}),
      CustomDomainState.IssuingCertificate,
    ],
    [
      "not verified, whatever its certificate",
      { isCnameVerified: false },
      certificate({ expiresAt: YESTERDAY, lastOrderError: ERROR }),
      CustomDomainState.WaitingForDns,
    ],
    [
      "on an uploaded certificate, whatever the free one",
      { isCnameVerified: true, isCustomCertificate: true },
      certificate({ expiresAt: YESTERDAY, lastOrderError: ERROR }),
      CustomDomainState.UsesUploadedCertificate,
    ],
  ])(
    "%s",
    (
      _name: string,
      domain: CustomDomainStateInput,
      domainCertificate: CustomDomainCertificate,
      state: CustomDomainState,
    ) => {
      expect(getCustomDomainState(domain, domainCertificate, NOW)).toBe(state);
    },
  );

  test("the failure is shown under the states that are about one, and only there", () => {
    const failed: CustomDomainCertificate = certificate({
      lastOrderError: ERROR,
    });

    for (const state of [
      CustomDomainState.CertificateFailed,
      CustomDomainState.CertificateExpired,
      CustomDomainState.RenewalFailed,
    ]) {
      expect(getCustomDomainCertificateError(state, failed)).toBe(ERROR);
    }

    for (const state of [
      CustomDomainState.WaitingForDns,
      CustomDomainState.UsesUploadedCertificate,
      CustomDomainState.IssuingCertificate,
      CustomDomainState.CertificateIssued,
    ]) {
      expect(getCustomDomainCertificateError(state, failed)).toBeUndefined();
    }

    expect(
      getCustomDomainCertificateError(
        CustomDomainState.CertificateExpired,
        certificate({ expiresAt: YESTERDAY }),
      ),
    ).toBeUndefined();
  });

  /*
   * DNS Setup, whose Check now orders the certificate, is the retry path of
   * a domain whose free certificate is not in place.
   */
  test.each([
    ["not verified", { isCnameVerified: false }, undefined, true],
    ["verified, not ordered yet", VERIFIED, undefined, true],
    [
      "ordered, its order failing (the certificate went missing)",
      { isCnameVerified: true, isSslOrdered: true },
      certificate({ lastOrderError: ERROR }),
      true,
    ],
    [
      "ordered, its certificate expired",
      SERVED,
      certificate({ expiresAt: YESTERDAY }),
      true,
    ],
    [
      "served, its last renewal failed: renewal retries on its own",
      SERVED,
      certificate({ expiresAt: IN_TWO_MONTHS, lastOrderError: ERROR }),
      false,
    ],
    ["served", SERVED, certificate({ expiresAt: IN_TWO_MONTHS }), false],
    ["ordered, its certificate not known yet", SERVED, undefined, false],
    [
      "on an uploaded certificate",
      { isCnameVerified: true, isCustomCertificate: true },
      certificate({ lastOrderError: ERROR }),
      false,
    ],
  ])(
    "DNS Setup when %s: %s",
    (
      _name: string,
      domain: CustomDomainStateInput,
      domainCertificate: CustomDomainCertificate | undefined,
      offered: boolean,
    ) => {
      expect(
        isCustomDomainDnsSetupAvailable(domain, domainCertificate, NOW),
      ).toBe(offered);
    },
  );

  test("the Status column's test ids are distinct", () => {
    expect(new Set(Object.values(STATUS_TEST_IDS)).size).toBe(
      Object.values(STATUS_TEST_IDS).length,
    );
  });
});

describe("the copy", () => {
  /*
   * Three hours, one hour and thirty minutes used to be promised for the
   * same certificate. The sweeps run every 15 minutes, nginx writes new
   * certificates every 15 minutes, and that is the one timing now.
   */
  test("gives one timing, 15 minutes, everywhere it gives one", () => {
    const timings: Array<string> = SENTENCES.flatMap((sentence: string) => {
      return sentence.match(/\d+ (?:minutes?|hours?)/g) || [];
    });

    expect(timings.length).toBeGreaterThan(0);
    expect(new Set(timings)).toEqual(new Set(["15 minutes"]));
  });

  test("never asks anyone to order a certificate", () => {
    const asksForAnOrder: RegExp = /order (?:a |free )?SSL/i;

    for (const sentence of SENTENCES) {
      expect([sentence, asksForAnOrder.test(sentence)]).toEqual([
        sentence,
        false,
      ]);
      expect([sentence, sentence.includes("Action Required")]).toEqual([
        sentence,
        false,
      ]);
    }
  });

  test("the record type is CNAME, and the dialog's test ids are distinct", () => {
    expect(CUSTOM_DOMAIN_RECORD_TYPE).toBe("CNAME");
    expect(new Set(Object.values(DNS_SETUP_TEST_IDS)).size).toBe(
      Object.values(DNS_SETUP_TEST_IDS).length,
    );
  });

  test("every sentence is an en.json key", () => {
    const english: Record<string, string> = readLocale("en");

    for (const sentence of SENTENCES) {
      expect([sentence, english[sentence]]).toEqual([sentence, sentence]);
    }
  });

  /*
   * 24 came with the status page flow; custom-domain-ssl-hardening added
   * the three Status sentences about a failure, the expired-certificate
   * intro of DNS Setup, and the failed order's sentence without a timing;
   * dashboards brought their card description and DNS Setup intro.
   */
  test("brings 30 sentences of its own", () => {
    expect(NEW_SENTENCES).toHaveLength(30);
  });

  test.each(OTHER_LOCALES)(
    "every sentence it brought is translated in %s, placeholders kept",
    (locale: string) => {
      const translations: Record<string, string> = readLocale(locale);

      for (const sentence of NEW_SENTENCES) {
        const translated: string | undefined = translations[sentence];

        expect([sentence, typeof translated]).toEqual([sentence, "string"]);
        expect([sentence, translated !== sentence]).toEqual([sentence, true]);

        for (const placeholder of sentence.match(/\{\{\w+\}\}/g) || []) {
          expect([sentence, translated!.includes(placeholder)]).toEqual([
            sentence,
            true,
          ]);
        }
      }
    },
  );
});

/*
 * What a kind of custom domain says in words of its own. The two kinds say
 * the same things about their own product - where the domain points, its
 * usual subdomain, how it is switched on - and nothing else differs.
 */
describe("each kind's own words", () => {
  test("both kinds say every one of them", () => {
    expect(Object.keys(DASHBOARD_CUSTOM_DOMAIN_COPY).sort()).toEqual(
      Object.keys(STATUS_PAGE_CUSTOM_DOMAIN_COPY).sort(),
    );
  });

  test.each(KIND_COPIES)(
    "the %s's sentences keep the placeholders the pages fill in",
    (_kind: string, copy: CustomDomainKindCopy) => {
      expect(copy.cardDescription).toContain("{{cnameRecord}}");
      expect(copy.dnsSetupIntro).toContain("{{domain}}");
      expect(copy.dnsSetupNotEnabled).toContain("{{variable}}");
    },
  );

  test("each names its own product, and its own Helm value", () => {
    expect(STATUS_PAGE_CUSTOM_DOMAIN_COPY.cardDescription).toContain(
      "this status page",
    );
    expect(DASHBOARD_CUSTOM_DOMAIN_COPY.cardDescription).toContain(
      "this dashboard",
    );
    expect(STATUS_PAGE_CUSTOM_DOMAIN_COPY.dnsSetupIntro).toContain(
      "your status page",
    );
    expect(DASHBOARD_CUSTOM_DOMAIN_COPY.dnsSetupIntro).toContain(
      "your dashboard",
    );
    expect(STATUS_PAGE_CUSTOM_DOMAIN_COPY.dnsSetupNotEnabled).toContain(
      "statusPage.cnameRecord",
    );
    expect(DASHBOARD_CUSTOM_DOMAIN_COPY.dnsSetupNotEnabled).toContain(
      "dashboard.cnameRecord",
    );
    expect(DASHBOARD_CUSTOM_DOMAIN_COPY.subdomainPlaceholder).toBe(
      "dashboard (leave blank for root)",
    );
    expect(STATUS_PAGE_CUSTOM_DOMAIN_COPY.subdomainPlaceholder).toBe(
      "status (leave blank for root)",
    );
    expect(DASHBOARD_CUSTOM_DOMAIN_COPY.reissueTitle).toBe(
      "Reissue SSL Certificate for this Dashboard",
    );
    expect(STATUS_PAGE_CUSTOM_DOMAIN_COPY.reissueTitle).toBe(
      "Reissue SSL Certificate for this Status Page",
    );
  });

  /*
   * The old dashboard page's words, which said the opposite of what now
   * happens: an order to place, a record that "will be provisioned in 1
   * hour", 30 minutes for an upload.
   */
  test("none of them is the old dashboard page's wording", () => {
    for (const sentence of SENTENCES) {
      for (const gone of [
        "Important: Please add a CNAME record",
        "Action Required",
        "provisioned in 1 hour",
        "allow 30 minutes",
        "Certificate Provisioned",
        "click Verify CNAME",
      ]) {
        expect([sentence, sentence.includes(gone)]).toEqual([sentence, false]);
      }
    }
  });
});

describe("the Custom Domains pages", () => {
  const table: string = readSource(TABLE);

  /*
   * One table for both, so the two pages cannot drift apart again: the
   * dashboard one kept Add CNAME and Order Free SSL after the status page
   * lost them.
   */
  test.each([
    ["status page", STATUS_PAGE_PAGE, "STATUS_PAGE_CUSTOM_DOMAINS"],
    ["dashboard", DASHBOARD_PAGE, "DASHBOARD_CUSTOM_DOMAINS"],
  ])(
    "the %s page is the shared table, for its own kind of domain",
    (_name: string, file: string, kind: string) => {
      const page: string = readSource(file);

      expect(page).toContain("<CustomDomainsTable");
      expect(page).toContain(`kind={${kind}}`);
      expect(page).not.toContain("<ModelTable");
      expect(page).not.toContain("ConfirmModal");
      expect(page).not.toContain("Order Free SSL");
      expect(page).not.toContain("Add CNAME");
      expect(page).not.toContain("verify-cname");
    },
  );

  test("has no Order Free SSL and no Add CNAME, and does not call order-ssl", () => {
    expect(table).not.toContain("Order Free SSL");
    expect(table).not.toContain("Add CNAME");
    expect(table).not.toContain("Verify CNAME");
    expect(table).not.toContain("order-ssl");
  });

  test("keeps Reissue SSL", () => {
    expect(table).toContain('title: "Reissue SSL"');
    expect(table).toContain("reissue-ssl");
  });

  test("adds a domain on one page: no form steps", () => {
    expect(table).not.toContain("formSteps");
    expect(table).not.toContain("stepId");
  });

  test("lists verified domains only", () => {
    expect(table).toMatch(/query: \{ isVerified: true, \}/);
  });

  test("opens DNS Setup on a domain that was just added", () => {
    expect(table).toContain("onCreateSuccess");
    expect(table).toContain("modalType === ModalType.Create");
    expect(table).toContain("CustomDomainDnsSetupModal");
  });

  test("reads each domain's certificate whenever the table loads its rows", () => {
    expect(table).toContain("onFetchSuccess");
    expect(table).toContain("/certificates/");
    expect(table).toContain("CustomDomainStatus");
    expect(table).toContain("isCustomDomainDnsSetupAvailable");
  });

  /*
   * Regression: "CNAME Valid" and "SSL Provisioned" were written with an
   * empty field ({}), so the filter had no column to filter on.
   */
  test("every filter filters a column", () => {
    expect(table).not.toMatch(/field: \{\s*\}/);
    expect(table).toContain(
      'field: { isCnameVerified: true, }, title: "CNAME Valid"',
    );
    expect(table).toContain(
      'field: { isSslProvisioned: true, }, title: "SSL Provisioned"',
    );
  });

  test("the dialog asks verify-cname, the one call it makes", () => {
    const dialog: string = readSource(DIALOG);

    expect(dialog).toContain("/verify-cname/");
    expect(dialog).not.toContain("order-ssl");
  });

  /*
   * Each kind keeps the table names it always had, so saved filters and
   * column preferences survive, and points at its own CNAME record.
   */
  test("each kind keeps its table's names and its own CNAME record", () => {
    const kinds: string = readSource(KINDS);

    expect(kinds).toMatch(
      /STATUS_PAGE_CUSTOM_DOMAINS: CustomDomainKind = \{ modelType: StatusPageDomain, parentColumn: "statusPageId", tableId: "domains-table", tableName: "Status Page > Domains", userPreferencesKey: "status-page-domains-table", saveFilterTableId: "status-page-domains-table", getCnameRecord: \(\): string => \{ return StatusPageCNameRecord; \}, cnameRecordVariable: "STATUS_PAGE_CNAME_RECORD", copy: STATUS_PAGE_CUSTOM_DOMAIN_COPY, \}/,
    );
    expect(kinds).toMatch(
      /DASHBOARD_CUSTOM_DOMAINS: CustomDomainKind = \{ modelType: DashboardDomain, parentColumn: "dashboardId", tableId: "dashboard-domains-table", tableName: "Dashboard > Domains", userPreferencesKey: "dashboard-domains-table", saveFilterTableId: "dashboard-domains-table", getCnameRecord: \(\): string => \{ return DashboardCNameRecord; \}, cnameRecordVariable: "DASHBOARD_CNAME_RECORD", copy: DASHBOARD_CUSTOM_DOMAIN_COPY, \}/,
    );
  });
});
