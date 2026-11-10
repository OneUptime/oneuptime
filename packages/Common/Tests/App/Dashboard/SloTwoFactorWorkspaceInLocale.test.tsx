/**
 * @timezone UTC
 */
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
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";

/*
 * THE SLO OVERVIEW'S CARDS, THE TWO-FACTOR STATUS AND A WORKSPACE'S TEST
 * BUTTON IN THE READER'S LANGUAGE - from the Dashboard's shipped locale
 * files (#6658).
 *
 * A German SLO overview used to say "Rolling 30 days", "43m 12s of downtime
 * allowed per rolling 30 days" and "2 burn rate rules are ready to alert"
 * between German labels, and an Arabic one counted its days the English
 * way; the two-factor card said "Enabled" in every language, and the Slack
 * and Microsoft Teams rows told a screen reader "Send test notification to
 * #alerts" in English. Each is now one sentence looked up whole, counted the
 * way the reader's language counts - and still the English word for word
 * for an English reader.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const EN: Record<string, string> = readLocale("en");
const DE: Record<string, string> = readLocale("de");
const AR: Record<string, string> = readLocale("ar");

// The locale's own words for `key`, which must differ from the English.
function worded(
  locale: Record<string, string>,
  key: string,
  values: Record<string, string> = {},
): string {
  const text: string | undefined = locale[key];

  expect({ key, translated: Boolean(text) && text !== EN[key] }).toEqual({
    key,
    translated: true,
  });

  return Object.keys(values).reduce((sentence: string, name: string) => {
    return sentence.split(`{{${name}}}`).join(values[name] as string);
  }, text as string);
}

let mockUser: Record<string, unknown> | null = null;
let mockPostResult: unknown = null;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (request: {
        modelType: new () => Record<string, unknown>;
      }): Promise<unknown> => {
        if (!mockUser) {
          return Promise.resolve(null);
        }
        const Model: new () => Record<string, unknown> = request.modelType;
        return Promise.resolve(Object.assign(new Model(), mockUser));
      },
      updateById: (): Promise<unknown> => {
        return Promise.resolve(new HTTPResponse<JSONObject>(200, {}, {}));
      },
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "project-under-test" };
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (): Promise<unknown> => {
        return mockPostResult instanceof Error
          ? Promise.reject(mockPostResult)
          : Promise.resolve(mockPostResult);
      },
      getFriendlyErrorMessage: (error: unknown): string => {
        return (error as Error).message;
      },
      getFriendlyMessage: (error: unknown): string => {
        return (error as Error).message;
      },
    },
  };
});

import SloBurnRateRulesSummaryCard from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloBurnRateRulesSummaryCard";
import SloConfigurationSummaryCard from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloConfigurationSummaryCard";
import SloOverviewEmptyState from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloOverviewEmptyState";
import SloOverviewGettingStartedCard from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloOverviewGettingStartedCard";
import TwoFactorStatus from "../../../../App/FeatureSet/Dashboard/src/Components/TwoFactorAuth/TwoFactorStatus";
import SendTestNotificationButton from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/SendTestNotificationButton";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import SloMultiMonitorMode from "../../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import UserUtil from "../../../UI/Utils/User";
import { formatDurationCompactInLanguage } from "../../../Utils/Slo/SloDuration";

const SLO_ID: ObjectID = new ObjectID("5f8b7c1e2d3a4b5c6d7e8f90");
const NOW: Date = new Date("2026-09-15T12:00:00.000Z");

function buildSlo(
  overrides: Partial<Record<keyof ServiceLevelObjective, unknown>> = {},
): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo.targetPercentage = 99.9;
  slo.windowType = SloWindowType.Rolling;
  slo.windowDays = 30;
  slo.timezone = "UTC";
  slo.atRiskThresholdPercentage = 25;
  slo.multiMonitorMode = SloMultiMonitorMode.AnyDown;
  slo.sliType = SliType.MonitorUptime;
  slo.downtimeMonitorStatuses = [];
  Object.assign(slo, overrides);
  return slo;
}

let ruleCounter: number = 0;

function buildRule(
  overrides: Partial<Record<keyof ServiceLevelObjectiveBurnRateRule, unknown>>,
): ServiceLevelObjectiveBurnRateRule {
  ruleCounter += 1;
  const rule: ServiceLevelObjectiveBurnRateRule =
    new ServiceLevelObjectiveBurnRateRule();
  rule._id = `5f8b7c1e2d3a4b5c6d7e${(9000 + ruleCounter).toString()}`;
  rule.isEnabled = true;
  rule.shouldCreateAlert = false;
  rule.shouldCreateIncident = false;
  Object.assign(rule, overrides);
  return rule;
}

function renderInRouter(element: React.ReactElement): void {
  render(<MemoryRouter>{element}</MemoryRouter>);
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      ar: { translation: AR },
      en: { translation: EN },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("de");
  mockUser = null;
  mockPostResult = new HTTPResponse<JSONObject>(200, {}, {});
  jest
    .spyOn(UserUtil, "getUserId")
    .mockReturnValue(new ObjectID("33333333-3333-4333-8333-333333333333"));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the SLO overview's configuration card in German and Arabic", () => {
  test("German: the window, the downtime allowed, the at-risk line and the indicator", () => {
    renderInRouter(
      <SloConfigurationSummaryCard sloId={SLO_ID} slo={buildSlo()} now={NOW} />,
    );

    expect(screen.getByTestId("slo-configuration-window")).toHaveTextContent(
      worded(DE, "Rolling {{count}} days", { count: "30" }),
    );
    expect(screen.getByTestId("slo-configuration-at-risk")).toHaveTextContent(
      worded(DE, "When {{percent}} or less of the error budget is left", {
        percent: "25%",
      }),
    );
    expect(
      screen.getByTestId("slo-configuration-downtime-statuses"),
    ).toHaveTextContent(worded(DE, "Every non-operational status"));
    expect(
      screen.getByTestId("slo-configuration-multi-monitor-mode"),
    ).toHaveTextContent(worded(DE, "Down when any monitor is down"));
    expect(screen.getByTestId("slo-configuration-indicator")).toHaveTextContent(
      worded(DE, "Monitor uptime"),
    );
    expect(screen.getByTestId("slo-configuration-indicator")).toHaveTextContent(
      worded(DE, "Evaluated every {{count}} minutes.", { count: "5" }),
    );

    const objective: HTMLElement = screen.getByTestId(
      "slo-configuration-objective",
    );

    expect(objective).toHaveTextContent(
      /Ausfallzeit erlaubt pro rollierenden 30 Tagen/,
    );

    // None of the English it used to show is left.
    for (const english of [
      "Rolling 30 days",
      "of downtime allowed",
      "or less of the error budget is left",
      "Every non-operational status",
      "Monitor uptime",
      "Evaluated every 5 minutes.",
      "43m 12s",
    ]) {
      expect(document.body.textContent).not.toContain(english);
    }
  });

  test("Arabic: a calendar month, and days counted with a label", async () => {
    await act(async () => {
      await i18next.changeLanguage("ar");
    });

    renderInRouter(
      <SloConfigurationSummaryCard
        sloId={SLO_ID}
        slo={buildSlo({
          windowType: SloWindowType.CalendarMonth,
          timezone: "Asia/Riyadh",
        })}
        now={NOW}
      />,
    );

    expect(screen.getByTestId("slo-configuration-window")).toHaveTextContent(
      worded(AR, "Calendar month ({{timezone}})", { timezone: "Asia/Riyadh" }),
    );
    expect(screen.getByTestId("slo-configuration-objective")).toHaveTextContent(
      /^.*وقت التوقف المسموح به هذا الشهر التقويمي: .+$/,
    );
    cleanup();

    renderInRouter(
      <SloConfigurationSummaryCard sloId={SLO_ID} slo={buildSlo()} now={NOW} />,
    );
    expect(screen.getByTestId("slo-configuration-window")).toHaveTextContent(
      "نافذة متحركة (الأيام: 30)",
    );
  });

  test("English reads word for word as before", async () => {
    await act(async () => {
      await i18next.changeLanguage("en");
    });

    renderInRouter(
      <SloConfigurationSummaryCard sloId={SLO_ID} slo={buildSlo()} now={NOW} />,
    );

    expect(screen.getByTestId("slo-configuration-window")).toHaveTextContent(
      "Rolling 30 days",
    );
    expect(
      within(screen.getByTestId("slo-configuration-objective")).getByText(
        "43m 12s of downtime allowed per rolling 30 days",
      ),
    ).toBeInTheDocument();
  });
});

describe("the SLO overview's burn rate rules card in German", () => {
  const rules: Array<ServiceLevelObjectiveBurnRateRule> = [
    buildRule({
      name: "Fast burn",
      burnRateThreshold: 14.4,
      longWindowInMinutes: 60,
      shortWindowInMinutes: 5,
      shouldCreateIncident: true,
    }),
    buildRule({
      name: "Paused rule",
      burnRateThreshold: 1,
      isEnabled: false,
    }),
  ];

  test("each rule's threshold is one German sentence, and the disabled rule is counted in German", () => {
    renderInRouter(
      <SloBurnRateRulesSummaryCard
        sloId={SLO_ID}
        rules={rules}
        currentBurnRate={2}
        error=""
      />,
    );

    const row: HTMLElement = screen.getByTestId("slo-burn-rule-row");

    expect(row.textContent).toContain(
      worded(
        DE,
        "At {{rate}} or faster over {{longWindow}} and {{shortWindow}}",
        {
          rate: "14.4×",
          longWindow: formatDurationCompactInLanguage(3600, "de"),
          shortWindow: formatDurationCompactInLanguage(300, "de"),
        },
      ),
    );
    // The windows are German durations, never the English "1h" and "5m".
    expect(formatDurationCompactInLanguage(3600, "de")).not.toBe("1h");
    expect(row.textContent).not.toContain("or faster");
    expect(row.textContent).not.toContain(" over ");
    expect(document.body.textContent).toContain(
      worded(DE, "{{count}} disabled rules are not shown._one", {
        count: "1",
      }),
    );
    expect(document.body.textContent).not.toContain("disabled rule is not");
  });

  test("with every rule disabled it warns, in German, that nothing alerts", () => {
    renderInRouter(
      <SloBurnRateRulesSummaryCard
        sloId={SLO_ID}
        rules={[rules[1]!]}
        currentBurnRate={null}
        error=""
      />,
    );

    expect(screen.getByTestId("slo-burn-rules-empty")).toHaveTextContent(
      worded(
        DE,
        "This SLO has {{count}} disabled rules, so nothing alerts when it burns its error budget too fast._one",
        { count: "1" },
      ),
    );
  });
});

describe("the SLO overview's getting-started card and empty states", () => {
  test("German counts the ready rules, Arabic names the count with a label", async () => {
    renderInRouter(
      <SloOverviewGettingStartedCard
        sloId={SLO_ID}
        enabledBurnRateRuleCount={2}
      />,
    );
    expect(document.body.textContent).toContain(
      worded(
        DE,
        "{{count}} burn rate rules are ready to alert when the budget burns too fast. Adjust thresholds, severities and who gets paged.",
        { count: "2" },
      ),
    );
    cleanup();

    await act(async () => {
      await i18next.changeLanguage("ar");
    });

    renderInRouter(
      <SloOverviewGettingStartedCard
        sloId={SLO_ID}
        enabledBurnRateRuleCount={12}
      />,
    );
    expect(document.body.textContent).toContain(
      "قواعد معدل الاستهلاك الجاهزة للتنبيه عندما تُستهلك الميزانية بسرعة كبيرة: 12.",
    );
  });

  test("an empty state looks its title and description up, and draws a worded one as it is", () => {
    render(
      <SloOverviewEmptyState
        icon={IconProp.CheckCircle}
        title="Nothing needs attention right now"
        description="No burn rate rule is enabled yet, so nothing will alert when the budget burns too fast."
        dataTestId="empty"
      />,
    );

    const empty: HTMLElement = screen.getByTestId("empty");

    expect(empty).toHaveTextContent(
      worded(DE, "Nothing needs attention right now"),
    );
    expect(empty).toHaveTextContent(
      worded(
        DE,
        "No burn rate rule is enabled yet, so nothing will alert when the budget burns too fast.",
      ),
    );
    cleanup();

    // A sentence a caller has already worded has no key: drawn as given.
    render(
      <SloOverviewEmptyState
        icon={IconProp.CheckCircle}
        title="Alles im grünen Bereich"
        description="Die 3 Monitore laufen."
        dataTestId="empty"
      />,
    );
    expect(screen.getByTestId("empty")).toHaveTextContent(
      "Alles im grünen Bereich",
    );
    expect(screen.getByTestId("empty")).toHaveTextContent(
      "Die 3 Monitore laufen.",
    );
  });
});

describe("the two-factor status card in German and Arabic", () => {
  test("German: the status badge and what it means", async () => {
    mockUser = { enableTwoFactorAuth: true };
    render(<TwoFactorStatus />);

    expect(await screen.findByTestId("two-factor-status")).toHaveTextContent(
      worded(DE, "Enabled"),
    );
    expect(
      screen.getByText(
        worded(
          DE,
          "Use an authenticator app or security key for your second step.",
        ),
      ),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(
      "Use an authenticator app or security key",
    );
  });

  test("Arabic: not enabled, and why a status that cannot be read is not called off", async () => {
    await act(async () => {
      await i18next.changeLanguage("ar");
    });

    mockUser = { enableTwoFactorAuth: false };
    render(<TwoFactorStatus />);
    expect(await screen.findByTestId("two-factor-status")).toHaveTextContent(
      worded(AR, "Not enabled"),
    );
    cleanup();

    mockUser = null;
    render(<TwoFactorStatus />);
    expect(
      await screen.findByText(
        worded(
          AR,
          "Your two-factor authentication status could not be loaded.",
        ),
      ),
    ).toBeInTheDocument();
  });
});

describe("a workspace row's Send Test button in German and Arabic", () => {
  test("German: what a screen reader hears, and the result it reports", async () => {
    render(
      <SendTestNotificationButton
        route="/slack/channels/test"
        requestBody={{ channelId: "C0123ALERTS" }}
        destinationName="#alerts"
        workspaceName="Slack"
      />,
    );

    const button: HTMLElement = screen.getByRole("button", {
      name: worded(DE, "Send test notification to {{destination}}", {
        destination: "#alerts",
      }),
    });

    await act(async () => {
      fireEvent.click(button);
    });

    const sent: HTMLElement = await screen.findByTestId(
      "send-test-notification-sent",
    );

    expect(sent).toHaveTextContent(worded(DE, "Sent"));
    expect(sent).toHaveAttribute(
      "title",
      worded(
        DE,
        "Test notification sent to {{destination}}. Check {{workspace}} to confirm it arrived.",
        { destination: "#alerts", workspace: "Slack" },
      ),
    );
  });

  test("Arabic: a failed send says so in Arabic, the server's reason beside it", async () => {
    await act(async () => {
      await i18next.changeLanguage("ar");
    });

    mockPostResult = new Error("channel_not_found");

    render(
      <SendTestNotificationButton
        route="/microsoft-teams/chats/test"
        requestBody={{ chatId: "19:war-room@thread.v2" }}
        destinationName="Incident War Room"
        workspaceName="Microsoft Teams"
      />,
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: worded(AR, "Send test notification to {{destination}}", {
            destination: "Incident War Room",
          }),
        }),
      );
    });

    expect(
      await screen.findByTestId("send-test-notification-failed"),
    ).toHaveTextContent(worded(AR, "Failed"));
    expect(
      screen.getByText(
        worded(
          AR,
          "OneUptime could not send a test notification to {{destination}} in {{workspace}}.",
          {
            destination: "Incident War Room",
            workspace: "Microsoft Teams",
          },
        ),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("channel_not_found")).toBeInTheDocument();
  });
});
