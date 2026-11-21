/** @timezone UTC */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Fix steps' checks (#10347) in every language the Dashboard speaks:
 * the card draws the route's fix in each state, the password reset and the
 * accounts' MFA in the reader's language - its chip, its line and what else
 * it saw - with the route, the version and the accounts as written, and no
 * English left in a sentence the language words. Every new word is in every
 * locale, keeping its placeholders.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      create: async (): Promise<unknown> => {
        return {};
      },
      updateById: async (): Promise<unknown> => {
        return {};
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleExceptions/AddRuleExceptionModal",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("div");
      },
    };
  },
);

import SecurityCaseResponsePlanCard from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponsePlanCard";
import { SECURITY_CASE_RESPONSE_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponseCopy";
import { CODE_TASK_ORIGIN_SENTENCES } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskCopy";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseStepCheck from "../../../Models/DatabaseModels/SecurityCaseStepCheck";
import { CodeTaskOriginType } from "../../../Types/AI/CodeTask";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import SecurityCaseStepCheckState from "../../../Types/SecurityCase/SecurityCaseStepCheckState";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import { PluralTemplate } from "../../../Types/Translator";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import Realtime from "../../../UI/Utils/Realtime";
import UserUtil from "../../../UI/Utils/User";
import * as StepCheckWords from "../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
  readDashboardLocaleAsDrawn,
} from "../../Helpers/DashboardLocales";
import {
  FIX_CASE_TECHNIQUES,
  FIX_CHANGE,
  FIX_ROUTE,
  FIX_USER,
  ROUTE_FIX_EVIDENCE,
  accountFixRows,
  fixCaseMatches,
  fixStepCheckRow,
} from "../../Helpers/SecurityCaseFixStepChecks";
import {
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
  testStatusId,
} from "../../Helpers/SecurityCaseValues";

const EN: Record<string, string> = readDashboardLocale("en");
const ROUTE_KEY: string = "fix:public-app";

// Every word #10347 added: the Fix steps' checks, and where a case's fix started in Code.
const FIX_WORDS: Array<string | PluralTemplate> = [
  ...Object.entries(StepCheckWords)
    .filter(([name]: [string, unknown]): boolean => {
      return name.startsWith("CHECK_FIX_");
    })
    .map(([, words]: [string, unknown]): string | PluralTemplate => {
      return words as string | PluralTemplate;
    }),
  CODE_TASK_ORIGIN_SENTENCES[CodeTaskOriginType.SecurityCase],
];

// Each word's keys in the locale files: a plural's general key, and its "_one".
const FIX_KEYS: Array<string> = FIX_WORDS.flatMap(
  (words: string | PluralTemplate): Array<string> => {
    return typeof words === "string"
      ? [words]
      : [words.other, `${words.other}_one`];
  },
);

// English words no translated sentence keeps.
const ENGLISH_WORDS: RegExp =
  /\b(attack requests?|shipped|turned away|the database|has no MFA|password was changed|Watching|Before it)\b/;

let stepChecks: Array<SecurityCaseStepCheck>;

function buildCase(): SecurityCase {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase._id = "22222222-2222-4222-8222-222222222222";
  securityCase.securityCaseStatusId = testStatusId(SecurityCaseStage.New);
  securityCase.entities = [
    { type: SecurityEntityType.IpAddress, value: "35.196.249.14" },
    { type: SecurityEntityType.User, value: FIX_USER },
  ] as never;
  securityCase.mitreTactics = ["TA0001"];
  securityCase.mitreTechniques = FIX_CASE_TECHNIQUES;
  return securityCase;
}

async function drawn(): Promise<void> {
  render(
    <MemoryRouter>
      <SecurityCaseResponsePlanCard
        caseId={new ObjectID("22222222-2222-4222-8222-222222222222")}
        securityCase={buildCase()}
        values={{
          priorities: buildDefaultTestPriorities(),
          statuses: buildDefaultTestStatuses(),
        }}
        matches={fixCaseMatches()}
        refreshToggle="first"
        isWorking={false}
        onAssignToMe={(): void => {}}
        onRunPlaybook={(): void => {}}
        onDeclareIncident={(): void => {}}
        onMarkContained={(): void => {}}
        onCloseCase={(): void => {}}
      />
    </MemoryRouter>,
  );
  await screen.findAllByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.step);
}

function stepOf(key: string): HTMLElement {
  return screen
    .getAllByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.step)
    .find((candidate: HTMLElement): boolean => {
      return candidate.getAttribute("data-step-key") === key;
    })!;
}

// What the card draws beside a step: its chip and its line.
function checkOf(key: string): { chip: string; line: string } {
  const line: HTMLElement = within(stepOf(key)).getByTestId(
    SECURITY_CASE_RESPONSE_TEST_IDS.checkLine,
  );

  return {
    chip:
      within(line).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.checkChip)
        .textContent || "",
    line: (line.querySelector("p")?.textContent || "").trim(),
  };
}

async function inLanguage(language: string): Promise<void> {
  if (!i18next.hasResourceBundle(language, "translation")) {
    i18next.addResourceBundle(
      language,
      "translation",
      readDashboardLocaleAsDrawn(language),
    );
  }

  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: EN } },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
  stepChecks = [];

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID("11111111-1111-4111-8111-111111111111"));
  jest.spyOn(PermissionUtil, "getAllPermissions").mockImplementation(() => {
    return [Permission.SecurityMember];
  });
  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  jest
    .spyOn(UserUtil, "getUserId")
    .mockReturnValue(new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-000000000001"));
  jest.spyOn(OneUptimeDate, "fromNow").mockReturnValue("5 minutes ago");
  jest
    .spyOn(Realtime, "listenToModelEvent")
    .mockImplementation(((): (() => void) => {
      return (): void => {};
    }) as never);
  jest
    .spyOn(GlobalEvents, "dispatchEvent")
    .mockImplementation((() => {}) as never);

  getListMock.mockReset();
  getListMock.mockImplementation(async (args: unknown) => {
    const data: Array<unknown> =
      (args as { modelType: unknown }).modelType === SecurityCaseStepCheck
        ? stepChecks
        : [];

    return { data, count: data.length };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("every new word is in every locale", () => {
  test("each is a key of the Dashboard's English", () => {
    expect(
      FIX_KEYS.filter((key: string): boolean => {
        return typeof EN[key] !== "string";
      }),
    ).toEqual([]);
    expect(FIX_KEYS.length).toBeGreaterThan(40);
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words each its own way, and keeps its placeholders",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      expect(
        FIX_KEYS.filter((key: string): boolean => {
          return !isWordedInDashboardLocale(key, language);
        }),
      ).toEqual([]);

      for (const key of FIX_KEYS) {
        expect({
          key,
          placeholders: placeholdersOf(words[key] || ""),
        }).toEqual({ key, placeholders: placeholdersOf(EN[key]!) });
      }
    },
  );
});

describe("the card draws the Fix steps' checks in the reader's language", () => {
  const STATES: Array<string> = Object.keys(ROUTE_FIX_EVIDENCE);
  // Each state's line as English draws it, drawn once.
  const english: Map<string, string> = new Map<string, string>();

  test.each(["en", ...DASHBOARD_LANGUAGES])(
    "%s: the route's fix in each state, the password and MFA",
    async (language: string) => {
      const words: Record<string, string> = readDashboardLocaleAsDrawn(
        language,
      );

      for (const state of STATES) {
        stepChecks = [
          fixStepCheckRow({ key: ROUTE_KEY, ...ROUTE_FIX_EVIDENCE[state]! }),
          ...accountFixRows(),
        ];

        if (!english.has(state)) {
          await inLanguage("en");
          await drawn();
          english.set(state, checkOf(ROUTE_KEY).line);
          cleanup();
        }

        await inLanguage(language);
        await drawn();

        const drawnCheck: { chip: string; line: string } =
          checkOf(ROUTE_KEY);
        const stateLabel: string =
          StepCheckWords.STEP_CHECK_STATE_LABELS[
            ROUTE_FIX_EVIDENCE[state]!.state as SecurityCaseStepCheckState
          ];

        // The chip, as the locale words the state.
        expect({ language, state, chip: drawnCheck.chip }).toEqual({
          language,
          state,
          chip: words[stateLabel] || stateLabel,
        });

        // The line: the route and the version as written, in the reader's words.
        if (state === "cannotTell") {
          expect(drawnCheck.line).toContain("search-api");
        } else {
          expect(drawnCheck.line).toContain(FIX_ROUTE);
          expect(drawnCheck.line).toContain(FIX_CHANGE);
        }

        if (language !== "en") {
          expect({ language, state, line: drawnCheck.line }).not.toEqual({
            language,
            state,
            line: english.get(state),
          });
          expect({
            language,
            state,
            leftInEnglish: ENGLISH_WORDS.exec(drawnCheck.line)?.[0] || "",
          }).toEqual({ language, state, leftInEnglish: "" });
        }

        // The accounts' fixes beside it, named as written.
        expect(checkOf("fix:credentials").line).toContain(FIX_USER);
        expect(checkOf("fix:brute-force").line).toContain("bob@acme.com");

        if (language !== "en") {
          for (const key of ["fix:credentials", "fix:brute-force"]) {
            expect({
              language,
              key,
              leftInEnglish: ENGLISH_WORDS.exec(checkOf(key).line)?.[0] || "",
            }).toEqual({ language, key, leftInEnglish: "" });
          }
        }

        cleanup();
      }
    },
  );
});
