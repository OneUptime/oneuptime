import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * One ThreatIntelIndicator row, as every source writes it: the identity
 * (project, feed, value, stixId), the claim (type, name, confidence,
 * labels), its validity, and the version that makes it the latest claim
 * about the value. Dates are ClickHouse-formatted here, once.
 */
export interface IndicatorRowInput {
  projectId: ObjectID;
  feedId: ObjectID;
  feedName: string;
  stixId: string;
  indicatorType: string;
  indicatorValue: string;
  indicatorName: string;
  confidence: number;
  labels: Array<string>;
  validFrom: Date;
  validUntil: Date;
  revoked: boolean;
  version: number;
  retentionDate: Date;
  now: Date;
}

export function buildIndicatorRow(input: IndicatorRowInput): JSONObject {
  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(input.now),
    projectId: input.projectId.toString(),
    feedId: input.feedId.toString(),
    feedName: input.feedName,
    stixId: input.stixId,
    indicatorType: input.indicatorType,
    indicatorValue: input.indicatorValue,
    indicatorName: input.indicatorName,
    confidence: Math.min(100, Math.max(0, Math.trunc(input.confidence || 0))),
    stixLabels: input.labels,
    validFrom: OneUptimeDate.toClickhouseDateTime64(input.validFrom),
    validUntil: OneUptimeDate.toClickhouseDateTime64(input.validUntil),
    revoked: input.revoked,
    version: input.version,
    retentionDate: OneUptimeDate.toClickhouseDateTime(input.retentionDate),
  } satisfies JSONObject;
}

// Rows a source inserts in one statement, at most.
export const INDICATOR_INSERT_BATCH_SIZE: number = 5000;
