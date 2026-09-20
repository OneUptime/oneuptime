import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";
import { JSONObject } from "Common/Types/JSON";

/*
 * Settings > Audit Logs against the Enterprise license.
 *
 * Once the trial or the grace period is over, audit logging stops recording -
 * the Community Edition's behaviour - until a license is activated, whatever
 * the "Enable Audit Logs" switch says. The page says so above the switch, and
 * warns about it during the trial or grace period. With a valid license, on
 * OneUptime Cloud (the plan decides there) or when the license cannot be read
 * it says nothing: the server keeps recording while the license state is
 * unknown, so the page must not claim otherwise. A license whose features
 * leave audit logs out stops recording the same way, and the page says that.
 *
 * The audit log table on every resource page shows the same copy
 * (getAuditLogsStoppedCopy), so it must read right away from the settings
 * too: it never points "below" or at "these settings".
 *
 * Billing is pinned in every test: CI's config.env sets BILLING_ENABLED=true.
 */

let billingEnabledForTest: boolean = false;

jest.mock("Common/UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  return mocked;
});

const mockLicenseFetch: jest.Mock = jest.fn();

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      fetch: (...args: Array<unknown>): unknown => {
        return mockLicenseFetch(...args);
      },
      getFriendlyMessage: (): string => {
        return "";
      },
    },
  };
});

jest.mock("Common/UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: { name: string }): ReactElement => {
      return <div data-testid={`card-model-detail-${props.name}`} />;
    },
  };
});

import AuditLogsLicenseNotice, {
  AUDIT_LOGS_GRACE_DESCRIPTION,
  AUDIT_LOGS_GRACE_TITLE,
  AUDIT_LOGS_LAPSED_DESCRIPTION,
  AUDIT_LOGS_LAPSED_TITLE,
  AUDIT_LOGS_NOT_INCLUDED_DESCRIPTION,
  AUDIT_LOGS_NOT_INCLUDED_TITLE,
  getAuditLogsStoppedCopy,
} from "../../../Dashboard/AuditLogs/AuditLogsLicenseNotice";
import AuditLogsSettings from "../../../Dashboard/AuditLogs/AuditLogsSettings";
import { EnterpriseLicenseMode } from "../../../Dashboard/SSO/License/EnterpriseLicenseMode";
import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
} from "Common/Types/EnterpriseLicense/EnterpriseLicensePeriods";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/project-id/settings/audit-logs"),
  currentProject: null,
  hasPaymentMethod: true,
};

const LAPSED_NOTICE_TEST_ID: string = "audit-logs-license-lapsed-notice";
const GRACE_NOTICE_TEST_ID: string = "audit-logs-license-grace-notice";

// What the lapsed notice must say, and what it must never say.
const LAPSED_PHRASES: Array<string> = [
  "audit logging is not recording",
  "nothing is recorded in the audit log, whatever the Audit Logs settings say",
  "Entries recorded so far are kept",
  "Recording resumes with the same settings as soon as a license is activated",
];

const NOT_INCLUDED_PHRASES: Array<string> = [
  "does not include audit logs",
  "audit logging is not recording",
  "nothing is recorded in the audit log, whatever the Audit Logs settings say",
  "Entries recorded so far are kept",
  "as soon as a license that includes audit logs is activated",
];

// Copy that only reads right on Settings > Audit Logs, not in the table.
const SETTINGS_PAGE_ONLY_WORDING: Array<RegExp> = [
  /\bbelow\b/i,
  /\bthese settings\b/i,
  /\babove\b/i,
];

const settingsPageOnlyWordingIn: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return SETTINGS_PAGE_ONLY_WORDING.filter((pattern: RegExp) => {
    return pattern.test(text);
  }).map((pattern: RegExp) => {
    return pattern.source;
  });
};

const GRACE_PHRASES: Array<string> = [
  "audit logging stops when the trial or grace period ends",
  "14-day trial of an installation with no license",
  "30-day grace period after a license expires",
  "nothing more is recorded until an Enterprise license is activated",
  "Entries recorded so far are kept",
];

const RETIRED_CLAIMS: Array<RegExp> = [
  /audit logging continues/i,
  /keeps? (?:recording|running|working)/i,
  /never stops?/i,
];

const noticeCopyProblems: (
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

const answerLicense: (payload: JSONObject) => void = (
  payload: JSONObject,
): void => {
  mockLicenseFetch.mockResolvedValue({
    isSuccess: (): boolean => {
      return true;
    },
    data: payload,
  });
};

const renderSettings: () => Promise<void> = async (): Promise<void> => {
  render(<AuditLogsSettings {...PAGE_PROPS} />);

  // Let the license request settle before asserting on what it decided.
  if (!billingEnabledForTest) {
    await waitFor(() => {
      expect(mockLicenseFetch).toHaveBeenCalled();
    });
  }

  await act(async () => {
    await Promise.resolve();
  });
};

beforeEach(() => {
  billingEnabledForTest = false;
  mockLicenseFetch.mockReset();
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID("11111111-1111-4111-8111-111111111111"));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("AuditLogsLicenseNotice", () => {
  test("lapsed: says audit logging is not recording, that nothing is lost, and that a license brings it back", () => {
    render(<AuditLogsLicenseNotice mode={EnterpriseLicenseMode.ReadOnly} />);

    const notice: HTMLElement = screen.getByTestId(LAPSED_NOTICE_TEST_ID);

    expect(notice).toHaveTextContent(AUDIT_LOGS_LAPSED_TITLE);
    expect(notice).toHaveTextContent(AUDIT_LOGS_LAPSED_DESCRIPTION);
    expect(
      noticeCopyProblems(
        `${AUDIT_LOGS_LAPSED_TITLE} ${AUDIT_LOGS_LAPSED_DESCRIPTION}`,
        LAPSED_PHRASES,
      ),
    ).toEqual([]);
  });

  test("not included: says the license leaves audit logs out, that nothing is lost, and what brings it back", () => {
    render(<AuditLogsLicenseNotice mode={EnterpriseLicenseMode.NotIncluded} />);

    const notice: HTMLElement = screen.getByTestId(LAPSED_NOTICE_TEST_ID);
    const text: string = `${AUDIT_LOGS_NOT_INCLUDED_TITLE} ${AUDIT_LOGS_NOT_INCLUDED_DESCRIPTION}`;

    expect(notice).toHaveTextContent(AUDIT_LOGS_NOT_INCLUDED_TITLE);
    expect(notice).toHaveTextContent(AUDIT_LOGS_NOT_INCLUDED_DESCRIPTION);
    expect(noticeCopyProblems(text, NOT_INCLUDED_PHRASES)).toEqual([]);
    // The license is fine otherwise: no "license required", no lapse.
    expect(text).not.toMatch(/Enterprise license required|missing|expired/i);
  });

  test("the copy the table shares reads right away from the settings", () => {
    for (const mode of [
      EnterpriseLicenseMode.ReadOnly,
      EnterpriseLicenseMode.NotIncluded,
    ]) {
      const copy: { title: string; description: string } | null =
        getAuditLogsStoppedCopy(mode);

      expect(copy).not.toBeNull();
      expect(
        settingsPageOnlyWordingIn(`${copy!.title} ${copy!.description}`),
      ).toEqual([]);
    }

    expect(getAuditLogsStoppedCopy(EnterpriseLicenseMode.ReadOnly)).toEqual({
      title: AUDIT_LOGS_LAPSED_TITLE,
      description: AUDIT_LOGS_LAPSED_DESCRIPTION,
    });
  });

  test.each([
    EnterpriseLicenseMode.Grace,
    EnterpriseLicenseMode.Editable,
    EnterpriseLicenseMode.Unknown,
  ])(
    "%s: the license has not stopped recording",
    (mode: EnterpriseLicenseMode) => {
      expect(getAuditLogsStoppedCopy(mode)).toBeNull();
    },
  );

  test("trial or grace period: warns that recording stops when it ends", () => {
    render(<AuditLogsLicenseNotice mode={EnterpriseLicenseMode.Grace} />);

    const notice: HTMLElement = screen.getByTestId(GRACE_NOTICE_TEST_ID);

    expect(notice).toHaveTextContent(AUDIT_LOGS_GRACE_TITLE);
    expect(notice).toHaveTextContent(AUDIT_LOGS_GRACE_DESCRIPTION);
    expect(
      noticeCopyProblems(
        `${AUDIT_LOGS_GRACE_TITLE} ${AUDIT_LOGS_GRACE_DESCRIPTION}`,
        GRACE_PHRASES,
      ),
    ).toEqual([]);
  });

  // It used to say "the 14-day trial or grace period": the grace period is 30 days.
  test("trial or grace period: states each with its own length, from the constants", () => {
    expect(AUDIT_LOGS_GRACE_DESCRIPTION).toContain(
      `${ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS}-day trial`,
    );
    expect(AUDIT_LOGS_GRACE_DESCRIPTION).toContain(
      `${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS}-day grace period`,
    );
    expect(AUDIT_LOGS_GRACE_DESCRIPTION).not.toContain(
      "14-day trial or grace period",
    );
    expect(AUDIT_LOGS_GRACE_DESCRIPTION).not.toMatch(/14-day grace/);
  });

  test.each([EnterpriseLicenseMode.Editable, EnterpriseLicenseMode.Unknown])(
    "%s: shows nothing",
    (mode: EnterpriseLicenseMode) => {
      const { container } = render(<AuditLogsLicenseNotice mode={mode} />);

      expect(container).toBeEmptyDOMElement();
    },
  );
});

describe("the notice copy checks (negative controls)", () => {
  test("reject the settings-page-only wording the table cannot use", () => {
    expect(
      settingsPageOnlyWordingIn(
        "Without a valid Enterprise license nothing is recorded in the audit log, whatever the settings below say. Recording resumes with these settings as soon as a license is activated.",
      ),
    ).toEqual(["\\bbelow\\b", "\\bthese settings\\b"]);
  });

  test.each(
    NOT_INCLUDED_PHRASES.map((phrase: string) => {
      return [phrase];
    }),
  )("report a not-included notice that leaves out: %s", (phrase: string) => {
    const text: string = `${AUDIT_LOGS_NOT_INCLUDED_TITLE} ${AUDIT_LOGS_NOT_INCLUDED_DESCRIPTION}`;

    expect(
      noticeCopyProblems(text.split(phrase).join(""), NOT_INCLUDED_PHRASES),
    ).toEqual([`missing: ${phrase}`]);
  });

  test("reject a notice that says audit logging keeps recording without a license", () => {
    expect(
      noticeCopyProblems(
        "Audit logging continues without a license: it keeps recording as configured.",
        LAPSED_PHRASES,
      ),
    ).toEqual([
      `missing: ${LAPSED_PHRASES[0]}`,
      `missing: ${LAPSED_PHRASES[1]}`,
      `missing: ${LAPSED_PHRASES[2]}`,
      `missing: ${LAPSED_PHRASES[3]}`,
      "retired: audit logging continues",
      "retired: keeps? (?:recording|running|working)",
    ]);
  });

  test.each(
    LAPSED_PHRASES.map((phrase: string) => {
      return [phrase];
    }),
  )("report a lapsed notice that leaves out: %s", (phrase: string) => {
    const text: string = `${AUDIT_LOGS_LAPSED_TITLE} ${AUDIT_LOGS_LAPSED_DESCRIPTION}`;

    expect(
      noticeCopyProblems(text.split(phrase).join(""), LAPSED_PHRASES),
    ).toEqual([`missing: ${phrase}`]);
  });

  test.each(
    GRACE_PHRASES.map((phrase: string) => {
      return [phrase];
    }),
  )("report a grace notice that leaves out: %s", (phrase: string) => {
    const text: string = `${AUDIT_LOGS_GRACE_TITLE} ${AUDIT_LOGS_GRACE_DESCRIPTION}`;

    expect(
      noticeCopyProblems(text.split(phrase).join(""), GRACE_PHRASES),
    ).toEqual([`missing: ${phrase}`]);
  });
});

describe("Settings > Audit Logs against the license", () => {
  test.each([
    [
      "expired, after the grace period",
      { status: "expired", licenseValid: false },
    ],
    ["missing, after the trial", { status: "missing", licenseValid: false }],
    ["invalid", { status: "invalid", licenseValid: false }],
  ])(
    "%s: says audit logging is not recording, above the switch",
    async (_name: string, payload: JSONObject) => {
      answerLicense(payload);

      await renderSettings();

      expect(
        await screen.findByTestId(LAPSED_NOTICE_TEST_ID),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("card-model-detail-Audit Logs"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId(GRACE_NOTICE_TEST_ID),
      ).not.toBeInTheDocument();
    },
  );

  test("trial or grace period: warns, and says nothing has stopped yet", async () => {
    answerLicense({ status: "grace", licenseValid: true });

    await renderSettings();

    expect(await screen.findByTestId(GRACE_NOTICE_TEST_ID)).toBeInTheDocument();
    expect(screen.queryByTestId(LAPSED_NOTICE_TEST_ID)).not.toBeInTheDocument();
  });

  test("a valid license that leaves audit logs out: says audit logging is not recording", async () => {
    answerLicense({
      status: "valid",
      licenseValid: true,
      features: ["sso", "scim"],
    });

    await renderSettings();

    const notice: HTMLElement = await screen.findByTestId(
      LAPSED_NOTICE_TEST_ID,
    );

    expect(notice).toHaveTextContent(AUDIT_LOGS_NOT_INCLUDED_TITLE);
    expect(screen.queryByTestId(GRACE_NOTICE_TEST_ID)).not.toBeInTheDocument();
  });

  test.each([
    ["audit logs", ["audit-logs"]],
    ["every feature", "all"],
  ])(
    "a valid license that includes %s: says nothing",
    async (_name: string, features: string | Array<string>) => {
      answerLicense({ status: "valid", licenseValid: true, features });

      await renderSettings();

      expect(
        screen.queryByTestId(LAPSED_NOTICE_TEST_ID),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(GRACE_NOTICE_TEST_ID),
      ).not.toBeInTheDocument();
    },
  );

  test("a valid license: says nothing", async () => {
    answerLicense({ status: "valid", licenseValid: true });

    await renderSettings();

    expect(screen.queryByTestId(LAPSED_NOTICE_TEST_ID)).not.toBeInTheDocument();
    expect(screen.queryByTestId(GRACE_NOTICE_TEST_ID)).not.toBeInTheDocument();
  });

  /*
   * The server keeps recording while it cannot read the license, so a failed
   * read must never make the page claim that recording stopped.
   */
  test("the license cannot be read: says nothing", async () => {
    mockLicenseFetch.mockRejectedValue(new Error("network down"));

    await renderSettings();

    expect(screen.queryByTestId(LAPSED_NOTICE_TEST_ID)).not.toBeInTheDocument();
    expect(screen.queryByTestId(GRACE_NOTICE_TEST_ID)).not.toBeInTheDocument();
  });

  test("OneUptime Cloud: the plan decides, so there is no license to ask about", async () => {
    billingEnabledForTest = true;
    answerLicense({ status: "expired", licenseValid: false });

    await renderSettings();

    expect(mockLicenseFetch).not.toHaveBeenCalled();
    expect(screen.queryByTestId(LAPSED_NOTICE_TEST_ID)).not.toBeInTheDocument();
  });
});
