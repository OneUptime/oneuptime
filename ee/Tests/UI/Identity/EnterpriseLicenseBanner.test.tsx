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
  NOT_INCLUDED_SSO_DESCRIPTION,
  NOT_INCLUDED_SSO_TITLE,
  NOT_INCLUDED_TITLE,
  READ_ONLY_DESCRIPTION,
  READ_ONLY_TITLE,
} from "../../../Dashboard/SSO/License/EnterpriseLicenseBanner";
import {
  EnterpriseLicenseMode,
  LicensedFeature,
} from "../../../Dashboard/SSO/License/EnterpriseLicenseMode";
import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
} from "Common/Types/EnterpriseLicense/EnterpriseLicensePeriods";

/*
 * The banner the identity screens (project, status page and global SSO,
 * OIDC and SCIM) show above their configuration.
 *
 * Once the trial or the grace period is over, single sign-on stops,
 * "Require SSO" is no longer enforced (members sign in with their password,
 * so nobody is locked out) and the identity provider's SCIM requests are
 * refused, until a license is activated. The read-only banner
 * must say all of that - an admin who reads "license required" next to their
 * SSO setup has to know that SSO is off, not assume it keeps running. Before
 * the lapse (Grace, which covers the trial too) the banner warns about
 * exactly that. The banner used to promise that single sign-on and SCIM keep
 * working without a license; bannerCopyProblems() rejects that copy, and the
 * negative controls below prove it does.
 *
 * A license that leaves one of the two features out (NotIncluded) stops only
 * that one: the banner names the screen's feature and must not claim the
 * other one stopped too, nor blame a missing or expired license.
 */

// The banner copy before the owner's decision, verbatim.
const RETIRED_READ_ONLY_DESCRIPTION: string =
  "Single sign-on and SCIM keep working as configured: members can still sign in, and your identity provider can still provision and deprovision users. To add or change providers, activate or renew the Enterprise license in the Admin Dashboard.";

const RETIRED_GRACE_DESCRIPTION: string =
  "This installation does not have a valid Enterprise license. You can still change this configuration during the grace period; after it ends the configuration becomes read-only. Single sign-on and SCIM keep working either way.";

const READ_ONLY_PHRASES: Array<string> = [
  "single sign-on is off",
  '"Require SSO" is not enforced',
  "members sign in with their password",
  '"Forgot password"',
  "SCIM requests are refused",
  "deprovision",
  "Nothing configured here is deleted",
  "everything resumes",
];

const GRACE_PHRASES: Array<string> = [
  "14-day trial of an installation with no license",
  "30-day grace period after a license expires",
  "single sign-on stops",
  '"Require SSO" is no longer enforced',
  "members sign in with their password",
  "SCIM requests are refused",
  "read-only",
  "until an Enterprise license is activated",
];

const NOT_INCLUDED_SSO_PHRASES: Array<string> = [
  "does not include single sign-on",
  "single sign-on is off",
  '"Require SSO" is not enforced',
  "members sign in with their password",
  '"Forgot password"',
  "read-only",
  "Nothing configured here is deleted",
  "a license that includes single sign-on",
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

// A not-included banner speaks for its own feature, and the license is not lapsed.
const NOT_INCLUDED_SSO_WRONG_CLAIMS: Array<RegExp> = [
  /\bSCIM\b/,
  /Enterprise license required/i,
  /\b(?:missing|expired)\b/i,
];

const NOT_INCLUDED_SCIM_WRONG_CLAIMS: Array<RegExp> = [
  /single sign-on is off/i,
  /Require SSO/i,
  /Enterprise license required/i,
  /\b(?:missing|expired)\b/i,
];

const wrongClaimsIn: (text: string, claims: Array<RegExp>) => Array<string> = (
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
  test("read-only: says a license is required, that SSO and SCIM are off, and that nothing can change", () => {
    render(<EnterpriseLicenseBanner mode={EnterpriseLicenseMode.ReadOnly} />);

    const banner: HTMLElement = screen.getByTestId(
      "enterprise-license-read-only-banner",
    );

    expect(banner).toHaveTextContent(READ_ONLY_TITLE);
    expect(banner).toHaveTextContent(READ_ONLY_DESCRIPTION);
    expect(READ_ONLY_TITLE).toContain("Enterprise license required");
    expect(READ_ONLY_TITLE).toContain("single sign-on and SCIM are off");
    expect(READ_ONLY_TITLE).toContain("read-only");
    expect(
      bannerCopyProblems(READ_ONLY_DESCRIPTION, READ_ONLY_PHRASES),
    ).toEqual([]);
    expect(
      screen.queryByTestId("enterprise-license-grace-banner"),
    ).not.toBeInTheDocument();
  });

  test("grace: warns what stops when the trial or grace period ends, while everything still works", () => {
    render(<EnterpriseLicenseBanner mode={EnterpriseLicenseMode.Grace} />);

    const banner: HTMLElement = screen.getByTestId(
      "enterprise-license-grace-banner",
    );

    expect(banner).toHaveTextContent(GRACE_TITLE);
    expect(banner).toHaveTextContent(GRACE_DESCRIPTION);
    expect(GRACE_TITLE).toContain(
      "single sign-on and SCIM stop when the trial or grace period ends",
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

  test("not included, on a single sign-on screen: says the license leaves single sign-on out, and nothing about SCIM", () => {
    render(
      <EnterpriseLicenseBanner
        mode={EnterpriseLicenseMode.NotIncluded}
        feature={LicensedFeature.SSO}
      />,
    );

    const banner: HTMLElement = screen.getByTestId(
      "enterprise-license-not-included-banner",
    );
    const text: string = `${NOT_INCLUDED_SSO_TITLE} ${NOT_INCLUDED_SSO_DESCRIPTION}`;

    expect(banner).toHaveTextContent(NOT_INCLUDED_SSO_TITLE);
    expect(banner).toHaveTextContent(NOT_INCLUDED_SSO_DESCRIPTION);
    expect(bannerCopyProblems(text, NOT_INCLUDED_SSO_PHRASES)).toEqual([]);
    expect(wrongClaimsIn(text, NOT_INCLUDED_SSO_WRONG_CLAIMS)).toEqual([]);
    expect(
      screen.queryByTestId("enterprise-license-read-only-banner"),
    ).not.toBeInTheDocument();
  });

  test("not included, on a SCIM screen: says the license leaves SCIM out, and nothing about single sign-on", () => {
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
    expect(wrongClaimsIn(text, NOT_INCLUDED_SCIM_WRONG_CLAIMS)).toEqual([]);
  });

  test("not included, on a screen that named no feature: a generic notice that claims nothing specific", () => {
    render(
      <EnterpriseLicenseBanner mode={EnterpriseLicenseMode.NotIncluded} />,
    );

    const banner: HTMLElement = screen.getByTestId(
      "enterprise-license-not-included-banner",
    );

    expect(banner).toHaveTextContent(NOT_INCLUDED_TITLE);
    expect(banner).toHaveTextContent(NOT_INCLUDED_DESCRIPTION);
    expect(banner).not.toHaveTextContent(/single sign-on|SCIM/);
  });

  test.each([EnterpriseLicenseMode.Editable, EnterpriseLicenseMode.Unknown])(
    "%s: shows nothing",
    (mode: EnterpriseLicenseMode) => {
      const { container } = render(<EnterpriseLicenseBanner mode={mode} />);

      expect(container).toBeEmptyDOMElement();
    },
  );

  /*
   * Unknown means the license could not be read (or not yet). The server
   * keeps SSO, SCIM and audit logging running then, so the screen must not
   * claim they stopped - the banner above renders nothing for it.
   */
  test("never tells an admin that SSO stopped when the license state is unknown", () => {
    const { container } = render(
      <EnterpriseLicenseBanner mode={EnterpriseLicenseMode.Unknown} />,
    );

    expect(container).not.toHaveTextContent(/off|stop|refused/i);
  });
});

describe("the banner copy checks (negative controls)", () => {
  test("reject a not-included SSO banner that reuses the lapsed copy (it claims SCIM stopped and blames the license)", () => {
    const lapsed: string = `${READ_ONLY_TITLE} ${READ_ONLY_DESCRIPTION}`;

    expect(wrongClaimsIn(lapsed, NOT_INCLUDED_SSO_WRONG_CLAIMS)).toEqual([
      "\\bSCIM\\b",
      "Enterprise license required",
    ]);
    expect(bannerCopyProblems(lapsed, NOT_INCLUDED_SSO_PHRASES)).toContain(
      "missing: does not include single sign-on",
    );
  });

  test("reject a not-included SCIM banner that talks about single sign-on", () => {
    const ssoCopy: string = `${NOT_INCLUDED_SSO_TITLE} ${NOT_INCLUDED_SSO_DESCRIPTION}`;

    expect(wrongClaimsIn(ssoCopy, NOT_INCLUDED_SCIM_WRONG_CLAIMS)).toEqual([
      "single sign-on is off",
      "Require SSO",
    ]);
  });

  test.each(
    NOT_INCLUDED_SSO_PHRASES.map((phrase: string) => {
      return [phrase];
    }),
  )(
    "report a not-included SSO banner that leaves out: %s",
    (phrase: string) => {
      const text: string = `${NOT_INCLUDED_SSO_TITLE} ${NOT_INCLUDED_SSO_DESCRIPTION}`;

      expect(
        bannerCopyProblems(
          text.split(phrase).join(""),
          NOT_INCLUDED_SSO_PHRASES,
        ),
      ).toContain(`missing: ${phrase}`);
    },
  );

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
    expect(problems).toContain("missing: single sign-on stops");
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
