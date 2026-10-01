/*
 * What the value picker offers, and the pure helpers around it.
 *
 * The picker lists values a step can use in a setting: the return values of
 * the steps that run before it, and the workflow's variables. Each comes from
 * a source (see ValueSuggestionSource), and the list is the sources' groups
 * merged together - so a source added later, such as one offering the fields
 * of the last request a webhook actually received, plugs in without the
 * picker changing.
 *
 * Nothing here touches the DOM or the API.
 */

import IconProp from "../../../../Types/Icon/IconProp";
import ObjectID from "../../../../Types/ObjectID";
import {
  ComponentInputType,
  NodeDataProp,
} from "../../../../Types/Workflow/Component";

export enum ValueSuggestionGroupKind {
  /** A step's return values. */
  Step = "Step",
  /** The workflow's own variables. */
  WorkflowVariables = "WorkflowVariables",
  /** Variables shared by every workflow in the project. */
  GlobalVariables = "GlobalVariables",
  /** Anything a later source adds that is neither. */
  Other = "Other",
}

/**
 * How to look inside a value. A record has fields; a JSON document or a set of
 * headers has whatever keys it arrives with, so a path into it can be typed.
 */
export interface ValueDrillIn {
  /** Names the whole value at the top of the list, e.g. "The whole Incident". */
  wholeValueLabel: string;
  /** The values inside it, when they can be known: a record's fields. */
  loadChildren?: (() => Promise<Array<ValueSuggestion>>) | undefined;
  /** Whether a path inside it can be typed, for values with no known shape. */
  allowsPath: boolean;
  /** An example path for the box, e.g. "title or alerts[0].status". */
  pathPlaceholder?: string | undefined;
}

export interface ValueSuggestion {
  /** What the picker inserts: a {{...}} reference. Unique within the list. */
  reference: string;
  /** The value's own name, e.g. "Request Body". */
  label: string;
  /** One line about it, shown under the name. */
  description?: string | undefined;
  /** The shape of the value in a word: Text, Number, JSON, Record... */
  typeLabel?: string | undefined;
  /** Short facts worth a badge, e.g. "Secret". */
  badges?: Array<string> | undefined;
  drillIn?: ValueDrillIn | undefined;
}

export interface ValueSuggestionGroup {
  /** Groups with the same id are merged, from whichever sources add to them. */
  id: string;
  kind: ValueSuggestionGroupKind;
  /** e.g. the step's title, "Webhook". */
  title: string;
  /** e.g. the step's id, "webhook-1". */
  subtitle?: string | undefined;
  iconProp?: IconProp | undefined;
  /** Lower comes first. */
  order: number;
  items: Array<ValueSuggestion>;
}

/** What a source knows about the step whose settings are being edited. */
export interface ValueSuggestionContext {
  workflowId?: ObjectID | undefined;
  /** The step being edited. */
  component?: NodeDataProp | undefined;
  /** The steps it can read from, in run order (see StepGraph). */
  upstreamComponents: Array<NodeDataProp>;
}

/**
 * Somewhere the picker's values come from.
 *
 * getGroups is for what the form already knows (the steps upstream);
 * loadGroups for what needs a request (variables, data from earlier runs),
 * and runs the first time the picker opens. A source may add items to a
 * group another source made - give the group the same id.
 */
export interface ValueSuggestionSource {
  id: string;
  getGroups?:
    | ((context: ValueSuggestionContext) => Array<ValueSuggestionGroup>)
    | undefined;
  loadGroups?:
    | ((
        context: ValueSuggestionContext,
      ) => Promise<Array<ValueSuggestionGroup>>)
    | undefined;
}

/*
 * A word for the shape of a value. "Database Record" and "Dictionary of
 * String" are the input types' names in the code, not words anyone building a
 * workflow uses.
 */
const TYPE_LABELS: Partial<Record<ComponentInputType, string>> = {
  [ComponentInputType.Text]: "Text",
  [ComponentInputType.LongText]: "Text",
  [ComponentInputType.Markdown]: "Text",
  [ComponentInputType.HTML]: "HTML",
  [ComponentInputType.Password]: "Text",
  [ComponentInputType.URL]: "URL",
  [ComponentInputType.Email]: "Email",
  [ComponentInputType.Number]: "Number",
  [ComponentInputType.Decimal]: "Number",
  [ComponentInputType.Boolean]: "Yes / No",
  [ComponentInputType.Date]: "Date",
  [ComponentInputType.DateTime]: "Date",
  [ComponentInputType.JSON]: "JSON",
  [ComponentInputType.JSONArray]: "List",
  [ComponentInputType.StringDictionary]: "Key / value",
  [ComponentInputType.BaseModel]: "Record",
  [ComponentInputType.BaseModelArray]: "Records",
  [ComponentInputType.AnyValue]: "Any",
  [ComponentInputType.JavaScript]: "Code",
};

export type TypeLabelForInputTypeFunction = (
  type: ComponentInputType | undefined,
) => string | undefined;

export const typeLabelForInputType: TypeLabelForInputTypeFunction = (
  type: ComponentInputType | undefined,
): string | undefined => {
  if (!type) {
    return undefined;
  }

  return TYPE_LABELS[type];
};

/*
 * Values with no fixed shape: a JSON document, a set of headers, a list.
 * There is no schema to list their insides from, so a path can be typed.
 */
const PATH_TYPES: Array<ComponentInputType> = [
  ComponentInputType.JSON,
  ComponentInputType.JSONArray,
  ComponentInputType.StringDictionary,
  ComponentInputType.AnyValue,
  ComponentInputType.BaseModel,
  ComponentInputType.BaseModelArray,
];

export type AllowsPathFunction = (type: ComponentInputType) => boolean;

export const allowsPathInto: AllowsPathFunction = (
  type: ComponentInputType,
): boolean => {
  return PATH_TYPES.includes(type);
};

/*
 * The characters a path into a value may hold. VMUtil.deepFind splits a path
 * on "." and reads an [index] or [last] off each part. Keys are kept to
 * letters, digits, dashes and underscores - header names, JSON keys - which
 * is also what the linter accepts as a reference without complaint.
 */
const PATH_PATTERN: RegExp =
  /^[A-Za-z0-9_-]+(?:\[(?:\d+|last)\])*(?:\.[A-Za-z0-9_-]+(?:\[(?:\d+|last)\])*)*$/;
const LEADING_INDEX_PATTERN: RegExp = /^(?:\[(?:\d+|last)\])+/;

export type AppendPathFunction = (
  reference: string,
  path: string,
) => string | null;

/**
 * `{{a.b}}` with "title" appended is `{{a.b.title}}`; with "[0].name" it is
 * `{{a.b[0].name}}`. Null when the path is not one the runtime could follow.
 */
export const appendPathToReference: AppendPathFunction = (
  reference: string,
  path: string,
): string | null => {
  const trimmedPath: string = path.trim().replace(/^\.+/, "");

  if (trimmedPath === "") {
    return null;
  }

  if (!reference.startsWith("{{") || !reference.endsWith("}}")) {
    return null;
  }

  const inner: string = reference.slice(2, -2);
  const leadingIndex: string =
    trimmedPath.match(LEADING_INDEX_PATTERN)?.[0] || "";
  const rest: string = trimmedPath.slice(leadingIndex.length).replace(/^\./, "");

  if (rest !== "" && !PATH_PATTERN.test(rest)) {
    return null;
  }

  if (leadingIndex === "" && rest === "") {
    return null;
  }

  return `{{${inner}${leadingIndex}${rest ? `.${rest}` : ""}}}`;
};

type MergeDrillInsFunction = (
  first: ValueDrillIn | undefined,
  second: ValueDrillIn | undefined,
) => ValueDrillIn | undefined;

/*
 * Two sources describing the inside of the same value: keep the first one's
 * words, offer every child either knows about, and allow a typed path if
 * either does.
 */
const mergeDrillIns: MergeDrillInsFunction = (
  first: ValueDrillIn | undefined,
  second: ValueDrillIn | undefined,
): ValueDrillIn | undefined => {
  if (!first) {
    return second;
  }

  if (!second) {
    return first;
  }

  const loaders: Array<() => Promise<Array<ValueSuggestion>>> = [
    first.loadChildren,
    second.loadChildren,
  ].filter(
    (
      loader: (() => Promise<Array<ValueSuggestion>>) | undefined,
    ): loader is () => Promise<Array<ValueSuggestion>> => {
      return Boolean(loader);
    },
  );

  return {
    wholeValueLabel: first.wholeValueLabel,
    allowsPath: first.allowsPath || second.allowsPath,
    pathPlaceholder: first.pathPlaceholder || second.pathPlaceholder,
    loadChildren:
      loaders.length === 0
        ? undefined
        : async (): Promise<Array<ValueSuggestion>> => {
            const settled: Array<PromiseSettledResult<Array<ValueSuggestion>>> =
              await Promise.allSettled(
                loaders.map(
                  (
                    loader: () => Promise<Array<ValueSuggestion>>,
                  ): Promise<Array<ValueSuggestion>> => {
                    return loader();
                  },
                ),
              );

            const fulfilled: Array<Array<ValueSuggestion>> = settled
              .filter(
                (
                  result: PromiseSettledResult<Array<ValueSuggestion>>,
                ): result is PromiseFulfilledResult<Array<ValueSuggestion>> => {
                  return result.status === "fulfilled";
                },
              )
              .map(
                (
                  result: PromiseFulfilledResult<Array<ValueSuggestion>>,
                ): Array<ValueSuggestion> => {
                  return result.value;
                },
              );

            // Every loader failed: say so, rather than showing an empty list.
            if (fulfilled.length === 0 && settled.length > 0) {
              throw (settled[0] as PromiseRejectedResult).reason;
            }

            return dedupeSuggestions(fulfilled.flat());
          },
  };
};

export type DedupeSuggestionsFunction = (
  items: Array<ValueSuggestion>,
) => Array<ValueSuggestion>;

/** One item per reference; the first source to offer it names it. */
export const dedupeSuggestions: DedupeSuggestionsFunction = (
  items: Array<ValueSuggestion>,
): Array<ValueSuggestion> => {
  const byReference: Map<string, ValueSuggestion> = new Map<
    string,
    ValueSuggestion
  >();

  for (const item of items) {
    const existing: ValueSuggestion | undefined = byReference.get(
      item.reference,
    );

    if (!existing) {
      byReference.set(item.reference, item);
      continue;
    }

    byReference.set(item.reference, {
      ...existing,
      description: existing.description || item.description,
      typeLabel: existing.typeLabel || item.typeLabel,
      badges:
        existing.badges || item.badges
          ? Array.from(
              new Set<string>([
                ...(existing.badges || []),
                ...(item.badges || []),
              ]),
            )
          : undefined,
      drillIn: mergeDrillIns(existing.drillIn, item.drillIn),
    });
  }

  return Array.from(byReference.values());
};

export type MergeSuggestionGroupsFunction = (
  groups: Array<ValueSuggestionGroup>,
) => Array<ValueSuggestionGroup>;

/**
 * Every source's groups as one list: groups sharing an id become one, each
 * reference appears once, and the groups are in order.
 */
export const mergeSuggestionGroups: MergeSuggestionGroupsFunction = (
  groups: Array<ValueSuggestionGroup>,
): Array<ValueSuggestionGroup> => {
  const byId: Map<string, ValueSuggestionGroup> = new Map<
    string,
    ValueSuggestionGroup
  >();

  for (const group of groups) {
    const existing: ValueSuggestionGroup | undefined = byId.get(group.id);

    if (!existing) {
      byId.set(group.id, { ...group, items: [...group.items] });
      continue;
    }

    byId.set(group.id, {
      ...existing,
      subtitle: existing.subtitle || group.subtitle,
      iconProp: existing.iconProp || group.iconProp,
      order: Math.min(existing.order, group.order),
      items: [...existing.items, ...group.items],
    });
  }

  return Array.from(byId.values())
    .map((group: ValueSuggestionGroup) => {
      return { ...group, items: dedupeSuggestions(group.items) };
    })
    .filter((group: ValueSuggestionGroup) => {
      return group.items.length > 0;
    })
    .sort((a: ValueSuggestionGroup, b: ValueSuggestionGroup) => {
      return a.order - b.order;
    });
};

type NormalizeFunction = (text: string | undefined) => string;

const normalize: NormalizeFunction = (text: string | undefined): string => {
  return (text || "").toLowerCase();
};

export type SuggestionMatchesFunction = (
  item: ValueSuggestion,
  group: ValueSuggestionGroup | null,
  query: string,
) => boolean;

/**
 * Does every word of the query appear somewhere in what the item says about
 * itself? "body webhook" finds the webhook's Request Body; "local.variables"
 * finds a variable by the reference someone half-remembers.
 */
export const suggestionMatches: SuggestionMatchesFunction = (
  item: ValueSuggestion,
  group: ValueSuggestionGroup | null,
  query: string,
): boolean => {
  const words: Array<string> = normalize(query)
    .split(/\s+/)
    .filter((word: string) => {
      return word.length > 0;
    });

  if (words.length === 0) {
    return true;
  }

  const haystack: string = [
    item.label,
    item.description,
    item.typeLabel,
    ...(item.badges || []),
    item.reference,
    group?.title,
    group?.subtitle,
  ]
    .map(normalize)
    .join(" \u0000 ");

  return words.every((word: string) => {
    return haystack.includes(word);
  });
};

export type FilterSuggestionGroupsFunction = (
  groups: Array<ValueSuggestionGroup>,
  query: string,
) => Array<ValueSuggestionGroup>;

/** The groups, holding only the items that match; empty groups dropped. */
export const filterSuggestionGroups: FilterSuggestionGroupsFunction = (
  groups: Array<ValueSuggestionGroup>,
  query: string,
): Array<ValueSuggestionGroup> => {
  if (query.trim() === "") {
    return groups;
  }

  return groups
    .map((group: ValueSuggestionGroup) => {
      return {
        ...group,
        items: group.items.filter((item: ValueSuggestion) => {
          return suggestionMatches(item, group, query);
        }),
      };
    })
    .filter((group: ValueSuggestionGroup) => {
      return group.items.length > 0;
    });
};

export interface FlatSuggestion {
  group: ValueSuggestionGroup;
  item: ValueSuggestion;
}

export type FlattenSuggestionGroupsFunction = (
  groups: Array<ValueSuggestionGroup>,
) => Array<FlatSuggestion>;

/** The items in the order the arrow keys walk them. */
export const flattenSuggestionGroups: FlattenSuggestionGroupsFunction = (
  groups: Array<ValueSuggestionGroup>,
): Array<FlatSuggestion> => {
  return groups.flatMap((group: ValueSuggestionGroup) => {
    return group.items.map((item: ValueSuggestion) => {
      return { group: group, item: item };
    });
  });
};
