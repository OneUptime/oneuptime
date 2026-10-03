import {
  DNS_SETUP_TEST_IDS,
  getStatusPageCustomDomainState,
  STATUS_PAGE_CUSTOM_DOMAIN_RECORD_TYPE,
  STATUS_PAGE_CUSTOM_DOMAIN_STATUS,
  STATUS_PAGE_CUSTOM_DOMAIN_VERIFIED_NEXT,
  StatusPageCustomDomainCopy,
  StatusPageCustomDomainState,
  StatusPageCustomDomainStateInput,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/CustomDomain/StatusPageCustomDomainCopy";
import { CustomDomainCertificateStatus } from "Common/Types/StatusPage/CustomDomainVerification";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A status page custom domain: add it, the DNS record opens right away, and
 * the free certificate is issued without a button.
 *
 * It took four actions in two places: verify the domain in Project
 * Settings, add the custom domain in two steps, find "Add CNAME" - which
 * added nothing - and then "Order Free SSL", while the Status column said
 * "Action Required: Please order SSL certificate." for an order the worker
 * placed on its own anyway. Three timings disagreed: three hours in the
 * order dialog, one hour in the Status column, thirty minutes for an
 * uploaded certificate.
 *
 * This holds the page, its copy and its translations to the new flow: one
 * state machine, one timing, no button to order a certificate, and every
 * sentence in all seventeen languages.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const PAGE: string = path.join(
  DASHBOARD_SRC,
  "Pages",
  "StatusPages",
  "View",
  "Domains.tsx",
);

const COMPONENT_DIR: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "StatusPage",
  "CustomDomain",
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

// Every sentence this flow shows, from the copy module.
const SENTENCES: Array<string> = [
  ...Object.values(STATUS_PAGE_CUSTOM_DOMAIN_STATUS),
  ...Object.values(STATUS_PAGE_CUSTOM_DOMAIN_VERIFIED_NEXT),
  ...Object.values(StatusPageCustomDomainCopy),
];

/*
 * Words and sentences the flow shares with the rest of the Dashboard, whose
 * translations were there before it - "Name" reads "Name" in German.
 */
const SHARED: Array<string> = [
  StatusPageCustomDomainCopy.dnsSetupRecordType,
  StatusPageCustomDomainCopy.dnsSetupRecordName,
  StatusPageCustomDomainCopy.dnsSetupRecordValue,
  StatusPageCustomDomainCopy.dnsSetupClose,
  StatusPageCustomDomainCopy.dnsSetupDone,
  StatusPageCustomDomainCopy.cardDescriptionNotEnabled,
  StatusPageCustomDomainCopy.dnsSetupNotEnabled,
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
      StatusPageCustomDomainState.WaitingForDns,
    ],
    [
      "not verified yet, with an uploaded certificate",
      { isCnameVerified: false, isCustomCertificate: true },
      StatusPageCustomDomainState.WaitingForDns,
    ],
    [
      "verified, on an uploaded certificate",
      { isCnameVerified: true, isCustomCertificate: true },
      StatusPageCustomDomainState.UsesUploadedCertificate,
    ],
    [
      "verified, its certificate not ordered yet",
      { isCnameVerified: true },
      StatusPageCustomDomainState.IssuingCertificate,
    ],
    [
      "verified, its certificate ordered but not served yet",
      { isCnameVerified: true, isSslProvisioned: false },
      StatusPageCustomDomainState.IssuingCertificate,
    ],
    [
      "verified and served",
      { isCnameVerified: true, isSslProvisioned: true },
      StatusPageCustomDomainState.CertificateIssued,
    ],
  ])(
    "%s",
    (
      _name: string,
      domain: StatusPageCustomDomainStateInput,
      state: string,
    ) => {
      expect(getStatusPageCustomDomainState(domain)).toBe(state);
    },
  );

  test("the Status column reads the brief's four sentences", () => {
    expect(STATUS_PAGE_CUSTOM_DOMAIN_STATUS).toEqual({
      [StatusPageCustomDomainState.WaitingForDns]:
        "Waiting for DNS: add the CNAME record.",
      [StatusPageCustomDomainState.UsesUploadedCertificate]:
        "Uses your uploaded certificate.",
      [StatusPageCustomDomainState.IssuingCertificate]:
        "Issuing a free certificate, usually within 15 minutes.",
      [StatusPageCustomDomainState.CertificateIssued]:
        "Certificate issued, renews automatically.",
    });
  });

  test("Check now has a sentence for every certificate status the server answers", () => {
    expect(Object.keys(STATUS_PAGE_CUSTOM_DOMAIN_VERIFIED_NEXT).sort()).toEqual(
      Object.values(CustomDomainCertificateStatus).sort(),
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
    expect(STATUS_PAGE_CUSTOM_DOMAIN_RECORD_TYPE).toBe("CNAME");
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

  test("brings 23 sentences of its own", () => {
    expect(NEW_SENTENCES).toHaveLength(23);
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

describe("the Custom Domains page", () => {
  const page: string = readSource(PAGE);

  test("has no Order Free SSL and no Add CNAME, and does not call order-ssl", () => {
    expect(page).not.toContain("Order Free SSL");
    expect(page).not.toContain("Add CNAME");
    expect(page).not.toContain("Verify CNAME");
    expect(page).not.toContain("order-ssl");
  });

  test("keeps Reissue SSL", () => {
    expect(page).toContain('title: "Reissue SSL"');
    expect(page).toContain("reissue-ssl");
  });

  test("adds a domain on one page: no form steps", () => {
    expect(page).not.toContain("formSteps");
    expect(page).not.toContain("stepId");
  });

  test("lists verified domains only", () => {
    expect(page).toMatch(/query: \{ isVerified: true, \}/);
  });

  test("opens DNS Setup on a domain that was just added", () => {
    expect(page).toContain("onCreateSuccess");
    expect(page).toContain("modalType === ModalType.Create");
    expect(page).toContain("StatusPageDomainDnsSetupModal");
  });

  test("the dialog asks verify-cname, the one call it makes", () => {
    const dialog: string = readSource(
      path.join(COMPONENT_DIR, "StatusPageDomainDnsSetupModal.tsx"),
    );

    expect(dialog).toContain("/verify-cname/");
    expect(dialog).not.toContain("order-ssl");
  });
});
