/*
 * The picker's list: every source's groups merged into one, searched by what
 * a person would type, and read in the order the arrow keys walk it.
 *
 * Sources are pluggable - a later one (values from the last run of a
 * webhook, say) adds to the groups the steps source made - so merging is
 * what keeps one value from appearing twice.
 */

import {
  FlatSuggestion,
  ValueSuggestion,
  ValueSuggestionGroup,
  ValueSuggestionGroupKind,
  allowsPathInto,
  appendPathToReference,
  dedupeSuggestions,
  filterSuggestionGroups,
  flattenSuggestionGroups,
  mergeSuggestionGroups,
  suggestionMatches,
  typeLabelForInputType,
} from "../../../../../UI/Components/Workflow/ValuePicker/ValueSuggestion";
import { ComponentInputType } from "../../../../../Types/Workflow/Component";
import { describe, expect, test } from "@jest/globals";

const BODY: string = "{{local.components.webhook-1.returnValues.request-body}}";
const HEADERS: string =
  "{{local.components.webhook-1.returnValues.request-headers}}";

type GroupFunction = (
  id: string,
  items: Array<ValueSuggestion>,
  order?: number,
) => ValueSuggestionGroup;

const group: GroupFunction = (
  id: string,
  items: Array<ValueSuggestion>,
  order: number = 0,
): ValueSuggestionGroup => {
  return {
    id: id,
    kind: ValueSuggestionGroupKind.Step,
    title: "Webhook",
    subtitle: "webhook-1",
    order: order,
    items: items,
  };
};

describe("typeLabelForInputType", () => {
  test("says what shape a value is in plain words", () => {
    expect(typeLabelForInputType(ComponentInputType.Text)).toBe("Text");
    expect(typeLabelForInputType(ComponentInputType.LongText)).toBe("Text");
    expect(typeLabelForInputType(ComponentInputType.Number)).toBe("Number");
    expect(typeLabelForInputType(ComponentInputType.Decimal)).toBe("Number");
    expect(typeLabelForInputType(ComponentInputType.Boolean)).toBe("Yes / No");
    expect(typeLabelForInputType(ComponentInputType.JSON)).toBe("JSON");
    expect(typeLabelForInputType(ComponentInputType.StringDictionary)).toBe(
      "Key / value",
    );
    expect(typeLabelForInputType(ComponentInputType.BaseModel)).toBe("Record");
    expect(typeLabelForInputType(ComponentInputType.BaseModelArray)).toBe(
      "Records",
    );
    expect(typeLabelForInputType(undefined)).toBeUndefined();
  });

  test("never shows the input type's code name", () => {
    for (const type of Object.values(ComponentInputType)) {
      const label: string | undefined = typeLabelForInputType(type);

      expect(label).not.toBe("Database Record");
      expect(label).not.toBe("Dictionary of String");
    }
  });
});

describe("allowsPathInto", () => {
  test("values with no fixed shape can be opened to a typed path", () => {
    expect(allowsPathInto(ComponentInputType.JSON)).toBe(true);
    expect(allowsPathInto(ComponentInputType.StringDictionary)).toBe(true);
    expect(allowsPathInto(ComponentInputType.JSONArray)).toBe(true);
    expect(allowsPathInto(ComponentInputType.BaseModel)).toBe(true);
    expect(allowsPathInto(ComponentInputType.Text)).toBe(false);
    expect(allowsPathInto(ComponentInputType.Number)).toBe(false);
  });
});

describe("appendPathToReference", () => {
  test("a field inside the value", () => {
    expect(appendPathToReference(BODY, "title")).toBe(
      "{{local.components.webhook-1.returnValues.request-body.title}}",
    );
  });

  test("a nested field and a list item", () => {
    expect(appendPathToReference(BODY, "alerts[0].labels.alertname")).toBe(
      "{{local.components.webhook-1.returnValues.request-body.alerts[0].labels.alertname}}",
    );
    expect(appendPathToReference(BODY, "[0].name")).toBe(
      "{{local.components.webhook-1.returnValues.request-body[0].name}}",
    );
    expect(appendPathToReference(BODY, "[last]")).toBe(
      "{{local.components.webhook-1.returnValues.request-body[last]}}",
    );
  });

  test("a header name with dashes", () => {
    expect(appendPathToReference(HEADERS, "x-api-key")).toBe(
      "{{local.components.webhook-1.returnValues.request-headers.x-api-key}}",
    );
  });

  test("spaces around it and a leading dot are forgiven", () => {
    expect(appendPathToReference(BODY, "  .title  ")).toBe(
      "{{local.components.webhook-1.returnValues.request-body.title}}",
    );
  });

  test("a path the runtime could not follow is refused, not mangled", () => {
    expect(appendPathToReference(BODY, "")).toBeNull();
    expect(appendPathToReference(BODY, "   ")).toBeNull();
    expect(appendPathToReference(BODY, "a b")).toBeNull();
    expect(appendPathToReference(BODY, "title}}")).toBeNull();
    expect(appendPathToReference(BODY, "a..b")).toBeNull();
    expect(appendPathToReference(BODY, "items[x]")).toBeNull();
    expect(appendPathToReference("not a reference", "title")).toBeNull();
  });
});

describe("mergeSuggestionGroups", () => {
  test("groups with the same id become one, keeping each value once", () => {
    const merged: Array<ValueSuggestionGroup> = mergeSuggestionGroups([
      group("step:webhook-1", [
        { reference: BODY, label: "Request Body", typeLabel: "JSON" },
      ]),
      group("step:webhook-1", [
        // Another source offering the same value, and a new one.
        { reference: BODY, label: "Body (from the last run)" },
        { reference: HEADERS, label: "Request Headers" },
      ]),
    ]);

    expect(merged).toHaveLength(1);
    expect(
      merged[0]!.items.map((item: ValueSuggestion) => {
        return item.label;
      }),
    ).toEqual(["Request Body", "Request Headers"]);
  });

  test("groups come in order, and an empty one is dropped", () => {
    const merged: Array<ValueSuggestionGroup> = mergeSuggestionGroups([
      group(
        "variables",
        [{ reference: "{{local.variables.a}}", label: "a" }],
        1000,
      ),
      group("empty", [], 5),
      group("step:webhook-1", [{ reference: BODY, label: "Request Body" }], 0),
    ]);

    expect(
      merged.map((item: ValueSuggestionGroup) => {
        return item.id;
      }),
    ).toEqual(["step:webhook-1", "variables"]);
  });

  test("a second source's way into a value is added to the first's", async () => {
    const merged: Array<ValueSuggestion> = dedupeSuggestions([
      {
        reference: BODY,
        label: "Request Body",
        drillIn: {
          wholeValueLabel: "The whole Request Body",
          allowsPath: true,
        },
      },
      {
        reference: BODY,
        label: "ignored",
        badges: ["From the last run"],
        drillIn: {
          wholeValueLabel: "ignored",
          allowsPath: false,
          loadChildren: async () => {
            return [
              { reference: `${BODY.slice(0, -2)}.title}}`, label: "title" },
            ];
          },
        },
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.label).toBe("Request Body");
    expect(merged[0]!.badges).toEqual(["From the last run"]);
    expect(merged[0]!.drillIn?.wholeValueLabel).toBe("The whole Request Body");
    expect(merged[0]!.drillIn?.allowsPath).toBe(true);

    const children: Array<ValueSuggestion> =
      await merged[0]!.drillIn!.loadChildren!();

    expect(children).toEqual([
      {
        reference:
          "{{local.components.webhook-1.returnValues.request-body.title}}",
        label: "title",
      },
    ]);
  });

  test("when both sources load children, either failing still leaves the other's", async () => {
    const merged: Array<ValueSuggestion> = dedupeSuggestions([
      {
        reference: BODY,
        label: "Request Body",
        drillIn: {
          wholeValueLabel: "The whole Request Body",
          allowsPath: true,
          loadChildren: async () => {
            throw new Error("offline");
          },
        },
      },
      {
        reference: BODY,
        label: "Request Body",
        drillIn: {
          wholeValueLabel: "",
          allowsPath: true,
          loadChildren: async () => {
            return [{ reference: "{{a.b.c.d.e.f}}", label: "f" }];
          },
        },
      },
    ]);

    await expect(merged[0]!.drillIn!.loadChildren!()).resolves.toEqual([
      { reference: "{{a.b.c.d.e.f}}", label: "f" },
    ]);
  });

  test("when every loader fails, the failure is reported", async () => {
    const merged: Array<ValueSuggestion> = dedupeSuggestions([
      {
        reference: BODY,
        label: "Request Body",
        drillIn: {
          wholeValueLabel: "x",
          allowsPath: true,
          loadChildren: async () => {
            throw new Error("offline");
          },
        },
      },
      {
        reference: BODY,
        label: "Request Body",
        drillIn: {
          wholeValueLabel: "x",
          allowsPath: true,
          loadChildren: async () => {
            throw new Error("still offline");
          },
        },
      },
    ]);

    await expect(merged[0]!.drillIn!.loadChildren!()).rejects.toThrow(
      "offline",
    );
  });
});

describe("searching", () => {
  const groups: Array<ValueSuggestionGroup> = [
    group("step:webhook-1", [
      {
        reference: BODY,
        label: "Request Body",
        description: "What the request sent.",
        typeLabel: "JSON",
      },
      {
        reference: HEADERS,
        label: "Request Headers",
        typeLabel: "Key / value",
      },
    ]),
    {
      id: "variables:workflow",
      kind: ValueSuggestionGroupKind.WorkflowVariables,
      title: "Workflow variables",
      order: 1000,
      items: [
        {
          reference: "{{local.variables.DEPLOY_ENV}}",
          label: "DEPLOY_ENV",
          badges: ["Secret"],
        },
      ],
    },
  ];

  test("by the value's name, ignoring case", () => {
    expect(
      flattenSuggestionGroups(filterSuggestionGroups(groups, "body")).map(
        (flat: FlatSuggestion) => {
          return flat.item.label;
        },
      ),
    ).toEqual(["Request Body"]);
  });

  test("every word has to match, anywhere: the step's name counts", () => {
    expect(
      flattenSuggestionGroups(
        filterSuggestionGroups(groups, "webhook headers"),
      ).map((flat: FlatSuggestion) => {
        return flat.item.label;
      }),
    ).toEqual(["Request Headers"]);
  });

  test("by the reference someone half remembers", () => {
    expect(
      flattenSuggestionGroups(
        filterSuggestionGroups(groups, "local.variables"),
      ).map((flat: FlatSuggestion) => {
        return flat.item.label;
      }),
    ).toEqual(["DEPLOY_ENV"]);
  });

  test("by a badge, a type or the description", () => {
    expect(suggestionMatches(groups[1]!.items[0]!, groups[1]!, "secret")).toBe(
      true,
    );
    expect(suggestionMatches(groups[0]!.items[0]!, groups[0]!, "json")).toBe(
      true,
    );
    expect(suggestionMatches(groups[0]!.items[0]!, groups[0]!, "sent")).toBe(
      true,
    );
  });

  test("a group with nothing that matches is left out", () => {
    const filtered: Array<ValueSuggestionGroup> = filterSuggestionGroups(
      groups,
      "DEPLOY",
    );

    expect(
      filtered.map((item: ValueSuggestionGroup) => {
        return item.id;
      }),
    ).toEqual(["variables:workflow"]);
  });

  test("nothing typed lists everything, in the order the arrow keys walk it", () => {
    expect(
      flattenSuggestionGroups(filterSuggestionGroups(groups, "  ")).map(
        (flat: FlatSuggestion) => {
          return flat.item.label;
        },
      ),
    ).toEqual(["Request Body", "Request Headers", "DEPLOY_ENV"]);
  });

  test("nothing matching lists nothing", () => {
    expect(filterSuggestionGroups(groups, "zzz")).toEqual([]);
  });
});
