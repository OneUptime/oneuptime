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
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/WhoIsToldApi",
  () => {
    return {
      __esModule: true,
      default: {
        getForMonitor: (...args: Array<unknown>) => {
          return whoIsToldMock(...args);
        },
      },
    };
  },
);

import MonitorWhoIsToldCard from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorWhoIsToldCard";
import FireDrillModal, {
  getFireDrillBlocker,
  getFireDrillFailureLabel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/FireDrillModal";
import {
  FIRE_DRILL_CANT_TEST,
  FIRE_DRILL_WORDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/OnCallTestPageWords";
import {
  WhoIsToldOwnersSource,
  WhoIsToldResult,
} from "../../../Types/Monitor/WhoIsTold";
import ObjectID from "../../../Types/ObjectID";
import {
  OnCallFireDrillPolicy,
  OnCallFireDrillPreview,
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

function textOf(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "");
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

    // A picker, showing the one this preview is of, rather than a line.
    expect(
      screen.queryByTestId("fire-drill-failure-only"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Offline · An incident (Critical)", { exact: false }),
    ).toBeInTheDocument();
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
          key: SLOW_KEY,
          criteriaName: "Slow",
          recordKind: OnCallTestPageRecordKind.Alert,
          severityName: "Warning",
          title: "API is slow",
          policyCount: 1,
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
