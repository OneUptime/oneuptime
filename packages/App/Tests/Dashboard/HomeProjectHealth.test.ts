import { describe, expect, test } from "@jest/globals";
import { seededRandom, SeededRandom } from "Common/Tests/Helpers/SeededRandom";
import IconProp from "Common/Types/Icon/IconProp";
import {
  createTranslator,
  PluralTemplate,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import { HomeCounts } from "../../FeatureSet/Dashboard/src/Components/Home/HomeOverviewData";
import {
  getIssuesNeedingAttentionCount,
  getProjectHealth,
  INCIDENTS_HEADLINE,
  INCIDENTS_SUMMARY,
  MAINTENANCE_HEADLINE,
  MAINTENANCE_SUMMARY,
  NEEDS_ATTENTION_HEADLINE,
  NEEDS_ATTENTION_SUMMARY,
  NOT_SET_UP_HEADLINE,
  NOT_SET_UP_SUMMARY,
  OPERATIONAL_HEADLINE,
  OPERATIONAL_SUMMARY,
  ProjectHealth,
  ProjectHealthKind,
  ProjectHealthText,
  ProjectHealthTone,
  translateProjectHealthText,
} from "../../FeatureSet/Dashboard/src/Components/Home/ProjectHealth";

/*
 * The one-line verdict Home leads with (ProjectHealth.ts): which of the
 * project's open problems decides it, the colour it is drawn in and the
 * words it says. Pure, so every combination of counts is checked here; the
 * card that draws it is mounted in Common/Tests/App/Dashboard.
 */

function counts(overrides: Partial<HomeCounts> = {}): HomeCounts {
  return {
    activeIncidents: 0,
    activeAlerts: 0,
    notOperationalMonitors: 0,
    ongoingMaintenance: 0,
    slosNeedingAttention: 0,
    totalMonitors: 0,
    totalSlos: 0,
    ...overrides,
  };
}

// English, as the dashboard reads it with no locale loaded.
const ENGLISH: Translator = createTranslator(undefined, "en");

function words(value: ProjectHealthText): string {
  return translateProjectHealthText(ENGLISH, value);
}

describe("the verdict", () => {
  test("an open incident decides it, whatever else is open", () => {
    const health: ProjectHealth = getProjectHealth(
      counts({
        activeIncidents: 2,
        activeAlerts: 5,
        notOperationalMonitors: 3,
        ongoingMaintenance: 1,
        slosNeedingAttention: 4,
        totalMonitors: 10,
        totalSlos: 4,
      }),
    );

    expect(health.kind).toBe(ProjectHealthKind.Incidents);
    expect(health.tone).toBe(ProjectHealthTone.Danger);
    expect(health.icon).toBe(IconProp.Alert);
    expect(words(health.headline)).toBe("2 active incidents");
    expect(words(health.summary)).toBe(INCIDENTS_SUMMARY);
  });

  test("one incident reads in the singular", () => {
    const health: ProjectHealth = getProjectHealth(
      counts({ activeIncidents: 1, totalMonitors: 1 }),
    );

    expect(words(health.headline)).toBe("1 active incident");
  });

  test("an incident is the verdict even with nothing monitored: a person declared it", () => {
    const health: ProjectHealth = getProjectHealth(
      counts({ activeIncidents: 1 }),
    );

    expect(health.kind).toBe(ProjectHealthKind.Incidents);
  });

  test("alerts, failing monitors and burning SLOs add up to the issues that need attention", () => {
    const health: ProjectHealth = getProjectHealth(
      counts({
        activeAlerts: 2,
        notOperationalMonitors: 1,
        slosNeedingAttention: 1,
        totalMonitors: 6,
        totalSlos: 2,
      }),
    );

    expect(health.kind).toBe(ProjectHealthKind.NeedsAttention);
    expect(health.tone).toBe(ProjectHealthTone.Warning);
    expect(health.icon).toBe(IconProp.ExclaimationCircle);
    expect(words(health.headline)).toBe("4 issues need attention");
    expect(words(health.summary)).toBe(NEEDS_ATTENTION_SUMMARY);
  });

  test.each([
    ["an alert", { activeAlerts: 1 }],
    ["a monitor that is not operational", { notOperationalMonitors: 1 }],
    ["an SLO burning its budget", { slosNeedingAttention: 1 }],
  ])(
    "%s alone needs attention, in the singular",
    (_name: string, overrides: Partial<HomeCounts>) => {
      const health: ProjectHealth = getProjectHealth(
        counts({ totalMonitors: 3, totalSlos: 1, ...overrides }),
      );

      expect(health.kind).toBe(ProjectHealthKind.NeedsAttention);
      expect(words(health.headline)).toBe("1 issue needs attention");
    },
  );

  test("needing attention outranks maintenance in progress", () => {
    const health: ProjectHealth = getProjectHealth(
      counts({ activeAlerts: 1, ongoingMaintenance: 2, totalMonitors: 3 }),
    );

    expect(health.kind).toBe(ProjectHealthKind.NeedsAttention);
  });

  test("maintenance in progress, and nothing wrong", () => {
    const health: ProjectHealth = getProjectHealth(
      counts({ ongoingMaintenance: 2, totalMonitors: 4 }),
    );

    expect(health.kind).toBe(ProjectHealthKind.Maintenance);
    expect(health.tone).toBe(ProjectHealthTone.Info);
    expect(health.icon).toBe(IconProp.Clock);
    expect(words(health.headline)).toBe("2 maintenance events in progress");
    expect(words(health.summary)).toBe(MAINTENANCE_SUMMARY);
  });

  test("maintenance in progress is said even before anything is monitored", () => {
    const health: ProjectHealth = getProjectHealth(
      counts({ ongoingMaintenance: 1 }),
    );

    expect(health.kind).toBe(ProjectHealthKind.Maintenance);
    expect(words(health.headline)).toBe("1 maintenance event in progress");
  });

  test("monitors and nothing open: all systems operational, with how many are watching", () => {
    const health: ProjectHealth = getProjectHealth(
      counts({ totalMonitors: 12, totalSlos: 3 }),
    );

    expect(health.kind).toBe(ProjectHealthKind.Operational);
    expect(health.tone).toBe(ProjectHealthTone.Success);
    expect(health.icon).toBe(IconProp.CheckCircle);
    expect(words(health.headline)).toBe("All systems operational");
    expect(words(health.summary)).toBe(
      "12 monitors are operational, and there are no open incidents or alerts.",
    );
  });

  test("one monitor reads in the singular", () => {
    const health: ProjectHealth = getProjectHealth(
      counts({ totalMonitors: 1 }),
    );

    expect(words(health.summary)).toBe(
      "1 monitor is operational, and there are no open incidents or alerts.",
    );
  });

  test("nothing monitored and nothing open is not 'all systems operational'", () => {
    /*
     * The wrong impression to give someone who has not created a monitor:
     * that something is watching and found nothing wrong.
     */
    const health: ProjectHealth = getProjectHealth(counts());

    expect(health.kind).toBe(ProjectHealthKind.NotSetUp);
    expect(health.tone).toBe(ProjectHealthTone.Neutral);
    expect(words(health.headline)).toBe(NOT_SET_UP_HEADLINE);
    expect(words(health.headline)).not.toBe(OPERATIONAL_HEADLINE);
    expect(words(health.summary)).toBe(NOT_SET_UP_SUMMARY);
  });

  test("SLOs alone do not make a project monitored", () => {
    const health: ProjectHealth = getProjectHealth(counts({ totalSlos: 2 }));

    expect(health.kind).toBe(ProjectHealthKind.NotSetUp);
  });

  test("a count read as negative is treated as none", () => {
    const health: ProjectHealth = getProjectHealth(
      counts({
        activeIncidents: -1,
        activeAlerts: -3,
        notOperationalMonitors: -2,
        slosNeedingAttention: -1,
        ongoingMaintenance: -1,
        totalMonitors: 2,
      }),
    );

    expect(health.kind).toBe(ProjectHealthKind.Operational);
    expect(
      getIssuesNeedingAttentionCount(
        counts({ activeAlerts: -3, notOperationalMonitors: 2 }),
      ),
    ).toBe(2);
  });
});

describe("the order of the verdicts, over any counts", () => {
  test("the most urgent open kind always decides", () => {
    const random: SeededRandom = seededRandom(20261013);

    for (let draw: number = 0; draw < 2000; draw++) {
      const sample: HomeCounts = counts({
        activeIncidents: random(3) === 0 ? random(4) : 0,
        activeAlerts: random(3) === 0 ? random(5) : 0,
        notOperationalMonitors: random(3) === 0 ? random(5) : 0,
        slosNeedingAttention: random(3) === 0 ? random(3) : 0,
        ongoingMaintenance: random(3) === 0 ? random(3) : 0,
        totalMonitors: random(2) === 0 ? random(30) : 0,
        totalSlos: random(4),
      });

      const health: ProjectHealth = getProjectHealth(sample);
      const issues: number =
        sample.activeAlerts +
        sample.notOperationalMonitors +
        sample.slosNeedingAttention;

      let expected: ProjectHealthKind = ProjectHealthKind.Operational;

      if (sample.activeIncidents > 0) {
        expected = ProjectHealthKind.Incidents;
      } else if (issues > 0) {
        expected = ProjectHealthKind.NeedsAttention;
      } else if (sample.ongoingMaintenance > 0) {
        expected = ProjectHealthKind.Maintenance;
      } else if (sample.totalMonitors === 0) {
        expected = ProjectHealthKind.NotSetUp;
      }

      expect({ sample, kind: health.kind }).toEqual({
        sample,
        kind: expected,
      });

      // The words always fill: no "{{count}}" is ever left in them.
      expect(words(health.headline)).not.toContain("{{");
      expect(words(health.summary)).not.toContain("{{");
    }
  });
});

describe("the copy", () => {
  const PLURALS: Array<[string, PluralTemplate]> = [
    ["INCIDENTS_HEADLINE", INCIDENTS_HEADLINE],
    ["NEEDS_ATTENTION_HEADLINE", NEEDS_ATTENTION_HEADLINE],
    ["MAINTENANCE_HEADLINE", MAINTENANCE_HEADLINE],
    ["OPERATIONAL_SUMMARY", OPERATIONAL_SUMMARY],
  ];

  test.each(PLURALS)(
    "%s says its count in both forms",
    (_name: string, template: PluralTemplate) => {
      /*
       * A language whose "one" form also covers 21 (Russian) translates the
       * one sentence for every such count, so it must carry the number.
       */
      expect(template.one).toContain("{{count}}");
      expect(template.other).toContain("{{count}}");
      expect(template.one).not.toBe(template.other);
    },
  );

  test("the fixed sentences are whole sentences, never built from pieces", () => {
    for (const sentence of [
      INCIDENTS_SUMMARY,
      NEEDS_ATTENTION_SUMMARY,
      MAINTENANCE_SUMMARY,
      NOT_SET_UP_SUMMARY,
    ]) {
      expect(sentence).toMatch(/^[A-Z].*\.$/);
      expect(sentence).not.toContain("{{");
    }

    expect(OPERATIONAL_HEADLINE).not.toContain("{{");
    expect(NOT_SET_UP_HEADLINE).not.toContain("{{");
  });

  test("a reader's language words the verdict when it has one", () => {
    const german: Record<string, string> = {
      "All systems operational": "Alle Systeme betriebsbereit",
      "{{count}} active incidents": "{{count}} aktive Vorfälle",
    };
    const translator: Translator = createTranslator(
      (key: string): string | undefined => {
        return german[key];
      },
      "de",
    );

    expect(
      translateProjectHealthText(
        translator,
        getProjectHealth(counts({ totalMonitors: 3 })).headline,
      ),
    ).toBe("Alle Systeme betriebsbereit");
    expect(
      translateProjectHealthText(
        translator,
        getProjectHealth(counts({ activeIncidents: 4, totalMonitors: 3 }))
          .headline,
      ),
    ).toBe("4 aktive Vorfälle");
  });
});
