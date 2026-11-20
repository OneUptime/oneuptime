/*
 * WHAT READS A METRIC ADDED TO A CLOUD CONNECTION, SAID BEFORE IT IS
 * REMOVED (#9807).
 *
 * A monitor, a dashboard's widget, an SLO or a recording rule reads an
 * added metric as it reads a key metric: by the name it is stored under.
 * Removed, the connection stops reading it, and they get no new data of it.
 * So the resource's More Metrics asks first which of them read it - for
 * that resource, or for any resource of its type when it was added for
 * every one - and names them, each a link, before Remove.
 *
 * The server's answer (CloudResourceMetrics.readersOf, found by the lookup
 * of what reads a metric, Telemetry/MetricReaders), read here defensively
 * for the page.
 *
 * A metric added for every resource of its type is often read of a few of
 * them alone - a monitor of one database, a chart of two VMs. The answer
 * says which (keepFor, #10078), so the dialog can offer to keep it for
 * those alone and stop paying for the rest: unless a reader reads it of
 * every resource (a query that names none), or some records could not be
 * checked, or the connection would hold too many added metrics.
 */

export enum CloudAddedMetricReaderKind {
  Monitor = "monitor",
  Dashboard = "dashboard",
  Slo = "slo",
  RecordingRule = "recordingRule",
}

// A dashboard's widget that reads it.
export interface CloudAddedMetricReaderWidget {
  // Its title, or "" when it has none.
  title: string;
  // Its kind ("Chart"), which names it when it has no title; "" when not known.
  type: string;
}

export interface CloudAddedMetricReader {
  kind: CloudAddedMetricReaderKind;
  id: string;
  // As its person named it; "" when it has no name.
  name: string;
  // A dashboard's: its widgets that read it, in their order on it.
  widgets: Array<CloudAddedMetricReaderWidget>;
  // A recording rule's: the metric it writes, which finds it in its list.
  outputMetricName?: string | undefined;
  /*
   * A type's addition (#10078): it reads it of every resource of the type,
   * by a query that names none, so it cannot be kept for some alone.
   */
  readsEveryResource?: boolean | undefined;
}

// Why a type's addition cannot be kept for the resources its readers read alone.
export enum CloudAddedMetricKeepBlock {
  // A reader reads it of every resource of its type.
  EveryResource = "everyResource",
  // Some records could not be checked: one of them may read it of the others.
  Unchecked = "unchecked",
  // The connection would read more added metrics than it may.
  ConnectionFull = "connectionFull",
}

// A type's addition that something reads: the resources it can be kept for alone.
export interface CloudAddedMetricKeepFor {
  // The resources of its type its readers read it of, by name: each its row and name.
  resources: Array<{ id: string; name: string }>;
  // Why it cannot be kept for those alone; none when it can.
  blockedBy?: CloudAddedMetricKeepBlock | undefined;
}

export interface CloudAddedMetricReaders {
  // Monitors, then dashboards, SLOs and recording rules, each kind by name.
  readers: Array<CloudAddedMetricReader>;
  // Found reading it, but not the asker's to open: counted, never named.
  hidden: number;
  // The kinds whose records could not be read just now: any of them may read it.
  uncheckedKinds: Array<CloudAddedMetricReaderKind>;
  // How many of each kind the asker cannot open (#10107): together, `hidden`.
  hiddenByKind?:
    | Partial<Record<CloudAddedMetricReaderKind, number>>
    | undefined;
  // An addition for every resource of its type that something reads (#10078).
  keepFor?: CloudAddedMetricKeepFor | undefined;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isReaderKind(value: unknown): value is CloudAddedMetricReaderKind {
  return (Object.values(CloudAddedMetricReaderKind) as Array<unknown>).includes(
    value,
  );
}

function readReader(value: unknown): CloudAddedMetricReader | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;
  const kind: unknown = raw["kind"];
  const id: string = readText(raw["id"]);

  if (!id || !isReaderKind(kind)) {
    return null;
  }

  const reader: CloudAddedMetricReader = {
    kind,
    id,
    name: readText(raw["name"]),
    widgets: Array.isArray(raw["widgets"])
      ? (raw["widgets"] as Array<unknown>)
          .map(readWidget)
          .filter(
            (
              widget: CloudAddedMetricReaderWidget | null,
            ): widget is CloudAddedMetricReaderWidget => {
              return widget !== null;
            },
          )
      : [],
  };
  const outputMetricName: string = readText(raw["outputMetricName"]);

  if (outputMetricName) {
    reader.outputMetricName = outputMetricName;
  }

  if (raw["readsEveryResource"] === true) {
    reader.readsEveryResource = true;
  }

  return reader;
}

// A widget as the answer names it: its title and kind, or - an older answer - its title alone.
function readWidget(value: unknown): CloudAddedMetricReaderWidget | null {
  if (typeof value === "string") {
    return { title: value, type: "" };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;

  return { title: readText(raw["title"]), type: readText(raw["type"]) };
}

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function readHiddenByKind(
  value: unknown,
): Partial<Record<CloudAddedMetricReaderKind, number>> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const counts: Partial<Record<CloudAddedMetricReaderKind, number>> = {};

  for (const [kind, count] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (isReaderKind(kind) && readCount(count) > 0) {
      counts[kind] = readCount(count);
    }
  }

  return counts;
}

function readKeepFor(value: unknown): CloudAddedMetricKeepFor | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;
  const blockedBy: unknown = raw["blockedBy"];
  const keepFor: CloudAddedMetricKeepFor = {
    resources: (Array.isArray(raw["resources"])
      ? (raw["resources"] as Array<unknown>)
      : []
    )
      .map((item: unknown): { id: string; name: string } | null => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return null;
        }

        const resource: Record<string, unknown> = item as Record<
          string,
          unknown
        >;
        const id: string = readText(resource["id"]);

        return id ? { id, name: readText(resource["name"]) } : null;
      })
      .filter(
        (
          resource: { id: string; name: string } | null,
        ): resource is { id: string; name: string } => {
          return resource !== null;
        },
      ),
  };

  if (
    (Object.values(CloudAddedMetricKeepBlock) as Array<unknown>).includes(
      blockedBy,
    )
  ) {
    keepFor.blockedBy = blockedBy as CloudAddedMetricKeepBlock;
  }

  return keepFor;
}

// The server's answer, read defensively; null when it is not one.
export function readCloudAddedMetricReaders(
  value: unknown,
): CloudAddedMetricReaders | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;

  if (!Array.isArray(raw["readers"])) {
    return null;
  }

  const answer: CloudAddedMetricReaders = {
    readers: (raw["readers"] as Array<unknown>)
      .map(readReader)
      .filter(
        (
          reader: CloudAddedMetricReader | null,
        ): reader is CloudAddedMetricReader => {
          return reader !== null;
        },
      ),
    hidden: readCount(raw["hidden"]),
    uncheckedKinds: Array.from(
      new Set(
        (Array.isArray(raw["uncheckedKinds"])
          ? (raw["uncheckedKinds"] as Array<unknown>)
          : []
        ).filter(isReaderKind),
      ),
    ),
  };
  const hiddenByKind:
    | Partial<Record<CloudAddedMetricReaderKind, number>>
    | undefined = readHiddenByKind(raw["hiddenByKind"]);
  const keepFor: CloudAddedMetricKeepFor | undefined = readKeepFor(
    raw["keepFor"],
  );

  if (hiddenByKind) {
    answer.hiddenByKind = hiddenByKind;
  }

  if (keepFor) {
    answer.keepFor = keepFor;
  }

  return answer;
}

const KIND_ORDER: Record<CloudAddedMetricReaderKind, number> = {
  [CloudAddedMetricReaderKind.Monitor]: 0,
  [CloudAddedMetricReaderKind.Dashboard]: 1,
  [CloudAddedMetricReaderKind.Slo]: 2,
  [CloudAddedMetricReaderKind.RecordingRule]: 3,
};

// Monitors, then dashboards, SLOs and recording rules, each kind by name, case aside.
export function sortCloudAddedMetricReaders(
  readers: ReadonlyArray<CloudAddedMetricReader>,
): Array<CloudAddedMetricReader> {
  return [...readers].sort(
    (a: CloudAddedMetricReader, b: CloudAddedMetricReader): number => {
      const byKind: number = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];

      if (byKind !== 0) {
        return byKind;
      }

      const nameA: string = a.name.toLowerCase();
      const nameB: string = b.name.toLowerCase();

      return nameA < nameB ? -1 : nameA > nameB ? 1 : a.id < b.id ? -1 : 1;
    },
  );
}
