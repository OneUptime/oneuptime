import {
  CLOUD_COST_DEFAULT_CURRENCY,
  CloudCostState,
  addUtcDays,
  roundCost,
  toCloudCostDay,
} from "../../../../Types/Cloud/CloudCost";
import { CloudCommitmentKind } from "../../../../Types/Cloud/CloudCommitments";
import {
  CloudCommitmentScope,
  CloudCommitmentState,
  readCloudCommitmentPaymentOption,
  readCloudCommitmentTermMonths,
} from "../../../../Types/Cloud/CloudCommitmentInventory";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import {
  readArray,
  readObject,
  readText,
} from "../../LlmObservability/LlmProviderHttp";
import {
  CloudCommitmentInventoryRead,
  CloudCommitmentRecord,
  CloudConnectorCallOptions,
  CloudReadBudget,
  CloudReadBudgetSpent,
} from "../CloudConnectorTypes";
import { getAwsCommitmentWindow } from "./AwsCommitments";
import {
  AwsCredentials,
  awsErrorCodeOf,
  getAwsHost,
  getAwsPartition,
  sendAwsRequest,
  sendAwsRestRequest,
} from "./AwsApi";

/*
 * EVERY SAVINGS PLAN AND RESERVED INSTANCE OF AN AWS ACCOUNT, OR OF AN
 * ORGANIZATION FROM ITS MANAGEMENT ACCOUNT (#11011) - from Cost Explorer
 * (AWS JSON 1.1, us-east-1, $0.01 a request), over the last 30 full days
 * and, for what an under-use alert judges, the last 7:
 *
 *   GetSavingsPlansUtilizationDetails { TimePeriod, NextToken }
 *     -> { SavingsPlansUtilizationDetails: [{ SavingsPlanArn, Attributes:
 *          { AccountId, Region, InstanceFamily, StartDateTime, EndDateTime,
 *            PaymentOption, PurchaseTerm, SavingsPlansType, UpfrontFee,
 *            RecurringHourlyFee, ... }, Utilization: { TotalCommitment,
 *          UsedCommitment, UnusedCommitment, UtilizationPercentage },
 *          Savings: { NetSavings, OnDemandCostEquivalent },
 *          AmortizedCommitment: { TotalAmortizedCommitment } }], NextToken }
 *   GetReservationUtilization { TimePeriod, GroupBy: [SUBSCRIPTION_ID],
 *     Filter: SERVICE = one of EC2, RDS, ElastiCache, OpenSearch, Redshift }
 *     -> { UtilizationsByTime: [{ Groups: [{ Value, Attributes: {
 *          AccountId, InstanceType, NumberOfInstances, Platform, Region,
 *          AvailabilityZone, Scope, StartDateTime, EndDateTime,
 *          SubscriptionStatus, SubscriptionType, OfferingType, ... },
 *          Utilization: { UtilizationPercentage, TotalAmortizedFee,
 *          AmortizedUpfrontFee, AmortizedRecurringFee, RICostForUnusedHours,
 *          OnDemandCostOfRIHoursUsed, NetRISavings } }] }], NextPageToken }
 *
 * The 7-day reads are made only for what the 30-day ones found. Cost
 * Explorer's attributes are a map whose keys AWS does not document, so they
 * are read whatever their case. Then, free, from the Savings Plans API:
 *
 *   savingsplans:DescribeSavingsPlans (REST JSON, POST /DescribeSavingsPlans,
 *   savingsplans.amazonaws.com) { states: [active, queued, ...] }
 *     -> { savingsPlans: [{ savingsPlanArn, savingsPlanId, state, start,
 *          end, commitment, upfrontPaymentAmount, recurringPaymentAmount,
 *          paymentOption, termDurationInSeconds, savingsPlanType, region,
 *          ec2InstanceFamily, currency }], nextToken }
 *
 * for the calling account's own plans: their hourly commitment and fees as
 * bought, and the ones queued to start when another ends - a renewal, which
 * no expiry alert should be raised for. A role that may not read it is
 * said, and the rest is read without it.
 */

const PROVIDER_TITLE: string = "AWS";
const SAVINGS_PLANS_DETAILS_TARGET: string =
  "AWSInsightsIndexService.GetSavingsPlansUtilizationDetails";
const RESERVATION_UTILIZATION_TARGET: string =
  "AWSInsightsIndexService.GetReservationUtilization";

// The services whose reservations are listed, one request each: Cost Explorer's own names.
export const AWS_RESERVATION_INVENTORY_SERVICES: ReadonlyArray<string> = [
  "Amazon Elastic Compute Cloud - Compute",
  "Amazon Relational Database Service",
  "Amazon ElastiCache",
  "Amazon OpenSearch Service",
  "Amazon Redshift",
];

// Pages of one list at most: each is $0.01, and holds 20 plans or more.
export const AWS_COMMITMENT_INVENTORY_MAX_PAGES: number = 10;

// The days the under-use alert judges.
export const AWS_COMMITMENT_WEEK_DAYS: number = 7;

// The IAM actions the inventory is read with, as a refusal names them.
export const AWS_COMMITMENT_INVENTORY_ACTIONS: ReadonlyArray<string> = [
  "ce:GetSavingsPlansUtilizationDetails",
  "ce:GetReservationUtilization",
  "savingsplans:DescribeSavingsPlans",
];

interface InventoryCall {
  credentials: AwsCredentials;
  region: string;
  options: CloudConnectorCallOptions;
  budget: CloudReadBudget;
}

// An amount as Cost Explorer writes it: text ("120.5"), or a number.
function readAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const amount: number =
    typeof value === "number" ? value : Number(readText(value));
  return Number.isFinite(amount) ? amount : null;
}

/*
 * One of Cost Explorer's attributes, whatever the case of its key: AWS
 * does not document the keys of the map, and writes some in CamelCase and
 * some in lower case.
 */
export function readAwsAttribute(
  attributes: JSONObject,
  ...names: Array<string>
): string {
  const byLowerKey: Map<string, unknown> = new Map();

  for (const [key, value] of Object.entries(attributes)) {
    byLowerKey.set(key.toLowerCase(), value);
  }

  for (const name of names) {
    const value: unknown = byLowerKey.get(name.toLowerCase());
    const text: string = readText(value);

    if (text) {
      return text;
    }
  }

  return "";
}

function readDate(value: string): Date | null {
  const time: number = Date.parse(value);
  return Number.isFinite(time) ? new Date(time) : null;
}

// The id at an ARN's end: "arn:aws:savingsplans::1:savingsplan/abc" -> "abc".
function arnTail(arn: string): string {
  const slash: number = arn.lastIndexOf("/");
  return slash >= 0 ? arn.slice(slash + 1) : arn;
}

// The account in an ARN: arn:aws:savingsplans::123456789012:savingsplan/abc.
function arnAccount(arn: string): string {
  const parts: Array<string> = arn.split(":");
  return parts.length >= 5 ? parts[4] || "" : "";
}

function timePeriod(window: { start: Date; end: Date }): JSONObject {
  return {
    Start: toCloudCostDay(window.start),
    End: toCloudCostDay(window.end),
  };
}

async function send(
  call: InventoryCall,
  target: string,
  body: JSONObject,
  step: string,
): Promise<JSONObject | null> {
  try {
    const answer: { json: JSONObject } = await sendAwsRequest({
      transport: call.options.transport,
      credentials: call.credentials,
      service: "ce",
      region: call.region,
      target,
      jsonVersion: "1.1",
      body,
      step,
      providerTitle: PROVIDER_TITLE,
      now: call.options.now,
      timeoutInMs: call.options.requestTimeoutInMs,
      sleep: call.options.sleep,
      budget: call.budget,
    });

    return answer.json;
  } catch (error) {
    const text: string =
      error instanceof LlmProviderError
        ? error.responseBody || error.message
        : error instanceof Error
          ? error.message
          : String(error);

    // Nothing of the kind in the window: none to list.
    if (awsErrorCodeOf(text) === "DataUnavailableException") {
      return null;
    }

    throw error;
  }
}

// One Savings Plan's utilization detail, as Cost Explorer answers it.
export interface AwsSavingsPlanDetail {
  arn: string;
  attributes: JSONObject;
  utilization: JSONObject;
  savings: JSONObject;
  amortized: JSONObject;
}

/*
 * Every Savings Plan's figures over a window, by its ARN. `complete` is
 * false when it stopped at its page limit.
 */
export async function readAwsSavingsPlansDetails(
  call: InventoryCall & { window: { start: Date; end: Date } },
): Promise<{ plans: Map<string, AwsSavingsPlanDetail>; complete: boolean }> {
  const plans: Map<string, AwsSavingsPlanDetail> = new Map();
  let token: string = "";

  for (let page: number = 0; page < AWS_COMMITMENT_INVENTORY_MAX_PAGES; page++) {
    const body: JSONObject = { TimePeriod: timePeriod(call.window) };

    if (token) {
      body["NextToken"] = token;
    }

    const answer: JSONObject | null = await send(
      call,
      SAVINGS_PLANS_DETAILS_TARGET,
      body,
      "Savings Plans list request",
    );

    if (!answer) {
      return { plans, complete: true };
    }

    for (const raw of readArray(answer["SavingsPlansUtilizationDetails"])) {
      const detail: JSONObject = readObject(raw);
      const arn: string = readText(detail["SavingsPlanArn"]);

      if (!arn) {
        continue;
      }

      plans.set(arn, {
        arn,
        attributes: readObject(detail["Attributes"]),
        utilization: readObject(detail["Utilization"]),
        savings: readObject(detail["Savings"]),
        amortized: readObject(detail["AmortizedCommitment"]),
      });
    }

    const next: string = readText(answer["NextToken"]);

    if (!next || next === token) {
      return { plans, complete: true };
    }

    token = next;
  }

  return { plans, complete: false };
}

// One reservation's utilization group, as Cost Explorer answers it.
export interface AwsReservationDetail {
  subscriptionId: string;
  service: string;
  attributes: JSONObject;
  utilization: JSONObject;
}

/*
 * Every reservation of one service over a window, by its subscription id.
 * `complete` is false when it stopped at its page limit.
 */
export async function readAwsReservationDetails(
  call: InventoryCall & {
    window: { start: Date; end: Date };
    service: string;
  },
): Promise<{
  reservations: Map<string, AwsReservationDetail>;
  complete: boolean;
}> {
  const reservations: Map<string, AwsReservationDetail> = new Map();
  let token: string = "";

  for (let page: number = 0; page < AWS_COMMITMENT_INVENTORY_MAX_PAGES; page++) {
    const body: JSONObject = {
      TimePeriod: timePeriod(call.window),
      GroupBy: [{ Type: "DIMENSION", Key: "SUBSCRIPTION_ID" }],
      Filter: { Dimensions: { Key: "SERVICE", Values: [call.service] } },
    };

    if (token) {
      body["NextPageToken"] = token;
    }

    const answer: JSONObject | null = await send(
      call,
      RESERVATION_UTILIZATION_TARGET,
      body,
      "reservation list request",
    );

    if (!answer) {
      return { reservations, complete: true };
    }

    for (const rawPeriod of readArray(answer["UtilizationsByTime"])) {
      for (const rawGroup of readArray(readObject(rawPeriod)["Groups"])) {
        const group: JSONObject = readObject(rawGroup);
        const attributes: JSONObject = readObject(group["Attributes"]);
        const subscriptionId: string =
          readText(group["Value"]) ||
          readAwsAttribute(attributes, "SubscriptionId");

        if (!subscriptionId) {
          continue;
        }

        reservations.set(subscriptionId, {
          subscriptionId,
          service: call.service,
          attributes,
          utilization: readObject(group["Utilization"]),
        });
      }
    }

    const next: string = readText(answer["NextPageToken"]);

    if (!next || next === token) {
      return { reservations, complete: true };
    }

    token = next;
  }

  return { reservations, complete: false };
}

// One Savings Plan as the Savings Plans API describes it.
export interface AwsDescribedSavingsPlan {
  arn: string;
  id: string;
  state: string;
  start: string;
  end: string;
  commitment: number | null;
  upfrontPaymentAmount: number | null;
  recurringPaymentAmount: number | null;
  paymentOption: string;
  termDurationInSeconds: number | null;
  savingsPlanType: string;
  region: string;
  ec2InstanceFamily: string;
  currency: string;
}

// The states of a plan worth knowing: what it pays for, and what is coming.
export const AWS_DESCRIBED_SAVINGS_PLAN_STATES: ReadonlyArray<string> = [
  "active",
  "queued",
  "payment-pending",
];

/*
 * Where the Savings Plans API answers, as its endpoint rules (botocore's
 * savingsplans 2019-06-28 rule set) say: one global endpoint, signed for
 * us-east-1, for the commercial partition; the Region's own elsewhere -
 * China's at savingsplans.cn-northwest-1.amazonaws.com.cn.
 */
export function getAwsSavingsPlansEndpoint(costRegion: string): {
  host: string;
  region: string;
} {
  if (getAwsPartition(costRegion) === "aws") {
    return { host: "savingsplans.amazonaws.com", region: "us-east-1" };
  }

  return {
    host: getAwsHost("savingsplans", costRegion),
    region: costRegion.trim(),
  };
}

/*
 * The calling account's own Savings Plans, as bought - active, queued and
 * awaiting payment. Free; read in pages of 1,000.
 */
export async function describeAwsSavingsPlans(
  call: InventoryCall,
): Promise<Array<AwsDescribedSavingsPlan>> {
  const plans: Array<AwsDescribedSavingsPlan> = [];
  const endpoint: { host: string; region: string } =
    getAwsSavingsPlansEndpoint(call.region);
  let token: string = "";

  for (let page: number = 0; page < AWS_COMMITMENT_INVENTORY_MAX_PAGES; page++) {
    const body: JSONObject = {
      states: [...AWS_DESCRIBED_SAVINGS_PLAN_STATES],
      maxResults: 1000,
    };

    if (token) {
      body["nextToken"] = token;
    }

    const answer: { json: JSONObject | undefined } = await sendAwsRestRequest({
      transport: call.options.transport,
      credentials: call.credentials,
      service: "savingsplans",
      region: endpoint.region,
      host: endpoint.host,
      method: "POST",
      path: "/DescribeSavingsPlans",
      body: JSON.stringify(body),
      step: "Savings Plans describe request",
      providerTitle: PROVIDER_TITLE,
      now: call.options.now,
      timeoutInMs: call.options.requestTimeoutInMs,
      sleep: call.options.sleep,
      budget: call.budget,
      isSafeToRepeat: true,
    });
    const json: JSONObject = answer.json || {};

    for (const raw of readArray(json["savingsPlans"])) {
      const plan: JSONObject = readObject(raw);
      const arn: string = readText(plan["savingsPlanArn"]);

      if (!arn) {
        continue;
      }

      plans.push({
        arn,
        id: readText(plan["savingsPlanId"]) || arnTail(arn),
        state: readText(plan["state"]),
        start: readText(plan["start"]),
        end: readText(plan["end"]),
        commitment: readAmount(plan["commitment"]),
        upfrontPaymentAmount: readAmount(plan["upfrontPaymentAmount"]),
        recurringPaymentAmount: readAmount(plan["recurringPaymentAmount"]),
        paymentOption: readText(plan["paymentOption"]),
        termDurationInSeconds: readAmount(plan["termDurationInSeconds"]),
        savingsPlanType: readText(plan["savingsPlanType"]),
        region: readText(plan["region"]),
        ec2InstanceFamily: readText(plan["ec2InstanceFamily"]),
        currency: readText(plan["currency"]),
      });
    }

    const next: string = readText(json["nextToken"]);

    if (!next || next === token) {
      break;
    }

    token = next;
  }

  return plans;
}

/*
 * A Savings Plans type as people say it: "ComputeSavingsPlans", "Compute"
 * -> "Compute Savings Plans"; "EC2Instance" -> "EC2 Instance Savings
 * Plans". Cloud product names, kept as AWS writes them.
 */
export function describeAwsSavingsPlanType(type: string): string {
  const key: string = type.toLowerCase().replace(/[^a-z0-9]/g, "");

  if (key.startsWith("compute")) {
    return "Compute Savings Plans";
  }

  if (key.startsWith("ec2instance")) {
    return "EC2 Instance Savings Plans";
  }

  if (key.startsWith("sagemaker")) {
    return "SageMaker Savings Plans";
  }

  if (key.startsWith("database")) {
    return "Database Savings Plans";
  }

  return type || "Savings Plans";
}

// A Savings Plans API state as OneUptime's.
export function readAwsSavingsPlanState(state: string): CloudCommitmentState {
  switch (state.trim().toLowerCase()) {
    case "active":
      return CloudCommitmentState.Active;
    case "queued":
      return CloudCommitmentState.Queued;
    case "payment-pending":
    case "payment-failed":
    case "pending-return":
      return CloudCommitmentState.Pending;
    default:
      return CloudCommitmentState.Retired;
  }
}

// A reservation's status as Cost Explorer writes it, as OneUptime's.
export function readAwsReservationState(status: string): CloudCommitmentState {
  const text: string = status.trim().toLowerCase();

  if (text === "active" || text === "") {
    return CloudCommitmentState.Active;
  }

  if (text.includes("pending")) {
    return CloudCommitmentState.Pending;
  }

  if (text.includes("expired")) {
    return CloudCommitmentState.Expired;
  }

  return CloudCommitmentState.Retired;
}

// Whole months between two dates: a reservation's term from its dates.
function monthsBetween(start: Date | null, end: Date | null): number | null {
  if (!start || !end || end.getTime() <= start.getTime()) {
    return null;
  }

  const days: number = (end.getTime() - start.getTime()) / (24 * 3600 * 1000);
  // A one-year term is 365 or 366 days: rounded to whole years first.
  const years: number = Math.round(days / 365);

  return years > 0 ? years * 12 : Math.max(1, Math.round(days / 30.44));
}

/*
 * The plans and reservations as OneUptime keeps them: each with what it
 * commits to, and what of it was used and covered over the last 30 and 7
 * days. A plan the Savings Plans API describes and Cost Explorer does not
 * list - one queued to start - is kept as it is described.
 */
export function buildAwsCommitmentRecords(data: {
  savingsPlans: Map<string, AwsSavingsPlanDetail>;
  savingsPlansWeek: Map<string, AwsSavingsPlanDetail>;
  reservations: Array<AwsReservationDetail>;
  reservationsWeek: Map<string, AwsReservationDetail>;
  described: Array<AwsDescribedSavingsPlan>;
  // The account read, or the organization's management account.
  readAccountId: string;
  isOrganization: boolean;
  windowDays: number;
  weekDays: number;
}): Array<CloudCommitmentRecord> {
  const records: Array<CloudCommitmentRecord> = [];
  const describedByArn: Map<string, AwsDescribedSavingsPlan> = new Map();
  const scope: CloudCommitmentScope = data.isOrganization
    ? CloudCommitmentScope.Shared
    : CloudCommitmentScope.Account;
  const windowHours: number = data.windowDays * 24;

  for (const plan of data.described) {
    describedByArn.set(plan.arn, plan);
  }

  for (const detail of data.savingsPlans.values()) {
    const attributes: JSONObject = detail.attributes;
    const described: AwsDescribedSavingsPlan | undefined = describedByArn.get(
      detail.arn,
    );
    const week: AwsSavingsPlanDetail | undefined = data.savingsPlansWeek.get(
      detail.arn,
    );
    const totalCommitment: number | null = readAmount(
      detail.utilization["TotalCommitment"],
    );
    const startsAt: Date | null = readDate(
      described?.start ||
        readAwsAttribute(attributes, "StartDateTime", "StartDate", "Start"),
    );
    const endsAt: Date | null = readDate(
      described?.end ||
        readAwsAttribute(attributes, "EndDateTime", "EndDate", "End"),
    );
    const hourly: number | null =
      described?.commitment ??
      readAmount(readAwsAttribute(attributes, "HourlyCommitment")) ??
      (totalCommitment !== null ? totalCommitment / windowHours : null);
    const instanceFamily: string =
      described?.ec2InstanceFamily ||
      readAwsAttribute(attributes, "InstanceFamily", "InstanceTypeFamily");
    const weekCommitment: number | null = week
      ? readAmount(week.utilization["TotalCommitment"])
      : null;

    records.push({
      accountId:
        readAwsAttribute(attributes, "AccountId", "LinkedAccount") ||
        arnAccount(detail.arn) ||
        data.readAccountId,
      commitmentId: detail.arn,
      kind: CloudCommitmentKind.SavingsPlans,
      name: described?.id || arnTail(detail.arn),
      commitmentType: describeAwsSavingsPlanType(
        described?.savingsPlanType ||
          readAwsAttribute(attributes, "SavingsPlansType", "SavingsPlanType"),
      ),
      covers: instanceFamily,
      region:
        described?.region || readAwsAttribute(attributes, "Region") || "",
      scope,
      appliesTo: "",
      termMonths: readCloudCommitmentTermMonths(
        described?.termDurationInSeconds ??
          readAwsAttribute(attributes, "PurchaseTerm", "Term"),
      ),
      paymentOption: readCloudCommitmentPaymentOption(
        described?.paymentOption ||
          readAwsAttribute(attributes, "PaymentOption"),
      ),
      startsAt,
      endsAt,
      state: described
        ? readAwsSavingsPlanState(described.state)
        : CloudCommitmentState.Active,
      isAutoRenew: null,
      hourlyCommitment: hourly === null ? null : roundCost(hourly),
      quantity: null,
      upfrontCost:
        described?.upfrontPaymentAmount ??
        readAmount(readAwsAttribute(attributes, "UpfrontFee")),
      recurringHourlyCost:
        described?.recurringPaymentAmount ??
        readAmount(readAwsAttribute(attributes, "RecurringHourlyFee")),
      currency: described?.currency || CLOUD_COST_DEFAULT_CURRENCY,
      utilizationPercent: readAmount(
        detail.utilization["UtilizationPercentage"],
      ),
      weekUtilizationPercent: week
        ? readAmount(week.utilization["UtilizationPercentage"])
        : null,
      figures: {
        days: data.windowDays,
        commitmentCost:
          readAmount(detail.amortized["TotalAmortizedCommitment"]) ??
          totalCommitment,
        usedCost: readAmount(detail.utilization["UsedCommitment"]),
        unusedCost: readAmount(detail.utilization["UnusedCommitment"]),
        coveredOnDemandCost: readAmount(
          detail.savings["OnDemandCostEquivalent"],
        ),
        netSavings: readAmount(detail.savings["NetSavings"]),
        weekCommitmentCost: weekCommitment,
        weekUnusedCost: week
          ? readAmount(week.utilization["UnusedCommitment"])
          : null,
      },
      service: "",
    });
  }

  // The plans Cost Explorer does not list yet: queued to start, or awaiting payment.
  for (const plan of data.described) {
    if (data.savingsPlans.has(plan.arn)) {
      continue;
    }

    records.push({
      accountId: arnAccount(plan.arn) || data.readAccountId,
      commitmentId: plan.arn,
      kind: CloudCommitmentKind.SavingsPlans,
      name: plan.id,
      commitmentType: describeAwsSavingsPlanType(plan.savingsPlanType),
      covers: plan.ec2InstanceFamily,
      region: plan.region,
      scope,
      appliesTo: "",
      termMonths: readCloudCommitmentTermMonths(plan.termDurationInSeconds),
      paymentOption: readCloudCommitmentPaymentOption(plan.paymentOption),
      startsAt: readDate(plan.start),
      endsAt: readDate(plan.end),
      state: readAwsSavingsPlanState(plan.state),
      isAutoRenew: null,
      hourlyCommitment: plan.commitment,
      quantity: null,
      upfrontCost: plan.upfrontPaymentAmount,
      recurringHourlyCost: plan.recurringPaymentAmount,
      currency: plan.currency || CLOUD_COST_DEFAULT_CURRENCY,
      utilizationPercent: null,
      weekUtilizationPercent: null,
      figures: null,
      service: "",
    });
  }

  for (const reservation of data.reservations) {
    const attributes: JSONObject = reservation.attributes;
    const utilization: JSONObject = reservation.utilization;
    const week: AwsReservationDetail | undefined = data.reservationsWeek.get(
      `${reservation.service}|${reservation.subscriptionId}`,
    );
    const startsAt: Date | null = readDate(
      readAwsAttribute(attributes, "StartDateTime", "StartDate"),
    );
    const endsAt: Date | null = readDate(
      readAwsAttribute(attributes, "EndDateTime", "EndDate"),
    );
    const termMonths: number | null = monthsBetween(startsAt, endsAt);
    const count: number | null = readAmount(
      readAwsAttribute(attributes, "NumberOfInstances", "NumberOfNodes"),
    );
    const instanceType: string = readAwsAttribute(
      attributes,
      "InstanceType",
      "NodeType",
    );
    const platform: string = readAwsAttribute(attributes, "Platform");
    const zone: string = readAwsAttribute(attributes, "AvailabilityZone");
    const totalFee: number | null = readAmount(utilization["TotalAmortizedFee"]);
    const unused: number | null = readAmount(
      utilization["RICostForUnusedHours"],
    );
    const upfrontInWindow: number | null = readAmount(
      utilization["AmortizedUpfrontFee"],
    );
    const recurringInWindow: number | null = readAmount(
      utilization["AmortizedRecurringFee"],
    );
    const offering: string = readAwsAttribute(
      attributes,
      "OfferingType",
      "OfferingClass",
    );
    const covers: string = [
      count !== null && instanceType
        ? `${count} × ${instanceType}`
        : instanceType,
      platform,
      zone,
    ]
      .filter((part: string): boolean => {
        return Boolean(part);
      })
      .join(", ");

    records.push({
      /*
       * Its account: AWS's own example answer writes the key of one as ""
       * rather than "AccountId", so that is read too.
       */
      accountId:
        readAwsAttribute(attributes, "AccountId", "LinkedAccount", "") ||
        data.readAccountId,
      commitmentId: `${reservation.service}/${reservation.subscriptionId}`,
      kind: CloudCommitmentKind.Reservations,
      name:
        readAwsAttribute(attributes, "LeaseId", "ReservationId") ||
        reservation.subscriptionId,
      commitmentType: offering
        ? `${reservation.service} (${offering})`
        : reservation.service,
      covers,
      region: readAwsAttribute(attributes, "Region"),
      scope,
      appliesTo: "",
      termMonths,
      paymentOption: readCloudCommitmentPaymentOption(
        readAwsAttribute(attributes, "SubscriptionType", "PaymentOption"),
      ),
      startsAt,
      endsAt,
      state: readAwsReservationState(
        readAwsAttribute(attributes, "SubscriptionStatus", "Status"),
      ),
      isAutoRenew: null,
      hourlyCommitment: null,
      quantity: count,
      upfrontCost:
        upfrontInWindow !== null && termMonths
          ? roundCost(
              (upfrontInWindow / data.windowDays) * (termMonths * 30.4375),
            )
          : null,
      recurringHourlyCost:
        recurringInWindow !== null
          ? roundCost(recurringInWindow / windowHours)
          : null,
      currency: CLOUD_COST_DEFAULT_CURRENCY,
      utilizationPercent: readAmount(utilization["UtilizationPercentage"]),
      weekUtilizationPercent: week
        ? readAmount(week.utilization["UtilizationPercentage"])
        : null,
      figures: {
        days: data.windowDays,
        commitmentCost: totalFee,
        usedCost:
          totalFee !== null && unused !== null
            ? roundCost(totalFee - unused)
            : null,
        unusedCost: unused,
        coveredOnDemandCost: readAmount(
          utilization["OnDemandCostOfRIHoursUsed"],
        ),
        netSavings: readAmount(utilization["NetRISavings"]),
        weekCommitmentCost: week
          ? readAmount(week.utilization["TotalAmortizedFee"])
          : null,
        weekUnusedCost: week
          ? readAmount(week.utilization["RICostForUnusedHours"])
          : null,
      },
      service: reservation.service,
    });
  }

  return records;
}

// The window of the under-use figures: the last 7 days of the 30-day one.
export function getAwsCommitmentWeekWindow(now: Date): {
  start: Date;
  end: Date;
} {
  const window: { start: Date; end: Date } = getAwsCommitmentWindow(now);

  return {
    start: addUtcDays(window.end, -AWS_COMMITMENT_WEEK_DAYS),
    end: window.end,
  };
}

/*
 * Why the commitments could not be listed, in words the person can act
 * on: a refusal is fixed by running the setup command again.
 */
export function describeAwsCommitmentInventoryFailure(error: unknown): {
  state: CloudCostState;
  message: string;
} {
  if (error instanceof CloudReadBudgetSpent) {
    return {
      state: CloudCostState.Failed,
      message:
        "The read reached its limit before every commitment was listed: they are listed again tomorrow.",
    };
  }

  if (
    error instanceof LlmProviderError &&
    error.kind === CloudConnectionFailureKind.Permission
  ) {
    return {
      state: CloudCostState.NotAllowed,
      message: `The role may not list Savings Plans and Reserved Instances (${AWS_COMMITMENT_INVENTORY_ACTIONS.join(
        ", ",
      )}). Run the setup command again to allow it.`,
    };
  }

  return {
    state: CloudCostState.Failed,
    message: (error instanceof Error ? error.message : String(error)).slice(
      0,
      500,
    ),
  };
}

/*
 * Every commitment the credential reaches: an account's, or an
 * organization's from its management account. A refused credential is
 * thrown, as every read throws it; anything else is said, and nothing is
 * listed.
 */
export async function readAwsCommitmentInventory(
  call: InventoryCall & {
    now: Date;
    readAccountId: string;
    isOrganization: boolean;
  },
): Promise<CloudCommitmentInventoryRead> {
  const window: { start: Date; end: Date } = getAwsCommitmentWindow(call.now);
  const weekWindow: { start: Date; end: Date } = getAwsCommitmentWeekWindow(
    call.now,
  );
  const windowDays: number = Math.round(
    (window.end.getTime() - window.start.getTime()) / (24 * 3600 * 1000),
  );

  try {
    const month: {
      plans: Map<string, AwsSavingsPlanDetail>;
      complete: boolean;
    } = await readAwsSavingsPlansDetails({ ...call, window });
    const week: {
      plans: Map<string, AwsSavingsPlanDetail>;
      complete: boolean;
    } =
      month.plans.size > 0
        ? await readAwsSavingsPlansDetails({ ...call, window: weekWindow })
        : { plans: new Map(), complete: true };
    const reservations: Array<AwsReservationDetail> = [];
    const reservationsWeek: Map<string, AwsReservationDetail> = new Map();
    let complete: boolean = month.complete && week.complete;

    for (const service of AWS_RESERVATION_INVENTORY_SERVICES) {
      const read: {
        reservations: Map<string, AwsReservationDetail>;
        complete: boolean;
      } = await readAwsReservationDetails({ ...call, window, service });

      complete = complete && read.complete;
      reservations.push(...Array.from(read.reservations.values()));

      if (read.reservations.size === 0) {
        continue;
      }

      const weekRead: {
        reservations: Map<string, AwsReservationDetail>;
        complete: boolean;
      } = await readAwsReservationDetails({
        ...call,
        window: weekWindow,
        service,
      });

      complete = complete && weekRead.complete;

      for (const [subscriptionId, detail] of weekRead.reservations) {
        reservationsWeek.set(`${service}|${subscriptionId}`, detail);
      }
    }

    /*
     * The plans as bought: optional - Cost Explorer has listed every plan
     * that ran, so whatever the Savings Plans API answers (a role that may
     * not call it, or a partition it is not in, refusing the credential
     * Cost Explorer just took), the rest is still listed.
     */
    let described: Array<AwsDescribedSavingsPlan> = [];
    let message: string | undefined;

    try {
      described = await describeAwsSavingsPlans(call);
    } catch (error) {
      if (error instanceof CloudReadBudgetSpent) {
        throw error;
      }

      message =
        error instanceof LlmProviderError &&
        error.kind === CloudConnectionFailureKind.Permission
          ? "The role may not read the Savings Plans API (savingsplans:DescribeSavingsPlans), so plans queued to start are not listed. Run the setup command again to allow it."
          : `The Savings Plans API could not be read, so plans queued to start are not listed: ${(error instanceof Error
              ? error.message
              : String(error)
            ).slice(0, 400)}`;
    }

    return {
      records: buildAwsCommitmentRecords({
        savingsPlans: month.plans,
        savingsPlansWeek: week.plans,
        reservations,
        reservationsWeek,
        described,
        readAccountId: call.readAccountId,
        isOrganization: call.isOrganization,
        windowDays,
        weekDays: AWS_COMMITMENT_WEEK_DAYS,
      }),
      complete,
      state: CloudCostState.Reading,
      ...(message ? { message } : {}),
    };
  } catch (error) {
    if (
      error instanceof LlmProviderError &&
      error.kind === CloudConnectionFailureKind.Authentication
    ) {
      throw error;
    }

    const failure: { state: CloudCostState; message: string } =
      describeAwsCommitmentInventoryFailure(error);

    return {
      records: [],
      complete: false,
      state: failure.state,
      message: failure.message,
    };
  }
}
