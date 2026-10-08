import {
  CONNECT_COULD_NOT_FINISH,
  CONNECT_LINK_INVALID,
  ConnectCallbackNoticeText,
  getConnectCallbackMessageKey,
  getConnectCallbackNotice,
  getConnectReturnPath,
  readConnectCallbackError,
} from "../../FeatureSet/Dashboard/src/Utils/Workspace/ConnectCallbackMessage";
import {
  getLocalePath,
  TRANSLATED_LOCALES,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import ConnectCallbackUtil, {
  CONNECT_RETURN_PATH,
  ConnectCallbackError,
  ConnectProvider,
  ConnectStartPage,
} from "Common/Types/Workspace/ConnectCallback";
import {
  createTranslator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the Slack, Microsoft Teams and Code Repositories pages say when a
 * connection comes back to them unmade (`?error=` and a code). Each code
 * reads as the page's own sentence, in the reader's language; anything else
 * reads as "could not finish" and is never shown as itself; the sentences are
 * in every locale. The page each provider comes back to is the one RouteMap
 * has, so a page that moves takes the callbacks with it or fails here; and
 * the pages answer through the one notice and tell their start route which
 * page they are.
 */

const PROVIDERS: Array<ConnectProvider> = Object.values(ConnectProvider);
const CODES: Array<ConnectCallbackError> = Object.values(ConnectCallbackError);
const START_PAGES: Array<ConnectStartPage> = Object.values(ConnectStartPage);

const ENGLISH: Translator = createTranslator(undefined, "en");

// Text a link could carry, or a provider could have said.
const UNKNOWN_ERRORS: Array<string> = [
  "access_denied",
  "invalid_grant: Bad code",
  "<script>alert(document.cookie)</script>",
  "Your session expired. Sign in again at https://evil.example",
  "AADSTS50020: User account does not exist in tenant",
  "LINK-INVALID",
  " link-invalid",
  "no-permission\nYou are an admin now",
];

const DASHBOARD_SOURCE: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SOURCE, relativePath), "utf8");
}

// Every sentence a page can show, as its translation key.
function everyKey(): Array<string> {
  const keys: Set<string> = new Set<string>();
  const recording: Translator = {
    ...ENGLISH,
    translateTemplate: (template: string): string => {
      keys.add(template);
      return template;
    },
  };

  for (const provider of PROVIDERS) {
    for (const code of CODES) {
      getConnectCallbackNotice({
        provider: provider,
        error: code,
        translator: recording,
      });
    }
  }

  return Array.from(keys);
}

describe("what a code reads as", () => {
  test.each(PROVIDERS)(
    "every code has a title and a sentence of its own on the %s page",
    (provider: ConnectProvider) => {
      for (const code of CODES) {
        const notice: ConnectCallbackNoticeText | null =
          getConnectCallbackNotice({
            provider: provider,
            error: code,
            translator: ENGLISH,
          });

        expect(notice).not.toBeNull();
        expect(notice!.code).toBe(
          readConnectCallbackError(provider, code) as ConnectCallbackError,
        );
        expect(notice!.title.length).toBeGreaterThan(0);
        // A sentence, never the code itself.
        expect(notice!.message).not.toBe(code);
        expect(notice!.message).toMatch(/\.$/);
      }
    },
  );

  test("the title names the provider that was not connected", () => {
    const titles: Array<string> = PROVIDERS.map(
      (provider: ConnectProvider): string => {
        return getConnectCallbackNotice({
          provider: provider,
          error: ConnectCallbackError.CouldNotFinish,
          translator: ENGLISH,
        })!.title;
      },
    );

    expect(titles).toEqual([
      "Slack was not connected",
      "Microsoft Teams was not connected",
      "GitHub was not connected",
    ]);
  });

  test("a refusal of the start's question is the start's own sentence", () => {
    expect(
      PROVIDERS.map((provider: ConnectProvider): string => {
        return getConnectCallbackMessageKey(
          provider,
          ConnectCallbackError.NoPermission,
        );
      }),
    ).toEqual([
      "You do not have permission to connect this project to Slack.",
      "You do not have permission to connect this project to Microsoft Teams.",
      "You do not have permission to add code repositories to this project.",
    ]);
  });

  test.each(UNKNOWN_ERRORS)(
    "unknown text reads as could not finish, never as itself: %j",
    (unknown: string) => {
      for (const provider of PROVIDERS) {
        const notice: ConnectCallbackNoticeText | null =
          getConnectCallbackNotice({
            provider: provider,
            error: unknown,
            translator: ENGLISH,
          });

        expect(notice!.code).toBe(ConnectCallbackError.CouldNotFinish);
        expect(notice!.message).toBe(CONNECT_COULD_NOT_FINISH);
        expect(`${notice!.title} ${notice!.message}`).not.toContain(unknown);
      }
    },
  );

  test("a code only another provider answers with reads as could not finish", () => {
    const owner: Record<string, ConnectProvider> = {
      [ConnectCallbackError.SlackOtherWorkspace]: ConnectProvider.Slack,
      [ConnectCallbackError.SlackNotInstalled]: ConnectProvider.Slack,
      [ConnectCallbackError.TeamsOtherTenant]: ConnectProvider.MicrosoftTeams,
      [ConnectCallbackError.TeamsNoTeams]: ConnectProvider.MicrosoftTeams,
      [ConnectCallbackError.GitHubNoInstallation]: ConnectProvider.GitHub,
      [ConnectCallbackError.GitHubNoAuthorization]: ConnectProvider.GitHub,
      [ConnectCallbackError.GitHubNotVerified]: ConnectProvider.GitHub,
    };

    for (const [code, ownProvider] of Object.entries(owner)) {
      for (const provider of PROVIDERS) {
        expect([
          code,
          provider,
          readConnectCallbackError(provider, code),
        ]).toEqual([
          code,
          provider,
          provider === ownProvider ? code : ConnectCallbackError.CouldNotFinish,
        ]);
      }
    }
  });

  test("no ?error= is no notice", () => {
    for (const provider of PROVIDERS) {
      for (const value of [null, undefined, ""]) {
        expect(
          getConnectCallbackNotice({
            provider: provider,
            error: value,
            translator: ENGLISH,
          }),
        ).toBeNull();
      }
    }
  });

  test("a plan refusal uses the page's own sentence naming the plan, where it has one", () => {
    const named: string = "Connecting GitHub needs the Growth plan.";

    expect(
      getConnectCallbackNotice({
        provider: ConnectProvider.GitHub,
        error: ConnectCallbackError.PlanRequired,
        translator: ENGLISH,
        planRequiredMessage: named,
      })!.message,
    ).toBe(named);

    expect(
      getConnectCallbackNotice({
        provider: ConnectProvider.Slack,
        error: ConnectCallbackError.PlanRequired,
        translator: ENGLISH,
      })!.message,
    ).toBe(
      "Your project's plan does not include this. Please upgrade the plan and try again.",
    );

    // Only a plan refusal: anything else keeps its own sentence.
    expect(
      getConnectCallbackNotice({
        provider: ConnectProvider.GitHub,
        error: ConnectCallbackError.LinkInvalid,
        translator: ENGLISH,
        planRequiredMessage: named,
      })!.message,
    ).toBe(CONNECT_LINK_INVALID);
  });

  test("the sentences are in the reader's language", () => {
    const german: Translator = createTranslator((text: string) => {
      return (
        {
          "Slack was not connected": "Slack wurde nicht verbunden",
          [CONNECT_LINK_INVALID]: "Dieser Verbindungslink ist ungültig.",
        } as Record<string, string>
      )[text];
    }, "de");

    expect(
      getConnectCallbackNotice({
        provider: ConnectProvider.Slack,
        error: ConnectCallbackError.LinkInvalid,
        translator: german,
      }),
    ).toEqual({
      code: ConnectCallbackError.LinkInvalid,
      title: "Slack wurde nicht verbunden",
      message: "Dieser Verbindungslink ist ungültig.",
    });
  });
});

describe("the sentences are in every locale", () => {
  const keys: Array<string> = everyKey();

  test("there is a sentence for every code", () => {
    // 3 titles, and at least one sentence per code.
    expect(keys.length).toBeGreaterThanOrEqual(3 + CODES.length);
  });

  test("en.json has every one", () => {
    const english: Record<string, unknown> = JSON.parse(
      fs.readFileSync(getLocalePath("en"), "utf8"),
    );

    for (const key of keys) {
      expect([key, english[key]]).toEqual([key, key]);
    }
  });

  test.each(TRANSLATED_LOCALES)(
    "%s has its own wording of every one",
    (code: string) => {
      const locale: Record<string, unknown> = JSON.parse(
        fs.readFileSync(getLocalePath(code), "utf8"),
      );

      for (const key of keys) {
        const value: unknown = locale[key];

        expect([key, typeof value]).toEqual([key, "string"]);
        expect([key, value === key]).toEqual([key, false]);
      }
    },
  );
});

describe("the connect-return page", () => {
  const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

  test("passes a code on to the provider's page in the open project", () => {
    expect(
      getConnectReturnPath({
        projectId: PROJECT_ID,
        provider: "slack",
        error: "link-invalid",
      }),
    ).toBe(
      `/dashboard/${PROJECT_ID}/settings/slack-integration?error=link-invalid`,
    );

    expect(
      getConnectReturnPath({
        projectId: PROJECT_ID,
        provider: "microsoft-teams",
        error: "could-not-finish",
      }),
    ).toBe(
      `/dashboard/${PROJECT_ID}/settings/microsoft-teams-integration?error=could-not-finish`,
    );
  });

  test("GitHub's own redirect has nothing to say", () => {
    expect(
      getConnectReturnPath({
        projectId: PROJECT_ID,
        provider: "github",
        error: null,
      }),
    ).toBe(`/dashboard/${PROJECT_ID}/code-repository`);
  });

  test.each(UNKNOWN_ERRORS)(
    "passes unknown text on as could-not-finish: %j",
    (unknown: string) => {
      const target: string = getConnectReturnPath({
        projectId: PROJECT_ID,
        provider: "github",
        error: unknown,
      });

      expect(target).toBe(
        `/dashboard/${PROJECT_ID}/code-repository?error=could-not-finish`,
      );
    },
  );

  test("a provider it does not know is the project's home", () => {
    for (const provider of [
      null,
      "",
      "gitlab",
      "../../admin",
      "https://evil.example",
    ]) {
      expect(
        getConnectReturnPath({
          projectId: PROJECT_ID,
          provider: provider,
          error: "link-invalid",
        }),
      ).toBe(`/dashboard/${PROJECT_ID}/home/`);
    }
  });
});

/*
 * The page a provider comes back to is the one the Dashboard serves.
 * RouteMap reads `window` as it loads (via ProjectUtil), so it is imported
 * once a stub is in place (see MonitorRecommendationRoutes.test.ts).
 */
describe("the pages the callbacks send the browser to are the Dashboard's", () => {
  type RouteMapModule =
    typeof import("../../FeatureSet/Dashboard/src/Utils/RouteMap");
  type PageMapModule =
    typeof import("../../FeatureSet/Dashboard/src/Utils/PageMap");
  type RouteParamsModule =
    typeof import("../../FeatureSet/Dashboard/src/Utils/RouteParams");

  let RouteMap: RouteMapModule["default"];
  let PageMap: PageMapModule["default"];
  let RouteParams: RouteParamsModule["default"];

  beforeAll(async () => {
    (globalThis as Record<string, unknown>)["window"] = {
      location: { pathname: "/", search: "", hash: "" },
      history: {
        state: null,
        replaceState: (): void => {
          // no-op; these tests never navigate.
        },
      },
    };

    for (const storageName of ["sessionStorage", "localStorage"]) {
      Object.defineProperty(globalThis, storageName, {
        value: {
          getItem: (): null => {
            return null;
          },
          setItem: (): void => {
            // no-op
          },
          removeItem: (): void => {
            // no-op
          },
        },
        configurable: true,
        writable: true,
      });
    }

    RouteMap = (await import("../../FeatureSet/Dashboard/src/Utils/RouteMap"))
      .default;
    PageMap = (await import("../../FeatureSet/Dashboard/src/Utils/PageMap"))
      .default;
    RouteParams = (
      await import("../../FeatureSet/Dashboard/src/Utils/RouteParams")
    ).default;
  });

  test("every provider and start page is a Dashboard page", () => {
    const page: Record<ConnectProvider, Record<ConnectStartPage, string>> = {
      [ConnectProvider.Slack]: {
        [ConnectStartPage.ProjectSettings]: PageMap.SETTINGS_SLACK_INTEGRATION,
        [ConnectStartPage.UserSettings]:
          PageMap.USER_SETTINGS_SLACK_INTEGRATION,
      },
      [ConnectProvider.MicrosoftTeams]: {
        [ConnectStartPage.ProjectSettings]:
          PageMap.SETTINGS_MICROSOFT_TEAMS_INTEGRATION,
        [ConnectStartPage.UserSettings]:
          PageMap.USER_SETTINGS_MICROSOFT_TEAMS_INTEGRATION,
      },
      [ConnectProvider.GitHub]: {
        [ConnectStartPage.ProjectSettings]: PageMap.CODE_REPOSITORY,
        [ConnectStartPage.UserSettings]: PageMap.CODE_REPOSITORY,
      },
    };

    for (const provider of PROVIDERS) {
      for (const startPage of START_PAGES) {
        expect([
          provider,
          startPage,
          `/dashboard/${RouteParams.ProjectID}${ConnectCallbackUtil.getPagePath(
            provider,
            startPage,
          )}`,
        ]).toEqual([
          provider,
          startPage,
          RouteMap[page[provider][startPage]]!.toString(),
        ]);
      }
    }
  });

  test("the connect-return page is where the callbacks send a link they cannot use", () => {
    expect(RouteMap[PageMap.CONNECT_RETURN]!.toString()).toBe(
      `/dashboard${CONNECT_RETURN_PATH}`,
    );
  });
});

describe("the pages answer through the one notice", () => {
  const PAGES: Array<{ file: string; provider: string }> = [
    {
      file: "Components/Slack/SlackIntegration.tsx",
      provider: "ConnectProvider.Slack",
    },
    {
      file: "Components/MicrosoftTeams/MicrosoftTeamsIntegration.tsx",
      provider: "ConnectProvider.MicrosoftTeams",
    },
    {
      file: "Pages/CodeRepository/CodeRepository.tsx",
      provider: "ConnectProvider.GitHub",
    },
  ];

  test.each(PAGES)(
    "$file shows the notice for its own provider",
    (page: { file: string; provider: string }) => {
      const source: string = readSource(page.file);

      expect(source).toContain("useConnectCallbackNotice(");
      expect(source).toContain(`provider: ${page.provider},`);
      expect(source).toContain("<ConnectCallbackNotice state={");
    },
  );

  test.each(PAGES)(
    "$file never reads ?error= itself",
    (page: { file: string; provider: string }) => {
      const source: string = readSource(page.file);

      expect(source).not.toMatch(/getQueryStringByName\(\s*"error"\s*\)/);
      expect(source).not.toMatch(/\.get\(\s*"error"\s*\)/);
      expect(source).not.toContain("{{error}}");
    },
  );

  test.each([
    "Components/Slack/SlackIntegration.tsx",
    "Components/MicrosoftTeams/MicrosoftTeamsIntegration.tsx",
  ])("%s tells its start routes which page it is", (file: string) => {
    expect(readSource(file)).toMatch(
      /\.addQueryParam\(\s*CONNECT_START_PAGE_QUERY_PARAM,\s*props\.startPage \|\| ConnectStartPage\.ProjectSettings,/,
    );
  });

  test.each([
    "Pages/UserSettings/SlackIntegration.tsx",
    "Pages/UserSettings/MicrosoftTeamsIntegration.tsx",
  ])("%s says it is the person's own settings", (file: string) => {
    expect(readSource(file)).toContain(
      "startPage={ConnectStartPage.UserSettings}",
    );
  });

  test.each([
    "Pages/Settings/SlackIntegration.tsx",
    "Pages/Settings/MicrosoftTeamsIntegration.tsx",
  ])("%s is the project's settings (the default)", (file: string) => {
    expect(readSource(file)).not.toContain("ConnectStartPage.UserSettings");
  });
});
