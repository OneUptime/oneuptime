import DataStore from "../../../Models/DatabaseModels/DataStore";
import { JSONObject } from "../../../Types/JSON";
import { MarkdownText, mdText } from "../../../Utils/Markdown/FeedMarkdown";

/*
 * WHAT A PERSON CHANGED ON A DATA STORE, AS ITS TIMELINE SAYS IT.
 *
 * A store's settings decide what its checks find - Public By Design keeps
 * its public access from being an issue, a Sensitivity Override decides how
 * severe every issue is, Scan Content turns sampling off - so who changed
 * them, and to what, is worth a line on the store's Timeline.
 *
 * Only the columns a person sets are recorded (what discovery, reads and
 * scans write is bookkeeping, written as root, and never reaches here). A
 * value is shown where it is a choice from a list - an environment, a
 * sensitivity, on or off - and only named where it is text a person wrote
 * (a name, a purpose, exclusions), a secret (the connection string), or a
 * reference.
 */

type Shown = "value" | "onOrOff" | "named";

interface TimelineColumn {
  column: string;
  // The other name a write may use for the same column: a reference's ID column.
  alsoNamed?: Array<string> | undefined;
  shown: Shown;
}

export const DATA_STORE_COLUMNS_ON_THE_TIMELINE: ReadonlyArray<TimelineColumn> =
  [
    { column: "name", shown: "named" },
    { column: "description", shown: "named" },
    { column: "environment", shown: "value" },
    { column: "sensitivityOverride", shown: "value" },
    { column: "isPublicByDesign", shown: "onOrOff" },
    { column: "isAiData", shown: "onOrOff" },
    { column: "isContentScanEnabled", shown: "onOrOff" },
    { column: "scanProbe", alsoNamed: ["scanProbeId"], shown: "named" },
    { column: "probeConnectionVariable", shown: "named" },
    // A secret: that it changed, never what to.
    { column: "connectionString", shown: "named" },
    { column: "scanExclusions", shown: "named" },
    { column: "purpose", shown: "named" },
    { column: "retention", shown: "named" },
    { column: "labels", shown: "named" },
  ];

const MODEL: DataStore = new DataStore();

// The column's title, as the store's pages and the API reference name it.
export function getDataStoreColumnTitle(column: string): string {
  return MODEL.getTableColumnMetadata(column)?.title || column;
}

function describeValue(column: TimelineColumn, value: unknown): string | null {
  if (column.shown === "onOrOff") {
    return value === true ? "On" : "Off";
  }

  if (column.shown === "value") {
    if (value === null || value === undefined || value === "") {
      // An override taken off: the store goes by its scans again.
      return column.column === "sensitivityOverride"
        ? "As its scans find"
        : "None";
    }

    return typeof value === "string" ? value : null;
  }

  return null;
}

// The value the update sent for the column, under whichever name it used.
function readSent(
  data: JSONObject,
  column: TimelineColumn,
): { sent: boolean; value: unknown } {
  for (const name of [column.column, ...(column.alsoNamed || [])]) {
    if (
      Object.prototype.hasOwnProperty.call(data, name) &&
      data[name] !== undefined
    ) {
      return { sent: true, value: data[name] };
    }
  }

  return { sent: false, value: undefined };
}

/*
 * One line per recorded column the update sent, in the order above:
 * "**Environment**: Production", "**Public By Design**: On",
 * "**Connection String** changed". Empty when the update sent none of them.
 */
export function describeDataStoreChanges(
  data: JSONObject | undefined,
): Array<MarkdownText> {
  if (!data) {
    return [];
  }

  const lines: Array<MarkdownText> = [];

  for (const column of DATA_STORE_COLUMNS_ON_THE_TIMELINE) {
    const sent: { sent: boolean; value: unknown } = readSent(data, column);

    if (!sent.sent) {
      continue;
    }

    const title: string = getDataStoreColumnTitle(column.column);
    const shown: string | null = describeValue(column, sent.value);

    lines.push(
      shown === null
        ? mdText`**${title}** changed`
        : mdText`**${title}**: ${shown}`,
    );
  }

  return lines;
}
