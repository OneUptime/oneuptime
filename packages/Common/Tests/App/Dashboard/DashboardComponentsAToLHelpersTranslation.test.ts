import { beforeAll, describe, expect, test } from "@jest/globals";
import i18next from "i18next";
import { getNotesCopy } from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/EventNotesUtil";
import { getEpisodeHeaderFacts } from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeView/EpisodeHeader";
import { describeMissingLink } from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/LinkedResource";
import { formatMinutesAgo } from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryLiveness";
import { describeExceptionStatusHistory } from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionSettings";
import {
  describeLogsOccurrenceCount,
  describeLogsTimeRange,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsInsightsCopy";
import { describeFinishedRunKubectlUsage } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ClusterAccessNotice";
import { KubectlActivitySummary } from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import EntityType from "../../../Types/Telemetry/EntityType";
import TimeRange from "../../../Types/Time/TimeRange";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";

/*
 * The helpers behind the components from AI to Logs build their sentences
 * outside React - a notes feed's copy, an episode header's facts, an
 * inventory item's empty state, a liveness age, an exception's status
 * history, a Logs Insights count, a finished run's kubectl usage. Handed the
 * component's translator they answer in the reader's language, whole
 * sentences with their values filled in and their counts in the language's
 * plural form. Left to the global translator, they answer in English until
 * the Dashboard sets i18next up, word for word what they said before.
 *
 * The German below is a test locale keyed by the English text, exactly as
 * App/FeatureSet/Dashboard/src/Locales/de.json is ("_one" for the singular
 * of a plural).
 */

const GERMAN: Record<string, string> = {
  // EventNotes/EventNotesUtil
  incident: "Vorfall",
  alert: "Warnung",
  "Internal notes for your team about this {{event}}. They are never shown on a status page or sent to subscribers.":
    "Interne Notizen für Ihr Team zu diesem {{event}}. Sie werden nie auf einer Statusseite angezeigt oder an Abonnenten gesendet.",
  "Customer-facing updates about this {{event}}. They appear on your status page, and subscribers can be notified when you post one.":
    "Updates für Kunden zu dieser {{event}}. Sie erscheinen auf Ihrer Statusseite, und Abonnenten können benachrichtigt werden.",
  // EpisodeView/EpisodeHeader
  "Manual episode": "Manuelle Episode",
  System: "System",
  // Inventory/LinkedResource
  "maintenance windows": "Wartungsfenster",
  "Kubernetes Pod": "Kubernetes-Pod",
  "{{signal}} are raised against services, hosts and Kubernetes clusters. A {{type}} does not carry its own — look at the service or host it belongs to, which you can find under Connections.":
    "{{signal}} werden für Dienste, Hosts und Kubernetes-Cluster erfasst. Ein {{type}} hat keine eigenen — sehen Sie sich den Dienst oder Host an, zu dem er gehört; Sie finden ihn unter Verbindungen.",
  // Inventory/InventoryLiveness
  "{{count}}h ago": "vor {{count}} Std.",
  "just now": "gerade eben",
  // Exceptions/ExceptionSettings
  "Resolved by {{name}}": "Gelöst von {{name}}",
  "Open and waiting for a fix.": "Offen und wartet auf eine Korrektur.",
  // Logs/LogsInsightsCopy
  "Past 1 Hour": "Letzte Stunde",
  "the {{range}}": "{{range}}",
  "the selected time range": "dem gewählten Zeitraum",
  "{{count}} times in {{range}}": "{{count}}-mal in {{range}}",
  "{{count}} times in {{range}}_one": "{{count}}-mal in {{range}}",
  // AI/ClusterAccessNotice
  "OneUptime AI ran {{count}} read-only kubectl commands during this investigation.":
    "OneUptime AI hat bei dieser Untersuchung {{count}} schreibgeschützte kubectl-Befehle ausgeführt.",
  "OneUptime AI ran {{count}} read-only kubectl commands during this investigation._one":
    "OneUptime AI hat bei dieser Untersuchung {{count}} schreibgeschützten kubectl-Befehl ausgeführt.",
};

const germanTranslator: Translator = createTranslator(
  (text: string): string | undefined => {
    return GERMAN[text];
  },
  "de",
);

function ranCommands(count: number): KubectlActivitySummary {
  return {
    executed: count,
    succeeded: count,
    notRun: 0,
    clusterToolCalls: count,
  };
}

const PAST_HOUR: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_HOUR,
} as RangeStartAndEndDateTime;

describe("before i18next is set up, the helpers answer in English, word for word", () => {
  test("a notes feed names its event in the sentence", () => {
    expect(getNotesCopy("private", "incident").description).toBe(
      "Internal notes for your team about this incident. They are never shown on a status page or sent to subscribers.",
    );
  });

  test("an episode header's facts", () => {
    expect(
      getEpisodeHeaderFacts({ memberNoun: "alert" }).map(
        (fact: { label: string; value: unknown }): string => {
          return `${fact.label}: ${String(fact.value)}`;
        },
      ),
    ).toEqual(["Grouping: Manual episode", "Created by: System"]);
  });

  test("an inventory item's empty state starts with the signal, capitalised", () => {
    expect(
      describeMissingLink(EntityType.KubernetesPod, "maintenance windows"),
    ).toBe(
      "Maintenance windows are raised against services, hosts and Kubernetes clusters. A Kubernetes Pod does not carry its own — look at the service or host it belongs to, which you can find under Connections.",
    );
  });

  test("liveness ages, Logs Insights counts and kubectl usage", () => {
    expect(formatMinutesAgo(90)).toBe("1h ago");
    expect(formatMinutesAgo(0)).toBe("just now");
    expect(describeLogsOccurrenceCount(1, PAST_HOUR)).toBe(
      "1 time in the past 1 hour",
    );
    expect(describeLogsOccurrenceCount(30, PAST_HOUR)).toBe(
      "30 times in the past 1 hour",
    );
    expect(
      describeLogsTimeRange({
        range: TimeRange.CUSTOM,
      } as RangeStartAndEndDateTime),
    ).toBe("the selected time range");
    expect(describeFinishedRunKubectlUsage(ranCommands(3))?.text).toBe(
      "OneUptime AI ran 3 read-only kubectl commands during this investigation.",
    );
  });
});

describe("handed the reader's translator, the helpers answer in German", () => {
  test("the notes feed fills the translated event into the translated sentence", () => {
    expect(
      getNotesCopy("private", "incident", germanTranslator).description,
    ).toBe(
      "Interne Notizen für Ihr Team zu diesem Vorfall. Sie werden nie auf einer Statusseite angezeigt oder an Abonnenten gesendet.",
    );
  });

  test("the episode header translates its own values; the panel looks the labels up", () => {
    const facts: Array<{ label: string; value: unknown }> =
      getEpisodeHeaderFacts(
        {
          memberNoun: "alert",
          lastMemberAddedAt: new Date("2026-09-30T12:00:00.000Z"),
        },
        germanTranslator,
      );

    expect(facts[0]?.value).toBe("Manuelle Episode");
    expect(facts[1]?.value).toBe("System");
    // English keys: EventStatusPanel looks each label up where it draws it.
    expect(
      facts.map((fact: { label: string }): string => {
        return fact.label;
      }),
    ).toEqual(["Grouping", "Created by", "Last alert added"]);
  });

  test("the empty state is one German sentence with the signal and the type in it", () => {
    expect(
      describeMissingLink(
        EntityType.KubernetesPod,
        "maintenance windows",
        germanTranslator,
      ),
    ).toBe(
      "Wartungsfenster werden für Dienste, Hosts und Kubernetes-Cluster erfasst. Ein Kubernetes-Pod hat keine eigenen — sehen Sie sich den Dienst oder Host an, zu dem er gehört; Sie finden ihn unter Verbindungen.",
    );
  });

  test("liveness ages", () => {
    expect(formatMinutesAgo(90, germanTranslator)).toBe("vor 1 Std.");
    expect(formatMinutesAgo(0, germanTranslator)).toBe("gerade eben");
  });

  test("an exception's status history is one sentence per change", () => {
    expect(
      describeExceptionStatusHistory(germanTranslator, {
        kind: "resolved",
        isActive: true,
        at: undefined,
        byName: "Priya Raman",
        inactiveText: "Open and waiting for a fix.",
      }),
    ).toBe("Gelöst von Priya Raman");
    expect(
      describeExceptionStatusHistory(germanTranslator, {
        kind: "resolved",
        isActive: false,
        at: undefined,
        byName: undefined,
        inactiveText: "Open and waiting for a fix.",
      }),
    ).toBe("Offen und wartet auf eine Korrektur.");
  });

  test("Logs Insights counts pick the German plural form, with the window translated", () => {
    expect(describeLogsOccurrenceCount(1, PAST_HOUR, germanTranslator)).toBe(
      "1-mal in Letzte Stunde",
    );
    expect(describeLogsOccurrenceCount(30, PAST_HOUR, germanTranslator)).toBe(
      "30-mal in Letzte Stunde",
    );
    expect(
      describeLogsTimeRange(
        { range: TimeRange.CUSTOM } as RangeStartAndEndDateTime,
        germanTranslator,
      ),
    ).toBe("dem gewählten Zeitraum");
  });

  test("a finished run's kubectl usage counts in the German singular and plural", () => {
    expect(
      describeFinishedRunKubectlUsage(ranCommands(1), germanTranslator)?.text,
    ).toBe(
      "OneUptime AI hat bei dieser Untersuchung 1 schreibgeschützten kubectl-Befehl ausgeführt.",
    );
    expect(
      describeFinishedRunKubectlUsage(ranCommands(1234), germanTranslator)
        ?.text,
    ).toBe(
      // The count is written the German way.
      "OneUptime AI hat bei dieser Untersuchung 1.234 schreibgeschützte kubectl-Befehle ausgeführt.",
    );
  });
});

describe("once the Dashboard sets i18next up, the helpers' default is the reader's language", () => {
  beforeAll(async () => {
    await i18next.init({
      lng: "de",
      fallbackLng: false,
      resources: { de: { translation: GERMAN } },
      keySeparator: false,
      nsSeparator: false,
      interpolation: { escapeValue: false },
    });
  });

  test("a notes feed without a translator handed to it still speaks German", () => {
    expect(getNotesCopy("public", "alert").description).toBe(
      "Updates für Kunden zu dieser Warnung. Sie erscheinen auf Ihrer Statusseite, und Abonnenten können benachrichtigt werden.",
    );
  });

  test("so does a liveness age", () => {
    expect(formatMinutesAgo(150)).toBe("vor 2 Std.");
  });
});
