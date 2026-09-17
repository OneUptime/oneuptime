import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  HTTP_RETRIES_ON_FAILURE_DESCRIPTION,
  NETWORK_RETRIES_ON_FAILURE_DESCRIPTION,
  PROBE_DEFAULT_RETRY_COUNT_LABEL,
  REQUEST_TIMEOUT_DESCRIPTION,
  SSL_RETRIES_ON_FAILURE_DESCRIPTION,
  getRetriesOnFailureDescription,
} from "../../FeatureSet/Dashboard/src/Utils/MonitorRetryHelpText";

/*
 * The "Retries on Failure" field on probe-based monitor steps.
 *
 * Two things can silently go wrong with this help text, and both are what the
 * tests below are for.
 *
 * The probe counts the value as retries AFTER the first attempt, and it does
 * names the failures retried by each monitor type. HTTP checks include error
 * responses and timeouts, while SSL checks include failed certificate
 * validation. A type pointed at the wrong variant makes a promise the probe
 * does not keep.
 *
 * The text is translated by exact-key lookup, so each string must also be a
 * key in every Dashboard locale file, or it silently renders in English for
 * the sixteen other languages.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES: Array<string> = [
  "en",
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

/*
 * Every monitor type whose step form renders the field, and the variant it has
 * to get. The form renders it in three places: the API advanced section, the
 * Website advanced section, and the shared Ping/IP/Port/SSL one.
 */
const VARIANT_BY_MONITOR_TYPE: Array<{
  monitorType: MonitorType;
  description: string;
}> = [
  {
    monitorType: MonitorType.Website,
    description: HTTP_RETRIES_ON_FAILURE_DESCRIPTION,
  },
  {
    monitorType: MonitorType.API,
    description: HTTP_RETRIES_ON_FAILURE_DESCRIPTION,
  },
  {
    monitorType: MonitorType.Ping,
    description: NETWORK_RETRIES_ON_FAILURE_DESCRIPTION,
  },
  {
    monitorType: MonitorType.IP,
    description: NETWORK_RETRIES_ON_FAILURE_DESCRIPTION,
  },
  {
    monitorType: MonitorType.Port,
    description: NETWORK_RETRIES_ON_FAILURE_DESCRIPTION,
  },
  {
    monitorType: MonitorType.SSLCertificate,
    description: SSL_RETRIES_ON_FAILURE_DESCRIPTION,
  },
];

const DESCRIPTIONS: Array<string> = [
  HTTP_RETRIES_ON_FAILURE_DESCRIPTION,
  NETWORK_RETRIES_ON_FAILURE_DESCRIPTION,
  SSL_RETRIES_ON_FAILURE_DESCRIPTION,
];

const TRANSLATED_TEXT: Array<string> = [
  ...DESCRIPTIONS,
  PROBE_DEFAULT_RETRY_COUNT_LABEL,
  REQUEST_TIMEOUT_DESCRIPTION,
];

/*
 * Retired descriptions must disappear from every locale as the contract
 * changes, including the old timeout and certificate-validation exclusions.
 */
const SUPERSEDED_DESCRIPTIONS: Array<string> = [
  "How many times to retry if the check fails. Set to 0 for no retries. Defaults to 3. Maximum is 3.",
  "How many times to retry after the first attempt fails. For example, 2 means up to 3 attempts in total. Set to 0 for no retries. Defaults to 3. Maximum is 3.",
  "How many times to retry after the first attempt fails. For example, 2 means up to 3 attempts in total. Set to 0 for no retries. Defaults to 3. Maximum is 3. Timeouts are not retried. Neither are failures to look up or validate the target, such as a hostname that does not resolve: the probe retries DNS lookups itself, within its DNS lookup time limit.",
  "How many times to retry after a failed attempt: 0 means one attempt, 2 means up to 3. Leave blank to use the probe's default (usually 3). Maximum is 3. Only connection failures are retried: a certificate that fails validation, or a check that times out, is reported after one attempt.",
  "How many times to retry after a failed attempt: 0 means one attempt, 2 means up to 3. Leave blank to use the probe's default (usually 3). Maximum is 3. It also limits re-checks of a successful response slower than 10 seconds. Timeouts are not retried, and neither are targets that do not resolve or are blocked.",
  "How many times to retry after a failed attempt: 0 means one attempt, 2 means up to 3. Leave blank to use the probe's default (usually 3). Maximum is 3. Only connection failures are retried: a certificate that fails validation, and a check that times out, are not retried.",
  "How long to wait for a response before timing out. Defaults to 60 seconds. Maximum is 60 seconds.",
];

/*
 * Any decimal digit, in any script. The Persian file writes its numbers in
 * Persian digits, so an assertion on ASCII "3" would fail a correct
 * translation.
 */
const ANY_DECIMAL_DIGIT: RegExp = /\p{Nd}/u;

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD_SRC, "Locales", `${locale}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

function readMonitorStepForm(): string {
  return fs.readFileSync(
    path.join(
      DASHBOARD_SRC,
      "Components",
      "Form",
      "Monitor",
      "MonitorStep.tsx",
    ),
    "utf8",
  );
}

describe("getRetriesOnFailureDescription", () => {
  test.each(VARIANT_BY_MONITOR_TYPE)(
    "$monitorType gets the variant that matches how the probe retries it",
    (mapping: { monitorType: MonitorType; description: string }) => {
      expect(getRetriesOnFailureDescription(mapping.monitorType)).toBe(
        mapping.description,
      );
    },
  );

  test("the three variants are distinct strings", () => {
    expect(new Set(DESCRIPTIONS).size).toBe(DESCRIPTIONS.length);
  });
});

describe("Retries on Failure descriptions", () => {
  test("every variant leads with the counting rule and what 0 does", () => {
    for (const description of DESCRIPTIONS) {
      expect(description.startsWith("How many times to retry")).toBe(true);
      expect(description).toContain("0 means one attempt, 2 means up to 3");
    }
  });

  test("every variant says a blank field takes the probe's default, and names the cap", () => {
    for (const description of DESCRIPTIONS) {
      expect(description).toContain(
        "Leave blank to use the probe's default (usually 3).",
      );
      expect(description).toContain("Maximum is 3.");
      // The old flat promise, which is only true of a probe with no override.
      expect(description).not.toContain("Defaults to 3.");
    }
  });

  test("Website and API include HTTP errors, timeouts and slow successful responses", () => {
    expect(HTTP_RETRIES_ON_FAILURE_DESCRIPTION).toContain(
      "a successful response slower than 10 seconds",
    );
    expect(HTTP_RETRIES_ON_FAILURE_DESCRIPTION).toContain(
      "Connection failures, timeouts, and HTTP 4xx and 5xx responses are retried",
    );
    expect(HTTP_RETRIES_ON_FAILURE_DESCRIPTION).toContain(
      "Each request attempt gets a new timeout",
    );
    expect(HTTP_RETRIES_ON_FAILURE_DESCRIPTION).not.toContain(
      "Timeouts are not retried",
    );
  });

  test("Website and API retain target, response-size and redirect protections", () => {
    expect(HTTP_RETRIES_ON_FAILURE_DESCRIPTION).toContain(
      "Invalid or blocked targets, oversized responses, and too many redirects are not retried",
    );
  });

  test("Ping, IP and Port say every failure is retried, including a slow success", () => {
    expect(NETWORK_RETRIES_ON_FAILURE_DESCRIPTION).toContain(
      "Every failure is retried, including timeouts",
    );
    expect(NETWORK_RETRIES_ON_FAILURE_DESCRIPTION).toContain(
      "a successful response slower than 10 seconds",
    );
  });

  test("SSL Certificate includes certificate validation failures and timeouts", () => {
    expect(SSL_RETRIES_ON_FAILURE_DESCRIPTION).toContain(
      "Connection failures, certificate validation failures, and timeouts are retried",
    );
    expect(SSL_RETRIES_ON_FAILURE_DESCRIPTION).not.toContain("are not retried");
    expect(SSL_RETRIES_ON_FAILURE_DESCRIPTION).not.toContain(
      "after one attempt",
    );
    /*
     * SSL has no slow-response re-check, so it must not borrow that sentence
     * from the other two variants.
     */
    expect(SSL_RETRIES_ON_FAILURE_DESCRIPTION).not.toContain("10 seconds");
  });

  test("no variant leaks probe internals into the help text", () => {
    for (const description of DESCRIPTIONS) {
      expect(description).not.toContain("EgressGuard");
      expect(description).not.toContain("Exception");
    }
  });
});

describe("Request timeout description", () => {
  test("each request or connection attempt gets its own timeout", () => {
    expect(REQUEST_TIMEOUT_DESCRIPTION).toContain(
      "each request or connection attempt",
    );
    expect(REQUEST_TIMEOUT_DESCRIPTION).toContain(
      "Each retry gets a new timeout",
    );
    expect(REQUEST_TIMEOUT_DESCRIPTION).toContain("Defaults to 60 seconds");
    expect(REQUEST_TIMEOUT_DESCRIPTION).toContain("Maximum is 60 seconds");
  });
});

describe("Monitor step form", () => {
  /*
   * Asserted against the source as tokens, never as a quoted span of JSX: the
   * file is prettier-formatted, and a reflow that moves the prop onto its own
   * line changes nothing about behaviour.
   */
  const source: string = readMonitorStepForm();

  test("the field's description comes from the helper", () => {
    expect(source).toContain("MonitorRetryHelpText");
    expect(source).toMatch(
      /getRetriesOnFailureDescription\(\s*props\.monitorType,?\s*\)/,
    );
  });

  test("the timeout field uses the translated per-attempt description", () => {
    expect(source).toContain("description={REQUEST_TIMEOUT_DESCRIPTION}");
    expect(source).not.toContain(REQUEST_TIMEOUT_DESCRIPTION);
  });

  test("no description is inlined in the form", () => {
    for (const description of [...DESCRIPTIONS, ...SUPERSEDED_DESCRIPTIONS]) {
      expect(source).not.toContain(description);
    }
  });
});

describe("Locales", () => {
  test("en.json carries every variant as an identity pair", () => {
    const en: Record<string, unknown> = readLocale("en");

    for (const description of TRANSLATED_TEXT) {
      expect(en[description]).toBe(description);
    }
  });

  test.each(LOCALES)(
    "%s.json translates every variant into a non-empty value that keeps its numbers",
    (locale: string) => {
      const json: Record<string, unknown> = readLocale(locale);

      for (const description of TRANSLATED_TEXT) {
        const translated: unknown = json[description];
        expect(typeof translated).toBe("string");
        expect((translated as string).trim().length).toBeGreaterThan(0);
        expect(ANY_DECIMAL_DIGIT.test(translated as string)).toBe(true);
      }
    },
  );

  test.each(LOCALES)(
    "%s.json names both HTTP error response classes",
    (locale: string) => {
      const description: string = readLocale(locale)[
        HTTP_RETRIES_ON_FAILURE_DESCRIPTION
      ] as string;
      expect(description).toContain("4xx");
      expect(description).toContain("5xx");
    },
  );

  test("the translations are not left in English", () => {
    for (const locale of LOCALES) {
      if (locale === "en") {
        continue;
      }

      const json: Record<string, unknown> = readLocale(locale);

      for (const description of TRANSLATED_TEXT) {
        expect(json[description]).not.toBe(description);
      }
    }
  });

  test("no locale keeps a superseded wording", () => {
    for (const locale of LOCALES) {
      const json: Record<string, unknown> = readLocale(locale);

      for (const description of SUPERSEDED_DESCRIPTIONS) {
        expect(json[description]).toBeUndefined();
      }
    }
  });
});
