import SecurityBlockEnforcement from "../../../../../Models/DatabaseModels/SecurityBlockEnforcement";
import AnalyticsTableName from "../../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { CLOUDFLARE_BLOCK_RULE_REFS } from "../../../../../Types/SecurityBlocklist/CloudflareBlocking";
import { SecurityBlockAction } from "../../../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityCaseStepCheckSentence } from "../../../../../Types/SecurityCase/SecurityCaseStepCheckEvidence";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  EDGE_ACTIONS_STOPPED_AT_THE_EDGE,
  EDGE_ACTION_ATTRIBUTE,
  EDGE_SAMPLE_INTERVAL_ATTRIBUTE,
} from "../../../../../Types/SecurityEvent/EdgeAction";
import { CLOUDFLARE_ATTRIBUTES } from "../../../../../Utils/SecurityEvent/Connectors/CloudflareNormalizer";
import {
  CHECK_BLOCK_CLOUDFLARE_CHALLENGED,
  CHECK_BLOCK_CLOUDFLARE_CHALLENGED_ABOUT,
  CHECK_BLOCK_CLOUDFLARE_STOPPED,
  CHECK_BLOCK_CLOUDFLARE_STOPPED_ABOUT,
} from "../../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import { getQuerySettings } from "../../../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../../../AnalyticsDatabase/Statement";
import SecurityEventService, {
  SECURITY_CONNECTION_READ_TIME_LIMIT,
} from "../../../../Services/SecurityEventService";
import { sentence } from "../StepCheck";

/*
 * WHAT CLOUDFLARE STOPPED OF AN ADDRESS SINCE ITS BLOCK (#10343): evidence a
 * Cloudflare destination adds to a block it holds, for the case's block
 * step: "Cloudflare has stopped 312 requests from 35.205.11.131 since the
 * block at 10:42."
 *
 * Counted from the firewall events the Cloudflare connection imports (the
 * project's own store: nothing here calls Cloudflare): the address's
 * requests since the block was applied there that OneUptime's rule for the
 * block's action blocked or challenged. The rule is OneUptime's custom rule
 * of that action, by its stable ref; on a plan that took IP Access Rules
 * instead, the access rule the block was written as, which the enforcement
 * row keeps as its providerRef. Each event counts the requests it stands
 * for, its sample interval, and a count read from sampled events says
 * about.
 *
 * A count of none adds nothing: that the app's requests went quiet already
 * says it. A read that fails throws, and the source leaves the fact out.
 */

export interface CloudflareStoppedReading {
  // The requests the events stand for.
  requests: number;
  // Whether any event was sampled, so the count is an estimate.
  isEstimate: boolean;
}

// The vendor the Cloudflare connection imports its events under.
export function getCloudflareVendorName(): string {
  const definition: SecurityEventConnectorDefinition | undefined =
    getSecurityEventConnectorDefinition(
      SecurityEventConnectorProvider.Cloudflare,
    );

  if (!definition) {
    throw new Error("Cloudflare is missing from the connector catalog.");
  }

  return definition.vendorName;
}

/*
 * The SQL that counts them: the address's events from Cloudflare since the
 * block, stopped at the edge by OneUptime's rule for the action (or by the
 * access rule the block is), each the requests of its sample interval.
 */
export function buildCloudflareStoppedStatement(data: {
  projectId: ObjectID;
  address: string;
  action: SecurityBlockAction;
  // The access rule the block was written as, on a plan without lists to spare.
  accessRuleId: string | null;
  since: Date;
  until: Date;
}): Statement {
  const statement: Statement = SQL`SELECT sum(greatest(toUInt64(1), toUInt64OrZero(attributes[${{
    type: TableColumnType.Text,
    value: EDGE_SAMPLE_INTERVAL_ATTRIBUTE,
  }}]))) AS requests, max(toUInt64OrZero(attributes[${{
    type: TableColumnType.Text,
    value: EDGE_SAMPLE_INTERVAL_ATTRIBUTE,
  }}])) AS maxSampleInterval FROM ${AnalyticsTableName.SecurityEvent} WHERE projectId = ${{
    type: TableColumnType.ObjectID,
    value: data.projectId,
  }} AND time >= ${{
    type: TableColumnType.DateTime64,
    value: data.since,
  }} AND time <= ${{
    type: TableColumnType.DateTime64,
    value: data.until,
  }} AND principalIp = ${{
    type: TableColumnType.Text,
    value: data.address,
  }} AND vendorName = ${{
    type: TableColumnType.Text,
    value: getCloudflareVendorName(),
  }} AND attributes[${{
    type: TableColumnType.Text,
    value: EDGE_ACTION_ATTRIBUTE,
  }}] IN (${{
    type: TableColumnType.Text,
    value: new Includes([...EDGE_ACTIONS_STOPPED_AT_THE_EDGE]),
  }}) AND (attributes[${{
    type: TableColumnType.Text,
    value: CLOUDFLARE_ATTRIBUTES.ruleRef,
  }}] = ${{
    type: TableColumnType.Text,
    value: CLOUDFLARE_BLOCK_RULE_REFS[data.action],
  }}`;

  if (data.accessRuleId) {
    statement.append(
      SQL` OR attributes[${{
        type: TableColumnType.Text,
        value: CLOUDFLARE_ATTRIBUTES.ruleId,
      }}] = ${{
        type: TableColumnType.Text,
        value: data.accessRuleId,
      }}`,
    );
  }

  statement.append(SQL`)`);
  statement.append(getQuerySettings(SECURITY_CONNECTION_READ_TIME_LIMIT));

  return statement;
}

// What the count's row says: none when nothing matched.
export function readCloudflareStoppedRow(
  row: JSONObject | undefined,
): CloudflareStoppedReading {
  const requests: number = Number(row?.["requests"] || 0);
  const maxSampleInterval: number = Number(row?.["maxSampleInterval"] || 0);

  return {
    requests: Number.isFinite(requests) && requests > 0 ? requests : 0,
    isEstimate: Number.isFinite(maxSampleInterval) && maxSampleInterval > 1,
  };
}

// The step's fact of it, or none when Cloudflare stopped nothing.
export function getCloudflareStoppedFact(data: {
  address: string;
  action: SecurityBlockAction;
  appliedAt: Date;
  reading: CloudflareStoppedReading;
}): SecurityCaseStepCheckSentence | null {
  if (data.reading.requests <= 0) {
    return null;
  }

  const isChallenge: boolean = data.action === SecurityBlockAction.Challenge;

  return sentence(
    isChallenge
      ? data.reading.isEstimate
        ? CHECK_BLOCK_CLOUDFLARE_CHALLENGED_ABOUT
        : CHECK_BLOCK_CLOUDFLARE_CHALLENGED
      : data.reading.isEstimate
        ? CHECK_BLOCK_CLOUDFLARE_STOPPED_ABOUT
        : CHECK_BLOCK_CLOUDFLARE_STOPPED,
    { address: data.address },
    { count: data.reading.requests, times: { time: data.appliedAt } },
  );
}

/*
 * The facts a Cloudflare destination adds to a block it holds: how many of
 * the address's requests it stopped since it applied the block. Throws when
 * the events cannot be read.
 */
export async function readCloudflareStoppedFacts(data: {
  projectId: ObjectID;
  address: string;
  action: SecurityBlockAction;
  row: Pick<SecurityBlockEnforcement, "appliedAt" | "providerRef">;
  appliedAt: Date;
  now: Date;
}): Promise<Array<SecurityCaseStepCheckSentence>> {
  const result: Awaited<ReturnType<typeof SecurityEventService.executeQuery>> =
    await SecurityEventService.executeQuery(
      buildCloudflareStoppedStatement({
        projectId: data.projectId,
        address: data.address,
        action: data.action,
        accessRuleId: data.row.providerRef || null,
        since: data.appliedAt,
        until: data.now,
      }),
    );
  const response: { data?: Array<JSONObject> } = await result.json<{
    data?: Array<JSONObject>;
  }>();
  const fact: SecurityCaseStepCheckSentence | null = getCloudflareStoppedFact({
    address: data.address,
    action: data.action,
    appliedAt: data.appliedAt,
    reading: readCloudflareStoppedRow(response.data?.[0]),
  });

  return fact ? [fact] : [];
}
