import { getCustomDomainInUseMessage } from "../../../../Server/Utils/CustomDomain/CustomDomainConflicts";
import {
  DOMAIN_REFUSAL_WORDS,
  isDomainServerError,
  isSubdomainServerError,
  NAME_IN_USE_WORDS,
  SUBDOMAIN_WORDS,
} from "../../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainServerErrors";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Create dialog of a custom domain - a status page's, a dashboard's or
 * a form's (Dashboard Components/CustomDomain/CustomDomainsTable) - says a
 * refusal about the subdomain under Subdomain, and one about the domain
 * under Domain (CustomDomainServerErrors, Field.ownsServerError). It knows
 * them by the server's own words, so this holds those words to the
 * services that write them: should a service say it another way, the
 * dialog would quietly go back to a red box over the whole form, and this
 * fails instead, naming the words to update.
 */

const SERVICES_DIR: string = path.resolve(__dirname, "../../../../Server/Services");

// The services whose create a Custom Domains page sends a new domain to.
const DOMAIN_SERVICES: Array<string> = [
  "StatusPageDomainService",
  "DashboardDomainService",
  "FormDomainService",
];

// A domain that stopped being verified while the dialog was open.
const NOT_VERIFIED: string =
  "This domain is not verified. Please verify it in Project Settings > Advanced > Domains.";

// A domain the service could not read.
const NO_DOMAIN: string = "Please select a valid domain.";

// The start of a subdomain that is not a plain DNS label, as each service writes it.
const NOT_VALID_START: string = "`Subdomain ${normalized} is not valid.";

function serviceSource(service: string): string {
  return fs.readFileSync(path.join(SERVICES_DIR, `${service}.ts`), "utf8");
}

describe("the server's words the dialog knows a refusal by", () => {
  test.each(DOMAIN_SERVICES)(
    "%s refuses a domain and a subdomain in those words",
    (service: string) => {
      const source: string = serviceSource(service);

      expect(source.indexOf(`"${NOT_VERIFIED}"`)).not.toBe(-1);
      expect(source.indexOf(`"${NO_DOMAIN}"`)).not.toBe(-1);
      expect(source.indexOf(NOT_VALID_START)).not.toBe(-1);
    },
  );

  // Every kind refuses a name another kind has with the one message.
  test.each(DOMAIN_SERVICES)(
    "%s refuses a name in use through CustomDomainConflicts",
    (service: string) => {
      expect(
        serviceSource(service).indexOf("CustomDomainConflicts.assertNameIsFree"),
      ).not.toBe(-1);
    },
  );
});

describe("Subdomain owns", () => {
  test("a name another status page, dashboard or form has, on a subdomain or the root", () => {
    for (const fullDomain of ["report.acme.com", "acme.com"]) {
      const message: string = getCustomDomainInUseMessage(fullDomain);

      expect(message.toLowerCase()).toContain(NAME_IN_USE_WORDS);
      expect(isSubdomainServerError(message)).toBe(true);
      expect(isDomainServerError(message)).toBe(false);
    }
  });

  test("a subdomain that is not a plain label, whatever was typed", () => {
    for (const typed of ["a/b", "169.254.169.254/latest/meta-data/#", "x:8080"]) {
      const message: string = `Subdomain ${typed} is not valid. Use a plain subdomain such as "report" — schemes, ports, paths and "/" are not allowed.`;

      expect(isSubdomainServerError(message)).toBe(true);
      expect(isDomainServerError(message)).toBe(false);
    }
  });

  test("in any case", () => {
    expect(isSubdomainServerError("REPORT.ACME.COM IS ALREADY IN USE")).toBe(
      true,
    );
    expect(SUBDOMAIN_WORDS).toBe(SUBDOMAIN_WORDS.toLowerCase());
    expect(NAME_IN_USE_WORDS).toBe(NAME_IN_USE_WORDS.toLowerCase());
  });
});

describe("Domain owns", () => {
  test("a domain that is no longer verified, and one the server could not read", () => {
    for (const message of [NOT_VERIFIED, NO_DOMAIN]) {
      expect(isDomainServerError(message)).toBe(true);
      expect(isSubdomainServerError(message)).toBe(false);
    }
  });

  test("in any case", () => {
    expect(isDomainServerError(NOT_VERIFIED.toUpperCase())).toBe(true);

    for (const words of DOMAIN_REFUSAL_WORDS) {
      expect(words).toBe(words.toLowerCase());
    }
  });
});

describe("neither owns", () => {
  test.each([
    "Custom certificate or private key is missing",
    "We could not reach OneUptime. Check your connection and try again.",
    "Server Error. Please try again",
    "",
  ])("%j, which stays over the form", (message: string) => {
    expect(isSubdomainServerError(message)).toBe(false);
    expect(isDomainServerError(message)).toBe(false);
  });
});
