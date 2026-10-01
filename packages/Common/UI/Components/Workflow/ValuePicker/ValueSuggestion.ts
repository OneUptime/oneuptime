/*
 * What the value picker offers, and the pure helpers around it.
 *
 * The picker lists values a step can use in a setting: the return values of
 * the steps that run before it, and the workflow's variables. Each comes from
 * a source (see ValueSuggestionSource), and the list is the sources' groups
 * merged together. The steps' values come from their metadata; what was
 * inside them the last times they ran - the fields of the request a webhook
 * received - comes from a second source that adds to the same groups (see
 * StepSampleSource).
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
  /**
   * A line above the values inside: where they come from ("Fields of the
   * request received 5 minutes ago.") or why there are none yet.
   */
  note?: string | undefined;
}

/**
 * Makes an item one that only a search lists: a field deep inside a value,
 * which browsing reaches by opening the value it is in.
 */
export interface ValueSuggestionSearchOnly {
  /**
   * The words that say where it sits - the value it is inside, as named and
   * as referenced. A search made only of these, or of the step's own name,
   * finds the value, not every field in it.
   */
  context: Array<string>;
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
  /**
   * What it held the last time its step ran, in a few words: "production",
   * "3 fields". Shown beside its name.
   */
  sample?: string | undefined;
  /**
   * What it held is not shown: it looks like a secret, or the run hid it.
   */
  isSampleHidden?: boolean | undefined;
  /** Listed only by a search that names it (see ValueSuggestionSearchOnly). */
  searchOnly?: ValueSuggestionSearchOnly | undefined;
  /**
   * Adds its sample to an item another source lists - a record's field, say -
   * and is dropped where no other source lists it.
   */
  annotatesOnly?: boolean | undefined;
}

/**
 * A word about a whole group, under its name: why a step has nothing to look
 * inside yet, and how to change that.
 */
export interface ValueSuggestionNote {
  text: string;
  /** Text for a Copy button beside it, e.g. a request to send. */
  copyText?: string | undefined;
  /** That button's label. */
  copyLabel?: string | undefined;
  /**
   * The source to ask again every few seconds while the list is open,
   * because what the note waits for - a request - can arrive at any moment.
   */
  refreshSourceId?: string | undefined;
  /** Said while it waits, e.g. "Waiting for a request…". */
  waitingText?: string | undefined;
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
  note?: ValueSuggestionNote | undefined;
}

/** What a source knows about the step whose settings are being edited. */
export interface ValueSuggestionContext {
  workflowId?: ObjectID | undefined;
  /** The step being edited. */
  component?: NodeDataProp | undefined;
  /** The steps it can read from, in run order (see StepGraph). */
  upstreamComponents: Array<NodeDataProp>;
  /**
   * The URL that starts the workflow through its Webhook trigger, secret key
   * and all, when the reader may see it. Never shown, only copied.
   */
  webhookUrl?: string | undefined;
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
  /**
   * An extra the picker works without, such as values from earlier runs: it
   * loads without a "Loading" line, and a failure is not reported.
   */
  isBackground?: boolean | undefined;
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
  const rest: string = trimmedPath
    .slice(leadingIndex.length)
    .replace(/^\./, "");

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
    note: first.note || second.note,
    loadChildren:
      loaders.length === 0
        ? undefined
        : async (): Promise<Array<ValueSuggestion>> => {
            interface LoaderResult {
              items: Array<ValueSuggestion> | null;
              error?: unknown;
            }

            const results: Array<LoaderResult> = await Promise.all(
              loaders.map(
                async (
                  loader: () => Promise<Array<ValueSuggestion>>,
                ): Promise<LoaderResult> => {
                  try {
                    return { items: await loader() };
                  } catch (error: unknown) {
                    return { items: null, error: error };
                  }
                },
              ),
            );

            const loaded: Array<Array<ValueSuggestion>> = results
              .map((result: LoaderResult) => {
                return result.items;
              })
              .filter(
                (
                  items: Array<ValueSuggestion> | null,
                ): items is Array<ValueSuggestion> => {
                  return items !== null;
                },
              );

            // Every loader failed: say so, rather than showing an empty list.
            if (loaded.length === 0 && results.length > 0) {
              throw results[0]!.error;
            }

            const children: Array<ValueSuggestion> = dedupeSuggestions(
              loaded.flat(),
            );

            /*
             * The loaders that worked only had samples to add, and the one
             * that lists the fields failed: that failure is the answer.
             */
            const failure: LoaderResult | undefined = results.find(
              (result: LoaderResult) => {
                return result.items === null;
              },
            );

            if (children.length === 0 && failure) {
              throw failure.error;
            }

            return children;
          },
  };
};

export type DedupeSuggestionsFunction = (
  items: Array<ValueSuggestion>,
) => Array<ValueSuggestion>;

/**
 * One item per reference. The first source to list it names it; the others
 * add what it lacks - a sample, a way inside. An item that only annotates is
 * dropped where no source lists it.
 */
export const dedupeSuggestions: DedupeSuggestionsFunction = (
  items: Array<ValueSuggestion>,
): Array<ValueSuggestion> => {
  const byReference: Map<string, ValueSuggestion> = new Map<
    string,
    ValueSuggestion
  >();

  /*
   * The items that list a value go first, each source's in its order, so an
   * annotation never names the item it adds to.
   */
  const ordered: Array<ValueSuggestion> = [
    ...items.filter((item: ValueSuggestion) => {
      return !item.annotatesOnly;
    }),
    ...items.filter((item: ValueSuggestion) => {
      return Boolean(item.annotatesOnly);
    }),
  ];

  for (const item of ordered) {
    const existing: ValueSuggestion | undefined = byReference.get(
      item.reference,
    );

    if (!existing) {
      if (!item.annotatesOnly) {
        byReference.set(item.reference, item);
      }

      continue;
    }

    // The first source to say what it held - or that it is hidden - says it.
    const sampleFrom: ValueSuggestion =
      existing.sample || existing.isSampleHidden ? existing : item;

    const merged: ValueSuggestion = {
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
      sample: sampleFrom.sample,
      isSampleHidden: sampleFrom.isSampleHidden,
      // Listed whenever either source lists it.
      searchOnly:
        existing.searchOnly && item.searchOnly
          ? existing.searchOnly
          : undefined,
    };

    if (!merged.sample && !merged.isSampleHidden) {
      delete merged.sample;
      delete merged.isSampleHidden;
    }

    if (!merged.searchOnly) {
      delete merged.searchOnly;
    }

    byReference.set(item.reference, merged);
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
      note: existing.note || group.note,
    });
  }

  return Array.from(byId.values())
    .map((group: ValueSuggestionGroup) => {
      return { ...group, items: dedupeSuggestions(group.items) };
    })
    .filter((group: ValueSuggestionGroup) => {
      // A group of fields only a search lists has nothing to browse to.
      return group.items.some((item: ValueSuggestion) => {
        return !item.searchOnly;
      });
    })
    .sort((a: ValueSuggestionGroup, b: ValueSuggestionGroup) => {
      return a.order - b.order;
    });
};

type NormalizeFunction = (text: string | undefined) => string;

const normalize: NormalizeFunction = (text: string | undefined): string => {
  return (text || "").toLowerCase();
};

type QueryWordsFunction = (query: string) => Array<string>;

const queryWords: QueryWordsFunction = (query: string): Array<string> => {
  return normalize(query)
    .split(/\s+/)
    .filter((word: string) => {
      return word.length > 0;
    });
};

/*
 * The most fields one group lists for a search. A short query can match a
 * hundred fields of one big body; the first of them, and a longer query,
 * serve better than a list too long to read.
 */
export const MAX_SEARCH_ONLY_RESULTS_PER_GROUP: number = 30;

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
  const words: Array<string> = queryWords(query);

  if (words.length === 0) {
    return true;
  }

  const haystack: string = [
    item.label,
    item.description,
    item.typeLabel,
    item.isSampleHidden ? undefined : item.sample,
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

export type IsListedForQueryFunction = (
  item: ValueSuggestion,
  group: ValueSuggestionGroup | null,
  query: string,
) => boolean;

/**
 * Whether the list shows an item for this search. Most items: when they
 * match. A field only a search lists (searchOnly): when it matches and the
 * search says something about the field itself - "title", "production",
 * "request-body.inc" - and not just the step or the value it is in, which
 * would bring up every field of a body at once.
 */
export const isListedForQuery: IsListedForQueryFunction = (
  item: ValueSuggestion,
  group: ValueSuggestionGroup | null,
  query: string,
): boolean => {
  const words: Array<string> = queryWords(query);

  if (!item.searchOnly) {
    return suggestionMatches(item, group, query);
  }

  if (words.length === 0 || !suggestionMatches(item, group, query)) {
    return false;
  }

  const context: string = [
    group?.title,
    group?.subtitle,
    ...item.searchOnly.context,
  ]
    .map(normalize)
    .join(" \u0000 ");

  return words.some((word: string) => {
    return !context.includes(word);
  });
};

export type FilterSuggestionGroupsFunction = (
  groups: Array<ValueSuggestionGroup>,
  query: string,
) => Array<ValueSuggestionGroup>;

/**
 * The groups, holding only the items listed for the search (see
 * isListedForQuery); empty groups dropped. With no search, every item a
 * search does not have to find.
 */
export const filterSuggestionGroups: FilterSuggestionGroupsFunction = (
  groups: Array<ValueSuggestionGroup>,
  query: string,
): Array<ValueSuggestionGroup> => {
  if (query.trim() === "") {
    return groups
      .map((group: ValueSuggestionGroup) => {
        return {
          ...group,
          items: group.items.filter((item: ValueSuggestion) => {
            return !item.searchOnly;
          }),
        };
      })
      .filter((group: ValueSuggestionGroup) => {
        return group.items.length > 0;
      });
  }

  return groups
    .map((group: ValueSuggestionGroup) => {
      let searchOnlyListed: number = 0;

      return {
        ...group,
        items: group.items.filter((item: ValueSuggestion) => {
          if (!isListedForQuery(item, group, query)) {
            return false;
          }

          if (!item.searchOnly) {
            return true;
          }

          searchOnlyListed++;

          return searchOnlyListed <= MAX_SEARCH_ONLY_RESULTS_PER_GROUP;
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
