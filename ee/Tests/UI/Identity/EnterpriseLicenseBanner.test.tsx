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
 * The banner the identity screens show above their configuration. It must
 * say that the configuration is read-only (when it is) AND that sign-in and
 * provisioning keep working - an admin seeing "license required" next to
 * their SSO setup otherwise fears a lock-out.
 */

afterEach(() => {
  cleanup();
});

describe("EnterpriseLicenseBanner", () => {
  test("read-only: says a license is required, that nothing can change, and what keeps working", () => {
    render(<EnterpriseLicenseBanner mode={EnterpriseLicenseMode.ReadOnly} />);

    const banner: HTMLElement = screen.getByTestId(
      "enterprise-license-read-only-banner",
    );

    expect(banner).toHaveTextContent(READ_ONLY_TITLE);
    expect(banner).toHaveTextContent(READ_ONLY_DESCRIPTION);
    expect(READ_ONLY_TITLE).toContain("Enterprise license required");
    expect(READ_ONLY_TITLE).toContain("read-only");
    expect(READ_ONLY_DESCRIPTION).toContain("keep working");
    expect(READ_ONLY_DESCRIPTION).toContain("deprovision");
    expect(
      screen.queryByTestId("enterprise-license-grace-banner"),
    ).not.toBeInTheDocument();
  });

  test("grace: warns that configuration becomes read-only when the grace period ends", () => {
    render(<EnterpriseLicenseBanner mode={EnterpriseLicenseMode.Grace} />);

    const banner: HTMLElement = screen.getByTestId(
      "enterprise-license-grace-banner",
    );

    expect(banner).toHaveTextContent(GRACE_TITLE);
    expect(banner).toHaveTextContent(GRACE_DESCRIPTION);
    expect(GRACE_DESCRIPTION).toContain("read-only");
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
});
