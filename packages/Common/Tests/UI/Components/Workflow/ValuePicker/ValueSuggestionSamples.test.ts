/*
 * The list rules that values from earlier runs brought with them:
 * - a field deep inside a value is found by a search that names it, and is
 *   not in the way otherwise;
 * - a sample is added to a value another source lists, and an annotation of
 *   a value nobody lists is dropped;
 * - a group's note, and the line above a value's fields, survive a merge.
 */

import {
  MAX_SEARCH_ONLY_RESULTS_PER_GROUP,
  ValueDrillIn,
  ValueSuggestion,
  ValueSuggestionGroup,
  ValueSuggestionGroupKind,
  dedupeSuggestions,
  filterSuggestionGroups,
  isListedForQuery,
  mergeSuggestionGroups,
  suggestionMatches,
} from "../../../../../UI/Components/Workflow/ValuePicker/ValueSuggestion";
import { describe, expect, test } from "@jest/globals";

const BODY: string = "{{local.components.webhook-1.returnValues.request-body}}";
const TITLE: string =
  "{{local.components.webhook-1.returnValues.request-body.incident.title}}";
const ENVIRONMENT: string =
  "{{local.components.webhook-1.returnValues.request-body.environment}}";

const BODY_ITEM: ValueSuggestion = {
  reference: BODY,
  label: "Request Body",
  description: "The body the caller sent.",
  typeLabel: "JSON",
  sample: "2 fields",
};

const TITLE_FIELD: ValueSuggestion = {
  reference: TITLE,
  label: "Request Body › incident.title",
  typeLabel: "Text",
  sample: "Database is down",
  searchOnly: { context: ["Request Body", BODY] },
};

const ENVIRONMENT_FIELD: ValueSuggestion = {
  reference: ENVIRONMENT,
  label: "Request Body › environment",
  typeLabel: "Text",
  sample: "production",
  searchOnly: { context: ["Request Body", BODY] },
};

const WEBHOOK_GROUP: ValueSuggestionGroup = {
  id: "step:webhook-1",
  kind: ValueSuggestionGroupKind.Step,
  title: "Webhook",
  subtitle: "webhook-1",
  order: 0,
  items: [BODY_ITEM, TITLE_FIELD, ENVIRONMENT_FIELD],
};

type ListedFunction = (query: string) => Array<string>;

const listed: ListedFunction = (query: string): Array<string> => {
  return filterSuggestionGroups([WEBHOOK_GROUP], query).flatMap(
    (group: ValueSuggestionGroup) => {
      return group.items.map((item: ValueSuggestion) => {
        return item.label;
      });
    },
  );
};

describe("a field only a search lists", () => {
  test("is not in the list being browsed", () => {
    expect(listed("")).toEqual(["Request Body"]);
    expect(listed("   ")).toEqual(["Request Body"]);
  });

  test("is listed by a word that names it", () => {
    expect(listed("title")).toEqual(["Request Body › incident.title"]);
    expect(listed("incident")).toEqual(["Request Body › incident.title"]);
  });

  test("is listed by what it held", () => {
    expect(listed("production")).toEqual(["Request Body › environment"]);
  });

  test("is not listed by its step's name or the value it is in alone: that finds the value", () => {
    expect(listed("webhook")).toEqual(["Request Body"]);
    expect(listed("body")).toEqual(["Request Body"]);
    expect(listed("request body")).toEqual(["Request Body"]);
  });

  test("is listed by those words with one about the field", () => {
    expect(listed("webhook title")).toEqual(["Request Body › incident.title"]);
    expect(listed("body environment")).toEqual(["Request Body › environment"]);
  });

  test("a reference typed after {{ finds the value, then its fields after the dot", () => {
    const valuePath: string =
      "local.components.webhook-1.returnValues.request-body";

    expect(listed(valuePath)).toEqual(["Request Body"]);
    expect(listed(`${valuePath}.`)).toEqual([
      "Request Body › incident.title",
      "Request Body › environment",
    ]);
    expect(listed(`${valuePath}.inc`)).toEqual([
      "Request Body › incident.title",
    ]);
  });

  test("a hidden sample is never searched", () => {
    const hidden: ValueSuggestion = {
      ...ENVIRONMENT_FIELD,
      sample: "s3cr3t",
      isSampleHidden: true,
    };

    expect(suggestionMatches(hidden, WEBHOOK_GROUP, "s3cr3t")).toBe(false);
    expect(isListedForQuery(hidden, WEBHOOK_GROUP, "s3cr3t")).toBe(false);
  });

  test(`at most ${MAX_SEARCH_ONLY_RESULTS_PER_GROUP} of one group's fields are listed for one search`, () => {
    const many: Array<ValueSuggestion> = [];

    for (let index: number = 0; index < 80; index++) {
      many.push({
        reference: `{{local.components.webhook-1.returnValues.request-body.field${index}}}`,
        label: `Request Body › field${index}`,
        searchOnly: { context: ["Request Body", BODY] },
      });
    }

    const groups: Array<ValueSuggestionGroup> = filterSuggestionGroups(
      [{ ...WEBHOOK_GROUP, items: [BODY_ITEM, ...many] }],
      "field",
    );
    const fields: Array<ValueSuggestion> = (groups[0]?.items || []).filter(
      (item: ValueSuggestion) => {
        return Boolean(item.searchOnly);
      },
    );

    expect(fields).toHaveLength(MAX_SEARCH_ONLY_RESULTS_PER_GROUP);
    expect(fields[0]?.label).toBe("Request Body › field0");
    // The body itself ("2 fields") is no field, and is not held to the cap.
    expect(groups[0]?.items[0]?.reference).toBe(BODY);
  });

  test("an ordinary item is listed exactly as before", () => {
    expect(isListedForQuery(BODY_ITEM, WEBHOOK_GROUP, "webhook")).toBe(true);
    expect(isListedForQuery(BODY_ITEM, WEBHOOK_GROUP, "")).toBe(true);
    expect(isListedForQuery(BODY_ITEM, WEBHOOK_GROUP, "nothing")).toBe(false);
  });

  test("a sample is searched like the rest of what an item says", () => {
    expect(suggestionMatches(BODY_ITEM, WEBHOOK_GROUP, "2 fields")).toBe(true);
  });
});

describe("dedupeSuggestions with samples", () => {
  test("a second source adds the sample the first did not have", () => {
    const merged: Array<ValueSuggestion> = dedupeSuggestions([
      { reference: BODY, label: "Request Body", typeLabel: "JSON" },
      { reference: BODY, label: "ignored", sample: "2 fields" },
    ]);

    expect(merged).toEqual([
      {
        reference: BODY,
        label: "Request Body",
        typeLabel: "JSON",
        sample: "2 fields",
      },
    ]);
  });

  test("the first source to say what it held, or that it is hidden, says it", () => {
    expect(
      dedupeSuggestions([
        { reference: BODY, label: "A", isSampleHidden: true },
        { reference: BODY, label: "B", sample: "visible" },
      ])[0],
    ).toEqual({ reference: BODY, label: "A", isSampleHidden: true });

    expect(
      dedupeSuggestions([
        { reference: BODY, label: "A", sample: "first" },
        { reference: BODY, label: "B", sample: "second" },
      ])[0]?.sample,
    ).toBe("first");
  });

  test("an annotation names nothing: it adds to an item that is listed, wherever it comes", () => {
    const merged: Array<ValueSuggestion> = dedupeSuggestions([
      { reference: TITLE, label: "title", sample: "Down", annotatesOnly: true },
      { reference: TITLE, label: "Title", typeLabel: "Text" },
    ]);

    expect(merged).toEqual([
      { reference: TITLE, label: "Title", typeLabel: "Text", sample: "Down" },
    ]);
  });

  test("an annotation of a value nobody lists is dropped", () => {
    expect(
      dedupeSuggestions([
        { reference: TITLE, label: "Title" },
        {
          reference: ENVIRONMENT,
          label: "environment",
          sample: "production",
          annotatesOnly: true,
        },
      ]).map((item: ValueSuggestion) => {
        return item.reference;
      }),
    ).toEqual([TITLE]);
  });

  test("an item listed by any source is listed when browsing", () => {
    expect(
      dedupeSuggestions([
        TITLE_FIELD,
        { reference: TITLE, label: "incident.title" },
      ])[0]?.searchOnly,
    ).toBeUndefined();

    expect(
      dedupeSuggestions([TITLE_FIELD, { ...TITLE_FIELD, label: "x" }])[0]
        ?.searchOnly,
    ).toEqual({ context: ["Request Body", BODY] });
  });
});

describe("mergeSuggestionGroups with notes", () => {
  test("a group keeps the note one source gave it", () => {
    const merged: Array<ValueSuggestionGroup> = mergeSuggestionGroups([
      { ...WEBHOOK_GROUP, items: [BODY_ITEM] },
      {
        ...WEBHOOK_GROUP,
        items: [],
        note: { text: "No request yet.", refreshSourceId: "step-samples" },
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.note?.text).toBe("No request yet.");
  });

  test("a group with only fields a search lists is not a group to browse", () => {
    expect(
      mergeSuggestionGroups([
        { ...WEBHOOK_GROUP, items: [TITLE_FIELD, ENVIRONMENT_FIELD] },
      ]),
    ).toEqual([]);
  });
});

describe("opening a value two sources know about", () => {
  type MergedDrillInFunction = (
    first: ValueDrillIn,
    second: ValueDrillIn,
  ) => ValueDrillIn | undefined;

  const mergedDrillIn: MergedDrillInFunction = (
    first: ValueDrillIn,
    second: ValueDrillIn,
  ): ValueDrillIn | undefined => {
    return dedupeSuggestions([
      { reference: BODY, label: "Request Body", drillIn: first },
      { reference: BODY, label: "Request Body", drillIn: second },
    ])[0]?.drillIn;
  };

  test("keeps the line above the fields from whichever has one", () => {
    expect(
      mergedDrillIn(
        { wholeValueLabel: "The whole Request Body", allowsPath: true },
        {
          wholeValueLabel: "ignored",
          allowsPath: true,
          note: "From the request received 5 minutes ago.",
        },
      )?.note,
    ).toBe("From the request received 5 minutes ago.");
  });

  test("the model's fields, with the run's samples added", async () => {
    const drillIn: ValueDrillIn | undefined = mergedDrillIn(
      {
        wholeValueLabel: "The whole Incident",
        allowsPath: true,
        loadChildren: async (): Promise<Array<ValueSuggestion>> => {
          return [{ reference: TITLE, label: "Title", typeLabel: "Text" }];
        },
      },
      {
        wholeValueLabel: "ignored",
        allowsPath: true,
        loadChildren: async (): Promise<Array<ValueSuggestion>> => {
          return [
            {
              reference: TITLE,
              label: "incident.title",
              sample: "Down",
              annotatesOnly: true,
            },
            {
              reference: ENVIRONMENT,
              label: "not a column",
              sample: "x",
              annotatesOnly: true,
            },
          ];
        },
      },
    );

    expect(await drillIn!.loadChildren!()).toEqual([
      { reference: TITLE, label: "Title", typeLabel: "Text", sample: "Down" },
    ]);
  });

  test("when the model's fields fail to load and only samples are left, the failure is the answer", async () => {
    const drillIn: ValueDrillIn | undefined = mergedDrillIn(
      {
        wholeValueLabel: "The whole Incident",
        allowsPath: true,
        loadChildren: async (): Promise<Array<ValueSuggestion>> => {
          throw new Error("Could not load the Incident's fields");
        },
      },
      {
        wholeValueLabel: "ignored",
        allowsPath: true,
        loadChildren: async (): Promise<Array<ValueSuggestion>> => {
          return [
            {
              reference: TITLE,
              label: "title",
              sample: "Down",
              annotatesOnly: true,
            },
          ];
        },
      },
    );

    await expect(drillIn!.loadChildren!()).rejects.toThrow(
      "Could not load the Incident's fields",
    );
  });
});
