import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import WidgetRenderer from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/WidgetRenderer";
import {
  DrawnResourceCard,
  DrawnResourceCardFact,
  getDrawnResourceCard,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ResourceCardWords";
import WidgetBuilder from "../../../Server/Utils/AI/Toolbox/WidgetBuilder";
import {
  getEmptyRunbookCardWords,
  getEmptyTeamCardWords,
  getMonitorCardWords,
  getOnCallPolicyCardWords,
  getOnCallScheduleCardWords,
  getSecurityCaseCardWords,
  getSloCardWords,
  getStatusPageCardWords,
  getUnrunWorkflowCardWords,
} from "../../../Server/Utils/AI/Toolbox/ReadCardWords";
import {
  AIActionCardWords,
  describeAIActionCardWords,
  isAIActionMoment,
} from "../../../Types/AI/AIActionWords";
import { AIChatWidget } from "../../../Types/AI/AIChatTypes";
import OneUptimeDate from "../../../Types/Date";
import { withDateDisplayLanguage } from "../../../Types/DateLanguage";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import { Translator } from "../../../Types/Translator";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * THE CARD A READ LEAVES, IN THE READER'S LANGUAGE (issue #7175).
 *
 * Under an answer, the card a read left - a monitor, an SLO, a team, an
 * on-call policy or schedule, a status page, a runbook, a workflow, a
 * security case - said its kind, its facts' names and OneUptime's own
 * values in the server's English on a German, Persian or Arabic page. The
 * Dashboard draws them in the reader's language now, from the words the
 * card stores: figures the reader's way, each moment as every page writes
 * one, and the data - names, a status the project named, a URL - as
 * written.
 */

const DE: Record<string, string> = readDashboardLocale("de");
const FA: Record<string, string> = readDashboardLocale("fa");
const AR: Record<string, string> = readDashboardLocale("ar");

const SINCE: Date = new Date("2026-11-12T08:00:00.000Z");
const HANDOFF: Date = new Date("2026-11-13T08:00:00.000Z");

function readCard(heading: string, words: AIActionCardWords): AIChatWidget {
  return {
    ...WidgetBuilder.resourceCard({ title: heading, heading, words }),
    id: "W1",
  };
}

function scheduleCard(): AIChatWidget {
  return readCard(
    "Primary rotation",
    getOnCallScheduleCardWords({
      onCallNow: "Alice",
      rosterStartAt: SINCE,
      rosterHandoffAt: HANDOFF,
      nextUp: "Bo",
      rosterNextStartAt: HANDOFF,
    }),
  );
}

function securityCaseCard(): AIChatWidget {
  return readCard(
    "CASE-42 Brute force",
    getSecurityCaseCardWords({
      statusName: "New",
      priorityName: "P1",
      detectionCount: 1234,
      entities: [
        { type: SecurityEntityType.IpAddress, value: "10.0.0.7" },
        { type: SecurityEntityType.User, value: "alice" },
      ],
    }),
  );
}

function sloCard(): AIChatWidget {
  return readCard(
    "Checkout availability",
    getSloCardWords({
      description: "Checkout stays up.",
      targetPercentage: 99.95,
      windowType: SloWindowType.Rolling,
      windowDays: 30,
      sliType: SliType.MonitorUptime,
      isArchived: false,
      isEnabled: true,
      sloStatus: SloStatus.AtRisk,
      currentSliPercentage: 99.9,
      errorBudgetRemainingPercentage: 42.5,
      currentBurnRate: 1.25,
      monitorNames: "Checkout API",
      monitorRules: { isVisible: true, count: 2, enabledCount: 1 },
      burnRateRules: { isVisible: false, count: 0 },
      policyTiers: { isVisible: true, count: 0 },
      deploymentsAllowed: true,
    }),
  );
}

function statusPageCard(): AIChatWidget {
  return readCard(
    "Acme Status",
    getStatusPageCardWords({
      description: "What our customers see.",
      isPublic: true,
      isArchived: false,
      publicUrl: "https://status.acme.dev",
      resourceCount: 2,
      resources: [
        {
          name: "Checkout",
          source: { name: "checkout-api", isMonitorGroup: false },
          isNotMonitored: false,
        },
        { name: "CDN", isNotMonitored: true },
      ],
      activeSubscribers: 1234,
    }),
  );
}

function policyCard(): AIChatWidget {
  return readCard(
    "Payments primary",
    getOnCallPolicyCardWords({
      isArchived: false,
      rules: [
        {
          order: 2,
          name: "Database team",
          users: ["Alice"],
          teams: ["SRE"],
          schedules: [],
          escalateAfterInMinutes: 5,
        },
      ],
    }),
  );
}

// Every card a read leaves, a branch of each.
function everyCard(): Array<AIChatWidget> {
  return [
    readCard(
      "Checkout API",
      getMonitorCardWords({
        monitorType: MonitorType.Website,
        statusName: "Offline",
        isMonitoringOff: true,
        isArchived: true,
      }),
    ),
    sloCard(),
    readCard("DBA", getEmptyTeamCardWords({ description: "Databases" })),
    policyCard(),
    scheduleCard(),
    readCard("Primary rotation", getOnCallScheduleCardWords({})),
    statusPageCard(),
    readCard(
      "Database failover",
      getEmptyRunbookCardWords({ isEnabled: false }),
    ),
    readCard(
      "Deploy notifier",
      getUnrunWorkflowCardWords({ isEnabled: true, isArchived: true }),
    ),
    securityCaseCard(),
  ];
}

function lineText(card: DrawnResourceCard): string {
  return card.line
    .map((part: { text: string; separatorBefore: string }): string => {
      return `${part.separatorBefore}${part.text}`;
    })
    .join("");
}

function factOf(
  card: DrawnResourceCard,
  label: string | undefined,
): DrawnResourceCardFact {
  const fact: DrawnResourceCardFact | undefined = card.facts.find(
    (candidate: DrawnResourceCardFact): boolean => {
      return candidate.label === label;
    },
  );

  expect({ label, found: Boolean(fact) }).toEqual({ label, found: true });

  return fact!;
}

// A moment as every page writes one, in a language.
function momentIn(language: string, moment: Date): string {
  return withDateDisplayLanguage(language, (): string => {
    return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(moment);
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      fa: { translation: FA },
      ar: { translation: AR },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("en");
  });
});

describe("every read's card, drawn in the reader's language", () => {
  test.each([["de"], ["fa"], ["ar"]])(
    "%s: drawn from its words - its kind, line and facts the language's, each moment written as pages write one",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      for (const widget of everyCard()) {
        const drawn: DrawnResourceCard = getDrawnResourceCard(
          widget,
          translator,
        );
        const words: AIActionCardWords = widget.data.words!;
        const said: {
          kind: string;
          line?: string | undefined;
          facts: Array<{ label: string; value: string }>;
        } = describeAIActionCardWords(words, translator);

        expect(drawn.isWorded).toBe(true);
        expect(drawn.kind).toBe(said.kind);
        expect(drawn.kind).toBe(translator.translateTerm(words.kind.term));
        expect(withoutIsolateMarks(lineText(drawn))).toBe(said.line || "");
        expect(
          drawn.facts.map((fact: DrawnResourceCardFact): string => {
            return withoutIsolateMarks(fact.label);
          }),
        ).toEqual(
          said.facts.map((fact: { label: string }): string => {
            return fact.label;
          }),
        );

        (words.facts || []).forEach((fact: unknown, index: number): void => {
          const value: string = withoutIsolateMarks(
            drawn.facts[index]!.value.text,
          );
          const stored: unknown = (fact as { value: unknown }).value;

          expect(value).toBe(
            isAIActionMoment(stored)
              ? momentIn(language, new Date(stored.moment))
              : said.facts[index]!.value,
          );
        });
      }
    },
  );
});

describe("an on-call schedule's card: its moments as every page writes one", () => {
  test("in German: the shift's moments in German, never the ISO text the exports print", () => {
    const widget: AIChatWidget = scheduleCard();
    const drawn: DrawnResourceCard = getDrawnResourceCard(
      widget,
      dashboardTranslator("de"),
    );

    expect(lineText(drawn)).toBe(
      DE["On call now: {{name}}"]!.split("{{name}}").join("Alice"),
    );

    const since: string = factOf(drawn, DE["On call since"]).value.text;
    expect(since).toBe(momentIn("de", SINCE));
    expect(since).not.toContain("T08:00");
    expect(since).not.toBe(momentIn("en", SINCE));
    expect(factOf(drawn, DE["Hands off at"]).value.text).toBe(
      momentIn("de", HANDOFF),
    );
    // Who is next is data.
    expect(factOf(drawn, DE["Next up"]).value.text).toBe("Bo");

    // The exports print what the card stores: ISO.
    expect(widget.data.fields).toContainEqual({
      label: "On call since",
      value: "2026-11-12T08:00:00.000Z",
    });
  });

  test("in English too: a moment as pages write one, not as the card stores it", () => {
    const drawn: DrawnResourceCard = getDrawnResourceCard(
      scheduleCard(),
      dashboardTranslator("en"),
    );

    expect(factOf(drawn, "On call since").value.text).toBe(
      momentIn("en", SINCE),
    );
    expect(factOf(drawn, "On call since").value.text).not.toContain("T08:00");
  });

  test("on the page, in German", async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("de");
    });
    render(<WidgetRenderer widgets={[scheduleCard()]} />);

    const values: Array<string> = screen
      .getAllByTestId("ai-chat-resource-card-fact-value")
      .map((element: HTMLElement): string => {
        return withoutIsolateMarks(element.textContent || "");
      });

    expect(values).toEqual([
      momentIn("de", SINCE),
      momentIn("de", HANDOFF),
      "Bo",
      momentIn("de", HANDOFF),
    ]);
    expect(
      withoutIsolateMarks(
        screen.getByTestId("ai-chat-resource-card-line").textContent || "",
      ),
    ).toBe(DE["On call now: {{name}}"]!.split("{{name}}").join("Alice"));
  });
});

describe("a security case's card in Arabic", () => {
  test("its status and priority as named, set apart by the line's dot; each entity's kind in Arabic", async () => {
    const drawn: DrawnResourceCard = getDrawnResourceCard(
      securityCaseCard(),
      dashboardTranslator("ar"),
    );

    expect(drawn.kind).toBe(AR["Security case"]);
    expect(
      drawn.line.map((part: { text: string }): string => {
        return part.text;
      }),
    ).toEqual(["New", "P1"]);
    expect(drawn.line[1]!.separatorBefore).toBe(" · ");
    expect(lineText(drawn)).toBe("New · P1");

    const entities: string = withoutIsolateMarks(
      factOf(drawn, AR["Entities"]).value.text,
    );
    expect(entities).toContain(AR["IP Address"]!);
    expect(entities).toContain("10.0.0.7");
    expect(entities).toContain(AR["User"]!);
    expect(entities).not.toContain("IP Address");

    await act(async (): Promise<void> => {
      await i18next.changeLanguage("ar");
    });
    render(<WidgetRenderer widgets={[securityCaseCard()]} />);
    expect(
      withoutIsolateMarks(
        screen.getByTestId("ai-chat-resource-card-line").textContent || "",
      ),
    ).toBe("New · P1");
  });
});

describe("an SLO's card in Persian", () => {
  test("its figures in Persian digits, its words Persian, its monitors as named", async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("fa");
    });
    render(<WidgetRenderer widgets={[sloCard()]} />);

    const labels: Array<string> = screen
      .getAllByTestId("ai-chat-resource-card-fact-label")
      .map((element: HTMLElement): string => {
        return withoutIsolateMarks(element.textContent || "");
      });
    const values: Array<string> = screen
      .getAllByTestId("ai-chat-resource-card-fact-value")
      .map((element: HTMLElement): string => {
        return withoutIsolateMarks(element.textContent || "");
      });
    const target: string = values[labels.indexOf(FA["Target"]!)]!;

    expect(screen.getByTestId("ai-chat-resource-card-kind")).toHaveTextContent(
      FA["SLO"]!,
    );
    expect(target).toMatch(/[۰-۹]/);
    expect(target).not.toMatch(/[0-9]/);
    expect(values).toContain("Checkout API");
    expect(labels).not.toContain("Target");
    expect(labels).not.toContain("Burn rate");
    for (const english of [
      "Not visible to you",
      "No error budget policy",
      "Allowed",
      "Monitor uptime",
      "Rolling",
    ]) {
      expect(values.join(" | ")).not.toContain(english);
    }
  });
});

describe("a status page's and an on-call policy's cards in German", () => {
  test("the resources a page shows by their names, the monitors behind them as named, its subscribers German's way", () => {
    const drawn: DrawnResourceCard = getDrawnResourceCard(
      statusPageCard(),
      dashboardTranslator("de"),
    );
    const resources: string = withoutIsolateMarks(
      factOf(drawn, DE["Resources shown"]).value.text,
    );

    expect(resources).toContain("Checkout");
    expect(resources).toContain("checkout-api");
    expect(resources).toContain("CDN");
    expect(resources).not.toContain("not monitored");
    expect(resources).not.toContain("monitor:");
    expect(factOf(drawn, DE["Active subscribers"]).value.text).toBe("1.234");
    expect(factOf(drawn, DE["Public URL"]).value.text).toBe(
      "https://status.acme.dev",
    );
  });

  test("a rule by its number and its name, whom it pages by kind and name, in German", () => {
    const drawn: DrawnResourceCard = getDrawnResourceCard(
      policyCard(),
      dashboardTranslator("de"),
    );

    expect(drawn.facts.length).toBe(1);
    expect(withoutIsolateMarks(drawn.facts[0]!.label)).toBe(
      "Regel 2 — Database team",
    );
    expect(withoutIsolateMarks(drawn.facts[0]!.value.text)).toBe(
      'Alarmiert Benutzer "Alice", Team "SRE", eskaliert dann nach 5 Minuten',
    );
  });
});
