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
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A MONITOR'S FIRE DRILL (#7012), on its "When this goes down" card.
 *
 *   - Run Fire Drill shows where a failure of the monitor pages an on-call
 *     policy, and nowhere else.
 *   - Before anything is sent, the dialog says plainly that it is a test,
 *     which failure it rehearses, which policies it pages and who each
 *     one's first level pages, with what it costs.
 *   - It can't start while a policy of it is one the reader may not test,
 *     or while nobody it pages can receive anything; one line says why.
 *   - Started, it shows each policy's test as it happens, and Done.
 *
 * The card and the dialog are the real ones with the shipped Dashboard
 * locales; only the server's answers are stood in for.
 */

configure({ asyncUtilTimeout: 15000 });

const previewMock: MockFunction = getJestMockFunction();
const startMock: MockFunction = getJestMockFunction();
const resultMock: MockFunction = getJestMockFunction();
const whoIsToldMock: MockFunction = getJestMockFunction();
const lastMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/OnCallTestPageApi",
  () => {
    return {
      __esModule: true,
      default: {
        fireDrillPreview: (...args: Array<unknown>) => {
          return previewMock(...args);
        },
        startFireDrill: (...args: Array<unknown>) => {
          return startMock(...args);
        },
        getResult: (...args: Array<unknown>) => {
          return resultMock(...args);
        },
        lastFireDrill: (...args: Array<unknown>) => {
          return lastMock(...args);
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/WhoIsToldApi",
  () => {
    // Its helpers as they are (a draft's body); only the server's answers stood in for.
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/WhoIsToldApi",
    ) as Record<string, unknown>;

    return {
      ...actual,
      __esModule: true,
      default: {
        getForMonitor: (...args: Array<unknown>) => {
          return whoIsToldMock(...args);
        },
        getForDraft: (...args: Array<unknown>) => {
          return whoIsToldMock(...args);
        },
      },
    };
  },
);

import MonitorWhoIsToldCard from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorWhoIsToldCard";
import FireDrillModal, {
  getFireDrillBlocker,
  getFireDrillDeclaredSentence,
  getFireDrillFailureLabel,
  isFireDrillWalkOffered,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/FireDrillModal";
import LastFireDrill, {
  getLastFireDrillFailure,
  getLastFireDrillOutcome,
  isLastFireDrillRunning,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/LastFireDrill";
import {
  FireDrillTrigger,
  ON_CALL_LOGS_FIRE_DRILL,
  ON_CALL_LOGS_FIRE_DRILL_MONITOR_DELETED,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable";
import {
  COST_SENTENCES,
  FIRE_DRILL_CANT_TEST,
  FIRE_DRILL_DECLARED_AFTER,
  FIRE_DRILL_DECLARED_AFTER_HIDDEN_RULE,
  FIRE_DRILL_LAST_ACKNOWLEDGED,
  FIRE_DRILL_LAST_ACKNOWLEDGED_SO_FAR,
  FIRE_DRILL_LAST_WORDS,
  FIRE_DRILL_WORDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/OnCallTestPageWords";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  WhoIsToldOwnersSource,
  WhoIsToldResult,
} from "../../../Types/Monitor/WhoIsTold";
import ObjectID from "../../../Types/ObjectID";
import {
  OnCallFireDrillPolicy,
  OnCallFireDrillPreview,
  OnCallFireDrillRecord,
} from "../../../Types/OnCallDutyPolicy/OnCallFireDrill";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  OnCallTestPageKind,
  OnCallTestPagePreview,
  OnCallTestPagePreviewPerson,
  OnCallTestPageRecordKind,
  OnCallTestPageStatus,
  OnCallTestPageWarningCode,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import { Translator, createTranslator } from "../../../Types/Translator";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { withPlainSpaces } from "../../../Types/NoBreakSpaces";
import { getShownDropdownValue, pickDropdownOption } from "../../DropdownPicks";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "fa"];

const LOCALES: Record<string, Record<string, string>> = {};

for (const language of LANGUAGES) {
  LOCALES[language] = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

function translatorIn(language: string): Translator {
  const locale: Record<string, string> = LOCALES[language]!;

  return createTranslator((text: string): string | undefined => {
    return locale[text];
  }, language);
}

const MONITOR_ID: string = "7e5b4000-0000-4000-8000-000000000001";
const PRIMARY: string = "7e5b4000-0000-4000-8000-0000000000c1";
const PLATFORM: string = "7e5b4000-0000-4000-8000-0000000000c2";
const RUN_1: string = "7e5b4000-0000-4000-8000-0000000000e1";
const RUN_2: string = "7e5b4000-0000-4000-8000-0000000000e2";
const OFFLINE_KEY: string = "criteria-offline:Incident:template-1:0";
const SLOW_KEY: string = "criteria-slow:Alert:template-2:0";

function person(
  name: string,
  data: Partial<OnCallTestPagePreviewPerson> = {},
): OnCallTestPagePreviewPerson {
  return {
    userId: `user-${name}`,
    userName: name,
    methods: [
      {
        channel: OnCallPageChannel.SMS,
        notifyAfterMinutes: 0,
        isVerified: true,
        canAcknowledge: true,
      },
    ],
    hasNoRule: false,
    isOptedOut: false,
    warnings: [],
    warningCodes: [],
    ...data,
  };
}

function optedOut(name: string): OnCallTestPagePreviewPerson {
  return person(name, {
    methods: [],
    hasNoRule: true,
    isOptedOut: true,
    warnings: [
      "Opted out of pages of this severity, so the test sends nothing.",
    ],
    warningCodes: [
      {
        code: OnCallTestPageWarningCode.OptedOut,
        message:
          "Opted out of pages of this severity, so the test sends nothing.",
      },
    ],
  });
}

function levelOf(
  people: Array<OnCallTestPagePreviewPerson>,
): OnCallTestPagePreview {
  return {
    kind: OnCallTestPageKind.Policy,
    people: people,
    notPaged: [],
    notPagedCodes: [],
    levelCount: 1,
    cost: {
      isPaid: false,
      smsCount: 0,
      callCount: 0,
      whatsAppCount: 0,
      telegramCount: 0,
    },
    walkLevels: [],
    walkUnreachedLevelCount: 0,
  };
}

function policy(
  id: string,
  name: string,
  people: Array<OnCallTestPagePreviewPerson>,
): OnCallFireDrillPolicy {
  return {
    policyId: id,
    policyName: name,
    mayTest: true,
    preview: levelOf(people),
  };
}

function drill(
  data: Partial<OnCallFireDrillPreview> = {},
): OnCallFireDrillPreview {
  return {
    monitorId: MONITOR_ID,
    monitorName: "API",
    events: [
      {
        key: OFFLINE_KEY,
        criteriaName: "Offline",
        recordKind: OnCallTestPageRecordKind.Incident,
        severityName: "Critical",
        title: "API is down",
        policyCount: 2,
      },
    ],
    eventKey: OFFLINE_KEY,
    policies: [
      policy(PRIMARY, "Primary", [person("Ana Lopez")]),
      policy(PLATFORM, "Platform", [person("Bob Stone")]),
    ],
    cost: {
      isPaid: false,
      smsCount: 2,
      callCount: 0,
      whatsAppCount: 0,
      telegramCount: 0,
    },
    ...data,
  };
}

// "When this goes down" of a monitor whose Offline criteria opens an incident.
function whoIsTold(policyIds: Array<string>): WhoIsToldResult {
  return {
    monitorId: MONITOR_ID,
    monitorName: "API",
    checkedAt: new Date().toISOString(),
    criteria: [
      {
        id: "criteria-offline",
        name: "Offline",
        statusName: "Offline",
        events: [
          {
            kind: OnCallTestPageRecordKind.Incident,
            id: "template-1",
            severityId: "7e5b4000-0000-4000-8000-0000000000d1",
            title: "API is down",
            severityName: "Critical",
            owners: {
              source: WhoIsToldOwnersSource.ProjectOwners,
              userNames: [],
              teamNames: [],
            },
            ownerRules: [],
            rules: [],
            policies: policyIds.map((id: string) => {
              return {
                id: id,
                name: id === PRIMARY ? "Primary" : "Platform",
                isHidden: false,
                isNamedByCriteria: true,
                ruleIds: [],
                levelCount: 1,
                people: [],
                notPaged: [],
              };
            }),
            statusPages: [],
          },
        ],
      },
    ],
    channels: {
      isBillingEnabled: false,
      isSmsOn: true,
      isCallOn: true,
      isWhatsAppOn: true,
      isTelegramOn: true,
      hasOwnTwilioForSms: false,
      hasOwnTwilioForCalls: false,
      serverCanSendEmail: null,
      serverCanSendSms: null,
      serverCanCall: null,
    },
    breaks: [],
  } as unknown as WhoIsToldResult;
}

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

async function openDialog(): Promise<void> {
  render(
    <MemoryRouter>
      <FireDrillModal monitorId={MONITOR_ID} onClose={() => {}} />
    </MemoryRouter>,
  );

  await screen.findByTestId("fire-drill-policies");
}

function startButton(): HTMLElement {
  return screen.getByTestId("modal-footer-submit-button");
}

/*
 * The words as a reader reads them: a number is held to its unit with a
 * no-break space ("2 minutes"), read as a space.
 */
function textOf(element: HTMLElement): string {
  return withPlainSpaces(withoutIsolateMarks(element.textContent || ""));
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of LANGUAGES) {
    resources[language] = { translation: LOCALES[language]! };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  previewMock.mockReset();
  startMock.mockReset();
  resultMock.mockReset();
  whoIsToldMock.mockReset();
  lastMock.mockReset();
  lastMock.mockResolvedValue(null);
  previewMock.mockResolvedValue(drill());
  resultMock.mockImplementation(() => {
    return new Promise(() => {});
  });
});

afterEach(async () => {
  cleanup();
  await readIn("en");
});

describe("Run Fire Drill on the When this goes down card", () => {
  async function renderCard(policyIds: Array<string>): Promise<void> {
    whoIsToldMock.mockResolvedValue(whoIsTold(policyIds));

    render(
      <MemoryRouter>
        <MonitorWhoIsToldCard monitorId={new ObjectID(MONITOR_ID)} />
      </MemoryRouter>,
    );

    await screen.findByTestId("who-is-told-summary");
  }

  test("shows where a failure of the monitor pages an on-call policy, and opens the drill", async () => {
    await renderCard([PRIMARY, PLATFORM]);

    const button: HTMLElement = screen.getByTestId("run-fire-drill");

    expect(textOf(button)).toBe("Run Fire Drill");

    fireEvent.click(button);

    expect(await screen.findByTestId("fire-drill-dialog")).toBeInTheDocument();
    expect(previewMock).toHaveBeenCalledWith({
      monitorId: MONITOR_ID,
      eventKey: undefined,
    });
  });

  test("is not offered where no failure pages a policy: there is nothing to drill", async () => {
    await renderCard([]);

    expect(screen.queryByTestId("run-fire-drill")).not.toBeInTheDocument();
  });

  test("is not offered over a draft of the monitor: a drill reads the monitor as it is saved (#7055)", async () => {
    whoIsToldMock.mockResolvedValue(whoIsTold([PRIMARY]));

    render(
      <MemoryRouter>
        <MonitorWhoIsToldCard
          monitorId={new ObjectID(MONITOR_ID)}
          draft={{
            monitorId: new ObjectID(MONITOR_ID),
            name: "Checkout API",
            monitorType: MonitorType.Website,
            monitorSteps: new MonitorSteps(),
            labelIds: [],
          }}
        />
      </MemoryRouter>,
    );

    await screen.findByTestId("who-is-told-summary");

    expect(screen.queryByTestId("run-fire-drill")).not.toBeInTheDocument();
  });
});

describe("before the drill starts", () => {
  test("says plainly that it is a test, and that nothing public happens", async () => {
    await openDialog();

    expect(
      screen.getByText(
        "Tests everyone this monitor's failure would page. Every message says TEST. No incident or alert is created, and no status page or channel is told.",
      ),
    ).toBeInTheDocument();
  });

  test("names the failure it rehearses, each policy it pages, and who each one pages", async () => {
    await openDialog();

    expect(textOf(screen.getByTestId("fire-drill-failure-only"))).toBe(
      "Offline · An incident (Critical)",
    );

    const policies: Array<HTMLElement> =
      screen.getAllByTestId("fire-drill-policy");

    expect(
      policies.map((each: HTMLElement) => {
        return textOf(within(each).getByTestId("fire-drill-policy-name"));
      }),
    ).toEqual(["Primary", "Platform"]);
    expect(
      within(policies[0]!).getByText("Ana Lopez", { exact: false }),
    ).toBeInTheDocument();
    expect(
      within(policies[1]!).getByText("Bob Stone", { exact: false }),
    ).toBeInTheDocument();
    expect(startButton()).toBeEnabled();
    expect(textOf(startButton())).toBe("Start Fire Drill");
  });

  test("with more than one failure, picks one, and reads what that one pages", async () => {
    previewMock.mockResolvedValue(
      drill({
        events: [
          ...drill().events,
          {
            key: SLOW_KEY,
            criteriaName: "Slow",
            recordKind: OnCallTestPageRecordKind.Alert,
            severityName: "Warning",
            title: "API is slow",
            policyCount: 1,
          },
        ],
      }),
    );

    await openDialog();

    /*
     * A picker named by its label, showing the one this preview is of,
     * rather than a line.
     */
    expect(
      screen.queryByTestId("fire-drill-failure-only"),
    ).not.toBeInTheDocument();
    const picker: HTMLElement = screen.getByRole("combobox", {
      name: "What fails",
    });
    expect(withoutIsolateMarks(getShownDropdownValue(picker) || "")).toBe(
      "Offline · An incident (Critical)",
    );

    // Picking another failure reads who that one pages.
    await pickDropdownOption(picker, (name: string): boolean => {
      return withoutIsolateMarks(name) === "Slow · An alert (Warning)";
    });

    await waitFor(() => {
      expect(previewMock).toHaveBeenLastCalledWith({
        monitorId: MONITOR_ID,
        eventKey: SLOW_KEY,
      });
    });
  });

  test("a policy the reader may not test is named, who it pages is not shown, and the drill can't start", async () => {
    previewMock.mockResolvedValue(
      drill({
        policies: [
          policy(PRIMARY, "Primary", [person("Ana Lopez")]),
          { policyId: PLATFORM, policyName: "Platform", mayTest: false },
        ],
      }),
    );

    await openDialog();

    expect(screen.getByTestId("fire-drill-policy-cant-test")).toHaveTextContent(
      "You can't test this policy, so who it pages is not shown.",
    );
    expect(startButton()).toBeDisabled();
    expect(textOf(screen.getByTestId("fire-drill-blocked-reason"))).toBe(
      "You can't start this fire drill: it tests every policy this failure pages, and you can't test 1 of them. Ask a Project Admin, or the policy's owners.",
    );
  });

  test("a policy the reader may not even see is called so", async () => {
    previewMock.mockResolvedValue(
      drill({
        policies: [
          policy(PRIMARY, "Primary", [person("Ana Lopez")]),
          { policyId: PLATFORM, policyName: "", mayTest: false },
        ],
      }),
    );

    await openDialog();

    expect(
      screen.getByText("An on-call policy you can't see"),
    ).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
  });

  test("nobody any of its policies pages can receive it: it can't start, and says why", async () => {
    previewMock.mockResolvedValue(
      drill({
        policies: [
          policy(PRIMARY, "Primary", [optedOut("Ana Lopez")]),
          policy(PLATFORM, "Platform", []),
        ],
      }),
    );

    await openDialog();

    expect(startButton()).toBeDisabled();
    expect(textOf(screen.getByTestId("fire-drill-blocked-reason"))).toBe(
      "This fire drill would send nothing yet: nobody these policies page can receive it right now. Each line above says why.",
    );
  });

  test("one policy that reaches somebody is enough: the others' lines say why they reach nobody", async () => {
    previewMock.mockResolvedValue(
      drill({
        policies: [
          policy(PRIMARY, "Primary", [person("Ana Lopez")]),
          policy(PLATFORM, "Platform", [optedOut("Bob Stone")]),
        ],
      }),
    );

    await openDialog();

    expect(startButton()).toBeEnabled();
    expect(screen.queryByTestId("fire-drill-blocked")).not.toBeInTheDocument();
  });

  test("on OneUptime Cloud, says what the drill costs before it is sent", async () => {
    previewMock.mockResolvedValue(
      drill({
        cost: {
          isPaid: true,
          smsCount: 2,
          callCount: 1,
          whatsAppCount: 0,
          telegramCount: 0,
          estimatedCostInUSDCents: 45,
        },
      }),
    );

    await openDialog();

    expect(textOf(screen.getByTestId("fire-drill-cost"))).toBe(
      "This fire drill sends 2 SMS and 1 phone call, paid from this project's SMS and call balance: about $0.45.",
    );
  });

  test("a monitor whose failure pages nobody says so, in the server's words, and nothing can be started", async () => {
    previewMock.mockRejectedValue(
      new Error(
        "Nothing this monitor opens pages an on-call policy, so a fire drill has nothing to test.",
      ),
    );

    render(
      <MemoryRouter>
        <FireDrillModal monitorId={MONITOR_ID} onClose={() => {}} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(
        "Nothing this monitor opens pages an on-call policy, so a fire drill has nothing to test.",
        { exact: false },
      ),
    ).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
  });
});

describe("starting the drill", () => {
  test("asks the server for the failure picked - never a list of policies - and shows each policy's test as it happens", async () => {
    startMock.mockResolvedValue([
      { policyId: PRIMARY, policyName: "Primary", executionLogId: RUN_1 },
      { policyId: PLATFORM, policyName: "Platform", executionLogId: RUN_2 },
    ]);
    resultMock.mockImplementation(async (executionLogId: unknown) => {
      return {
        executionLogId: executionLogId,
        kind: OnCallTestPageKind.Policy,
        recordKind: OnCallTestPageRecordKind.Incident,
        severityName: "Critical",
        walksEscalation: false,
        status: OnCallTestPageStatus.Paging,
        statusMessage: "Test page sent to the first escalation level.",
        startedAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        steps: [],
      };
    });

    await openDialog();

    await act(async () => {
      fireEvent.click(startButton());
    });

    expect(startMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledWith({
      monitorId: MONITOR_ID,
      eventKey: OFFLINE_KEY,
      // Each policy's first level: the walk is off unless turned on (#9385).
      walksEscalation: false,
    });

    const results: Array<HTMLElement> =
      await screen.findAllByTestId("fire-drill-result");

    expect(
      results.map((each: HTMLElement) => {
        return textOf(each.querySelector("h4")!);
      }),
    ).toEqual(["Primary", "Platform"]);
    expect(resultMock).toHaveBeenCalledWith(RUN_1);
    expect(resultMock).toHaveBeenCalledWith(RUN_2);
    expect(
      textOf(screen.getByTestId("modal-description")).replace(/\s+/g, " "),
    ).toBe(
      "Started. Each policy's messages are below as they go out. Each test ends when someone acknowledges it, or after 15 minutes.",
    );
    // One way out, Done, drawn plain: closing does not stop the tests.
    expect(
      screen.queryByTestId("modal-footer-submit-button"),
    ).not.toBeInTheDocument();
  });

  test("a refusal - a policy tested a moment ago - is said in the server's words, and nothing is shown as started", async () => {
    startMock.mockRejectedValue(
      new Error(
        "On-call policy Platform was tested a moment ago, so the fire drill was not started. Wait 5 minutes, then run it again.",
      ),
    );

    await openDialog();

    await act(async () => {
      fireEvent.click(startButton());
    });

    expect(
      await screen.findByText(
        "On-call policy Platform was tested a moment ago, so the fire drill was not started. Wait 5 minutes, then run it again.",
        { exact: false },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("fire-drill-results")).not.toBeInTheDocument();
  });
});

describe("its words, in the reader's language", () => {
  test("a failure's label: its criteria, and what it opens at its severity", () => {
    expect(
      withoutIsolateMarks(
        getFireDrillFailureLabel(translatorIn("en"), drill().events[0]!),
      ),
    ).toBe("Offline · An incident (Critical)");
    expect(
      withoutIsolateMarks(
        getFireDrillFailureLabel(translatorIn("en"), {
          criteriaName: "Slow",
          recordKind: OnCallTestPageRecordKind.Alert,
          severityName: "Warning",
        }),
      ),
    ).toBe("Slow · An alert (Warning)");
  });

  test("why it can't start: a count of the policies the reader may not test, in the reader's plural", () => {
    expect(
      getFireDrillBlocker(
        drill({
          policies: [
            { policyId: PRIMARY, policyName: "Primary", mayTest: false },
            { policyId: PLATFORM, policyName: "", mayTest: false },
          ],
        }),
      ),
    ).toEqual({ kind: "cantTest", count: 2 });
    expect(translatorIn("en").translatePlural(FIRE_DRILL_CANT_TEST, 2)).toBe(
      "You can't start this fire drill: it tests every policy this failure pages, and you can't test 2 of them. Ask a Project Admin, or the policies' owners.",
    );
    expect(getFireDrillBlocker(drill())).toBeNull();
    expect(getFireDrillBlocker(null)).toBeNull();
  });

  test("in German and Persian, the dialog is the reader's", async () => {
    for (const language of ["de", "fa"]) {
      await readIn(language);
      await openDialog();

      expect(
        screen.getByText(LOCALES[language]![FIRE_DRILL_WORDS.description]!),
      ).toBeInTheDocument();
      expect(textOf(startButton())).toBe(
        LOCALES[language]![FIRE_DRILL_WORDS.start],
      );

      cleanup();
    }
  });

  test("every word of the drill is worded in every Dashboard language", () => {
    const keys: Array<string> = [
      ...Object.values(FIRE_DRILL_WORDS),
      FIRE_DRILL_CANT_TEST.other,
      `${FIRE_DRILL_CANT_TEST.other}_one`,
      "This fire drill sends {{items}}, paid from this project's SMS and call balance.",
      "This fire drill sends {{items}}, paid from this project's SMS and call balance: about {{amount}}.",
      // #9385, #9397, #9386.
      COST_SENTENCES.fireDrillWalk.withAmount,
      COST_SENTENCES.fireDrillWalk.withoutAmount,
      ...[
        FIRE_DRILL_DECLARED_AFTER,
        FIRE_DRILL_DECLARED_AFTER_HIDDEN_RULE,
        FIRE_DRILL_LAST_ACKNOWLEDGED,
        FIRE_DRILL_LAST_ACKNOWLEDGED_SO_FAR,
      ].flatMap((template: { other: string }): Array<string> => {
        return [template.other, `${template.other}_one`];
      }),
      ...Object.values(FIRE_DRILL_LAST_WORDS),
      ON_CALL_LOGS_FIRE_DRILL,
      ON_CALL_LOGS_FIRE_DRILL_MONITOR_DELETED,
    ];

    for (const file of fs.readdirSync(LOCALES_DIR).filter((each: string) => {
      return each.endsWith(".json") && each !== "en.json";
    })) {
      const locale: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
      ) as Record<string, string>;

      for (const key of keys) {
        expect({ file, key, worded: Boolean(locale[key]) }).toEqual({
          file,
          key,
          worded: true,
        });
        expect({ file, key, isEnglish: locale[key] === key }).toEqual({
          file,
          key,
          isEnglish: false,
        });
      }
    }
  });
});

/*
 * #9385: WALK EVERY ESCALATION LEVEL, folded under More fields, off by
 * default. On, each policy's test pages its levels in turn, as a walked
 * test of the policy does: the dialog lists every level each policy
 * reaches, prices the walk at most, and a drill whose first levels reach
 * nobody while a later level can is started in one click, as a policy's own
 * test offers it (#7259).
 */
function walkingLevelOf(
  first: Array<OnCallTestPagePreviewPerson>,
  later: Array<OnCallTestPagePreviewPerson>,
): OnCallTestPagePreview {
  return {
    ...levelOf(first),
    levelCount: 2,
    walkLevels: [
      {
        order: 2,
        startsAfterMinutes: 2,
        people: later,
        notPaged: [],
        notPagedCodes: [],
      },
    ],
    walkUnreachedLevelCount: 0,
  };
}

function walkingPolicy(
  id: string,
  name: string,
  first: Array<OnCallTestPagePreviewPerson>,
  later: Array<OnCallTestPagePreviewPerson>,
): OnCallFireDrillPolicy {
  return {
    policyId: id,
    policyName: name,
    mayTest: true,
    preview: walkingLevelOf(first, later),
  };
}

function walkFold(): HTMLElement {
  return screen.getByTestId("fire-drill-more-fields");
}

// The fold's line for the walk, and whether it says it is on.
function walkItem(): HTMLElement {
  return walkFold().querySelector(
    '[data-testid="folded-section-item"][data-item-key="walksEscalation"]',
  ) as HTMLElement;
}

function turnOnTheWalk(): void {
  fireEvent.click(within(walkFold()).getByTestId("folded-section-header"));
  fireEvent.click(screen.getByTestId("fire-drill-walks-escalation"));
}

describe("walking every escalation level (#9385)", () => {
  beforeEach(() => {
    previewMock.mockResolvedValue(
      drill({
        policies: [
          walkingPolicy(
            PRIMARY,
            "Primary",
            [person("Ana Lopez")],
            [
              person("Cara Diaz", {
                methods: [
                  {
                    channel: OnCallPageChannel.Call,
                    notifyAfterMinutes: 0,
                    isVerified: true,
                    canAcknowledge: true,
                  },
                ],
              }),
            ],
          ),
          policy(PLATFORM, "Platform", [person("Bob Stone")]),
        ],
        cost: {
          isPaid: true,
          smsCount: 2,
          callCount: 0,
          whatsAppCount: 0,
          telegramCount: 0,
          estimatedCostInUSDCents: 20,
        },
        walkCost: {
          isPaid: true,
          smsCount: 2,
          callCount: 1,
          whatsAppCount: 0,
          telegramCount: 0,
          estimatedCostInUSDCents: 55,
        },
      }),
    );
  });

  test("is folded away under More fields, off: each policy's first level is listed and priced", async () => {
    await openDialog();

    expect(
      within(walkFold()).getByTestId("folded-section-header"),
    ).toHaveAttribute("aria-expanded", "false");
    expect(walkItem()).toHaveAttribute("data-item-set", "false");
    expect(textOf(walkItem())).toBe("Walk every escalation level");
    expect(screen.queryByTestId("test-page-walk")).not.toBeInTheDocument();
    expect(textOf(screen.getByTestId("fire-drill-cost"))).toBe(
      "This fire drill sends 2 SMS, paid from this project's SMS and call balance: about $0.20.",
    );
  });

  test("is not offered where no policy has a level after its first: there is nothing to walk", async () => {
    previewMock.mockResolvedValue(drill());

    await openDialog();

    expect(
      screen.queryByTestId("fire-drill-more-fields"),
    ).not.toBeInTheDocument();
  });

  test("on, each policy's levels are listed in turn, the cost is the walk's at most, and the fold says it is on", async () => {
    await openDialog();
    turnOnTheWalk();

    const policies: Array<HTMLElement> =
      screen.getAllByTestId("fire-drill-policy");
    const headings: Array<string> = within(policies[0]!)
      .getAllByTestId("test-page-walk-level-heading")
      .map((heading: HTMLElement): string => {
        return textOf(heading);
      });

    expect(headings).toEqual([
      "Level 1, right away",
      "Level 2, after 2 minutes",
    ]);
    expect(
      within(policies[0]!).getByText("Cara Diaz", { exact: false }),
    ).toBeInTheDocument();
    expect(textOf(screen.getByTestId("fire-drill-cost"))).toBe(
      "If nobody acknowledges them, walking every level of each policy sends up to 2 SMS and 1 phone call, paid from this project's SMS and call balance: about $0.55.",
    );

    // Folded again, its line says the walk is on: nothing in force is hidden.
    fireEvent.click(within(walkFold()).getByTestId("folded-section-header"));

    expect(walkItem()).toHaveAttribute("data-item-set", "true");
    expect(textOf(walkItem())).toBe("Walk every escalation level: On");
    // And the walk stays on.
    expect(screen.getAllByTestId("test-page-walk").length).toBeGreaterThan(0);
  });

  test("on, Start Fire Drill asks the server to walk every level of each policy", async () => {
    startMock.mockResolvedValue([
      { policyId: PRIMARY, policyName: "Primary", executionLogId: RUN_1 },
    ]);

    await openDialog();
    turnOnTheWalk();

    await act(async () => {
      fireEvent.click(startButton());
    });

    expect(startMock).toHaveBeenCalledWith({
      monitorId: MONITOR_ID,
      eventKey: OFFLINE_KEY,
      walksEscalation: true,
    });
  });

  test("off, it asks for each policy's first level only", async () => {
    startMock.mockResolvedValue([
      { policyId: PRIMARY, policyName: "Primary", executionLogId: RUN_1 },
    ]);

    await openDialog();

    await act(async () => {
      fireEvent.click(startButton());
    });

    expect(startMock).toHaveBeenCalledWith({
      monitorId: MONITOR_ID,
      eventKey: OFFLINE_KEY,
      walksEscalation: false,
    });
  });

  test("when only a later level can be reached, Start is off with one line, and one click walks every level", async () => {
    previewMock.mockResolvedValue(
      drill({
        policies: [
          walkingPolicy(
            PRIMARY,
            "Primary",
            [optedOut("Ana Lopez")],
            [person("Cara Diaz")],
          ),
          policy(PLATFORM, "Platform", [optedOut("Bob Stone")]),
        ],
      }),
    );

    await openDialog();

    expect(startButton()).toBeDisabled();
    expect(textOf(screen.getByTestId("fire-drill-blocked-reason"))).toBe(
      "Nobody on these policies' first levels can receive this fire drill right now, so it would send nothing. A later level can.",
    );

    fireEvent.click(screen.getByTestId("fire-drill-walk-every-level"));

    expect(startButton()).toBeEnabled();
    expect(screen.queryByTestId("fire-drill-blocked")).not.toBeInTheDocument();
    expect(walkItem()).toHaveAttribute("data-item-set", "true");
  });

  test("walking, a drill nobody on any level can receive still can't start, and says why", async () => {
    previewMock.mockResolvedValue(
      drill({
        policies: [
          walkingPolicy(
            PRIMARY,
            "Primary",
            [optedOut("Ana Lopez")],
            [optedOut("Cara Diaz")],
          ),
        ],
      }),
    );

    await openDialog();

    // Walking would reach nobody either: no one-click walk is offered.
    expect(
      screen.queryByTestId("fire-drill-walk-every-level"),
    ).not.toBeInTheDocument();

    turnOnTheWalk();

    expect(startButton()).toBeDisabled();
    expect(textOf(screen.getByTestId("fire-drill-blocked-reason"))).toBe(
      "This fire drill would send nothing yet: nobody these policies page can receive it right now. Each line above says why.",
    );
  });

  test("the rule, as a function: a later level that reaches somebody stops blocking the drill only while walking", () => {
    const lateOnly: OnCallFireDrillPreview = drill({
      policies: [
        walkingPolicy(
          PRIMARY,
          "Primary",
          [optedOut("Ana Lopez")],
          [person("Cara Diaz")],
        ),
      ],
    });

    expect(isFireDrillWalkOffered(lateOnly)).toBe(true);
    expect(isFireDrillWalkOffered(drill())).toBe(false);
    expect(isFireDrillWalkOffered(null)).toBe(false);
    expect(
      getFireDrillBlocker(lateOnly, { isWalking: false, offersWalk: true }),
    ).toEqual({ kind: "walkReachesLaterLevel" });
    expect(
      getFireDrillBlocker(lateOnly, { isWalking: true, offersWalk: true }),
    ).toBeNull();
    // Not offered (an older server's preview): no walk to offer.
    expect(
      getFireDrillBlocker(lateOnly, { isWalking: false, offersWalk: false }),
    ).toEqual({ kind: "reachesNobody" });
  });
});

/*
 * #9397: THE INCIDENT AN ALERT INCIDENT RULE DECLARES, as a failure of its
 * own: what fails names it as declared from its alert, and one line says
 * which rule declares it and after how long - and that the drill does not
 * wait for it.
 */
const DECLARED_KEY: string = "criteria-slow:Incident:template-2:0:declared";

const DECLARED_EVENT: OnCallFireDrillPreview["events"][number] = {
  key: DECLARED_KEY,
  criteriaName: "Slow",
  recordKind: OnCallTestPageRecordKind.Incident,
  severityName: "Major",
  title: "API is slow",
  policyCount: 1,
  declaredBy: { ruleName: "Escalate slow alerts", waitInMinutes: 30 },
};

describe("the incident an alert incident rule declares (#9397)", () => {
  test("what fails names it as declared from its alert, and one line names the rule and its wait", async () => {
    previewMock.mockResolvedValue(
      drill({ events: [DECLARED_EVENT], eventKey: DECLARED_KEY }),
    );

    await openDialog();

    expect(textOf(screen.getByTestId("fire-drill-failure-only"))).toBe(
      "Slow · An incident (Major) declared from its alert",
    );
    expect(textOf(screen.getByTestId("fire-drill-declared"))).toBe(
      "Alert incident rule Escalate slow alerts declares this incident from the alert if it's still open after 30 minutes. The fire drill tests it now, without the wait.",
    );
  });

  test("in the picker it is told apart from its alert, and picking it reads what it pages", async () => {
    previewMock.mockResolvedValue(
      drill({
        events: [
          {
            key: SLOW_KEY,
            criteriaName: "Slow",
            recordKind: OnCallTestPageRecordKind.Alert,
            severityName: "Warning",
            title: "API is slow",
            policyCount: 1,
          },
          DECLARED_EVENT,
        ],
        eventKey: SLOW_KEY,
      }),
    );

    await openDialog();

    expect(screen.queryByTestId("fire-drill-declared")).not.toBeInTheDocument();

    const picker: HTMLElement = screen.getByRole("combobox", {
      name: "What fails",
    });

    await pickDropdownOption(picker, (name: string): boolean => {
      return (
        withoutIsolateMarks(name) ===
        "Slow · An incident (Major) declared from its alert"
      );
    });

    await waitFor(() => {
      expect(previewMock).toHaveBeenLastCalledWith({
        monitorId: MONITOR_ID,
        eventKey: DECLARED_KEY,
      });
    });
  });

  test("a rule the reader can't see, and one that declares right away, are said so", () => {
    const en: Translator = translatorIn("en");

    expect(
      withPlainSpaces(
        withoutIsolateMarks(
          getFireDrillDeclaredSentence(en, { ruleName: "", waitInMinutes: 30 }),
        ),
      ),
    ).toBe(
      "An alert incident rule you can't see declares this incident from the alert if it's still open after 30 minutes. The fire drill tests it now, without the wait.",
    );
    expect(
      withPlainSpaces(
        withoutIsolateMarks(
          getFireDrillDeclaredSentence(en, {
            ruleName: "Escalate",
            waitInMinutes: 1,
          }),
        ),
      ),
    ).toBe(
      "Alert incident rule Escalate declares this incident from the alert if it's still open after 1 minute. The fire drill tests it now, without the wait.",
    );
    expect(
      withoutIsolateMarks(
        getFireDrillDeclaredSentence(en, {
          ruleName: "Escalate",
          waitInMinutes: 0,
        }),
      ),
    ).toBe(
      "Alert incident rule Escalate declares this incident from the alert right away.",
    );
    expect(
      withoutIsolateMarks(
        getFireDrillDeclaredSentence(en, { ruleName: "", waitInMinutes: 0 }),
      ),
    ).toBe(
      "An alert incident rule you can't see declares this incident from the alert right away.",
    );
  });

  test("in German and Persian, the line is the reader's", () => {
    for (const language of ["de", "fa"]) {
      const translator: Translator = translatorIn(language);

      expect(
        withPlainSpaces(
          withoutIsolateMarks(
            getFireDrillDeclaredSentence(translator, {
              ruleName: "",
              waitInMinutes: 30,
            }),
          ),
        ),
      ).toBe(
        withPlainSpaces(
          LOCALES[language]![
            FIRE_DRILL_DECLARED_AFTER_HIDDEN_RULE.other
          ]!.replace("{{count}}", translator.formatNumber(30)),
        ),
      );
    }
  });
});

/*
 * #9386: THE CARD'S LAST FIRE DRILL. Once the drill's dialog is closed, the
 * card says the failure its last drill rehearsed, when and by whom, and how
 * many tests were acknowledged - each policy's folded until wanted - and
 * reads it again as a drill starts and its dialog closes.
 */
const STARTED_AT: string = new Date(
  Date.now() - 2 * 60 * 60 * 1000,
).toISOString();

function lastDrill(
  data: Partial<OnCallFireDrillRecord> = {},
): OnCallFireDrillRecord {
  return {
    fireDrillId: "7e5b4000-0000-4000-8000-0000000000f1",
    monitorId: MONITOR_ID,
    startedAt: STARTED_AT,
    startedByName: "Ana Lopez",
    failure: {
      criteriaName: "Offline",
      recordKind: OnCallTestPageRecordKind.Incident,
      severityName: "Critical",
    },
    walksEscalation: false,
    runs: [
      {
        executionLogId: RUN_1,
        policyId: PRIMARY,
        policyName: "Primary",
        status: OnCallTestPageStatus.Acknowledged,
        startedAt: STARTED_AT,
        endsAt: STARTED_AT,
        acknowledgedByName: "Ana Lopez",
        acknowledgedChannel: OnCallPageChannel.SMS,
        acknowledgedAfterSeconds: 14,
      },
      {
        executionLogId: RUN_2,
        policyId: PLATFORM,
        policyName: "Platform",
        status: OnCallTestPageStatus.Ended,
        startedAt: STARTED_AT,
        endsAt: STARTED_AT,
      },
    ],
    ...data,
  };
}

async function renderCardWithDrill(): Promise<void> {
  whoIsToldMock.mockResolvedValue(whoIsTold([PRIMARY, PLATFORM]));

  render(
    <MemoryRouter>
      <MonitorWhoIsToldCard monitorId={new ObjectID(MONITOR_ID)} />
    </MemoryRouter>,
  );

  await screen.findByTestId("who-is-told-summary");
}

describe("the card's Last fire drill (#9386)", () => {
  test("says the failure the last drill rehearsed, when and by whom, and how many of its tests were acknowledged", async () => {
    lastMock.mockResolvedValue(lastDrill());

    await renderCardWithDrill();

    const line: HTMLElement = await screen.findByTestId("last-fire-drill");

    expect(lastMock).toHaveBeenCalledWith(MONITOR_ID);
    expect(within(line).getByRole("heading")).toHaveTextContent(
      "Last fire drill",
    );
    expect(textOf(screen.getByTestId("last-fire-drill-failure"))).toBe(
      "Offline · An incident (Critical)",
    );
    expect(textOf(screen.getByTestId("last-fire-drill-started"))).toMatch(
      /^Started .+ by Ana Lopez$/,
    );
    expect(textOf(screen.getByTestId("last-fire-drill-outcome"))).toBe(
      "1 of 2 tests acknowledged.",
    );
    // Each policy's, folded until wanted.
    expect(
      screen.queryByTestId("last-fire-drill-details"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("last-fire-drill-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(textOf(screen.getByTestId("last-fire-drill-toggle"))).toBe(
      "Show details",
    );
  });

  test("Show details lists each policy's test: acknowledged, by whom, by what and how fast - or not", async () => {
    lastMock.mockResolvedValue(lastDrill());

    await renderCardWithDrill();
    fireEvent.click(await screen.findByTestId("last-fire-drill-toggle"));

    const results: Array<HTMLElement> = screen.getAllByTestId(
      "last-fire-drill-result",
    );

    expect(
      results.map((each: HTMLElement) => {
        return [
          textOf(within(each).getByTestId("last-fire-drill-policy")),
          each.getAttribute("data-status"),
        ];
      }),
    ).toEqual([
      ["Primary", OnCallTestPageStatus.Acknowledged],
      ["Platform", OnCallTestPageStatus.Ended],
    ]);
    expect(within(results[0]!).getByText("It works")).toBeInTheDocument();
    expect(
      textOf(within(results[0]!).getByTestId("last-fire-drill-acknowledged")),
    ).toBe("Ana Lopez acknowledged it by SMS after 14 seconds.");
    expect(
      within(results[1]!).getByText("Nobody acknowledged it"),
    ).toBeInTheDocument();
    expect(
      within(results[1]!).queryByTestId("last-fire-drill-acknowledged"),
    ).not.toBeInTheDocument();
    expect(textOf(screen.getByTestId("last-fire-drill-toggle"))).toBe(
      "Hide details",
    );
    // Not walked: nothing said of a walk.
    expect(
      screen.queryByTestId("last-fire-drill-walked"),
    ).not.toBeInTheDocument();
  });

  test("a walked drill says each test walked every level; a declared incident's says it was declared", async () => {
    lastMock.mockResolvedValue(
      lastDrill({
        walksEscalation: true,
        failure: {
          criteriaName: "Slow",
          recordKind: OnCallTestPageRecordKind.Incident,
          severityName: "Major",
          declaredAfterMinutes: 30,
        },
      }),
    );

    await renderCardWithDrill();
    fireEvent.click(await screen.findByTestId("last-fire-drill-toggle"));

    expect(textOf(screen.getByTestId("last-fire-drill-failure"))).toBe(
      "Slow · An incident (Major) declared from its alert",
    );
    expect(textOf(screen.getByTestId("last-fire-drill-walked"))).toBe(
      "Each test walked every escalation level.",
    );
  });

  test("with no drill, or none the reader may read, nothing is drawn", async () => {
    await renderCardWithDrill();

    await waitFor(() => {
      expect(lastMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId("last-fire-drill")).not.toBeInTheDocument();
  });

  test("a drill that can't be read says nothing, and the card stands", async () => {
    lastMock.mockRejectedValue(new Error("Server error."));

    await renderCardWithDrill();

    await waitFor(() => {
      expect(lastMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId("last-fire-drill")).not.toBeInTheDocument();
    expect(screen.getByTestId("who-is-told-summary")).toBeInTheDocument();
  });

  test("is read again as a drill is started from the card, and as its dialog closes", async () => {
    startMock.mockResolvedValue([
      { policyId: PRIMARY, policyName: "Primary", executionLogId: RUN_1 },
    ]);

    await renderCardWithDrill();
    await waitFor(() => {
      expect(lastMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByTestId("run-fire-drill"));
    await screen.findByTestId("fire-drill-policies");

    await act(async () => {
      fireEvent.click(startButton());
    });

    await waitFor(() => {
      expect(lastMock).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-close-button"));
    });

    await waitFor(() => {
      expect(lastMock).toHaveBeenCalledTimes(3);
    });
  });

  test("is never read over a draft of the monitor", async () => {
    whoIsToldMock.mockResolvedValue(whoIsTold([PRIMARY]));

    render(
      <MemoryRouter>
        <MonitorWhoIsToldCard
          monitorId={new ObjectID(MONITOR_ID)}
          draft={{
            monitorId: new ObjectID(MONITOR_ID),
            name: "Checkout API",
            monitorType: MonitorType.Website,
            monitorSteps: new MonitorSteps(),
            labelIds: [],
          }}
        />
      </MemoryRouter>,
    );

    await screen.findByTestId("who-is-told-summary");

    expect(lastMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("last-fire-drill")).not.toBeInTheDocument();
  });

  test("while a test still waits for somebody it says so far, and is read again until it is over", async () => {
    const running: OnCallFireDrillRecord = lastDrill({
      runs: [
        {
          executionLogId: RUN_1,
          policyId: PRIMARY,
          policyName: "Primary",
          status: OnCallTestPageStatus.Paging,
          startedAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        },
      ],
    });

    lastMock.mockResolvedValueOnce(running).mockResolvedValue(
      lastDrill({
        runs: [
          {
            ...running.runs[0]!,
            status: OnCallTestPageStatus.Acknowledged,
            acknowledgedByName: "Ana Lopez",
          },
        ],
      }),
    );

    render(
      <MemoryRouter>
        <LastFireDrill monitorId={MONITOR_ID} pollIntervalInMs={20} />
      </MemoryRouter>,
    );

    expect(textOf(await screen.findByTestId("last-fire-drill-outcome"))).toBe(
      "0 of 1 test acknowledged so far.",
    );

    await waitFor(() => {
      expect(textOf(screen.getByTestId("last-fire-drill-outcome"))).toBe(
        "1 of 1 test acknowledged.",
      );
    });

    // Over: read no more.
    const reads: number = lastMock.mock.calls.length;
    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 80);
      });
    });
    expect(lastMock.mock.calls.length).toBe(reads);
  });

  test("its words: the failure as the dialog named it, and the counts in the reader's plural and digits", () => {
    const en: Translator = translatorIn("en");
    const fa: Translator = translatorIn("fa");

    expect(withoutIsolateMarks(getLastFireDrillFailure(en, lastDrill()))).toBe(
      "Offline · An incident (Critical)",
    );
    expect(getLastFireDrillOutcome(en, lastDrill())).toBe(
      "1 of 2 tests acknowledged.",
    );
    expect(isLastFireDrillRunning(lastDrill())).toBe(false);
    // Persian's digits for both counts.
    expect(getLastFireDrillOutcome(fa, lastDrill())).toContain(
      fa.formatNumber(2),
    );
    expect(getLastFireDrillOutcome(fa, lastDrill())).toContain(
      fa.formatNumber(1),
    );
    expect(fa.formatNumber(2)).not.toBe("2");
  });

  test("in German, the line is the reader's", async () => {
    await readIn("de");
    lastMock.mockResolvedValue(lastDrill());

    await renderCardWithDrill();

    const line: HTMLElement = await screen.findByTestId("last-fire-drill");

    expect(within(line).getByRole("heading")).toHaveTextContent(
      LOCALES["de"]![FIRE_DRILL_LAST_WORDS.title]!,
    );
    expect(textOf(screen.getByTestId("last-fire-drill-outcome"))).toBe(
      LOCALES["de"]![FIRE_DRILL_LAST_ACKNOWLEDGED.other]!.replace(
        "{{acknowledged}}",
        "1",
      ).replace("{{count}}", "2"),
    );
  });
});

/*
 * #9386: A FIRE DRILL'S TEST IN ITS POLICY'S EXECUTION LOGS says it was part
 * of a fire drill of the monitor, whose name opens it - or of one deleted
 * since.
 */
describe("a fire drill's test in the execution logs (#9386)", () => {
  test("says it was part of a fire drill of the monitor, and links the monitor", () => {
    render(
      <MemoryRouter>
        <FireDrillTrigger
          run={{
            testPageFireDrillMonitorId: new ObjectID(MONITOR_ID),
            testPageFireDrillMonitor: { name: "API" } as never,
          }}
        />
      </MemoryRouter>,
    );

    expect(textOf(screen.getByTestId("execution-log-fire-drill-trigger"))).toBe(
      "Fire drill of monitor API: no incident or alert",
    );
    expect(
      screen
        .getByTestId("execution-log-fire-drill-monitor")
        .getAttribute("href"),
    ).toContain(MONITOR_ID);
  });

  test("of a monitor deleted since, says so", () => {
    render(
      <MemoryRouter>
        <FireDrillTrigger run={{}} />
      </MemoryRouter>,
    );

    expect(textOf(screen.getByTestId("execution-log-fire-drill-trigger"))).toBe(
      "Fire drill of a monitor that was deleted: no incident or alert",
    );
  });

  test("the logs read what it needs with every row", () => {
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable.tsx",
      ),
      "utf8",
    );

    expect(source).toMatch(
      /selectMoreFields=\{\{[\s\S]*?testPageFireDrillId: true,[\s\S]*?testPageFireDrillMonitorId: true,[\s\S]*?testPageFireDrillMonitor: \{\s*name: true,\s*\}/,
    );
  });
});
