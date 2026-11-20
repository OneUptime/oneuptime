import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { ResourceAttentionItem } from "../../../Components/ResourcePart/ResourceAttention";
import {
  OpenStackRouteFor,
  getOpenStackAttentionItems,
} from "./OpenStackHealth";

/*
 * A BARE METAL CLASS'S "FAILED: N" OPENS WHICH NODES AND WHY (#9751).
 *
 * The Bare Metal page's Capacity by resource class card counted each class's
 * failed nodes ("Failed: 2") and the count could not be pressed. Each node
 * that failed keeps why when a probe read it (facts.lastError, read at
 * facts.lastErrorReadAt, kept until the node leaves the failed state). The
 * count now opens those nodes (ResourceAttentionPill), read when pressed
 * (POST /openstack-resource/bare-metal-failed-nodes: the very nodes the class
 * count counts), each as Needs attention words it (getOpenStackAttentionItems:
 * its name, its state, Ironic's last error as the message), with since when
 * it failed, when Ironic said so, and View to the node.
 *
 * React-free, so App tests can read it.
 */

export const BARE_METAL_FAILED_HINT: string = translationKey(
  "Show which nodes and why",
);

// The dialog's title, a class named or the nodes with none.
export const BARE_METAL_FAILED_IN_CLASS: PluralTemplate = {
  one: "{{count}} failed node in resource class {{class}}",
  other: "{{count}} failed nodes in resource class {{class}}",
};
export const BARE_METAL_FAILED_WITHOUT_CLASS: PluralTemplate = {
  one: "{{count}} failed node with no resource class",
  other: "{{count}} failed nodes with no resource class",
};

export const BARE_METAL_FAILED_EMPTY: string = translationKey(
  "Nothing needs attention now.",
);
export const BARE_METAL_FAILED_READ_FAILED: string = translationKey(
  "Couldn't read what needs attention",
);

// When it failed: the node's state changed to the failed one then.
const FAILED_SINCE: string = translationKey("Failed {{time}}");

// When a probe read Ironic's last_error, which Ironic can empty within a minute.
const LAST_ERROR_READ_AT: string = translationKey(
  "What Ironic last said, at {{time}}",
);

function factsOf(row: OpenStackResource): JSONObject {
  return (row.facts as JSONObject | undefined) || {};
}

function toDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  const date: Date = new Date(value as string | Date);
  return Number.isNaN(date.getTime()) ? null : date;
}

// The dialog's title, in the reader's words, its count in their digits.
export function getBareMetalFailedTitle(data: {
  translator: Translator;
  resourceClass: string | null;
  count: number;
}): string {
  return data.resourceClass
    ? data.translator.translatePlural(
        BARE_METAL_FAILED_IN_CLASS,
        data.count,
        { class: data.resourceClass },
        { setsValuesApart: true },
      )
    : data.translator.translatePlural(
        BARE_METAL_FAILED_WITHOUT_CLASS,
        data.count,
      );
}

/*
 * The failed nodes as the dialog lists them, the most urgent first: each
 * as Needs attention words it, with since when it failed and, where a probe
 * read why, when it read it.
 */
export function getBareMetalFailedItems(data: {
  rows: Array<OpenStackResource>;
  now: Date;
  routeFor: OpenStackRouteFor;
  translator: Translator;
}): Array<ResourceAttentionItem> {
  const rowsByKey: Map<string, OpenStackResource> = new Map<
    string,
    OpenStackResource
  >();

  for (const row of data.rows) {
    rowsByKey.set(`${row.kind}/${row.externalId}`, row);
  }

  const nodes: Array<OpenStackResource> = data.rows.filter(
    (row: OpenStackResource): boolean => {
      return row.kind === OpenStackResourceKind.BareMetalNode;
    },
  );

  return getOpenStackAttentionItems({
    rows: nodes,
    now: data.now,
    routeFor: data.routeFor,
  }).map((item: ResourceAttentionItem): ResourceAttentionItem => {
    const row: OpenStackResource | undefined = rowsByKey.get(item.key);

    if (!row) {
      return item;
    }

    const failedAt: Date | null = toDate(row.stateChangedAt);
    const facts: JSONObject = factsOf(row);
    const lastErrorReadAt: Date | null =
      typeof facts["lastError"] === "string" && facts["lastError"]
        ? toDate(facts["lastErrorReadAt"])
        : null;

    return {
      ...item,
      ...(failedAt ? { since: { at: failedAt, template: FAILED_SINCE } } : {}),
      ...(lastErrorReadAt
        ? {
            explanation: data.translator.translateTemplate(
              LAST_ERROR_READ_AT,
              {
                time: OneUptimeDate.getDateAsLocalFormattedString(
                  lastErrorReadAt,
                ),
              },
              { setsValuesApart: true },
            ),
          }
        : {}),
    };
  });
}
