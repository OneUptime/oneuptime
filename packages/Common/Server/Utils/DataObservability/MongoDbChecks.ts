import BadDataException from "../../../Types/Exception/BadDataException";
import {
  DataCheckType,
  MAX_ACCEPTED_VALUES,
  MAX_SEGMENTS_PER_CHECK,
} from "../../../Types/DataObservability/DataCheckType";
import { JSONObject, JSONValue } from "../../../Types/JSON";

/*
 * A DATA CHECK ON A MONGODB COLLECTION: ONE AGGREGATION PIPELINE.
 *
 * MongoDB has no SQL, so each check is an aggregation pipeline that ends in
 * one document - { value }, or { segment, value } per segment - so only the
 * number leaves the database, never a document. The statement a check plans
 * is the pipeline as JSON, with the database and collection it runs on. A
 * custom check is the person's own pipeline, refused if it writes ($out,
 * $merge) or calls code ($function, $accumulator, $where), and capped like
 * every check's rows.
 *
 * A document store holds whatever its writers wrote, so a value that is not
 * the type a check reads converts to nothing ($convert's onError) rather
 * than failing the check: a "n/a" in a number field is skipped by an
 * average, and counts as invalid or mismatched where a check asks.
 */

export interface MongoCheckStatement {
  database: string;
  collection: string;
  pipeline: Array<JSONObject>;
  isSegmented: boolean;
  // What no documents at all read as: a count's 0, else nothing, as SQL's aggregates do.
  emptyValue: number | null;
}

export interface MongoCheckTarget {
  type: DataCheckType;
  schemaName: string;
  tableName: string;
  columnName?: string | null | undefined;
  segmentColumn?: string | null | undefined;
  acceptedValues?: Array<string> | null | undefined;
  pattern?: string | null | undefined;
  referenceTableName?: string | null | undefined;
  referenceColumnName?: string | null | undefined;
  customSql?: string | null | undefined;
}

const MAX_CUSTOM_PIPELINE_LENGTH: number = 10_000;
const MAX_PIPELINE_STAGES: number = 30;

// Stages and operators a check never needs: each writes, or runs code.
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  "$out",
  "$merge",
  "$function",
  "$accumulator",
  "$where",
]);

// A field as a pipeline names it: never an operator, never empty.
export function mongoField(name: string | null | undefined): string {
  const field: string = (name || "").trim();

  if (
    !field ||
    field.startsWith("$") ||
    field.length > 240 ||
    field.includes("\u0000")
  ) {
    throw new BadDataException(
      `"${field.slice(0, 50)}" is not a field a check can read.`,
    );
  }

  return field;
}

function containsForbidden(value: unknown, depth: number = 0): boolean {
  if (depth > 50 || !value || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item: unknown): boolean => {
      return containsForbidden(item, depth + 1);
    });
  }

  return Object.entries(value as JSONObject).some(
    ([key, item]: [string, unknown]): boolean => {
      return FORBIDDEN_KEYS.has(key) || containsForbidden(item, depth + 1);
    },
  );
}

/*
 * A custom check's pipeline: a JSON array of stages, none that writes or
 * runs code, ending in documents with a value.
 */
export function checkMongoPipeline(text: string): Array<JSONObject> {
  const value: string = (text || "").trim();

  if (!value) {
    throw new BadDataException("A custom check needs an aggregation pipeline.");
  }

  if (value.length > MAX_CUSTOM_PIPELINE_LENGTH) {
    throw new BadDataException("The aggregation pipeline is too long.");
  }

  let pipeline: unknown;

  try {
    pipeline = JSON.parse(value);
  } catch {
    throw new BadDataException(
      'A MongoDB custom check is an aggregation pipeline as JSON: [{ "$match": ... }, { "$count": "value" }].',
    );
  }

  if (
    !Array.isArray(pipeline) ||
    pipeline.length === 0 ||
    pipeline.length > MAX_PIPELINE_STAGES ||
    !pipeline.every((stage: unknown): boolean => {
      return (
        Boolean(stage) && typeof stage === "object" && !Array.isArray(stage)
      );
    })
  ) {
    throw new BadDataException(
      `The aggregation pipeline must be an array of 1 to ${MAX_PIPELINE_STAGES} stages.`,
    );
  }

  if (containsForbidden(pipeline)) {
    throw new BadDataException(
      "The aggregation pipeline may only read: no $out, $merge, $function, $accumulator or $where.",
    );
  }

  return pipeline as Array<JSONObject>;
}

// A share of the counted documents, as a percent: null when none were counted.
function percentOf(part: string, total: string): JSONObject {
  return {
    $cond: [
      { $eq: [`$${total}`, 0] },
      null,
      { $multiply: [100, { $divide: [`$${part}`, `$${total}`] }] },
    ],
  };
}

// A field as text, or null where it has none ($toString would fail the whole check).
function asText(ref: string): JSONObject {
  return {
    $convert: { input: ref, to: "string", onError: null, onNull: null },
  };
}

// A field as a double, or null where it is not a number.
function asDouble(ref: string): JSONObject {
  return {
    $convert: { input: ref, to: "double", onError: null, onNull: null },
  };
}

// The group key: one group for the collection, or one per segment.
function groupKey(segment: string | null): string | null {
  return segment ? `$${segment}` : null;
}

// The pipeline's last stages: the value, and per segment its 100 largest.
function finish(segment: string | null, value: JSONValue): Array<JSONObject> {
  const project: JSONObject = segment
    ? { $project: { _id: 0, segment: "$_id", value, size: "$size" } }
    : { $project: { _id: 0, value } };

  return segment
    ? [
        project,
        { $sort: { size: -1 } },
        { $limit: MAX_SEGMENTS_PER_CHECK },
        { $project: { size: 0 } },
      ]
    : [project];
}

export function buildMongoCheckStatement(target: MongoCheckTarget): {
  sql: string;
  params: Array<string>;
  isSegmented: boolean;
} {
  const segment: string | null = target.segmentColumn
    ? mongoField(target.segmentColumn)
    : null;
  const statement: MongoCheckStatement = {
    database: target.schemaName,
    collection: mongoField(target.tableName),
    pipeline: [],
    isSegmented: Boolean(segment),
    emptyValue: [
      DataCheckType.RowCount,
      DataCheckType.DistinctCount,
      DataCheckType.OrphanCount,
    ].includes(target.type)
      ? 0
      : null,
  };

  if (target.type === DataCheckType.CustomSql) {
    statement.pipeline = [
      ...checkMongoPipeline(target.customSql || ""),
      { $limit: MAX_SEGMENTS_PER_CHECK },
    ];
  } else if (target.type === DataCheckType.RowCount) {
    statement.pipeline = [
      {
        $group: {
          _id: groupKey(segment),
          value: { $sum: 1 },
          size: { $sum: 1 },
        },
      },
      ...finish(segment, "$value"),
    ];
  } else {
    const field: string = mongoField(target.columnName);
    const ref: string = `$${field}`;
    const present: JSONObject = { $match: { [field]: { $ne: null } } };

    switch (target.type) {
      case DataCheckType.NullPercent:
        statement.pipeline = [
          {
            $group: {
              _id: groupKey(segment),
              size: { $sum: 1 },
              missing: {
                $sum: {
                  $cond: [{ $eq: [{ $ifNull: [ref, null] }, null] }, 1, 0],
                },
              },
            },
          },
          ...finish(segment, percentOf("missing", "size")),
        ];
        break;
      case DataCheckType.DistinctCount:
        statement.pipeline = [
          present,
          { $group: { _id: { segment: groupKey(segment), value: ref } } },
          {
            $group: {
              _id: "$_id.segment",
              value: { $sum: 1 },
              size: { $sum: 1 },
            },
          },
          ...finish(segment, "$value"),
        ];
        break;
      case DataCheckType.DuplicatePercent:
        statement.pipeline = [
          present,
          {
            $group: {
              _id: { segment: groupKey(segment), value: ref },
              n: { $sum: 1 },
            },
          },
          {
            $group: {
              _id: "$_id.segment",
              distinct: { $sum: 1 },
              size: { $sum: "$n" },
            },
          },
          {
            $set: { repeated: { $subtract: ["$size", "$distinct"] } },
          },
          ...finish(segment, percentOf("repeated", "size")),
        ];
        break;
      case DataCheckType.Minimum:
      case DataCheckType.Maximum:
      case DataCheckType.Average:
      case DataCheckType.Sum: {
        const operator: string =
          target.type === DataCheckType.Minimum
            ? "$min"
            : target.type === DataCheckType.Maximum
              ? "$max"
              : target.type === DataCheckType.Average
                ? "$avg"
                : "$sum";

        statement.pipeline = [
          {
            $group: {
              _id: groupKey(segment),
              value: { [operator]: asDouble(ref) },
              size: { $sum: 1 },
            },
          },
          ...finish(segment, "$value"),
        ];
        break;
      }
      case DataCheckType.InvalidPercent: {
        const values: Array<string> = (target.acceptedValues || [])
          .filter((value: string): boolean => {
            return typeof value === "string";
          })
          .slice(0, MAX_ACCEPTED_VALUES);

        if (values.length === 0) {
          throw new BadDataException(
            "An Invalid Percent check needs at least one accepted value.",
          );
        }

        statement.pipeline = [
          present,
          {
            $group: {
              _id: groupKey(segment),
              size: { $sum: 1 },
              invalid: {
                $sum: { $cond: [{ $in: [asText(ref), values] }, 0, 1] },
              },
            },
          },
          ...finish(segment, percentOf("invalid", "size")),
        ];
        break;
      }
      case DataCheckType.FormatMismatchPercent: {
        const pattern: string = (target.pattern || "").slice(0, 500);

        if (!pattern) {
          throw new BadDataException(
            "A Format Mismatch Percent check needs a pattern.",
          );
        }

        statement.pipeline = [
          present,
          {
            $group: {
              _id: groupKey(segment),
              size: { $sum: 1 },
              mismatched: {
                $sum: {
                  $cond: [
                    { $regexMatch: { input: asText(ref), regex: pattern } },
                    0,
                    1,
                  ],
                },
              },
            },
          },
          ...finish(segment, percentOf("mismatched", "size")),
        ];
        break;
      }
      case DataCheckType.OrphanCount:
        if (!target.referenceTableName || !target.referenceColumnName) {
          throw new BadDataException(
            "An Orphan Count check needs the collection and field it refers to.",
          );
        }

        statement.pipeline = [
          present,
          {
            $lookup: {
              from: mongoField(target.referenceTableName),
              localField: field,
              foreignField: mongoField(target.referenceColumnName),
              as: "oneuptime_referenced",
            },
          },
          { $match: { oneuptime_referenced: { $size: 0 } } },
          {
            $group: {
              _id: groupKey(segment),
              value: { $sum: 1 },
              size: { $sum: 1 },
            },
          },
          ...finish(segment, "$value"),
        ];
        break;
      default:
        throw new BadDataException(
          `${target.type} is not a check on one field.`,
        );
    }
  }

  return {
    sql: JSON.stringify(statement),
    params: [],
    isSegmented: statement.isSegmented,
  };
}

// A planned check's statement, as the catalog session runs it.
export function readMongoCheckStatement(sql: string): MongoCheckStatement {
  const value: JSONObject = JSON.parse(sql) as JSONObject;
  const pipeline: unknown = value["pipeline"];

  if (
    typeof value["collection"] !== "string" ||
    !Array.isArray(pipeline) ||
    containsForbidden(pipeline)
  ) {
    throw new Error("Not a MongoDB check.");
  }

  return {
    database: typeof value["database"] === "string" ? value["database"] : "",
    collection: value["collection"],
    pipeline: pipeline as Array<JSONObject>,
    isSegmented: value["isSegmented"] === true,
    emptyValue:
      typeof value["emptyValue"] === "number" ? value["emptyValue"] : null,
  };
}
