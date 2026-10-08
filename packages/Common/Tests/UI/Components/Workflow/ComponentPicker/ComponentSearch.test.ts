import {
  ComponentSearchIndex,
  ComponentSearchOutcome,
  ComponentSearchResult,
  HighlightSegment,
  SearchTier,
  WordMatchKind,
  buildComponentSearchIndex,
  getComponentSearchIndex,
  getEditDistance,
  getHighlightSegments,
  getMaxTypoDistance,
  getSearchTokens,
  getSearchWords,
  getWordVariants,
  matchWord,
  matchWordWithTypo,
  searchComponents,
} from "../../../../../UI/Components/Workflow/ComponentPicker/ComponentSearch";
import {
  PickerCatalog,
  buildPickerCatalog,
} from "../../../../../UI/Components/Workflow/ComponentPicker/PickerCatalog";
import IconProp from "../../../../../Types/Icon/IconProp";
import ComponentMetadata, {
  ComponentType,
} from "../../../../../Types/Workflow/Component";
import { FixturePalette, buildFixturePalette } from "./PickerFixtures";
import { describe, expect, test } from "@jest/globals";

const palette: FixturePalette = buildFixturePalette();

type IndexForFunction = (componentsType: ComponentType) => ComponentSearchIndex;

const indexFor: IndexForFunction = (
  componentsType: ComponentType,
): ComponentSearchIndex => {
  return buildComponentSearchIndex(
    buildPickerCatalog({
      components: palette.components,
      categories: palette.categories,
      componentsType: componentsType,
    }),
  );
};

const ACTIONS: ComponentSearchIndex = indexFor(ComponentType.Component);
const TRIGGERS: ComponentSearchIndex = indexFor(ComponentType.Trigger);

type SearchFunction = (
  index: ComponentSearchIndex,
  search: string,
) => Array<ComponentSearchResult>;

const search: SearchFunction = (
  index: ComponentSearchIndex,
  query: string,
): Array<ComponentSearchResult> => {
  return searchComponents(index, query).results;
};

type TitlesFunction = (
  index: ComponentSearchIndex,
  search: string,
) => Array<string>;

const titles: TitlesFunction = (
  index: ComponentSearchIndex,
  query: string,
): Array<string> => {
  return search(index, query).map((result: ComponentSearchResult): string => {
    return result.component.title;
  });
};

type ResultForFunction = (
  results: Array<ComponentSearchResult>,
  title: string,
) => ComponentSearchResult;

const resultFor: ResultForFunction = (
  results: Array<ComponentSearchResult>,
  title: string,
): ComponentSearchResult => {
  const result: ComponentSearchResult | undefined = results.find(
    (candidate: ComponentSearchResult): boolean => {
      return candidate.component.title === title;
    },
  );

  if (!result) {
    throw new Error(`"${title}" is not among the results.`);
  }

  return result;
};

type MarkedFunction = (segments: Array<HighlightSegment>) => Array<string>;

const marked: MarkedFunction = (
  segments: Array<HighlightSegment>,
): Array<string> => {
  return segments
    .filter((segment: HighlightSegment): boolean => {
      return segment.isMatch;
    })
    .map((segment: HighlightSegment): string => {
      return segment.text;
    });
};

const INCIDENT_ACTIONS: Array<string> = [
  "Create One Incident",
  "Create Many Incidents",
  "Find One Incident",
  "Find Many Incidents",
  "Update One Incident",
  "Update Many Incidents",
  "Delete One Incident",
  "Delete Many Incidents",
];

describe("the words of a search", () => {
  test("splits on spaces and punctuation, in lower case, without accents", () => {
    expect(getSearchWords("On-Call Policy")).toEqual(["on", "call", "policy"]);
    expect(getSearchWords("If / Else")).toEqual(["if", "else"]);
    expect(getSearchWords("API Post (JSON)")).toEqual(["api", "post", "json"]);
    expect(getSearchWords("  Créer   UN\tincident\n")).toEqual([
      "creer",
      "un",
      "incident",
    ]);
    expect(getSearchWords("")).toEqual([]);
    expect(getSearchWords(" / - . ")).toEqual([]);
  });

  test("drops the words that say nothing about the step, unless that is all there is", () => {
    expect(getSearchTokens("send a message to slack")).toEqual([
      "send",
      "message",
      "slack",
    ]);
    expect(getSearchTokens("when an incident is created")).toEqual([
      "incident",
      "created",
    ]);
    // "on" is half of "on-call" and the start of every trigger.
    expect(getSearchTokens("on call")).toEqual(["on", "call"]);
    expect(getSearchTokens("to")).toEqual(["to"]);
  });

  test("counts each word once, at most eight of them, and nothing when nothing searchable was typed", () => {
    expect(getSearchTokens("  Create   ONE  Monitor  ")).toEqual([
      "create",
      "one",
      "monitor",
    ]);
    expect(getSearchTokens("incident INCIDENT incident")).toEqual(["incident"]);
    expect(
      getSearchTokens("one two three four five six seven eight nine ten"),
    ).toHaveLength(8);
    expect(getSearchTokens("")).toEqual([]);
    expect(getSearchTokens("    ")).toEqual([]);
    expect(getSearchTokens("/")).toEqual([]);
  });
});

describe("matching one typed word to one word of the catalog", () => {
  test("reads a plural as its singular, without a dictionary", () => {
    expect(getWordVariants("incidents")).toContain("incident");
    expect(getWordVariants("policies")).toContain("policy");
    expect(getWordVariants("statuses")).toContain("status");
    expect(getWordVariants("severities")).toContain("severity");
    expect(getWordVariants("notes")).toContain("note");
    // "ss" is not a plural, and short words are left alone.
    expect(getWordVariants("class")).toEqual(["class"]);
    expect(getWordVariants("bus")).toEqual(["bus"]);
  });

  test("names how a word matched: exactly, in another number, as a start, or inside", () => {
    expect(matchWord("incident", "incident")).toBe(WordMatchKind.Exact);
    expect(matchWord("incidents", "incident")).toBe(WordMatchKind.Variant);
    expect(matchWord("incident", "incidents")).toBe(WordMatchKind.Variant);
    expect(matchWord("policy", "policies")).toBe(WordMatchKind.Variant);
    expect(matchWord("inc", "incident")).toBe(WordMatchKind.Prefix);
    expect(matchWord("script", "javascript")).toBe(WordMatchKind.Substring);
    // Two letters inside a word are noise, not a match.
    expect(matchWord("ci", "incident")).toBeNull();
    expect(matchWord("alert", "incident")).toBeNull();
  });

  test("counts letters swapped, added, dropped or changed, and stops once past the limit", () => {
    expect(getEditDistance("incident", "incident", 2)).toBe(0);
    expect(getEditDistance("incidnet", "incident", 2)).toBe(1);
    expect(getEditDistance("monitr", "monitor", 1)).toBe(1);
    expect(getEditDistance("monitorr", "monitor", 1)).toBe(1);
    expect(getEditDistance("alxrt", "alert", 1)).toBe(1);
    expect(getEditDistance("cretae", "create", 1)).toBe(1);
    expect(getEditDistance("slakc", "slack", 1)).toBe(1);
    expect(getEditDistance("incdient", "incident", 2)).toBe(1);
    expect(getEditDistance("incdeint", "incident", 2)).toBe(2);
    // Past the limit it only says so.
    expect(getEditDistance("abcd", "wxyz", 1)).toBe(2);
    expect(getEditDistance("a", "abcdef", 2)).toBe(3);
  });

  test("allows a typo only in a word long enough to tell it apart", () => {
    expect(getMaxTypoDistance("log")).toBe(0);
    expect(getMaxTypoDistance("slak")).toBe(1);
    expect(getMaxTypoDistance("monitr")).toBe(1);
    expect(getMaxTypoDistance("incidnet")).toBe(2);

    expect(matchWordWithTypo("incidnet", "incident")).toBe(true);
    expect(matchWordWithTypo("slakc", "slack")).toBe(true);
    expect(matchWordWithTypo("emial", "email")).toBe(true);
    // A typo in what has been typed so far of a longer word.
    expect(matchWordWithTypo("incidne", "incidents")).toBe(true);
    expect(matchWordWithTypo("lgo", "log")).toBe(false);
    expect(matchWordWithTypo("slack", "teams")).toBe(false);
  });
});

describe("a search keeps the steps that match every word", () => {
  test("finds a step whose words have other words between them, in any order", () => {
    /*
     * "create monitor" is in no title as typed: the generator writes "Create
     * One Monitor". Monitor's two create steps come first, then Monitor
     * Status's, which every word matches too; no other step.
     */
    const expected: Array<string> = [
      "Create One Monitor",
      "Create Many Monitors",
      "Create One Monitor Status",
      "Create Many Monitor Statuses",
    ];

    expect(titles(ACTIONS, "create monitor")).toEqual(expected);
    expect(titles(ACTIONS, "monitor create")).toEqual(expected);
    expect(titles(ACTIONS, "CrEaTe MoNiToR")).toEqual(expected);
  });

  test("drops every step when one word matches nothing", () => {
    expect(titles(ACTIONS, "create monitor banana")).toEqual([]);
    expect(titles(ACTIONS, "zzzz")).toEqual([]);
  });

  test("takes its words from the title, category, keywords and description", () => {
    // "code" is the category's, "javascript" the title's.
    expect(titles(ACTIONS, "javascript code")[0]).toBe("Run Custom JavaScript");
    /*
     * "database" is only ever in a generated step's description - and not in
     * every one: Delete Many's reads "Delete many Monitors that match a
     * query.", so every word has to land somewhere for real.
     */
    const database: Array<string> = titles(ACTIONS, "database monitor");
    expect(database).toEqual(
      expect.arrayContaining(["Create One Monitor", "Delete One Monitor"]),
    );
    expect(database).not.toContain("Delete Many Monitors");
    // A word only a keyword holds.
    expect(titles(ACTIONS, "wait")).toEqual(["Sleep"]);
  });

  test("finds nothing for an empty search, which is the browse view's job", () => {
    const outcome: ComponentSearchOutcome = searchComponents(ACTIONS, "   ");

    expect(outcome.tokens).toEqual([]);
    expect(outcome.results).toEqual([]);
  });

  test("searches only the picker's own kind of step", () => {
    expect(titles(ACTIONS, "on create incident")).not.toContain(
      "On Create Incident",
    );
    expect(titles(TRIGGERS, "create incident")).not.toContain(
      "Create One Incident",
    );
    expect(titles(TRIGGERS, "create incident")[0]).toBe("On Create Incident");
  });
});

describe("the resource named comes first", () => {
  test("'incident' lists Incident's steps before Incident State's, although Incident State is registered first", () => {
    const results: Array<ComponentSearchResult> = search(ACTIONS, "incident");
    const first: Array<string> = results
      .slice(0, 8)
      .map((result: ComponentSearchResult): string => {
        return result.component.title;
      });

    // The order the old picker drew its groups in: model by model, as registered.
    const registered: Array<string> = palette.categories.map(
      (category: { name: string }): string => {
        return category.name;
      },
    );
    expect(registered.indexOf("Incident State")).toBeLessThan(
      registered.indexOf("Incident"),
    );

    expect(first).toEqual(INCIDENT_ACTIONS);
    expect(resultFor(results, "Create One Incident").tier).toBe(
      SearchTier.Named,
    );
    expect(resultFor(results, "Create One Incident State").tier).toBe(
      SearchTier.Related,
    );
  });

  test("'create incident' puts Create One Incident first", () => {
    const results: Array<string> = titles(ACTIONS, "create incident");

    expect(results.slice(0, 2)).toEqual([
      "Create One Incident",
      "Create Many Incidents",
    ]);
    expect(results.indexOf("Create One Incident State")).toBeGreaterThan(1);
    expect(results).not.toContain("Find One Incident");
  });

  test("'incident state' puts Incident State first, and its timeline after", () => {
    const results: Array<string> = titles(ACTIONS, "incident state");

    expect(results.slice(0, 8)).toEqual([
      "Create One Incident State",
      "Create Many Incident States",
      "Find One Incident State",
      "Find Many Incident States",
      "Update One Incident State",
      "Update Many Incident States",
      "Delete One Incident State",
      "Delete Many Incident States",
    ]);
    expect(results).toContain("Create One Incident Episode State Timeline");
    expect(results).not.toContain("Create One Incident");
  });

  test("a closer resource ranks above a further one: Incident Feed before Incident Episode State Timeline", () => {
    const results: Array<string> = titles(ACTIONS, "incident");

    expect(results.indexOf("Find One Incident Feed")).toBeLessThan(
      results.indexOf("Find One Incident Episode State Timeline"),
    );
  });

  test("the common resources come before the others at the same distance", () => {
    const results: Array<string> = titles(ACTIONS, "incident");

    // Incident Episode and the notes are common, Incident Feed is not.
    expect(results.indexOf("Find One Incident Episode")).toBeLessThan(
      results.indexOf("Find One Incident Feed"),
    );
    expect(results.indexOf("Find One Incident Public Note")).toBeLessThan(
      results.indexOf("Find One Incident Note Template"),
    );
  });

  test("a word typed so far names the resource it starts: 'inc', 'create inc'", () => {
    expect(titles(ACTIONS, "inc").slice(0, 8)).toEqual(INCIDENT_ACTIONS);
    expect(titles(ACTIONS, "create inc")[0]).toBe("Create One Incident");
  });

  test("a plural typed prefers the steps that act on many", () => {
    const results: Array<string> = titles(ACTIONS, "incidents");

    expect(results.slice(0, 8).sort()).toEqual([...INCIDENT_ACTIONS].sort());
    expect(results.indexOf("Find Many Incidents")).toBeLessThan(
      results.indexOf("Find One Incident"),
    );
    expect(titles(ACTIONS, "find all incidents")[0]).toBe(
      "Find Many Incidents",
    );
  });

  test("a plural's last letter does not run on into the next word of a name", () => {
    /*
     * "incidents" is the start of "incidentseverity" and "incidentstate",
     * the run-together names of Incident Severity and Incident State. That
     * must not make "incidents" a search for either.
     */
    const results: Array<ComponentSearchResult> = search(
      ACTIONS,
      "find all incidents",
    );

    expect(resultFor(results, "Find Many Incident Severities").tier).toBe(
      SearchTier.Related,
    );
    expect(resultFor(results, "Find Many Incident States").tier).toBe(
      SearchTier.Related,
    );
    expect(resultFor(results, "Find Many Incidents").tier).toBe(
      SearchTier.Named,
    );
  });

  test("a name run together or by its initials still names the resource", () => {
    expect(titles(ACTIONS, "oncall")[0]).toBe("Create One On-Call Policy");
    expect(titles(ACTIONS, "on-call")[0]).toBe("Create One On-Call Policy");
    expect(titles(ACTIONS, "slo")[0]).toBe(
      "Create One Service Level Objective",
    );
  });

  test("initials only match when typed in full: 'if' is not the start of IoT Fleet Label Rule's", () => {
    expect(titles(ACTIONS, "if")).toEqual(["If / Else"]);
    expect(titles(ACTIONS, "iflr")[0]).toBe("Create One IoT Fleet Label Rule");
  });

  test("two resources with the same name are both found", () => {
    const results: Array<ComponentSearchResult> = search(
      ACTIONS,
      "subscriber notification template",
    );

    expect(
      new Set(
        results.map((result: ComponentSearchResult): string | undefined => {
          return result.component.tableName;
        }),
      ),
    ).toEqual(
      new Set([
        "StatusPageSubscriberNotificationTemplate",
        "StatusPageSubscriberNotificationTemplateStatusPage",
      ]),
    );
    expect(results).toHaveLength(16);
  });
});

describe("hand-written steps and resources together", () => {
  test("'teams' means the Microsoft Teams message before OneUptime's Team records", () => {
    const results: Array<string> = titles(ACTIONS, "teams");

    expect(results[0]).toBe("Send Message to Teams");
    expect(results).toContain("Find Many Teams");
  });

  test("'email' means Send Email before the Email Log records", () => {
    expect(titles(ACTIONS, "email")).toEqual([
      "Send Email",
      "Create One Email Log",
      "Create Many Email Logs",
    ]);
  });

  test("a search that is a step's whole title puts that step first", () => {
    const results: Array<ComponentSearchResult> = search(ACTIONS, "log");

    expect(results[0]!.component.title).toBe("Log");
    expect(results[0]!.tier).toBe(SearchTier.ExactTitle);
    expect(search(ACTIONS, "if else")[0]!.component.title).toBe("If / Else");
    expect(search(ACTIONS, "If/Else")[0]!.tier).toBe(SearchTier.ExactTitle);
  });

  test("'json' means the JSON steps before the API steps that speak it", () => {
    const results: Array<string> = titles(ACTIONS, "json");

    expect(results.slice(0, 3).sort()).toEqual([
      "JSON to Text",
      "Merge JSON",
      "Text to JSON",
    ]);
    expect(results).toContain("API Post (JSON)");
  });

  test("the words people use for a step find it", () => {
    expect(titles(ACTIONS, "http request").slice(0, 2).sort()).toEqual([
      "API Get (JSON)",
      "API Post (JSON)",
    ]);
    expect(titles(ACTIONS, "send a webhook")[0]).toBe("API Post (JSON)");
    expect(titles(ACTIONS, "send slack message")[0]).toBe(
      "Send Message to Slack",
    );
    expect(titles(ACTIONS, "irc")[0]).toBe("Send Message to IRC");
    expect(titles(ACTIONS, "internet relay chat")[0]).toBe(
      "Send Message to IRC",
    );
    expect(titles(ACTIONS, "send to libera chat")[0]).toBe(
      "Send Message to IRC",
    );
    expect(titles(ACTIONS, "oftc")).toEqual(["Send Message to IRC"]);
    expect(titles(ACTIONS, "send irc message")[0]).toBe("Send Message to IRC");
    expect(titles(ACTIONS, "resolve incident")[0]).toBe("Update One Incident");
    expect(titles(ACTIONS, "open an incident")[0]).toBe("Create One Incident");

    const note: Array<string> = titles(ACTIONS, "add note to incident");

    expect(note.slice(0, 4).sort()).toEqual([
      "Create Many Incident Internal Notes",
      "Create Many Incident Public Notes",
      "Create One Incident Internal Note",
      "Create One Incident Public Note",
    ]);
  });

  test("the words people use for a trigger find it", () => {
    expect(titles(TRIGGERS, "when an incident is created")[0]).toBe(
      "On Create Incident",
    );
    expect(titles(TRIGGERS, "incident resolved")[0]).toBe("On Update Incident");
    expect(titles(TRIGGERS, "cron")).toEqual(["Schedule"]);
    expect(titles(TRIGGERS, "every hour")).toEqual(["Schedule"]);
    expect(titles(TRIGGERS, "webhook")[0]).toBe("Webhook");
    expect(titles(TRIGGERS, "incident").slice(0, 3)).toEqual([
      "On Create Incident",
      "On Update Incident",
      "On Delete Incident",
    ]);
  });
});

describe("typos", () => {
  test("a misspelt word is read as the word it nearly is", () => {
    const outcome: ComponentSearchOutcome = searchComponents(
      ACTIONS,
      "incidnet",
    );

    expect(outcome.typoTokens).toEqual(["incidnet"]);
    expect(
      outcome.results
        .slice(0, 8)
        .map((result: ComponentSearchResult): string => {
          return result.component.title;
        }),
    ).toEqual(INCIDENT_ACTIONS);
    expect(titles(ACTIONS, "cretae incidnet")[0]).toBe("Create One Incident");
    expect(titles(ACTIONS, "slakc")).toEqual(["Send Message to Slack"]);
    expect(titles(ACTIONS, "monitr")[0]).toBe("Create One Monitor");
  });

  test("a word that matches as typed is never read as a typo", () => {
    const index: ComponentSearchIndex = buildComponentSearchIndex(
      buildPickerCatalog({
        components: [
          {
            id: "post-message",
            title: "Post Message",
            description: "Posts a message",
            category: "Utils",
            iconProp: IconProp.Bolt,
            componentType: ComponentType.Component,
            arguments: [],
            returnValues: [],
            inPorts: [],
            outPorts: [],
          },
          {
            id: "host-check",
            title: "Host Check",
            description: "Checks a server",
            category: "Utils",
            iconProp: IconProp.Bolt,
            componentType: ComponentType.Component,
            arguments: [],
            returnValues: [],
            inPorts: [],
            outPorts: [],
          },
        ],
        categories: [],
        componentsType: ComponentType.Component,
      }),
    );

    const exact: ComponentSearchOutcome = searchComponents(index, "host");
    expect(exact.typoTokens).toEqual([]);
    expect(
      exact.results.map((result: ComponentSearchResult): string => {
        return result.component.title;
      }),
    ).toEqual(["Host Check"]);

    const typo: ComponentSearchOutcome = searchComponents(index, "hots");
    expect(typo.typoTokens).toEqual(["hots"]);
    expect(
      typo.results.map((result: ComponentSearchResult): string => {
        return result.component.title;
      }),
    ).toEqual(["Host Check"]);
  });
});

describe("what a result marks in its title", () => {
  test("marks a whole word named, in its own capitals", () => {
    expect(
      getHighlightSegments("Create One Incident", ["create", "incident"]),
    ).toEqual([
      { text: "Create", isMatch: true },
      { text: " One ", isMatch: false },
      { text: "Incident", isMatch: true },
    ]);
    expect(
      marked(getHighlightSegments("Create Many Incidents", ["incident"])),
    ).toEqual(["Incidents"]);
  });

  test("marks only what has been typed of a longer word, or the letters inside one", () => {
    expect(
      marked(getHighlightSegments("Create One Incident", ["inc"])),
    ).toEqual(["Inc"]);
    expect(
      marked(getHighlightSegments("Run Custom JavaScript", ["script"])),
    ).toEqual(["Script"]);
  });

  test("marks the word a typo was read as, and only when the search read it that way", () => {
    expect(
      marked(
        getHighlightSegments("Create One Incident", ["incidnet"], ["incidnet"]),
      ),
    ).toEqual(["Incident"]);
    expect(
      marked(getHighlightSegments("Create One Incident", ["incidnet"])),
    ).toEqual([]);
  });

  test("never marks punctuation, and reads no search as a pattern", () => {
    expect(marked(getHighlightSegments("If / Else", ["if", "else"]))).toEqual([
      "If",
      "Else",
    ]);
    expect(() => {
      return getHighlightSegments("Literal . (operation) *", [
        ".",
        "(",
        "*",
        "[",
      ]);
    }).not.toThrow();
    expect(
      marked(getHighlightSegments("Literal . (operation) *", ["operation"])),
    ).toEqual(["operation"]);
  });

  test("marks nothing when nothing was searched", () => {
    expect(getHighlightSegments("Log", [])).toEqual([
      { text: "Log", isMatch: false },
    ]);
  });
});

describe("the index", () => {
  test("is built once per catalog", () => {
    const catalog: PickerCatalog = buildPickerCatalog({
      components: palette.components,
      categories: palette.categories,
      componentsType: ComponentType.Component,
    });

    expect(getComponentSearchIndex(catalog)).toBe(
      getComponentSearchIndex(catalog),
    );
  });

  test("holds every step of its kind, and none of the other", () => {
    const actions: number = palette.components.filter(
      (componentMetadata: ComponentMetadata): boolean => {
        return componentMetadata.componentType === ComponentType.Component;
      },
    ).length;

    expect(ACTIONS.entries).toHaveLength(actions);
    expect(TRIGGERS.entries).toHaveLength(palette.components.length - actions);
  });
});
