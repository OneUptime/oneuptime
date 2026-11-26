import { ResponseJSON } from "@clickhouse/client";
import DataCategory from "../../../../Types/DataSecurity/DataCategory";
import { getBuiltInDataType } from "../../../../Types/DataSecurity/DataTypeCatalog";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  ScrubRuleWriterPlace,
  ScrubRuleWriterShape,
} from "../../../../Types/DataSecurity/ScrubRuleWriterPlace";
import {
  describeUnplacedField,
  UnplacedField,
  UnplacedValueShape,
} from "../../../../Utils/DataSecurity/UnplacedFields";
import { Results } from "../../../Services/AnalyticsDatabaseService";
import { SQL, Statement } from "../../AnalyticsDatabase/Statement";
import { getQuerySettings } from "../../AnalyticsDatabase/QuerySettingsHelper";
import logger from "../../Logger";
import { ContentScanOptions } from "../DataSecurityScanTypes";
import {
  appendOwnersIn,
  appendWhere,
  getTelemetrySource,
  SourceDefinition,
  tableOf,
} from "./TelemetryDataScanner";
import {
  getOccurrenceWindow,
  planOccurrenceRead,
  OccurrencePlan,
} from "./TelemetryFindingOccurrences";
import { ScrubPlanFindingRecord } from "./TelemetryScrubPlan";
import {
  readScrubPlaceValues,
  ScrubProofRowReader,
} from "./TelemetryScrubProof";
import {
  getAttributeKeyOfTarget,
  getScrubFindingCategory,
} from "./TelemetryScrubPlanner";

/*
 * A FINDING'S PLACE AS ONEUPTIME AI IS TOLD IT: NAMES AND SHAPES, NEVER A
 * VALUE (#10366).
 *
 * Plain code, inside the boundary: reads the values at a finding's place in
 * the records its proof reads (TelemetryScrubProof.readScrubPlaceValues)
 * and the keys of the attributes beside it in the service's newest
 * records, and keeps of them only what OneUptime AI may be told
 * (Types/DataSecurity/ScrubRuleWriterPlace): the shapes of the values -
 * every letter a or A, every digit 9 (Utils/DataSecurity/UnplacedFields,
 * as field suggestions make them) - how many there were and how long, and
 * the attribute names. The values themselves go nowhere.
 */

// The most records whose attribute names are read for what sits beside a place.
const NEIGHBOUR_RECORDS_READ: number = 50;

// The most attribute names read of one record.
const NEIGHBOUR_KEYS_PER_RECORD: number = 64;

// How long the read of names may take.
const NEIGHBOUR_READ_TIME_LIMIT_IN_SECONDS: number = 15;

// A shape, as the writer is told it: OneUptime's own text.
function toWriterShape(shape: UnplacedValueShape): ScrubRuleWriterShape {
  return { shape: shape.shape, share: shape.share };
}

/*
 * The names of the attributes in a service's newest records of the kind a
 * finding is in - the commonest first, the place's own key left out. None
 * when they could not be read.
 */
export async function readNeighbourKeys(data: {
  projectId: ObjectID;
  plan: OccurrencePlan;
  serviceId: string;
  leaveOut?: string | undefined;
  now: Date;
}): Promise<Array<string>> {
  const source: SourceDefinition = getTelemetrySource(data.plan.source);
  const window: { since: Date; until: Date } = getOccurrenceWindow(data.now);
  const statement: Statement = SQL`SELECT arraySlice(mapKeys(attributes), 1, `;

  statement.append(String(NEIGHBOUR_KEYS_PER_RECORD));
  statement.append(") AS readKeys FROM ");
  statement.append(tableOf(source.table));
  appendWhere(statement, source, {
    projectId: data.projectId,
    since: window.since,
    until: window.until,
  });
  appendOwnersIn(statement, source, [data.serviceId]);
  statement.append(" ORDER BY ");
  statement.append(source.timeColumn);
  statement.append(` DESC LIMIT ${NEIGHBOUR_RECORDS_READ}`);
  statement.append(
    getQuerySettings({
      maxExecutionTimeInSeconds: NEIGHBOUR_READ_TIME_LIMIT_IN_SECONDS,
      timeoutOverflowMode: "throw",
    }),
  );

  try {
    const result: Results = await source.runner.executeQuery(statement);
    const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();
    const counts: Map<string, number> = new Map<string, number>();

    for (const row of (response.data || []) as Array<JSONObject>) {
      const keys: unknown = row["readKeys"];

      for (const key of Array.isArray(keys) ? keys : []) {
        if (typeof key === "string" && key && key !== data.leaveOut) {
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      }
    }

    return Array.from(counts.entries())
      .sort((a: [string, number], b: [string, number]): number => {
        return b[1] - a[1] || a[0].localeCompare(b[0]);
      })
      .map(([key]: [string, number]): string => {
        return key;
      });
  } catch (error) {
    logger.warn(
      `DataSecurity: could not read the attribute names beside ${data.serviceId}'s records in project ${data.projectId.toString()}:`,
    );
    logger.warn(error);
    return [];
  }
}

/*
 * One finding's place, as OneUptime AI is told it, or null when there is
 * nothing to tell it: no value could be read there.
 */
export async function describeScrubPlace(data: {
  projectId: ObjectID;
  ref: string;
  finding: ScrubPlanFindingRecord;
  dataTypeName: string;
  serviceId: string;
  options: ContentScanOptions;
  now?: Date | undefined;
  readRows?: ScrubProofRowReader | undefined;
  // Stands in for the read of the names beside it, in a test.
  readNeighbours?: (() => Promise<Array<string>>) | undefined;
}): Promise<ScrubRuleWriterPlace | null> {
  const now: Date = data.now || OneUptimeDate.getCurrentDate();
  const plan: OccurrencePlan | null = planOccurrenceRead(
    data.finding.kind,
    data.finding.location,
  );

  if (!plan) {
    return null;
  }

  const values: { holding: Array<string>; others: Array<string> } | null =
    await readScrubPlaceValues({
      projectId: data.projectId,
      finding: data.finding,
      serviceId: data.serviceId,
      options: data.options,
      now,
      readRows: data.readRows,
    });

  if (!values) {
    return null;
  }

  const shaped: Array<string> =
    values.holding.length > 0 ? values.holding : values.others;
  const attributeKey: string | null = getAttributeKeyOfTarget(
    data.finding.target,
  );
  const neighbours: Array<string> = data.readNeighbours
    ? await data.readNeighbours()
    : await readNeighbourKeys({
        projectId: data.projectId,
        plan,
        serviceId: data.serviceId,
        leaveOut: data.finding.target.key,
        now,
      });
  const described: UnplacedField | null = describeUnplacedField({
    path: data.finding.location,
    values: shaped,
    neighbours,
    locationKind: attributeKey ? "Attribute" : "Body",
  });

  if (!described) {
    return null;
  }

  const category: string =
    getScrubFindingCategory(data.finding) || DataCategory.ContactAndIdentity;

  return {
    ref: data.ref,
    dataTypeId: data.finding.dataTypeId,
    dataTypeName: data.dataTypeName,
    category,
    foundBy:
      getBuiltInDataType(data.finding.dataTypeId)?.foundBy === "name"
        ? "name"
        : "value",
    signal: data.finding.target.signal,
    location: data.finding.location,
    ...(attributeKey ? { attributeKey } : {}),
    locationKind: described.locationKind,
    neighbours: described.neighbours,
    shapes: described.shapes.map(toWriterShape),
    valueCount: described.valueCount,
    averageLength: described.averageLength,
  };
}
