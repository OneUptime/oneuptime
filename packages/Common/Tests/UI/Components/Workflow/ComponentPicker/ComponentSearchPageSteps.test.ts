/*
 * Finding the Page steps in the Add Component panel, over the real catalog:
 * every database model's steps plus the hand-written ones.
 *
 * Paging is what OneUptime calls it. Somebody who wants to "notify whoever
 * is on call", "call someone", "escalate" or do "what PagerDuty does" is
 * looking for the same four steps, so each of those words finds them - and
 * a word that names one of the four (a team, a schedule, a policy) finds
 * that one first.
 *
 * Two words are left alone on purpose. "email" means Send Email, and
 * "alert" is a record here with steps of its own: neither is taken over by
 * the Page steps.
 */

import {
  COMPONENT_KEYWORDS,
  ComponentSearchIndex,
  ComponentSearchResult,
  buildComponentSearchIndex,
  searchComponents,
} from "../../../../../UI/Components/Workflow/ComponentPicker/ComponentSearch";
import {
  PickerCatalog,
  buildPickerCatalog,
} from "../../../../../UI/Components/Workflow/ComponentPicker/PickerCatalog";
import { loadComponentsAndCategories } from "../../../../../UI/Components/Workflow/Utils";
import ComponentMetadata, {
  ComponentCategory,
  ComponentType,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import { describe, expect, test } from "@jest/globals";

const loaded: {
  components: Array<ComponentMetadata>;
  categories: Array<ComponentCategory>;
} = loadComponentsAndCategories();

const ACTIONS: ComponentSearchIndex = buildComponentSearchIndex(
  buildPickerCatalog({
    components: loaded.components,
    categories: loaded.categories,
    componentsType: ComponentType.Component,
  }) as PickerCatalog,
);

const TRIGGERS: ComponentSearchIndex = buildComponentSearchIndex(
  buildPickerCatalog({
    components: loaded.components,
    categories: loaded.categories,
    componentsType: ComponentType.Trigger,
  }) as PickerCatalog,
);

const PAGE_USERS: string = "Page Users";
const PAGE_TEAM: string = "Page a Team";
const PAGE_ON_CALL: string = "Page Whoever Is On Call";
const PAGE_POLICY: string = "Page an On-Call Policy";

// The SMSEagle steps text and call a phone, so the same words find them too.
const SMSEAGLE_SMS: string = "Send SMS via SMSEagle";
const SMSEAGLE_CALL: string = "Make a Call via SMSEagle";

// The four, in the order equal matches are listed: by name.
const PAGE_STEPS: Array<string> = [
  PAGE_TEAM,
  PAGE_POLICY,
  PAGE_USERS,
  PAGE_ON_CALL,
];

const PAGE_STEP_IDS: Array<ComponentID> = [
  ComponentID.PageUsers,
  ComponentID.PageTeam,
  ComponentID.PageOnCall,
  ComponentID.PageOnCallPolicy,
];

function titles(query: string): Array<string> {
  return searchComponents(ACTIONS, query).results.map(
    (result: ComponentSearchResult): string => {
      return result.component.title;
    },
  );
}

function sorted(list: Array<string>): Array<string> {
  return [...list].sort();
}

describe("the word itself", () => {
  test.each(["page", "Page", "PAGE", "pager", "paging"])(
    "'%s' lists the four Page steps before anything else",
    (query: string) => {
      expect(titles(query).slice(0, 4)).toEqual(PAGE_STEPS);
    },
  );

  test("'page' still finds the Status Page steps, after them", () => {
    const found: Array<string> = titles("page");

    expect(found[4]).toBe("Create One Status Page");
    expect(found.length).toBeGreaterThan(8);
  });
});

describe("what people call it", () => {
  test.each([
    "person",
    "people",
    "someone",
    "somebody",
    "responder",
    "engineer",
    "pagerduty",
    "opsgenie",
    "page someone",
  ])("'%s' lists the four Page steps first", (query: string) => {
    expect(titles(query).slice(0, 4)).toEqual(PAGE_STEPS);
  });

  test("'phone' lists the four Page steps with the SMSEagle steps, by name", () => {
    expect(titles("phone").slice(0, 6)).toEqual([
      SMSEAGLE_CALL,
      ...PAGE_STEPS,
      SMSEAGLE_SMS,
    ]);
  });

  test("'sms' lists the SMSEagle steps, which say it in their name, then the four Page steps", () => {
    expect(titles("sms").slice(0, 6)).toEqual([
      SMSEAGLE_SMS,
      SMSEAGLE_CALL,
      ...PAGE_STEPS,
    ]);
  });

  test.each(["notify", "notification"])(
    "'%s' lists them with the steps that send a message, which keep their place",
    (query: string) => {
      const found: Array<string> = titles(query);

      expect(found.slice(0, 4)).toEqual([
        "Send Message to Slack",
        "Send Message to Teams",
        "Send Message to Discord",
        "Send Email",
      ]);
      expect(found.slice(4, 9)).toEqual([SMSEAGLE_CALL, ...PAGE_STEPS]);
    },
  );

  test("'call' lists all four, the ones that say it in their name first", () => {
    const found: Array<string> = titles("call");

    expect(found.slice(0, 3)).toEqual([
      SMSEAGLE_CALL,
      PAGE_POLICY,
      PAGE_ON_CALL,
    ]);
    expect(found).toContain(PAGE_USERS);
    expect(found).toContain(PAGE_TEAM);
  });

  test.each(["on call", "on-call", "duty", "call someone", "page on call"])(
    "'%s' lists the four before the on-call records' own steps",
    (query: string) => {
      const found: Array<string> = titles(query);

      expect(sorted(found.slice(0, 4))).toEqual(sorted(PAGE_STEPS));
      // The two that say "on call" in their name lead.
      expect(found.slice(0, 2)).toEqual([PAGE_POLICY, PAGE_ON_CALL]);
    },
  );
});

describe("a word that names one of the four finds that one first", () => {
  test.each<[string, string]>([
    ["user", PAGE_USERS],
    ["users", PAGE_USERS],
    ["page user", PAGE_USERS],
    ["member", PAGE_USERS],
    ["group", PAGE_TEAM],
    ["page team", PAGE_TEAM],
    ["everyone", PAGE_TEAM],
    ["schedule", PAGE_ON_CALL],
    ["rotation", PAGE_ON_CALL],
    ["rota", PAGE_ON_CALL],
    ["shift", PAGE_ON_CALL],
    ["policy", PAGE_POLICY],
    ["page policy", PAGE_POLICY],
    ["escalate", PAGE_POLICY],
    ["escalation", PAGE_POLICY],
  ])("'%s' → %s", (query: string, step: string) => {
    expect(titles(query)[0]).toBe(step);
  });

  test("'team' means the Teams message first - its name is the word - and Page a Team right after", () => {
    expect(titles("team").slice(0, 2)).toEqual([
      "Send Message to Teams",
      PAGE_TEAM,
    ]);
  });

  test("'notify team' offers both ways to reach a team, and nothing else", () => {
    expect(titles("notify team")).toEqual(["Send Message to Teams", PAGE_TEAM]);
  });

  test("'execute' still means Execute Workflow first; the policy step follows, as it executes a policy", () => {
    expect(titles("execute")).toEqual(["Execute Workflow", PAGE_POLICY]);
  });
});

describe("words the Page steps leave alone", () => {
  test("'email' is Send Email and the email records: no Page step", () => {
    const found: Array<string> = titles("email");

    expect(found[0]).toBe("Send Email");

    for (const step of PAGE_STEPS) {
      expect(found).not.toContain(step);
    }
  });

  test("'alert' is the Alert record's own steps: no Page step among the first", () => {
    const found: Array<string> = titles("alert");

    expect(found[0]).toBe("Create One Alert");

    for (const step of PAGE_STEPS) {
      expect(found.slice(0, 8)).not.toContain(step);
    }
  });

  test("'incident' likewise", () => {
    const found: Array<string> = titles("incident");

    expect(found[0]).toBe("Create One Incident");

    for (const step of PAGE_STEPS) {
      expect(found.slice(0, 8)).not.toContain(step);
    }
  });
});

describe("the list of triggers", () => {
  test("has no Page step: a page is something a workflow does, not what starts one", () => {
    for (const query of ["page", "on call", "pager", "notify"]) {
      const found: Array<string> = searchComponents(
        TRIGGERS,
        query,
      ).results.map((result: ComponentSearchResult): string => {
        return result.component.title;
      });

      for (const step of PAGE_STEPS) {
        expect(found).not.toContain(step);
      }
    }
  });
});

describe("the words themselves", () => {
  test("each Page step has its own, and all four share the words for paging", () => {
    const shared: Array<string> = [
      "pager",
      "paging",
      "notify",
      "notification",
      "call",
      "phone",
      "sms",
      "person",
      "people",
      "someone",
      "somebody",
      "responder",
      "engineer",
      "pagerduty",
      "opsgenie",
    ];

    for (const id of PAGE_STEP_IDS) {
      const keywords: ReadonlyArray<string> = COMPONENT_KEYWORDS[id]!;

      for (const word of shared) {
        expect(keywords).toContain(word);
      }

      // Its own, beside the shared ones.
      expect(keywords.length).toBeGreaterThan(shared.length);
      // Lower case, one word each, none twice: what the index matches on.
      expect(new Set(keywords).size).toBe(keywords.length);

      for (const keyword of keywords) {
        expect(keyword).toBe(keyword.toLowerCase().trim());
        expect(keyword).not.toContain(" ");
      }
    }
  });

  test("none of them is 'email' or 'alert'", () => {
    for (const id of PAGE_STEP_IDS) {
      expect(COMPONENT_KEYWORDS[id]).not.toContain("email");
      expect(COMPONENT_KEYWORDS[id]).not.toContain("alert");
      expect(COMPONENT_KEYWORDS[id]).not.toContain("incident");
    }
  });
});
