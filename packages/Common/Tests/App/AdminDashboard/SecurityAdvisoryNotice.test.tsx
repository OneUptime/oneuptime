import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";

/*
 * THE SECURITY NOTICE ON THE ADMIN DASHBOARD'S FIRST PAGE.
 *
 * When a published OneUptime security advisory affects the version a
 * self-hosted installation runs, its master admins are told at the top of
 * the Users page, the page the Admin Dashboard opens on:
 *
 *   - what is affected, and the release to upgrade to - or that no release
 *     fixes it yet;
 *   - each advisory: its severity, its summary linked to GitHub, its
 *     identifiers, the versions it affects and the release that fixes it;
 *   - the upgrade guide, and what the check sends, each in a new tab, and
 *     saying so;
 *   - when the check last read the advisories, and - when the latest check
 *     failed after that - why, and that this is what an earlier check found.
 *
 * Nothing is drawn for anything but a security state, and it cannot be
 * hidden: it goes when the installation runs a version no advisory affects.
 * Every word is in every language the Admin Dashboard speaks.
 */

let mockBillingEnabled: boolean = false;
let mockIsMasterAdmin: boolean = true;
let mockStatusJson: unknown = null;
const mockFetchedUrls: Array<string> = [];

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return mockBillingEnabled;
    },
  });

  return mocked;
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return mockIsMasterAdmin;
      },
      isLoggedIn: (): boolean => {
        return true;
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  const responseModule: typeof import("../../../Types/API/HTTPResponse") =
    jest.requireActual(
      "../../../Types/API/HTTPResponse",
    ) as typeof import("../../../Types/API/HTTPResponse");

  return {
    __esModule: true,
    default: {
      fetch: (options: {
        url: { toString: () => string };
      }): Promise<unknown> => {
        mockFetchedUrls.push(options.url.toString());
        return Promise.resolve(
          new responseModule.default(200, mockStatusJson as never, {}),
        );
      },
    },
  };
});

import SecurityAdvisoryNotice, {
  SECURITY_ADVISORY_NOTICE_COPY,
  isShowingEarlierCheck,
} from "../../../../App/FeatureSet/AdminDashboard/src/Components/SecurityAdvisories/SecurityAdvisoryNotice";
import { UPDATE_STATUS_PILL_COPY } from "../../../UI/Components/UpdateStatus/UpdateStatusPill";
import UpdateStatusLoader, {
  getUpdateCheckDocsUrl,
  getUpgradeGuideUrl,
} from "../../../UI/Utils/UpdateStatus";
import { SecurityAdvisorySeverity } from "../../../Types/UpdateCheck/SecurityAdvisory";
import UpdateCheckFailure from "../../../Types/UpdateCheck/UpdateCheckFailure";
import UpdateStatusUtil, {
  AffectingAdvisory,
  UpdateState,
  UpdateStatus,
} from "../../../Types/UpdateCheck/UpdateStatus";

const ADMIN_LOCALES: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
  "Locales",
);

const LANGUAGES: Array<string> = [
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

type Locale = Record<string, unknown>;

const readLocale: (code: string) => Locale = (code: string): Locale => {
  return JSON.parse(
    fs.readFileSync(path.join(ADMIN_LOCALES, `${code}.json`), "utf8"),
  ) as Locale;
};

const PLACEHOLDER: RegExp = /\{\{\s*[^}]+\s*\}\}/g;

const placeholders: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return (text.match(PLACEHOLDER) || []).sort();
};

// Every key the notice and the Admin Dashboard's footer pill look up.
const SINGLE_KEYS: Array<string> = [
  SECURITY_ADVISORY_NOTICE_COPY.securityUpdateTitle,
  SECURITY_ADVISORY_NOTICE_COPY.securityAdvisoryTitle,
  SECURITY_ADVISORY_NOTICE_COPY.howToUpgrade,
  SECURITY_ADVISORY_NOTICE_COPY.opensInNewTab,
  SECURITY_ADVISORY_NOTICE_COPY.fixedIn,
  SECURITY_ADVISORY_NOTICE_COPY.noFixYet,
  SECURITY_ADVISORY_NOTICE_COPY.affects,
  SECURITY_ADVISORY_NOTICE_COPY.checkedAt,
  SECURITY_ADVISORY_NOTICE_COPY.whatTheCheckSends,
  ...Object.values(SECURITY_ADVISORY_NOTICE_COPY.severity),
  ...Object.values(SECURITY_ADVISORY_NOTICE_COPY.failures),
  UPDATE_STATUS_PILL_COPY.updateAvailable,
  UPDATE_STATUS_PILL_COPY.securityUpdate,
  UPDATE_STATUS_PILL_COPY.securityAdvisory,
  UPDATE_STATUS_PILL_COPY.updateDescription,
  UPDATE_STATUS_PILL_COPY.opensGuide,
];

const PLURALS: Array<{ one: string; other: string }> = [
  SECURITY_ADVISORY_NOTICE_COPY.securityUpdateLead,
  SECURITY_ADVISORY_NOTICE_COPY.securityAdvisoryLead,
  UPDATE_STATUS_PILL_COPY.securityUpdateDescription,
  UPDATE_STATUS_PILL_COPY.securityAdvisoryDescription,
];

async function instanceFor(locale: string): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: locale,
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      [locale]: { translation: readLocale(locale) },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });

  return instance;
}

const advisory: (
  overrides?: Partial<AffectingAdvisory>,
) => AffectingAdvisory = (
  overrides?: Partial<AffectingAdvisory>,
): AffectingAdvisory => {
  return {
    ghsaId: "GHSA-9q6r-9h5m-572w",
    cveId: "CVE-2026-12345",
    summary: "Any user can read every user's TOTP secret",
    severity: SecurityAdvisorySeverity.Critical,
    url: "https://github.com/OneUptime/oneuptime/security/advisories/GHSA-9q6r-9h5m-572w",
    publishedAt: "2026-08-10T00:00:00.000Z",
    affectedVersions: "<= 14.0.66",
    fixedIn: "14.0.67",
    ...(overrides || {}),
  };
};

const status: (overrides?: Partial<UpdateStatus>) => UpdateStatus = (
  overrides?: Partial<UpdateStatus>,
): UpdateStatus => {
  return {
    state: UpdateState.SecurityUpdate,
    currentVersion: "14.0.60",
    isVersionComparable: true,
    isUpdateCheckDisabled: false,
    latestVersion: "14.0.80",
    latestVersionPublishedAt: "2026-10-20T00:00:00.000Z",
    isUpdateAvailable: true,
    isMajorUpgrade: false,
    recommendedVersion: "14.0.80",
    advisories: [advisory()],
    latestVersionCheckedAt: "2026-10-30T08:00:00.000Z",
    advisoriesCheckedAt: "2026-10-30T08:00:01.000Z",
    lastCheckAttemptedAt: "2026-10-30T08:00:00.000Z",
    lastCheckFailure: null,
    ...(overrides || {}),
  };
};

async function renderNotice(
  value: UpdateStatus | null | undefined,
  locale: string = "en",
): Promise<HTMLElement | null> {
  const instance: i18n = await instanceFor(locale);

  await act(async () => {
    render(
      <I18nextProvider i18n={instance}>
        <SecurityAdvisoryNotice status={value} />
      </I18nextProvider>,
    );
  });

  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });

  return screen.queryByTestId("security-advisory-notice");
}

beforeEach(() => {
  mockBillingEnabled = false;
  mockIsMasterAdmin = true;
  mockStatusJson = null;
  mockFetchedUrls.length = 0;
  UpdateStatusLoader.clear();
});

afterEach(() => {
  cleanup();
});

describe("a security update", () => {
  test("says what is affected and the release to upgrade to, with the upgrade guide", async () => {
    const notice: HTMLElement | null = await renderNotice(status());

    expect(notice).not.toBeNull();
    expect(notice).toHaveAttribute("data-state", UpdateState.SecurityUpdate);
    expect(within(notice!).getByRole("heading")).toHaveTextContent(
      "Security update needed",
    );
    expect(
      screen.getByTestId("security-advisory-notice-lead"),
    ).toHaveTextContent(
      "A published security advisory affects version 14.0.60, which this installation runs. Upgrade to 14.0.80 to fix it.",
    );

    const upgrade: HTMLElement = screen.getByTestId(
      "security-advisory-notice-upgrade",
    );

    expect(upgrade).toHaveAttribute("href", getUpgradeGuideUrl());
    expect(upgrade).toHaveAttribute("target", "_blank");
    expect(upgrade).toHaveTextContent("How to upgrade");
    expect(upgrade).toHaveTextContent("(Opens in a new tab)");
  });

  test("lists each advisory: severity, summary linked to GitHub, identifiers, versions and fix", async () => {
    await renderNotice(
      status({
        advisories: [
          advisory(),
          advisory({
            ghsaId: "GHSA-aaaa-bbbb-cccc",
            cveId: null,
            summary: "Unauthenticated workflow execution",
            severity: SecurityAdvisorySeverity.Medium,
            affectedVersions: null,
            fixedIn: null,
            url: null,
          }),
        ],
      }),
    );

    const first: HTMLElement = screen.getByTestId(
      "security-advisory-GHSA-9q6r-9h5m-572w",
    );

    expect(first).toHaveAttribute("data-severity", "critical");
    expect(first).toHaveTextContent("Critical");
    expect(
      within(first).getByRole("link", { name: /TOTP secret/ }),
    ).toHaveAttribute(
      "href",
      "https://github.com/OneUptime/oneuptime/security/advisories/GHSA-9q6r-9h5m-572w",
    );
    expect(first).toHaveTextContent(
      "GHSA-9q6r-9h5m-572w · CVE-2026-12345 · Affects <= 14.0.66",
    );
    expect(first).toHaveTextContent("Fixed in 14.0.67");

    const second: HTMLElement = screen.getByTestId(
      "security-advisory-GHSA-aaaa-bbbb-cccc",
    );

    expect(second).toHaveTextContent("Medium");
    expect(within(second).queryByRole("link")).toBeNull();
    expect(second).toHaveTextContent("No fixed release yet");
    expect(
      screen.getByTestId("security-advisory-notice-lead"),
    ).toHaveTextContent(
      "2 published security advisories affect version 14.0.60, which this installation runs. Upgrade to 14.0.80 to fix them.",
    );
  });

  test("says when the check last read the advisories, and links what it sends", async () => {
    await renderNotice(status());

    expect(
      screen.getByTestId("security-advisory-notice-checked"),
    ).toHaveTextContent(/^Checked for security advisories on .*2026/);
    expect(
      screen.queryByTestId("security-advisory-notice-failure"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /What this check sends/ }),
    ).toHaveAttribute("href", getUpdateCheckDocsUrl());
  });
});

describe("an advisory no release fixes yet", () => {
  test("says so, and to read the advisory for what to do", async () => {
    const notice: HTMLElement | null = await renderNotice(
      status({
        state: UpdateState.SecurityAdvisory,
        recommendedVersion: null,
        advisories: [advisory({ fixedIn: null })],
      }),
    );

    expect(within(notice!).getByRole("heading")).toHaveTextContent(
      "Security advisory: no fixed release yet",
    );
    expect(
      screen.getByTestId("security-advisory-notice-lead"),
    ).toHaveTextContent(
      "A published security advisory affects version 14.0.60, which this installation runs. No release fixes it yet: read it for what to do until one does.",
    );
  });
});

describe("when the latest check failed", () => {
  test.each([
    [UpdateCheckFailure.RateLimited, "was turned away by GitHub's rate limit"],
    [UpdateCheckFailure.Unreachable, "could not reach GitHub"],
    [UpdateCheckFailure.TimedOut, "timed out waiting for GitHub"],
    [UpdateCheckFailure.HttpError, "got an error from GitHub"],
    [
      UpdateCheckFailure.MalformedResponse,
      "got an answer that is not GitHub's",
    ],
  ])(
    "%s: says why, and that this is what an earlier check found",
    async (failure: UpdateCheckFailure, words: string) => {
      await renderNotice(
        status({
          lastCheckAttemptedAt: "2026-10-31T08:00:00.000Z",
          lastCheckFailure: failure,
        }),
      );

      const line: HTMLElement = screen.getByTestId(
        "security-advisory-notice-failure",
      );

      expect(line).toHaveTextContent(words);
      expect(line).toHaveTextContent("so this is what an earlier check found.");
    },
  );

  test("a failure older than the advisories shown is not news", () => {
    expect(
      isShowingEarlierCheck(
        status({
          lastCheckAttemptedAt: "2026-10-29T08:00:00.000Z",
          lastCheckFailure: UpdateCheckFailure.Unreachable,
        }),
      ),
    ).toBe(false);
    expect(isShowingEarlierCheck(status())).toBe(false);
    expect(
      isShowingEarlierCheck(
        status({
          advisoriesCheckedAt: null,
          lastCheckFailure: UpdateCheckFailure.Unreachable,
        }),
      ),
    ).toBe(true);
  });
});

describe("when there is nothing to say", () => {
  test.each([
    [
      "an update without an advisory",
      status({ state: UpdateState.UpdateAvailable, advisories: [] }),
    ],
    ["up to date", status({ state: UpdateState.UpToDate, advisories: [] })],
    ["unknown", status({ state: UpdateState.Unknown, advisories: [] })],
    ["a security state with no advisory", status({ advisories: [] })],
  ] as Array<[string, UpdateStatus]>)(
    "draws nothing: %s",
    async (_name: string, value: UpdateStatus) => {
      expect(await renderNotice(value)).toBeNull();
    },
  );

  test("draws nothing with no status", async () => {
    expect(await renderNotice(null)).toBeNull();
  });

  test("offers no way to hide it", async () => {
    const notice: HTMLElement | null = await renderNotice(status());

    expect(within(notice!).queryByRole("button")).toBeNull();
  });
});

describe("read from the server", () => {
  test("a master admin's notice reads the update status", async () => {
    mockStatusJson = UpdateStatusUtil.toJSON(status());

    expect(await renderNotice(undefined)).not.toBeNull();
    expect(mockFetchedUrls).toHaveLength(1);
    expect(mockFetchedUrls[0]).toMatch(/\/global-config\/update-status$/);
  });

  test("nothing is asked, or drawn, for anybody but a master admin", async () => {
    mockIsMasterAdmin = false;
    mockStatusJson = UpdateStatusUtil.toJSON(status());

    expect(await renderNotice(undefined)).toBeNull();
    expect(mockFetchedUrls).toEqual([]);
  });

  test("nothing is asked, or drawn, on OneUptime Cloud", async () => {
    mockBillingEnabled = true;
    mockStatusJson = UpdateStatusUtil.toJSON(status());

    expect(await renderNotice(undefined)).toBeNull();
    expect(mockFetchedUrls).toEqual([]);
  });
});

describe("in every language the Admin Dashboard speaks", () => {
  test.each(LANGUAGES)(
    "%s has every word, with the English placeholders",
    (code: string) => {
      const locale: Locale = readLocale(code);
      const english: Locale = readLocale("en");

      for (const key of SINGLE_KEYS) {
        expect({ key, english: english[key] }).toEqual({ key, english: key });
        expect(typeof locale[key]).toBe("string");
        expect(placeholders(locale[key] as string)).toEqual(placeholders(key));
      }

      for (const plural of PLURALS) {
        expect(english[plural.other]).toBe(plural.other);
        expect(english[`${plural.other}_one`]).toBe(plural.one);
        expect(placeholders(locale[plural.other] as string)).toEqual(
          placeholders(plural.other),
        );
        expect(placeholders(locale[`${plural.other}_one`] as string)).toEqual(
          placeholders(plural.one),
        );
      }
    },
  );

  test.each(
    LANGUAGES.filter((code: string): boolean => {
      return code !== "en";
    }),
  )("%s words it in its own language", (code: string) => {
    const locale: Locale = readLocale(code);

    for (const key of [
      ...SINGLE_KEYS,
      ...PLURALS.map((plural: { other: string }): string => {
        return plural.other;
      }),
    ]) {
      expect({ key, value: locale[key] }).not.toEqual({ key, value: key });
    }
  });

  test.each([["de"], ["ja"], ["fa"], ["ru"], ["zh-CN"]])(
    "draws the notice in %s",
    async (code: string) => {
      const locale: Locale = readLocale(code);
      const notice: HTMLElement | null = await renderNotice(status(), code);

      expect(within(notice!).getByRole("heading")).toHaveTextContent(
        locale[SECURITY_ADVISORY_NOTICE_COPY.securityUpdateTitle] as string,
      );
      expect(notice).toHaveTextContent(
        locale[SECURITY_ADVISORY_NOTICE_COPY.howToUpgrade] as string,
      );
      expect(notice).toHaveTextContent(
        locale[SECURITY_ADVISORY_NOTICE_COPY.severity.critical] as string,
      );
    },
  );
});

describe("on the Admin Dashboard's first page", () => {
  test("comes before everything else on the Users page", () => {
    const page: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "App",
        "FeatureSet",
        "AdminDashboard",
        "src",
        "Pages",
        "Users",
        "Index.tsx",
      ),
      "utf8",
    );

    const notice: number = page.indexOf("<SecurityAdvisoryNotice />");
    const checklist: number = page.indexOf("<ServerSetupChecklist />");
    const table: number = page.indexOf("<ModelTable<User>");

    expect(notice).toBeGreaterThan(-1);
    expect(notice).toBeLessThan(checklist);
    expect(checklist).toBeLessThan(table);
  });
});
