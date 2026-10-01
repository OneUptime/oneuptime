/*
 * The rules behind the workflow template picker: which templates each view
 * holds and in what order, how the search finds and ranks them, how the
 * highlight moves, and what the preview says about a template.
 *
 * The picker replaced a grid that showed all forty-odd templates at once, as
 * equally large cards, which the maintainer called decision paralysis. What
 * replaced it only helps if no template went missing on the way: every one
 * has to stay reachable from a category, from All templates and from the
 * search, so several of these tests walk the whole catalog rather than a
 * sample of it.
 */

import { describe, expect, test } from "@jest/globals";
import IconProp from "Common/Types/Icon/IconProp";
import ComponentMetadata from "Common/Types/Workflow/Component";
import ComponentID from "Common/Types/Workflow/ComponentID";
import {
  RECOMMENDED_WORKFLOW_TEMPLATE_IDS,
  WorkflowTemplate,
  WorkflowTemplateCategories,
  WorkflowTemplateCategory,
  getTemplateGraphSpec,
  getWorkflowTemplate,
  getWorkflowTemplateCategoryInfo,
  getWorkflowTemplates,
} from "Common/Types/Workflow/Templates";
import {
  ALL_TEMPLATES_VIEW_INFO,
  INITIAL_WORKFLOW_TEMPLATE_PICKER_STATE,
  RECOMMENDED_VIEW_INFO,
  WorkflowTemplateCollection,
  WorkflowTemplateHighlightSegment,
  WorkflowTemplateMove,
  WorkflowTemplatePickerList,
  WorkflowTemplatePickerSection,
  WorkflowTemplatePickerState,
  WorkflowTemplatePickerView,
  WorkflowTemplatePickerViewInfo,
  WorkflowTemplatePreview,
  WorkflowTemplatePreviewBlock,
  findWorkflowComponent,
  getActiveWorkflowTemplate,
  getCurrentWorkflowTemplatePickerView,
  getMovedWorkflowTemplateId,
  getTemplatesInView,
  getWorkflowTemplateCategoryLabel,
  getWorkflowTemplateHighlightSegments,
  getWorkflowTemplatePickerCounts,
  getWorkflowTemplatePickerList,
  getWorkflowTemplatePickerViewInfo,
  getWorkflowTemplatePickerViews,
  getWorkflowTemplatePreview,
  getWorkflowTemplateSearchScore,
  getWorkflowTemplateSearchTokens,
  getWorkflowTemplateTypoTokens,
  isSearchingTemplates,
  searchWorkflowTemplates,
  withWorkflowTemplateSearch,
  withWorkflowTemplateView,
  workflowTemplateMatchesSearch,
} from "../../FeatureSet/Dashboard/src/Utils/Workflow/WorkflowTemplatePickerUtil";

const ALL_TEMPLATES: Array<WorkflowTemplate> = getWorkflowTemplates();

type IdsFunction = (templates: Array<WorkflowTemplate>) => Array<string>;

const ids: IdsFunction = (
  templates: Array<WorkflowTemplate>,
): Array<string> => {
  return templates.map((template: WorkflowTemplate): string => {
    return template.id;
  });
};

type TemplateFunction = (templateId: string) => WorkflowTemplate;

const template: TemplateFunction = (templateId: string): WorkflowTemplate => {
  const found: WorkflowTemplate | null = getWorkflowTemplate(templateId);

  if (!found) {
    throw new Error(`No template "${templateId}".`);
  }

  return found;
};

type StateFunction = (
  changes: Partial<WorkflowTemplatePickerState>,
) => WorkflowTemplatePickerState;

const stateWith: StateFunction = (
  changes: Partial<WorkflowTemplatePickerState>,
): WorkflowTemplatePickerState => {
  return { ...INITIAL_WORKFLOW_TEMPLATE_PICKER_STATE, ...changes };
};

type ListIdsFunction = (state: WorkflowTemplatePickerState) => Array<string>;

const listIds: ListIdsFunction = (
  state: WorkflowTemplatePickerState,
): Array<string> => {
  return ids(getWorkflowTemplatePickerList(state).templates);
};

type SearchIdsFunction = (search: string) => Array<string>;

// What the search shows, across every template.
const searchIds: SearchIdsFunction = (search: string): Array<string> => {
  return ids(
    searchWorkflowTemplates(
      getTemplatesInView(WorkflowTemplateCollection.All),
      search,
    ),
  );
};

/*
 * The two kinds of Jira template, as the catalog files them. Read from the
 * catalog rather than written out, so a new Jira template is covered here
 * the day it is added.
 */
const JIRA_TEMPLATES: Array<WorkflowTemplate> = ALL_TEMPLATES.filter(
  (candidate: WorkflowTemplate) => {
    return candidate.category === WorkflowTemplateCategory.Jira;
  },
);

const INCIDENT_JIRA_IDS: Array<string> = ids(
  JIRA_TEMPLATES.filter((candidate: WorkflowTemplate) => {
    return candidate.subcategory === "Incidents";
  }),
);

const ALERT_JIRA_IDS: Array<string> = ids(
  JIRA_TEMPLATES.filter((candidate: WorkflowTemplate) => {
    return candidate.subcategory === "Alerts";
  }),
);

describe("the picker's views", () => {
  test("Recommended comes first, then every category in the catalog's order, then All templates", () => {
    expect(
      getWorkflowTemplatePickerViews().map(
        (info: WorkflowTemplatePickerViewInfo) => {
          return info.view;
        },
      ),
    ).toEqual([
      WorkflowTemplateCollection.Recommended,
      ...WorkflowTemplateCategories,
      WorkflowTemplateCollection.All,
    ]);
  });

  test("a category is shown by its label, with its description and icon", () => {
    for (const category of WorkflowTemplateCategories) {
      const info: WorkflowTemplatePickerViewInfo =
        getWorkflowTemplatePickerViewInfo(category);

      expect(info).toEqual({
        view: category,
        label: getWorkflowTemplateCategoryInfo(category).label,
        description: getWorkflowTemplateCategoryInfo(category).description,
        icon: getWorkflowTemplateCategoryInfo(category).icon,
      });
    }
  });

  test("labels differ from one another, so no two entries in the list read the same", () => {
    const labels: Array<string> = getWorkflowTemplatePickerViews().map(
      (info: WorkflowTemplatePickerViewInfo) => {
        return info.label;
      },
    );

    expect(new Set(labels).size).toBe(labels.length);
  });

  test("the two collections say what they hold", () => {
    expect(RECOMMENDED_VIEW_INFO.label).toBe("Recommended");
    expect(RECOMMENDED_VIEW_INFO.icon).toBe(IconProp.Star);
    expect(ALL_TEMPLATES_VIEW_INFO.label).toBe("All templates");
    expect(ALL_TEMPLATES_VIEW_INFO.icon).toBe(IconProp.Squares);
    expect(
      getWorkflowTemplatePickerViewInfo(WorkflowTemplateCollection.All),
    ).toBe(ALL_TEMPLATES_VIEW_INFO);
  });

  test("Recommended holds the curated handful, in the curated order", () => {
    expect(
      ids(getTemplatesInView(WorkflowTemplateCollection.Recommended)),
    ).toEqual([...RECOMMENDED_WORKFLOW_TEMPLATE_IDS]);
  });

  test("All templates holds every template exactly once, grouped in category order", () => {
    const all: Array<WorkflowTemplate> = getTemplatesInView(
      WorkflowTemplateCollection.All,
    );

    expect(all).toHaveLength(ALL_TEMPLATES.length);
    expect(new Set(ids(all))).toEqual(new Set(ids(ALL_TEMPLATES)));

    const categoryOrder: Array<number> = all.map(
      (candidate: WorkflowTemplate): number => {
        return WorkflowTemplateCategories.indexOf(candidate.category);
      },
    );

    expect(categoryOrder).toEqual(
      [...categoryOrder].sort((a: number, b: number) => {
        return a - b;
      }),
    );
  });

  test("a category holds its own templates, in catalog order", () => {
    for (const category of WorkflowTemplateCategories) {
      expect(ids(getTemplatesInView(category))).toEqual(
        ids(
          ALL_TEMPLATES.filter((candidate: WorkflowTemplate) => {
            return candidate.category === category;
          }),
        ),
      );
    }
  });

  test("every template is in exactly one category view", () => {
    for (const candidate of ALL_TEMPLATES) {
      const containing: Array<WorkflowTemplateCategory> =
        WorkflowTemplateCategories.filter(
          (category: WorkflowTemplateCategory) => {
            return ids(getTemplatesInView(category)).includes(candidate.id);
          },
        );

      expect({ template: candidate.id, categories: containing }).toEqual({
        template: candidate.id,
        categories: [candidate.category],
      });
    }
  });

  test("a row's category label is the label the list of categories shows", () => {
    expect(
      getWorkflowTemplateCategoryLabel(
        WorkflowTemplateCategory.ScheduledMaintenance,
      ),
    ).toBe("Maintenance");
    expect(
      getWorkflowTemplateCategoryLabel(WorkflowTemplateCategory.Jira),
    ).toBe("Jira");
  });
});

/*
 * The template search reads words the way the Add Component picker does,
 * on the same word matching, so the two pickers answer the same typing the
 * same way.
 */
describe("words the way the Add Component picker reads them", () => {
  test("a plural finds what is written in the singular", () => {
    const SINGULAR_WEBHOOK: RegExp = /\bwebhook\b/i;
    const webhookTemplates: Array<string> = ALL_TEMPLATES.filter(
      (candidate: WorkflowTemplate) => {
        return SINGULAR_WEBHOOK.test(candidate.name);
      },
    ).map((candidate: WorkflowTemplate) => {
      return candidate.id;
    });

    expect(webhookTemplates.length).toBeGreaterThan(0);
    expect(searchIds("webhooks")).toEqual(
      expect.arrayContaining(webhookTemplates),
    );
  });

  test("the start of a word finds the word", () => {
    expect(searchIds("discor")).toEqual(["incident-created-discord"]);
    expect(searchIds("inc").length).toBeGreaterThan(0);

    for (const templateId of searchIds("inc")) {
      expect(JSON.stringify(template(templateId)).toLowerCase()).toContain(
        "inc",
      );
    }
  });

  test("a typo finds what was meant, but only where nothing matches as typed", () => {
    expect(getWorkflowTemplateTypoTokens(["incidnet", "slack"])).toEqual([
      "incidnet",
    ]);
    // The same templates; a typo counts for less than the word, so the order may differ.
    expect([...searchIds("incidnet slack")].sort()).toEqual(
      [...searchIds("incident slack")].sort(),
    );
    // "slak" is in no word as typed, so it is read as a typo of "slack".
    expect(getWorkflowTemplateTypoTokens(["slak"])).toEqual(["slak"]);
    expect([...searchIds("slak")].sort()).toEqual(
      [...searchIds("slack")].sort(),
    );
    // "tems" is inside "systems", so it is not a typo of "teams".
    expect(getWorkflowTemplateTypoTokens(["tems"])).toEqual([]);
  });

  test("a word too short to be read as a typo is not", () => {
    expect(getWorkflowTemplateTypoTokens(["zq"])).toEqual(["zq"]);
    expect(searchIds("zq")).toEqual([]);
  });

  test("words that say nothing about which template is meant are left out", () => {
    expect(
      getWorkflowTemplateSearchTokens("Tell Slack when an incident opens"),
    ).toEqual(["tell", "slack", "incident", "opens"]);
    expect(searchIds("when an incident opens")).toEqual(
      searchIds("incident opens"),
    );
  });

  test("unless they are all that was typed", () => {
    expect(getWorkflowTemplateSearchTokens("the")).toEqual(["the"]);
  });

  test("punctuation splits words: on-call is on and call", () => {
    expect(getWorkflowTemplateSearchTokens("On-Call, Slack!")).toEqual([
      "on",
      "call",
      "slack",
    ]);
    expect(searchIds("on-call")).toContain("oncall-executed-slack");
  });
});

describe("search words", () => {
  test("are lower-cased, trimmed, split on any whitespace and kept once each", () => {
    expect(
      getWorkflowTemplateSearchTokens("  Slack\tINCIDENT  slack \n"),
    ).toEqual(["slack", "incident"]);
  });

  test("an empty or blank search has no words", () => {
    expect(getWorkflowTemplateSearchTokens("")).toEqual([]);
    expect(getWorkflowTemplateSearchTokens("   \t ")).toEqual([]);
  });
});

describe("what a search matches", () => {
  test("no words match everything", () => {
    for (const candidate of ALL_TEMPLATES) {
      expect(workflowTemplateMatchesSearch(candidate, [])).toBe(true);
    }
  });

  /*
   * The old search looked for the whole phrase as one piece of text, so
   * "slack monitor" found nothing even though two templates tell Slack about
   * monitors.
   */
  test("every word has to be found, but each may be found in a different place", () => {
    const results: Array<string> = searchIds("slack monitor");

    expect(results).toContain("monitor-status-changed-slack");
    expect(results).toContain("monitor-offline-only-slack");
    expect(results).not.toContain("incident-created-slack");
    expect(searchIds("monitor slack")).toEqual(results);
  });

  test("a word that appears nowhere leaves nothing, whatever else matched", () => {
    expect(searchIds("slack pagerduty")).toEqual([]);
  });

  test("the category's own name counts, and so does the label the picker shows", () => {
    expect(searchIds("scheduled maintenance")).toContain(
      "maintenance-scheduled-slack",
    );
    expect(
      workflowTemplateMatchesSearch(template("maintenance-scheduled-slack"), [
        "maintenance",
      ]),
    ).toBe(true);

    // "Learn the basics" is the label; "Basics" is the category's own name.
    for (const word of ["learn", "basics"]) {
      expect(searchIds(word)).toEqual(
        expect.arrayContaining(
          ids(getTemplatesInView(WorkflowTemplateCategory.Basics)),
        ),
      );
    }

    expect(searchIds("integrations")).toEqual(
      expect.arrayContaining(
        ids(getTemplatesInView(WorkflowTemplateCategory.Integrations)),
      ),
    );
  });

  test("what a template teaches is searched too", () => {
    const javascriptTransform: WorkflowTemplate = template(
      "javascript-transform",
    );

    expect(javascriptTransform.teaches).toContain("built-in components");
    expect(searchIds("built-in components")).toContain("javascript-transform");
  });

  /*
   * The Jira category's description mentions incidents and alerts both. If
   * a search read it, "alert" would bring back every Jira template, incident
   * ones included.
   */
  test("a category's description is not searched", () => {
    expect(
      getWorkflowTemplateCategoryInfo(WorkflowTemplateCategory.Jira)
        .description,
    ).toMatch(/alerts/);

    const results: Array<string> = searchIds("alert");

    for (const incidentJiraId of INCIDENT_JIRA_IDS) {
      expect(results).not.toContain(incidentJiraId);
    }
  });

  test("case does not matter", () => {
    expect(searchIds("TEAMS")).toEqual(searchIds("teams"));
    expect(searchIds("teams")).toContain("incident-created-teams");
  });

  test("a search for jira finds the seventeen Jira templates and nothing else", () => {
    expect(JIRA_TEMPLATES).toHaveLength(17);
    expect(new Set(searchIds("jira"))).toEqual(new Set(ids(JIRA_TEMPLATES)));
  });

  test("a search for alert finds the alert templates: the two Alerts ones, then the eight Jira ones", () => {
    expect(searchIds("alert")).toEqual([
      ...ids(getTemplatesInView(WorkflowTemplateCategory.Alerts)),
      ...ALERT_JIRA_IDS,
    ]);
  });

  test("a search for incident never brings back an alert-only Jira template", () => {
    const results: Array<string> = searchIds("incident");

    for (const alertJiraId of ALERT_JIRA_IDS) {
      expect(results).not.toContain(alertJiraId);
    }

    for (const incidentJiraId of INCIDENT_JIRA_IDS) {
      expect(results).toContain(incidentJiraId);
    }
  });
});

describe("how a search ranks what it finds", () => {
  test("every template with the word in its name comes before every one without", () => {
    const results: Array<string> = searchIds("webhook");

    type NameHasItFunction = (templateId: string) => boolean;

    const nameHasIt: NameHasItFunction = (templateId: string): boolean => {
      return template(templateId).name.toLowerCase().includes("webhook");
    };

    const inName: Array<string> = results.filter(nameHasIt);
    const elsewhere: Array<string> = results.filter((templateId: string) => {
      return !nameHasIt(templateId);
    });

    // Both kinds exist, so the order below says something.
    expect(inName.length).toBeGreaterThan(0);
    expect(elsewhere.length).toBeGreaterThan(0);
    expect(results).toEqual([...inName, ...elsewhere]);
  });

  test("a name that starts with the word comes before one that only contains it", () => {
    const results: Array<string> = searchIds("send");

    expect(template("scheduled-email-digest").name).toMatch(/^Send /);
    expect(template("subscriber-added-forward").name).toMatch(/^Send /);
    expect(template("webhook-to-slack").name).toMatch(/ send /);
    expect(results.slice(0, 2).sort()).toEqual(
      ["scheduled-email-digest", "subscriber-added-forward"].sort(),
    );
    expect(results.indexOf("webhook-to-slack")).toBeGreaterThan(1);
    expect(
      getWorkflowTemplateSearchScore(template("scheduled-email-digest"), [
        "send",
      ]),
    ).toBeGreaterThan(
      getWorkflowTemplateSearchScore(template("webhook-to-slack"), ["send"]),
    );
  });

  /*
   * Equal matches keep the catalog's order. "jira alert" is in the name of
   * all eight Jira alert templates; what a template teaches used to break the
   * tie, and put "Acknowledge or resolve the alert..." above the template the
   * docs say to start with.
   */
  test("equal matches keep the catalog's order, whatever the templates teach", () => {
    expect(searchIds("jira alert")).toEqual(ALERT_JIRA_IDS);
    expect(searchIds("jira alert")[0]).toBe("jira-create-issue-for-alert");
  });

  /*
   * Word for word these two names are the same search, so a search scored
   * word by word alone put whichever came first in some other respect on
   * top. Typing a name has to find that name.
   */
  test("typing a name puts that template first, even where another has the very same words", () => {
    const issueForAlert: WorkflowTemplate = template(
      "jira-create-issue-for-alert",
    );
    const alertFromIssue: WorkflowTemplate = template(
      "jira-create-alert-from-issue",
    );

    expect(
      [...getWorkflowTemplateSearchTokens(issueForAlert.name)].sort(),
    ).toEqual([...getWorkflowTemplateSearchTokens(alertFromIssue.name)].sort());

    expect(searchIds(issueForAlert.name)[0]).toBe(issueForAlert.id);
    expect(searchIds(alertFromIssue.name)[0]).toBe(alertFromIssue.id);
    // However it is typed.
    expect(
      searchIds("  CREATE an alert   when a jira ISSUE is created ")[0],
    ).toBe(alertFromIssue.id);
  });

  test("a phrase in the name counts for more than the same words apart", () => {
    const tokens: Array<string> = ["jira", "issue"];

    expect(
      getWorkflowTemplateSearchScore(
        template("jira-create-issue-for-incident"),
        tokens,
        "jira issue",
      ),
    ).toBeGreaterThan(
      getWorkflowTemplateSearchScore(
        template("jira-create-issue-for-incident"),
        tokens,
        "issue jira",
      ),
    );
  });

  test("a word only in what a template teaches finds it, but scores nothing", () => {
    const transform: WorkflowTemplate = template("javascript-transform");

    expect(transform.teaches).toContain("built-in");
    expect(
      `${transform.name} ${transform.description}`.toLowerCase(),
    ).not.toContain("built");
    expect(getWorkflowTemplateSearchScore(transform, ["built"])).toBe(0);
    expect(workflowTemplateMatchesSearch(transform, ["built"])).toBe(true);
  });

  test("an empty search keeps the order it was given", () => {
    const given: Array<WorkflowTemplate> = [...ALL_TEMPLATES].reverse();

    expect(ids(searchWorkflowTemplates(given, "  "))).toEqual(ids(given));
  });

  test("the result is a new list, never the one passed in", () => {
    const given: Array<WorkflowTemplate> = [...ALL_TEMPLATES];

    expect(searchWorkflowTemplates(given, "")).not.toBe(given);
  });
});

describe("highlighting what a search matched", () => {
  type MarkedFunction = (
    segments: Array<WorkflowTemplateHighlightSegment>,
  ) => Array<string>;

  const marked: MarkedFunction = (
    segments: Array<WorkflowTemplateHighlightSegment>,
  ): Array<string> => {
    return segments
      .filter((segment: WorkflowTemplateHighlightSegment) => {
        return segment.isMatch;
      })
      .map((segment: WorkflowTemplateHighlightSegment) => {
        return segment.text;
      });
  };

  test("no words, no highlight: the text comes back whole", () => {
    expect(
      getWorkflowTemplateHighlightSegments(
        "Tell Slack when an incident opens",
        [],
      ),
    ).toEqual([{ text: "Tell Slack when an incident opens", isMatch: false }]);
  });

  test("every word is marked wherever it appears, in its own case", () => {
    const segments: Array<WorkflowTemplateHighlightSegment> =
      getWorkflowTemplateHighlightSegments(
        "Tell Slack when an incident opens in slack",
        ["slack", "incident"],
      );

    expect(marked(segments)).toEqual(["Slack", "incident", "slack"]);
    expect(
      segments
        .map((segment: WorkflowTemplateHighlightSegment) => {
          return segment.text;
        })
        .join(""),
    ).toBe("Tell Slack when an incident opens in slack");
  });

  test("the longer word wins where two overlap", () => {
    expect(
      marked(
        getWorkflowTemplateHighlightSegments("Incident opened", [
          "inc",
          "incident",
        ]),
      ),
    ).toEqual(["Incident"]);
  });

  test("a search is read as words, never as a pattern, and punctuation is never marked", () => {
    expect(
      marked(
        getWorkflowTemplateHighlightSegments(
          "API Post (JSON)",
          getWorkflowTemplateSearchTokens("(json)"),
        ),
      ),
    ).toEqual(["JSON"]);
    expect(getWorkflowTemplateSearchTokens(".* [a-z]+ (?:)")).toEqual(["z"]);
    expect(searchIds(".*")).toEqual(
      ids(getTemplatesInView(WorkflowTemplateCollection.All)),
    );
  });

  test("the word a typo was read as is marked whole", () => {
    expect(
      marked(
        getWorkflowTemplateHighlightSegments(
          "Tell Slack when an incident opens",
          ["incidnet"],
          ["incidnet"],
        ),
      ),
    ).toEqual(["incident"]);
    // Not when the word was not read as a typo.
    expect(
      marked(
        getWorkflowTemplateHighlightSegments(
          "Tell Slack when an incident opens",
          ["incidnet"],
        ),
      ),
    ).toEqual([]);
  });
});

describe("the list for each state", () => {
  test("the picker opens on Recommended, not searching, with nothing picked yet", () => {
    expect(INITIAL_WORKFLOW_TEMPLATE_PICKER_STATE).toEqual({
      search: "",
      browseView: WorkflowTemplateCollection.Recommended,
      searchView: WorkflowTemplateCollection.All,
      activeTemplateId: null,
      isPreviewOpen: false,
    });
  });

  /*
   * Recommended holds a Jira template, and Jira templates are split into
   * incident and alert parts. The split is for the Jira category only: in
   * Recommended it put an "Incidents" heading over that one row.
   */
  test("Recommended is one list with no headings, though it holds a Jira template", () => {
    const list: WorkflowTemplatePickerList = getWorkflowTemplatePickerList(
      INITIAL_WORKFLOW_TEMPLATE_PICKER_STATE,
    );

    expect(
      getTemplatesInView(WorkflowTemplateCollection.Recommended).some(
        (candidate: WorkflowTemplate) => {
          return Boolean(candidate.subcategory);
        },
      ),
    ).toBe(true);
    expect(list.sections).toHaveLength(1);
    expect(list.sections[0]?.title).toBe("");
    expect(ids(list.templates)).toEqual([...RECOMMENDED_WORKFLOW_TEMPLATE_IDS]);
    expect(list.isSearching).toBe(false);
    expect(list.view).toBe(WorkflowTemplateCollection.Recommended);
  });

  test("a category with no parts is one list with no heading", () => {
    const list: WorkflowTemplatePickerList = getWorkflowTemplatePickerList(
      stateWith({ browseView: WorkflowTemplateCategory.Incidents }),
    );

    expect(list.sections).toHaveLength(1);
    expect(list.sections[0]?.title).toBe("");
    expect(ids(list.templates)).toEqual(
      ids(getTemplatesInView(WorkflowTemplateCategory.Incidents)),
    );
  });

  test("Jira is two lists: its incident templates, then its alert ones", () => {
    const list: WorkflowTemplatePickerList = getWorkflowTemplatePickerList(
      stateWith({ browseView: WorkflowTemplateCategory.Jira }),
    );

    expect(
      list.sections.map((section: WorkflowTemplatePickerSection) => {
        return {
          id: section.id,
          title: section.title,
          templates: ids(section.templates),
        };
      }),
    ).toEqual([
      { id: "incidents", title: "Incidents", templates: INCIDENT_JIRA_IDS },
      { id: "alerts", title: "Alerts", templates: ALERT_JIRA_IDS },
    ]);
    expect(INCIDENT_JIRA_IDS).toHaveLength(9);
    expect(ALERT_JIRA_IDS).toHaveLength(8);
  });

  test("All templates is one list per category, headed by its label, in category order", () => {
    const list: WorkflowTemplatePickerList = getWorkflowTemplatePickerList(
      stateWith({ browseView: WorkflowTemplateCollection.All }),
    );

    expect(
      list.sections.map((section: WorkflowTemplatePickerSection) => {
        return section.title;
      }),
    ).toEqual(
      WorkflowTemplateCategories.map((category: WorkflowTemplateCategory) => {
        return getWorkflowTemplateCategoryLabel(category);
      }),
    );

    for (const section of list.sections) {
      expect(section.templates.length).toBeGreaterThan(0);
    }

    expect(list.templates).toHaveLength(ALL_TEMPLATES.length);
  });

  test("section ids are unique and safe in a DOM id", () => {
    const list: WorkflowTemplatePickerList = getWorkflowTemplatePickerList(
      stateWith({ browseView: WorkflowTemplateCollection.All }),
    );
    const sectionIds: Array<string> = list.sections.map(
      (section: WorkflowTemplatePickerSection) => {
        return section.id;
      },
    );

    expect(new Set(sectionIds).size).toBe(sectionIds.length);

    for (const sectionId of sectionIds) {
      expect(sectionId).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  test("a search is one ranked list, across every template unless narrowed", () => {
    const searching: WorkflowTemplatePickerState = withWorkflowTemplateSearch(
      INITIAL_WORKFLOW_TEMPLATE_PICKER_STATE,
      "slack",
    );
    const list: WorkflowTemplatePickerList =
      getWorkflowTemplatePickerList(searching);

    expect(list.isSearching).toBe(true);
    expect(list.view).toBe(WorkflowTemplateCollection.All);
    expect(list.sections).toHaveLength(1);
    expect(ids(list.templates)).toEqual(searchIds("slack"));

    const narrowed: WorkflowTemplatePickerList = getWorkflowTemplatePickerList(
      withWorkflowTemplateView(searching, WorkflowTemplateCategory.Monitors),
    );

    expect(ids(narrowed.templates)).toEqual(
      ids(
        searchWorkflowTemplates(
          getTemplatesInView(WorkflowTemplateCategory.Monitors),
          "slack",
        ),
      ),
    );
    expect(narrowed.templates.length).toBeGreaterThan(0);
  });

  test("a search that matches nothing is an empty list, with no empty sections", () => {
    const list: WorkflowTemplatePickerList = getWorkflowTemplatePickerList(
      withWorkflowTemplateSearch(
        INITIAL_WORKFLOW_TEMPLATE_PICKER_STATE,
        "pagerduty",
      ),
    );

    expect(list.templates).toEqual([]);
    expect(list.sections).toEqual([]);
  });
});

describe("every template stays reachable", () => {
  test.each(
    ALL_TEMPLATES.map((candidate: WorkflowTemplate) => {
      return [candidate.id];
    }),
  )(
    "%s is in its category, in All templates, and found by its own name",
    (templateId: string) => {
      const candidate: WorkflowTemplate = template(templateId);

      expect(listIds(stateWith({ browseView: candidate.category }))).toContain(
        templateId,
      );
      expect(
        listIds(stateWith({ browseView: WorkflowTemplateCollection.All })),
      ).toContain(templateId);

      const byName: Array<string> = listIds(
        withWorkflowTemplateSearch(
          INITIAL_WORKFLOW_TEMPLATE_PICKER_STATE,
          candidate.name,
        ),
      );

      // Typing a template's whole name puts it first.
      expect(byName[0]).toBe(templateId);
    },
  );
});

describe("counts beside each category", () => {
  test("without a search, each view's size", () => {
    const counts: Map<WorkflowTemplatePickerView, number> =
      getWorkflowTemplatePickerCounts("");

    expect(counts.get(WorkflowTemplateCollection.Recommended)).toBe(
      RECOMMENDED_WORKFLOW_TEMPLATE_IDS.length,
    );
    expect(counts.get(WorkflowTemplateCollection.All)).toBe(
      ALL_TEMPLATES.length,
    );

    for (const category of WorkflowTemplateCategories) {
      expect(counts.get(category)).toBe(getTemplatesInView(category).length);
    }

    expect(counts.get(WorkflowTemplateCategory.Jira)).toBe(17);
  });

  test("with a search, how many match in each, adding up to All", () => {
    const counts: Map<WorkflowTemplatePickerView, number> =
      getWorkflowTemplatePickerCounts("slack");

    expect(counts.get(WorkflowTemplateCollection.All)).toBe(
      searchIds("slack").length,
    );

    const sum: number = WorkflowTemplateCategories.reduce(
      (total: number, category: WorkflowTemplateCategory): number => {
        return total + (counts.get(category) || 0);
      },
      0,
    );

    expect(sum).toBe(counts.get(WorkflowTemplateCollection.All));
    expect(counts.get(WorkflowTemplateCategory.Jira)).toBe(0);
    expect(counts.get(WorkflowTemplateCategory.Basics)).toBe(0);
    expect(counts.get(WorkflowTemplateCategory.Incidents)).toBeGreaterThan(0);
  });

  test("Recommended counts only the recommended templates that match", () => {
    const counts: Map<WorkflowTemplatePickerView, number> =
      getWorkflowTemplatePickerCounts("jira");

    expect(counts.get(WorkflowTemplateCollection.Recommended)).toBe(1);
  });
});

describe("searching and choosing a category", () => {
  test("a new search looks through every template, whichever category was open", () => {
    const browsingJira: WorkflowTemplatePickerState = stateWith({
      browseView: WorkflowTemplateCategory.Jira,
      activeTemplateId: "jira-status-to-alert-state",
      isPreviewOpen: true,
    });
    const searching: WorkflowTemplatePickerState = withWorkflowTemplateSearch(
      browsingJira,
      "slack",
    );

    expect(isSearchingTemplates(searching)).toBe(true);
    expect(getCurrentWorkflowTemplatePickerView(searching)).toBe(
      WorkflowTemplateCollection.All,
    );
    // Browsing remembers where it was, for when the search is cleared.
    expect(searching.browseView).toBe(WorkflowTemplateCategory.Jira);
    // The best match is highlighted afresh, and the preview closes.
    expect(searching.activeTemplateId).toBeNull();
    expect(searching.isPreviewOpen).toBe(false);
  });

  test("typing on keeps the category the search was narrowed to", () => {
    const narrowed: WorkflowTemplatePickerState = withWorkflowTemplateView(
      withWorkflowTemplateSearch(INITIAL_WORKFLOW_TEMPLATE_PICKER_STATE, "sl"),
      WorkflowTemplateCategory.Monitors,
    );
    const typedOn: WorkflowTemplatePickerState = withWorkflowTemplateSearch(
      narrowed,
      "slack",
    );

    expect(getCurrentWorkflowTemplatePickerView(typedOn)).toBe(
      WorkflowTemplateCategory.Monitors,
    );
  });

  test("clearing the search goes back to the category that was being browsed", () => {
    const searching: WorkflowTemplatePickerState = withWorkflowTemplateView(
      withWorkflowTemplateSearch(
        stateWith({ browseView: WorkflowTemplateCategory.Alerts }),
        "slack",
      ),
      WorkflowTemplateCategory.Monitors,
    );
    const cleared: WorkflowTemplatePickerState = withWorkflowTemplateSearch(
      searching,
      "",
    );

    expect(isSearchingTemplates(cleared)).toBe(false);
    expect(getCurrentWorkflowTemplatePickerView(cleared)).toBe(
      WorkflowTemplateCategory.Alerts,
    );
  });

  test("a search of nothing but spaces is not a search", () => {
    const spaces: WorkflowTemplatePickerState = withWorkflowTemplateSearch(
      stateWith({ browseView: WorkflowTemplateCategory.Jira }),
      "   ",
    );

    expect(isSearchingTemplates(spaces)).toBe(false);
    expect(getCurrentWorkflowTemplatePickerView(spaces)).toBe(
      WorkflowTemplateCategory.Jira,
    );
  });

  test("choosing a category while browsing changes what is browsed", () => {
    const next: WorkflowTemplatePickerState = withWorkflowTemplateView(
      stateWith({ activeTemplateId: "incident-created-teams" }),
      WorkflowTemplateCategory.OnCall,
    );

    expect(next.browseView).toBe(WorkflowTemplateCategory.OnCall);
    expect(next.searchView).toBe(WorkflowTemplateCollection.All);
    expect(next.activeTemplateId).toBeNull();
  });

  test("choosing a category while searching narrows the search, and leaves browsing alone", () => {
    const next: WorkflowTemplatePickerState = withWorkflowTemplateView(
      withWorkflowTemplateSearch(INITIAL_WORKFLOW_TEMPLATE_PICKER_STATE, "x"),
      WorkflowTemplateCategory.Jira,
    );

    expect(next.searchView).toBe(WorkflowTemplateCategory.Jira);
    expect(next.browseView).toBe(WorkflowTemplateCollection.Recommended);
  });

  test("the state passed in is never changed", () => {
    const before: WorkflowTemplatePickerState = stateWith({
      activeTemplateId: "manual-log",
    });
    const copy: WorkflowTemplatePickerState = { ...before };

    withWorkflowTemplateSearch(before, "slack");
    withWorkflowTemplateView(before, WorkflowTemplateCategory.Jira);

    expect(before).toEqual(copy);
  });
});

describe("the highlighted template", () => {
  test("with nothing picked, it is the first on the list", () => {
    expect(
      getActiveWorkflowTemplate(INITIAL_WORKFLOW_TEMPLATE_PICKER_STATE)?.id,
    ).toBe(RECOMMENDED_WORKFLOW_TEMPLATE_IDS[0]);
  });

  test("the one picked, while it is on the list", () => {
    expect(
      getActiveWorkflowTemplate(
        stateWith({ activeTemplateId: "scheduled-check-alert-slack" }),
      )?.id,
    ).toBe("scheduled-check-alert-slack");
  });

  test("a pick the list no longer shows falls back to the first on the list", () => {
    expect(
      getActiveWorkflowTemplate(
        stateWith({
          browseView: WorkflowTemplateCategory.Alerts,
          activeTemplateId: "manual-log",
        }),
      )?.id,
    ).toBe(getTemplatesInView(WorkflowTemplateCategory.Alerts)[0]?.id);
  });

  test("after a search, the best match", () => {
    expect(
      getActiveWorkflowTemplate(
        withWorkflowTemplateSearch(
          INITIAL_WORKFLOW_TEMPLATE_PICKER_STATE,
          "discord",
        ),
      )?.id,
    ).toBe("incident-created-discord");
  });

  test("none when nothing matches", () => {
    expect(
      getActiveWorkflowTemplate(
        withWorkflowTemplateSearch(
          INITIAL_WORKFLOW_TEMPLATE_PICKER_STATE,
          "pagerduty",
        ),
      ),
    ).toBeNull();
  });
});

describe("moving the highlight", () => {
  const recommended: Array<string> = [...RECOMMENDED_WORKFLOW_TEMPLATE_IDS];

  test("down and up move one row at a time, from the implicit first row", () => {
    const start: WorkflowTemplatePickerState =
      INITIAL_WORKFLOW_TEMPLATE_PICKER_STATE;

    expect(getMovedWorkflowTemplateId(start, WorkflowTemplateMove.Next)).toBe(
      recommended[1],
    );
    expect(
      getMovedWorkflowTemplateId(
        stateWith({ activeTemplateId: recommended[2]! }),
        WorkflowTemplateMove.Previous,
      ),
    ).toBe(recommended[1]);
  });

  test("they stop at either end instead of wrapping round", () => {
    expect(
      getMovedWorkflowTemplateId(
        INITIAL_WORKFLOW_TEMPLATE_PICKER_STATE,
        WorkflowTemplateMove.Previous,
      ),
    ).toBe(recommended[0]);
    expect(
      getMovedWorkflowTemplateId(
        stateWith({ activeTemplateId: recommended[recommended.length - 1]! }),
        WorkflowTemplateMove.Next,
      ),
    ).toBe(recommended[recommended.length - 1]);
  });

  test("first and last jump to the ends of the list", () => {
    const middle: WorkflowTemplatePickerState = stateWith({
      activeTemplateId: recommended[3]!,
    });

    expect(getMovedWorkflowTemplateId(middle, WorkflowTemplateMove.First)).toBe(
      recommended[0],
    );
    expect(getMovedWorkflowTemplateId(middle, WorkflowTemplateMove.Last)).toBe(
      recommended[recommended.length - 1],
    );
  });

  test("they walk across the parts of a split list as one list", () => {
    const lastIncidentJira: string =
      INCIDENT_JIRA_IDS[INCIDENT_JIRA_IDS.length - 1]!;

    expect(
      getMovedWorkflowTemplateId(
        stateWith({
          browseView: WorkflowTemplateCategory.Jira,
          activeTemplateId: lastIncidentJira,
        }),
        WorkflowTemplateMove.Next,
      ),
    ).toBe(ALERT_JIRA_IDS[0]);
  });

  test("nothing to move to when the list is empty", () => {
    const empty: WorkflowTemplatePickerState = withWorkflowTemplateSearch(
      INITIAL_WORKFLOW_TEMPLATE_PICKER_STATE,
      "pagerduty",
    );

    for (const move of Object.values(WorkflowTemplateMove)) {
      expect(getMovedWorkflowTemplateId(empty, move)).toBeNull();
    }
  });
});

describe("the preview of a template", () => {
  type TitlesFunction = (
    blocks: Array<WorkflowTemplatePreviewBlock>,
  ) => Array<string>;

  const titles: TitlesFunction = (
    blocks: Array<WorkflowTemplatePreviewBlock>,
  ): Array<string> => {
    return blocks.map((block: WorkflowTemplatePreviewBlock) => {
      return block.title;
    });
  };

  type PreviewFunction = (templateId: string) => WorkflowTemplatePreview;

  const previewOf: PreviewFunction = (
    templateId: string,
  ): WorkflowTemplatePreview => {
    const preview: WorkflowTemplatePreview | null = getWorkflowTemplatePreview(
      template(templateId),
    );

    if (!preview) {
      throw new Error(`No preview for "${templateId}".`);
    }

    return preview;
  };

  test("names the trigger and the blocks the way the builder's canvas does", () => {
    const preview: WorkflowTemplatePreview = previewOf(
      "incident-created-slack",
    );

    expect(preview.trigger.title).toBe("On Create Incident");
    expect(titles(preview.steps)).toEqual(["Send Message to Slack", "Log"]);
    expect(preview.blockCount).toBe(3);
  });

  /*
   * This template's Slack step hangs off the API call's Error port. A preview
   * that followed only the way that works would leave out the one step the
   * template is named for.
   */
  test("lists a block reached only when something fails", () => {
    expect(titles(previewOf("scheduled-check-alert-slack").steps)).toEqual([
      "API Get (JSON)",
      "Send Message to Slack",
      "Log",
    ]);
  });

  test("lists each kind of block once, however often it is used", () => {
    const steps: Array<string> = titles(
      previewOf("jira-declare-incident-from-issue").steps,
    );

    expect(new Set(steps).size).toBe(steps.length);
    expect(steps).toContain("Run Custom JavaScript");
    expect(steps[steps.length - 1]).toBe("Log");
    expect(previewOf("jira-declare-incident-from-issue").blockCount).toBe(
      getTemplateGraphSpec("jira-declare-incident-from-issue")?.nodes.length,
    );
  });

  test("a template that only logs shows its Log step", () => {
    const preview: WorkflowTemplatePreview = previewOf("manual-log");

    expect(preview.trigger.title).toBe("Manual");
    expect(titles(preview.steps)).toEqual(["Log"]);
  });

  test("lists the settings the Configure step will ask for, in its order", () => {
    const preview: WorkflowTemplatePreview = previewOf(
      "scheduled-email-digest",
    );

    expect(
      preview.settings.map((setting: { name: string }) => {
        return setting.name;
      }),
    ).toEqual(
      template("scheduled-email-digest").variables.map(
        (variable: { name: string }) => {
          return variable.name;
        },
      ),
    );
  });

  test("has no settings for a template that asks for none", () => {
    expect(previewOf("jira-status-to-incident-state").settings).toEqual([]);
  });

  test.each(
    ALL_TEMPLATES.map((candidate: WorkflowTemplate) => {
      return [candidate.id];
    }),
  )(
    "%s: every block in it has a name and an icon from the registry",
    (templateId: string) => {
      const preview: WorkflowTemplatePreview = previewOf(templateId);

      for (const block of [preview.trigger, ...preview.steps]) {
        const component: ComponentMetadata | undefined = findWorkflowComponent(
          block.componentId,
        );

        expect({ block: block.componentId, found: Boolean(component) }).toEqual(
          {
            block: block.componentId,
            found: true,
          },
        );
        expect(block.title).toBe(component?.title);
        expect(block.icon).toBe(component?.iconProp);
      }
    },
  );

  test("a block the registry does not know is still named, from its id", () => {
    const preview: WorkflowTemplatePreview | null = getWorkflowTemplatePreview(
      template("incident-created-slack"),
      (componentId: string): ComponentMetadata | undefined => {
        return componentId === ComponentID.Log
          ? findWorkflowComponent(componentId)
          : undefined;
      },
    );

    expect(preview?.trigger).toEqual({
      componentId: "incident-on-create",
      title: "Incident on create",
      icon: IconProp.Cube,
    });
    expect(preview?.steps[1]?.title).toBe("Log");
  });
});
