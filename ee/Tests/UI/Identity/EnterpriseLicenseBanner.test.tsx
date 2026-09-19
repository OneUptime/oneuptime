import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import EnterpriseLicenseBanner, {
  GRACE_DESCRIPTION,
  GRACE_TITLE,
  READ_ONLY_DESCRIPTION,
  READ_ONLY_TITLE,
} from "../../../Dashboard/SSO/License/EnterpriseLicenseBanner";
import { EnterpriseLicenseMode } from "../../../Dashboard/SSO/License/EnterpriseLicenseMode";

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
  "14-day trial or grace period",
  "single sign-on stops",
  '"Require SSO" is no longer enforced',
  "members sign in with their password",
  "SCIM requests are refused",
  "read-only",
  "until an Enterprise license is activated",
];

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
