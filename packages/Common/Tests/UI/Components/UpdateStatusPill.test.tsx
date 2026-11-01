import UpdateStatusPill, {
  UPDATE_STATUS_PILL_COPY,
  describeUpdateStatus,
} from "../../../UI/Components/UpdateStatus/UpdateStatusPill";
import UpdateStatusLoader, {
  getUpdateCheckDocsUrl,
  getUpgradeGuideUrl,
} from "../../../UI/Utils/UpdateStatus";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import { SecurityAdvisorySeverity } from "../../../Types/UpdateCheck/SecurityAdvisory";
import UpdateStatusUtil, {
  AffectingAdvisory,
  UpdateState,
  UpdateStatus,
} from "../../../Types/UpdateCheck/UpdateStatus";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The footers' "Update available" / "Security update" pill, and the one
 * request per page that feeds it and the Admin Dashboard's notice.
 *
 *   - An update: amber, quiet, "Update available".
 *   - An advisory that affects the version, fixed by a release: red, with a
 *     shield, "Security update". With no release that fixes it: "Security
 *     advisory".
 *   - Up to date, unknown, or no status: nothing at all.
 *   - Each opens this installation's upgrade guide in a new tab and says,
 *     on hover and to a screen reader, what it is about.
 *   - Only a master admin of a self-hosted installation asks the server:
 *     nobody else, and never on OneUptime Cloud. One request a page serves
 *     every component; a failed one is asked again.
 *   - In every Dashboard language, as its locale words it.
 */

let billingEnabled: boolean = false;
let isMasterAdmin: boolean = true;

jest.mock("../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mockedConfig: Record<string, unknown> = { ...actualConfig };

  Object.defineProperty(mockedConfig, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabled;
    },
  });

  return mockedConfig;
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdmin;
      },
      isLoggedIn: (): boolean => {
        return true;
      },
    },
  };
});

const fetchCalls: Array<string> = [];
let respond: () => HTTPResponse<JSONObject> | HTTPErrorResponse | Error;

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      fetch: (options: {
        url: { toString: () => string };
      }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        fetchCalls.push(options.url.toString());

        const answer: HTTPResponse<JSONObject> | HTTPErrorResponse | Error =
          respond();

        return answer instanceof Error
          ? Promise.reject(answer)
          : Promise.resolve(answer);
      },
    },
  };
});

const DASHBOARD_LOCALES: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const advisory: AffectingAdvisory = {
  ghsaId: "GHSA-aaaa-bbbb-cccc",
  cveId: null,
  summary: "Every user's TOTP secret could be read",
  severity: SecurityAdvisorySeverity.Critical,
  url: "https://github.com/OneUptime/oneuptime/security/advisories/GHSA-aaaa-bbbb-cccc",
  publishedAt: "2026-10-01T00:00:00.000Z",
  affectedVersions: "<= 14.0.66",
  fixedIn: "14.0.67",
};

const status: (overrides?: Partial<UpdateStatus>) => UpdateStatus = (
  overrides?: Partial<UpdateStatus>,
): UpdateStatus => {
  return {
    state: UpdateState.UpdateAvailable,
    currentVersion: "14.0.60",
    isVersionComparable: true,
    isUpdateCheckDisabled: false,
    latestVersion: "14.0.80",
    latestVersionPublishedAt: "2026-10-20T00:00:00.000Z",
    isUpdateAvailable: true,
    isMajorUpgrade: false,
    recommendedVersion: null,
    advisories: [],
    latestVersionCheckedAt: "2026-10-30T08:00:00.000Z",
    advisoriesCheckedAt: "2026-10-30T08:00:01.000Z",
    lastCheckAttemptedAt: "2026-10-30T08:00:00.000Z",
    lastCheckFailure: null,
    ...(overrides || {}),
  };
};

const SECURITY_UPDATE: UpdateStatus = status({
  state: UpdateState.SecurityUpdate,
  recommendedVersion: "14.0.80",
  advisories: [advisory],
});

const SECURITY_ADVISORY: UpdateStatus = status({
  state: UpdateState.SecurityAdvisory,
  advisories: [advisory, { ...advisory, ghsaId: "GHSA-aaaa-bbbb-dddd" }],
});

const readLocale: (code: string) => Record<string, unknown> = (
  code: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES, `${code}.json`), "utf8"),
  ) as Record<string, unknown>;
};

async function renderIn(
  value: UpdateStatus | null,
  language: string = "en",
): Promise<void> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      [language]: { translation: readLocale(language) },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });

  await act(async () => {
    render(
      <I18nextProvider i18n={instance}>
        <UpdateStatusPill status={value} />
      </I18nextProvider>,
    );
  });
}

const ok: (body: JSONObject) => HTTPResponse<JSONObject> = (
  body: JSONObject,
): HTTPResponse<JSONObject> => {
  return new HTTPResponse<JSONObject>(200, body, {});
};

beforeEach(() => {
  billingEnabled = false;
  isMasterAdmin = true;
  fetchCalls.length = 0;
  respond = () => {
    return ok(UpdateStatusUtil.toJSON(status()));
  };
  UpdateStatusLoader.clear();
});

afterEach(() => {
  cleanup();
});

describe("the pill", () => {
  test("says a newer release is available, quietly, and opens the upgrade guide", async () => {
    await renderIn(status());

    const pill: HTMLElement = screen.getByTestId("update-status-pill");

    expect(pill).toHaveTextContent("Update available");
    expect(pill).toHaveAttribute("data-state", UpdateState.UpdateAvailable);
    expect(pill).toHaveAttribute("href", getUpgradeGuideUrl());
    expect(pill).toHaveAttribute("target", "_blank");
    expect(pill).toHaveAttribute("rel", "noopener noreferrer");
    expect(pill.className).toContain("bg-amber-50");
    expect(pill.getAttribute("aria-label")).toBe(
      "Update available. Version 14.0.80 is available. This installation runs 14.0.60. Opens the upgrade guide in a new tab.",
    );
  });

  test("says a security update is needed, in red, with what to upgrade to", async () => {
    await renderIn(SECURITY_UPDATE);

    const pill: HTMLElement = screen.getByTestId("update-status-pill");

    expect(pill).toHaveTextContent("Security update");
    expect(pill.className).toContain("bg-red-50");
    expect(pill.getAttribute("aria-label")).toBe(
      "Security update. A published security advisory affects version 14.0.60, which this installation runs. Upgrade to 14.0.80. Opens the upgrade guide in a new tab.",
    );
  });

  test("says a security advisory when no release fixes it yet, counting them", async () => {
    await renderIn(SECURITY_ADVISORY);

    const pill: HTMLElement = screen.getByTestId("update-status-pill");

    expect(pill).toHaveTextContent("Security advisory");
    expect(pill.className).toContain("bg-red-50");
    expect(pill.getAttribute("aria-label")).toContain(
      "2 published security advisories affect version 14.0.60, which this installation runs. No release fixes them all yet.",
    );
  });

  test.each([
    [
      "up to date",
      status({ state: UpdateState.UpToDate, isUpdateAvailable: false }),
    ],
    ["unknown", status({ state: UpdateState.Unknown })],
  ] as Array<[string, UpdateStatus]>)(
    "draws nothing when %s",
    async (_name: string, value: UpdateStatus) => {
      await renderIn(value);

      expect(
        screen.queryByTestId("update-status-pill"),
      ).not.toBeInTheDocument();
    },
  );

  test("draws nothing with no status", async () => {
    await renderIn(null);

    expect(screen.queryByTestId("update-status-pill")).not.toBeInTheDocument();
  });

  test.each([["de"], ["ja"], ["fa"], ["ru"]])(
    "reads in %s as that language's Dashboard words it",
    async (language: string) => {
      const locale: Record<string, unknown> = readLocale(language);

      await renderIn(SECURITY_UPDATE, language);

      const pill: HTMLElement = screen.getByTestId("update-status-pill");

      expect(pill).toHaveTextContent(
        locale[UPDATE_STATUS_PILL_COPY.securityUpdate] as string,
      );
      expect(locale[UPDATE_STATUS_PILL_COPY.securityUpdate]).not.toBe(
        "Security update",
      );
      expect(pill.getAttribute("aria-label")).toContain(
        locale[UPDATE_STATUS_PILL_COPY.opensGuide] as string,
      );
    },
  );

  test("links to this installation's own docs, never to an outside site", () => {
    expect(getUpgradeGuideUrl()).toMatch(/\/docs\/installation\/upgrading$/);
    expect(getUpdateCheckDocsUrl()).toMatch(
      /\/docs\/self-hosted\/update-checks$/,
    );
    expect(getUpgradeGuideUrl()).not.toContain("oneuptime.com");
  });
});

describe("what the pill says on hover", () => {
  const english: Translator = createTranslator(undefined);

  test("an update names the latest release and the one this installation runs", () => {
    expect(describeUpdateStatus(status(), english)).toBe(
      "Version 14.0.80 is available. This installation runs 14.0.60.",
    );
  });

  test("a security update names the release to upgrade to", () => {
    expect(describeUpdateStatus(SECURITY_UPDATE, english)).toBe(
      "A published security advisory affects version 14.0.60, which this installation runs. Upgrade to 14.0.80.",
    );
  });

  test("an advisory with no fix says so", () => {
    expect(
      describeUpdateStatus(
        { ...SECURITY_ADVISORY, advisories: [advisory] },
        english,
      ),
    ).toBe(
      "A published security advisory affects version 14.0.60, which this installation runs. No release fixes it yet.",
    );
  });
});

describe("the request that feeds it", () => {
  test("a master admin of a self-hosted installation asks the update status once a page", async () => {
    const [first, second] = await Promise.all([
      UpdateStatusLoader.load(),
      UpdateStatusLoader.load(),
    ]);

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]).toMatch(/\/api\/global-config\/update-status$/);
    expect(first).toEqual(status());
    expect(second).toBe(first);

    await UpdateStatusLoader.load();

    expect(fetchCalls).toHaveLength(1);
  });

  test("nobody else asks", async () => {
    isMasterAdmin = false;

    expect(await UpdateStatusLoader.load()).toBeNull();
    expect(fetchCalls).toEqual([]);
    expect(UpdateStatusLoader.isShownToReader()).toBe(false);
  });

  test("OneUptime Cloud never asks", async () => {
    billingEnabled = true;

    expect(await UpdateStatusLoader.load()).toBeNull();
    expect(fetchCalls).toEqual([]);
  });

  test("a refused or failed request draws nothing, and is asked again", async () => {
    respond = () => {
      return new HTTPErrorResponse(403, { message: "Not a master admin" }, {});
    };

    expect(await UpdateStatusLoader.load()).toBeNull();

    respond = () => {
      return new Error("Network down");
    };

    expect(await UpdateStatusLoader.load()).toBeNull();

    respond = () => {
      return ok(UpdateStatusUtil.toJSON(SECURITY_UPDATE));
    };

    expect((await UpdateStatusLoader.load())?.state).toBe(
      UpdateState.SecurityUpdate,
    );
    expect(fetchCalls).toHaveLength(3);
  });

  test("an answer that is not a status is nothing to say", async () => {
    respond = () => {
      return ok({ state: "panic", advisories: "lots" } as JSONObject);
    };

    expect((await UpdateStatusLoader.load())?.state).toBe(UpdateState.Unknown);
  });
});
