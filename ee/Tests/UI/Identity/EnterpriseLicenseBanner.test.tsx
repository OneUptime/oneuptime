import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import EnterpriseLicenseBanner, {
  GRACE_DESCRIPTION,
  GRACE_TITLE,
  NOT_INCLUDED_DESCRIPTION,
  NOT_INCLUDED_SCIM_DESCRIPTION,
  NOT_INCLUDED_SCIM_TITLE,
  NOT_INCLUDED_TITLE,
  READ_ONLY_DESCRIPTION,
  READ_ONLY_TITLE,
  getNotIncludedCopy,
} from "../../../Dashboard/Identity/License/EnterpriseLicenseBanner";
import {
  EnterpriseLicenseMode,
  LicensedFeature,
} from "../../../Dashboard/Identity/License/EnterpriseLicenseMode";
import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
} from "Common/Types/EnterpriseLicense/EnterpriseLicensePeriods";

/*
 * The banner the SCIM screens (project and status page) show above their
 * configuration.
 *
 * Once the trial or the grace period is over, the identity provider's SCIM
 * requests are refused and the configuration becomes read-only, until a
 * license is activated. The read-only banner must say so - an admin who reads
 * "license required" next to their SCIM setup has to know that provisioning
 * and deprovisioning stopped, not assume they keep running. Before the lapse
 * (Grace, which covers the trial too) the banner warns about exactly that.
 * The banner once promised that SCIM keeps working without a license;
 * bannerCopyProblems() rejects that copy, and the negative controls below
 * prove it does.
 *
 * Single sign-on is part of every edition and never depends on a license, so
 * no banner may say anything about it: it once told admins that single
 * sign-on is off and "Require SSO" is not enforced after a lapse, which is
 * no longer true on any install. ssoClaimsIn() rejects that copy.
 *
 * A license that leaves SCIM out (NotIncluded) stops it too: the banner says
 * the license leaves SCIM out, and does not blame a missing or expired
 * license.
 */

// The banner copy before the owner's decision, verbatim.
const RETIRED_READ_ONLY_DESCRIPTION: string =
  "Single sign-on and SCIM keep working as configured: members can still sign in, and your identity provider can still provision and deprovision users. To add or change providers, activate or renew the Enterprise license in the Admin Dashboard.";

const RETIRED_GRACE_DESCRIPTION: string =
  "This installation does not have a valid Enterprise license. You can still change this configuration during the grace period; after it ends the configuration becomes read-only. Single sign-on and SCIM keep working either way.";

// The banner copy from while single sign-on stopped with the license, verbatim.
const RETIRED_SSO_READ_ONLY_TITLE: string =
  "Enterprise license required: single sign-on and SCIM are off, and this configuration is read-only.";

const RETIRED_SSO_READ_ONLY_DESCRIPTION: string =
  'Without a valid Enterprise license, single sign-on is off and "Require SSO" is not enforced, so members sign in with their password (anyone who only ever used single sign-on can set one with "Forgot password"). Your identity provider\'s SCIM requests are refused, so it cannot provision or deprovision users until the license is back. Nothing configured here is deleted: activate or renew the Enterprise license in the Admin Dashboard and everything resumes as configured.';

const RETIRED_SSO_GRACE_TITLE: string =
  "No valid Enterprise license: single sign-on and SCIM stop when the trial or grace period ends.";

const RETIRED_NOT_INCLUDED_SSO_TITLE: string =
  "Your Enterprise license does not include single sign-on: single sign-on is off, and this configuration is read-only.";

const READ_ONLY_PHRASES: Array<string> = [
  "SCIM requests are refused",
  "deprovision",
  "Nothing configured here is deleted",
  "everything resumes",
];

const GRACE_PHRASES: Array<string> = [
  "14-day trial of an installation with no license",
  "30-day grace period after a license expires",
  "SCIM requests are refused",
  "read-only",
  "until an Enterprise license is activated",
];

const NOT_INCLUDED_SCIM_PHRASES: Array<string> = [
  "does not include SCIM",
  "SCIM is off",
  "SCIM requests are refused",
  "deprovision",
  "read-only",
  "Nothing configured here is deleted",
  "a license that includes SCIM",
];

// A not-included banner speaks for SCIM, and the license is not lapsed.
const NOT_INCLUDED_SCIM_WRONG_CLAIMS: Array<RegExp> = [
  /Enterprise license required/i,
  /\b(?:missing|expired)\b/i,
];

/*
 * Anything a banner could say about single sign-on. Single sign-on never
 * stops with the license, so the SCIM banners mention none of it.
 */
const SSO_CLAIMS: Array<RegExp> = [
  /single sign-on/i,
  /\bSSO\b/,
  /\bSAML\b/,
  /\bOIDC\b/,
  /Forgot password/i,
  /sign in with their password/i,
];

const matchingClaims: (text: string, claims: Array<RegExp>) => Array<string> = (
  text: string,
  claims: Array<RegExp>,
): Array<string> => {
  return claims
    .filter((claim: RegExp) => {
      return claim.test(text);
    })
    .map((claim: RegExp) => {
      return claim.source;
    });
};

const ssoClaimsIn: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return matchingClaims(text, SSO_CLAIMS);
};

const RETIRED_CLAIMS: Array<RegExp> = [
  /keeps? working/i,
  /never stop/i,
  /can still sign in/i,
  /can still provision/i,
];

const bannerCopyProblems: (
  text: string,
  requiredPhrases: Array<string>,
) => Array<string> = (
  text: string,
  requiredPhrases: Array<string>,
): Array<string> => {
  const problems: Array<string> = [];

  for (const phrase of requiredPhrases) {
    if (!text.includes(phrase)) {
      problems.push(`missing: ${phrase}`);
    }
  }

  for (const retired of RETIRED_CLAIMS) {
    if (retired.test(text)) {
      problems.push(`retired: ${retired.source}`);
    }
  }

  return problems;
};

afterEach(() => {
  cleanup();
});

describe("EnterpriseLicenseBanner", () => {
  test("read-only: says a license is required, that SCIM is off, and that nothing can change", () => {
    render(
      <EnterpriseLicenseBanner
        mode={EnterpriseLicenseMode.ReadOnly}
        feature={LicensedFeature.SCIM}
      />,
    );

    const banner: HTMLElement = screen.getByTestId(
      "enterprise-license-read-only-banner",
    );

    expect(banner).toHaveTextContent(READ_ONLY_TITLE);
    expect(banner).toHaveTextContent(READ_ONLY_DESCRIPTION);
    expect(READ_ONLY_TITLE).toBe(
      "Enterprise license required: SCIM is off, and this configuration is read-only.",
    );
    expect(
      bannerCopyProblems(READ_ONLY_DESCRIPTION, READ_ONLY_PHRASES),
    ).toEqual([]);
    expect(
      screen.queryByTestId("enterprise-license-grace-banner"),
    ).not.toBeInTheDocument();
  });

  test("grace: warns what stops when the trial or grace period ends, while everything still works", () => {
    render(
      <EnterpriseLicenseBanner
        mode={EnterpriseLicenseMode.Grace}
        feature={LicensedFeature.SCIM}
      />,
    );

    const banner: HTMLElement = screen.getByTestId(
      "enterprise-license-grace-banner",
    );

    expect(banner).toHaveTextContent(GRACE_TITLE);
    expect(banner).toHaveTextContent(GRACE_DESCRIPTION);
    expect(GRACE_TITLE).toBe(
      "No valid Enterprise license: SCIM stops when the trial or grace period ends.",
    );
    expect(bannerCopyProblems(GRACE_DESCRIPTION, GRACE_PHRASES)).toEqual([]);
    expect(
      screen.queryByTestId("enterprise-license-read-only-banner"),
    ).not.toBeInTheDocument();
  });

  /*
   * The trial and the grace period are different lengths. The banner used to
   * say "the 14-day trial or grace period", which reads as a 14-day grace
   * period; it now names each with the number the license classifier uses.
   */
  test("grace: states the trial and the grace period with their own lengths, from the constants", () => {
    expect(GRACE_DESCRIPTION).toContain(
      `${ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS}-day trial`,
    );
    expect(GRACE_DESCRIPTION).toContain(
      `${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS}-day grace period`,
    );
    expect(GRACE_DESCRIPTION).not.toContain("14-day trial or grace period");
    expect(GRACE_DESCRIPTION).not.toMatch(/14-day grace/);
  });

  test("not included, on a SCIM screen: says the license leaves SCIM out, without blaming a lapse", () => {
    render(
      <EnterpriseLicenseBanner
        mode={EnterpriseLicenseMode.NotIncluded}
        feature={LicensedFeature.SCIM}
      />,
    );

    const banner: HTMLElement = screen.getByTestId(
      "enterprise-license-not-included-banner",
    );
    const text: string = `${NOT_INCLUDED_SCIM_TITLE} ${NOT_INCLUDED_SCIM_DESCRIPTION}`;

    expect(banner).toHaveTextContent(NOT_INCLUDED_SCIM_TITLE);
    expect(banner).toHaveTextContent(NOT_INCLUDED_SCIM_DESCRIPTION);
    expect(bannerCopyProblems(text, NOT_INCLUDED_SCIM_PHRASES)).toEqual([]);
    expect(matchingClaims(text, NOT_INCLUDED_SCIM_WRONG_CLAIMS)).toEqual([]);
    expect(
      screen.queryByTestId("enterprise-license-read-only-banner"),
    ).not.toBeInTheDocument();
  });

  test.each([
    ["a screen that named no feature", undefined],
    ["an audit log screen", LicensedFeature.AuditLogs],
  ])(
    "not included, on %s: a generic notice that claims nothing specific",
    (_screen: string, feature: LicensedFeature | undefined) => {
      render(
        <EnterpriseLicenseBanner
          mode={EnterpriseLicenseMode.NotIncluded}
          feature={feature}
        />,
      );

      const banner: HTMLElement = screen.getByTestId(
        "enterprise-license-not-included-banner",
      );

      expect(banner).toHaveTextContent(NOT_INCLUDED_TITLE);
      expect(banner).toHaveTextContent(NOT_INCLUDED_DESCRIPTION);
      expect(banner).not.toHaveTextContent(/single sign-on|SCIM/);
      expect(getNotIncludedCopy(feature)).toEqual({
        title: NOT_INCLUDED_TITLE,
        description: NOT_INCLUDED_DESCRIPTION,
      });
    },
  );

  test.each([EnterpriseLicenseMode.Editable, EnterpriseLicenseMode.Unknown])(
    "%s: shows nothing",
    (mode: EnterpriseLicenseMode) => {
      const { container } = render(
        <EnterpriseLicenseBanner mode={mode} feature={LicensedFeature.SCIM} />,
      );

      expect(container).toBeEmptyDOMElement();
    },
  );

  /*
   * Unknown means the license could not be read (or not yet). The server
   * keeps SCIM and audit logging running then, so the screen must not claim
   * they stopped - the banner above renders nothing for it.
   */
  test("never tells an admin that SCIM stopped when the license state is unknown", () => {
    const { container } = render(
      <EnterpriseLicenseBanner mode={EnterpriseLicenseMode.Unknown} />,
    );

    expect(container).not.toHaveTextContent(/off|stop|refused/i);
  });
});

describe("the banners say nothing about single sign-on", () => {
  test.each([
    ["read-only", `${READ_ONLY_TITLE} ${READ_ONLY_DESCRIPTION}`],
    ["grace", `${GRACE_TITLE} ${GRACE_DESCRIPTION}`],
    [
      "not included (SCIM)",
      `${NOT_INCLUDED_SCIM_TITLE} ${NOT_INCLUDED_SCIM_DESCRIPTION}`,
    ],
    [
      "not included (generic)",
      `${NOT_INCLUDED_TITLE} ${NOT_INCLUDED_DESCRIPTION}`,
    ],
  ])(
    "the %s copy never mentions single sign-on or its sign-in fallbacks",
    (_banner: string, text: string) => {
      expect(ssoClaimsIn(text)).toEqual([]);
    },
  );

  test.each([
    EnterpriseLicenseMode.ReadOnly,
    EnterpriseLicenseMode.Grace,
    EnterpriseLicenseMode.NotIncluded,
  ])(
    "the rendered %s banner never mentions single sign-on",
    (mode: EnterpriseLicenseMode) => {
      const { container } = render(
        <EnterpriseLicenseBanner mode={mode} feature={LicensedFeature.SCIM} />,
      );

      expect(container.textContent).not.toBe("");
      expect(ssoClaimsIn(container.textContent || "")).toEqual([]);
    },
  );
});

describe("the banner copy checks (negative controls)", () => {
  test("reject the copy that said single sign-on stops with the license", () => {
    expect(ssoClaimsIn(RETIRED_SSO_READ_ONLY_TITLE)).toEqual([
      "single sign-on",
    ]);
    expect(ssoClaimsIn(RETIRED_SSO_READ_ONLY_DESCRIPTION)).toEqual([
      "single sign-on",
      "\\bSSO\\b",
      "Forgot password",
      "sign in with their password",
    ]);
    expect(ssoClaimsIn(RETIRED_SSO_GRACE_TITLE)).toEqual(["single sign-on"]);
    expect(ssoClaimsIn(RETIRED_NOT_INCLUDED_SSO_TITLE)).toEqual([
      "single sign-on",
    ]);
  });

  test("reject a not-included SCIM banner that reuses the lapsed copy (it blames the license)", () => {
    const lapsed: string = `${READ_ONLY_TITLE} ${READ_ONLY_DESCRIPTION}`;

    expect(matchingClaims(lapsed, NOT_INCLUDED_SCIM_WRONG_CLAIMS)).toEqual([
      "Enterprise license required",
    ]);
    expect(bannerCopyProblems(lapsed, NOT_INCLUDED_SCIM_PHRASES)).toContain(
      "missing: does not include SCIM",
    );
  });

  test.each(
    NOT_INCLUDED_SCIM_PHRASES.map((phrase: string) => {
      return [phrase];
    }),
  )(
    "report a not-included SCIM banner that leaves out: %s",
    (phrase: string) => {
      const text: string = `${NOT_INCLUDED_SCIM_TITLE} ${NOT_INCLUDED_SCIM_DESCRIPTION}`;

      expect(
        bannerCopyProblems(
          text.split(phrase).join(""),
          NOT_INCLUDED_SCIM_PHRASES,
        ),
      ).toContain(`missing: ${phrase}`);
    },
  );

  test("reject the retired read-only copy that said SSO and SCIM keep working", () => {
    const problems: Array<string> = bannerCopyProblems(
      RETIRED_READ_ONLY_DESCRIPTION,
      READ_ONLY_PHRASES,
    );

    expect(problems).toContain("retired: keeps? working");
    expect(problems).toContain("retired: can still sign in");
    expect(problems).toContain("missing: SCIM requests are refused");
  });

  test("reject the retired grace copy that said SSO and SCIM keep working either way", () => {
    const problems: Array<string> = bannerCopyProblems(
      RETIRED_GRACE_DESCRIPTION,
      GRACE_PHRASES,
    );

    expect(problems).toContain("retired: keeps? working");
    expect(problems).toContain("missing: SCIM requests are refused");
  });

  test.each(
    READ_ONLY_PHRASES.map((phrase: string) => {
      return [phrase];
    }),
  )("report a read-only description that leaves out: %s", (phrase: string) => {
    expect(
      bannerCopyProblems(
        READ_ONLY_DESCRIPTION.split(phrase).join(""),
        READ_ONLY_PHRASES,
      ),
    ).toContain(`missing: ${phrase}`);
  });

  test.each(
    GRACE_PHRASES.map((phrase: string) => {
      return [phrase];
    }),
  )("report a grace description that leaves out: %s", (phrase: string) => {
    expect(
      bannerCopyProblems(
        GRACE_DESCRIPTION.split(phrase).join(""),
        GRACE_PHRASES,
      ),
    ).toContain(`missing: ${phrase}`);
  });
});
