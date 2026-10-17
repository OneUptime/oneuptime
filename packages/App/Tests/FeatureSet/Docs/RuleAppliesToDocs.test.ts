import {
  AiLane,
  AI_LANE_RULE_CRITERIA_SUBJECTS,
} from "../../../FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import {
  APPLIES_TO_ALL_ANSWERS,
  APPLIES_TO_MATCHING_ANSWERS,
} from "../../../FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleCopy";
import { readPage, TRANSLATED_LANGUAGES } from "./DocsContentSupport";
import { dashboardLabel, drawnDashboardLabel } from "./DocsDashboardLabels";
import {
  getRuleCriteriaSubjectForModel,
  RuleCriteriaSubject,
} from "Common/Types/Rules/RuleCriteriaSubject";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import { RuleCriteriaCopy } from "Common/UI/Components/RuleCriteria/RuleCriteriaFields";
import {
  getRuleCriteriaSubjectCopy,
  RuleCriteriaSubjectCopy,
} from "Common/UI/Components/RuleCriteria/RuleCriteriaSubjectCopy";
import { describe, expect, it } from "@jest/globals";

/*
 * A RULE'S CONDITIONS STEP ASKS WHAT THE RULE APPLIES TO, AND THE DOCS SAY SO.
 *
 * Every rule with conditions asks first - "All incidents" or "Only incidents
 * that match conditions", in the words of its records - and a new rule
 * starts on the first; the second opens the first condition
 * (RuleCriteriaBuilder, and the workspace rules' NotificationRuleConditions).
 * Customers who read "add a condition" added one they did not want. The
 * pages that walk a rule's conditions step name the two answers as the form
 * draws them, in every docs language as that language's Dashboard draws
 * them, and none tells a reader to leave the conditions empty or to click
 * Add condition before the choice has opened them. Markdown is not
 * compiled, so nothing else notices a page left behind.
 */

interface AppliesToPage {
  page: string;
  // The records the walked rule's form names.
  subject: RuleCriteriaSubject;
  // The rule models the page walks, each naming those records itself.
  models: ReadonlyArray<string>;
  // Whether the page names the second answer too, or only the first.
  namesMatching: boolean;
  // Whether the page names the field the two answers are under.
  namesAppliesTo: boolean;
}

const PAGES: ReadonlyArray<AppliesToPage> = [
  {
    page: "introduction/quickstart",
    subject: RuleCriteriaSubject.Incidents,
    models: ["IncidentOnCallRule"],
    namesMatching: false,
    namesAppliesTo: false,
  },
  {
    page: "configuration/label-and-owner-rules",
    subject: RuleCriteriaSubject.Hosts,
    models: ["HostLabelRule", "HostOwnerRule"],
    namesMatching: true,
    namesAppliesTo: true,
  },
  {
    page: "slo/label-and-owner-rules",
    subject: RuleCriteriaSubject.ServiceLevelObjectives,
    models: [
      "ServiceLevelObjectiveLabelRule",
      "ServiceLevelObjectiveOwnerRule",
    ],
    namesMatching: true,
    namesAppliesTo: true,
  },
  {
    // A runbook rule's table passes its trigger's records (RunbookRulesTable).
    page: "runbooks/rules",
    subject: RuleCriteriaSubject.Incidents,
    models: [],
    namesMatching: true,
    namesAppliesTo: true,
  },
  {
    page: "incidents/settings",
    subject: RuleCriteriaSubject.Incidents,
    models: ["IncidentGroupingRule", "IncidentOnCallRule"],
    namesMatching: true,
    namesAppliesTo: false,
  },
  {
    page: "alerts/settings",
    subject: RuleCriteriaSubject.Alerts,
    models: ["AlertOnCallRule", "AlertReminderRule"],
    namesMatching: true,
    namesAppliesTo: false,
  },
  {
    page: "alerts/episodes",
    subject: RuleCriteriaSubject.Alerts,
    models: ["AlertGroupingRule"],
    namesMatching: true,
    namesAppliesTo: false,
  },
  {
    page: "scheduled-maintenance/settings",
    subject: RuleCriteriaSubject.ScheduledMaintenanceEvents,
    models: ["ScheduledMaintenanceReminderRule"],
    namesMatching: true,
    namesAppliesTo: false,
  },
  {
    page: "rum/applications",
    subject: RuleCriteriaSubject.RumApplications,
    models: ["RumApplicationLabelRule", "RumApplicationOwnerRule"],
    namesMatching: true,
    namesAppliesTo: false,
  },
  {
    // The incident page's auto remediation rules (AI_LANE_RULE_CRITERIA_SUBJECTS).
    page: "ai/ai-sre",
    subject: RuleCriteriaSubject.Incidents,
    models: [],
    namesMatching: true,
    namesAppliesTo: false,
  },
  {
    // The workspace rules' Conditions step (NotificationRuleCopy).
    page: "workspace-connections/slack",
    subject: RuleCriteriaSubject.Incidents,
    models: [],
    namesMatching: true,
    namesAppliesTo: false,
  },
  {
    page: "workspace-connections/microsoft-teams",
    subject: RuleCriteriaSubject.Incidents,
    models: [],
    namesMatching: true,
    namesAppliesTo: false,
  },
];

/*
 * The incident pages keep the Dashboard's English names in Persian
 * (IncidentDocsTranslations, DocsDashboardLabels' dashboardLabel); every
 * other page names it as each language's Dashboard draws it.
 */
const ENGLISH_NAMED_PAGES: ReadonlyArray<string> = ["incidents/settings"];

/*
 * What the pages said before the choice: an empty step, an Add condition
 * walk that no longer opens the step, a rule "with no conditions" a reader
 * would have to make by leaving things out.
 */
const RETIRED_WORDINGS: ReadonlyArray<string> = [
  "Leave **Match Criteria** empty",
  "click **Add condition** for each condition",
  "Leave it empty to group every new",
  "Leave them empty to match every new",
  "Leave them empty to remind about every",
  "Add none to start the runbooks",
  "Leave it empty to match every event of its type",
  "With no conditions the rule is for every event",
  "A rule with no conditions matches every new",
  "A rule with no conditions matches every application",
  "A rule with no condition matches every incident",
];

function copyOf(entry: AppliesToPage): RuleCriteriaSubjectCopy {
  return getRuleCriteriaSubjectCopy(entry.subject);
}

// The bold labels the page names, in English.
function namedLabels(entry: AppliesToPage): Array<string> {
  const copy: RuleCriteriaSubjectCopy = copyOf(entry);
  const labels: Array<string> = [copy.all];

  if (entry.namesMatching) {
    labels.push(copy.matching);
  }

  if (entry.namesAppliesTo) {
    labels.push(RuleCriteriaCopy.appliesToTitle);
  }

  return labels;
}

function drawn(language: string, page: string, english: string): string {
  return ENGLISH_NAMED_PAGES.includes(page)
    ? dashboardLabel(language, english)
    : drawnDashboardLabel(language, english);
}

function boldCount(markdown: string, label: string): number {
  return markdown.split(`**${label}**`).length - 1;
}

describe("the rules these pages walk", () => {
  it("name their records as the page does", () => {
    for (const entry of PAGES) {
      for (const model of entry.models) {
        expect({
          model,
          subject: getRuleCriteriaSubjectForModel(model),
        }).toEqual({
          model,
          subject: entry.subject,
        });
      }
    }
  });

  it("include the tables that pass their records: AI rules and workspace rules", () => {
    expect(AI_LANE_RULE_CRITERIA_SUBJECTS[AiLane.Incident]).toBe(
      RuleCriteriaSubject.Incidents,
    );

    const incidents: RuleCriteriaSubjectCopy = getRuleCriteriaSubjectCopy(
      RuleCriteriaSubject.Incidents,
    );

    expect(APPLIES_TO_ALL_ANSWERS[NotificationRuleEventType.Incident]).toBe(
      incidents.all,
    );
    expect(
      APPLIES_TO_MATCHING_ANSWERS[NotificationRuleEventType.Incident],
    ).toBe(incidents.matching);
  });

  it("are named in words a reader sees on the form", () => {
    expect(getRuleCriteriaSubjectCopy(RuleCriteriaSubject.Incidents)).toEqual({
      all: "All incidents",
      matching: "Only incidents that match conditions",
    });
    expect(RuleCriteriaCopy.appliesToTitle).toBe("Applies to");
  });
});

describe.each(
  PAGES.map((entry: AppliesToPage): [string, AppliesToPage] => {
    return [entry.page, entry];
  }),
)("%s", (page: string, entry: AppliesToPage) => {
  const english: string = readPage("en", page);

  it("names the answers the rule's form draws, a new rule's first", () => {
    for (const label of namedLabels(entry)) {
      expect({ label, named: boldCount(english, label) > 0 }).toEqual({
        label,
        named: true,
      });
    }
  });

  it("no longer asks a reader to leave the conditions empty", () => {
    for (const wording of RETIRED_WORDINGS) {
      expect({ wording, found: english.includes(wording) }).toEqual({
        wording,
        found: false,
      });
    }
  });

  it.each(TRANSLATED_LANGUAGES)(
    "names them in %s as its Dashboard draws them, as often as the English page",
    (language: string) => {
      const translated: string = readPage(language, page);

      for (const label of namedLabels(entry)) {
        const local: string = drawn(language, page, label);

        expect({
          label,
          local,
          count: boldCount(translated, local),
        }).toEqual({ label, local, count: boldCount(english, label) });
      }
    },
  );
});

describe("a rule kind that needs a condition", () => {
  it("keeps the Add condition walk, with no answer that leaves it out", () => {
    const page: string = readPage("en", "slo/monitor-rules");

    expect(
      getRuleCriteriaSubjectForModel("ServiceLevelObjectiveMonitorRule"),
    ).toBeNull();
    expect(page).toContain(
      `On **Match Criteria**, click **${RuleCriteriaCopy.addCondition}**`,
    );
    expect(page).toContain("A monitor rule needs at least one condition.");
    expect(page).not.toContain(
      `**${getRuleCriteriaSubjectCopy(RuleCriteriaSubject.ServiceLevelObjectives).all}**`,
    );
  });
});
