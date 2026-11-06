import {
  CLOUD_COST_DEFAULT_CURRENCY,
  CloudCostState,
  addUtcDays,
  roundCost,
  startOfUtcDay,
  toCloudCostDay,
} from "../../../../Types/Cloud/CloudCost";
import {
  CLOUD_COMMITMENT_WINDOW_DAYS,
  CloudCommitmentKind,
  CloudCommitmentKindFigures,
  CloudCommitmentSummary,
} from "../../../../Types/Cloud/CloudCommitments";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import {
  readArray,
  readObject,
  readText,
} from "../../LlmObservability/LlmProviderHttp";
import {
  CloudConnectorCallOptions,
  CloudReadBudget,
  CloudReadBudgetSpent,
} from "../CloudConnectorTypes";
import { AwsCredentials, awsErrorCodeOf, sendAwsRequest } from "./AwsApi";

/*
 * HOW MUCH OF AN AWS ACCOUNT'S SPEND ITS COMMITMENTS COVER, AND HOW MUCH OF
 * THEM IS USED - from Cost Explorer (AWS JSON 1.1, us-east-1, $0.01 a
 * request), over the last 30 full days, four requests a day:
 *
 *   GetSavingsPlansCoverage { TimePeriod, Granularity: "MONTHLY" }
 *     -> { SavingsPlansCoverages: [{ Coverage: { SpendCoveredBySavingsPlans,
 *          OnDemandCost } }], NextToken }
 *   GetSavingsPlansUtilization { TimePeriod, Granularity: "MONTHLY" }
 *     -> { Total: { Utilization: { TotalCommitment, UnusedCommitment } } }
 *   GetReservationCoverage { TimePeriod, Granularity, Metrics: ["Hour",
 *     "Cost"], Filter: SERVICE in Amazon EC2 and Amazon RDS }
 *     -> { Total: { CoverageCost: { OnDemandCost } } }
 *   GetReservationUtilization { TimePeriod, Granularity, Filter: the same }
 *     -> { Total: { OnDemandCostOfRIHoursUsed, TotalAmortizedFee,
 *          RICostForUnusedHours } }
 *
 * Savings Plans' covered spend is at on-demand rates, as Cost Explorer
 * reports it; Reserved Instances' is the on-demand cost of the hours they
 * covered. Cost Explorer reports reservations for at most two services at
 * once: Amazon EC2 and Amazon RDS, where most of them are. An account with
 * no Savings Plan or reservation answers the utilisation with
 * DataUnavailableException: it has none, and pays for none.
 *
 * An organization's management account reads every account's at once;
 * the figures go on the management account's summary (isOrganization).
 */

const PROVIDER_TITLE: string = "AWS";
const SAVINGS_PLANS_COVERAGE_TARGET: string =
  "AWSInsightsIndexService.GetSavingsPlansCoverage";
const SAVINGS_PLANS_UTILIZATION_TARGET: string =
  "AWSInsightsIndexService.GetSavingsPlansUtilization";
const RESERVATION_COVERAGE_TARGET: string =
  "AWSInsightsIndexService.GetReservationCoverage";
const RESERVATION_UTILIZATION_TARGET: string =
  "AWSInsightsIndexService.GetReservationUtilization";

// The services Reserved Instances' figures are read for: two, Cost Explorer's limit.
export const AWS_RESERVATION_SERVICES: ReadonlyArray<string> = [
  "Amazon Elastic Compute Cloud - Compute",
  "Amazon Relational Database Service",
];

// Pages of one coverage read at most: a month's window is one or two items.
export const AWS_COMMITMENT_MAX_PAGES: number = 5;

// The IAM actions the commitments are read with, as a refusal names them.
export const AWS_COMMITMENT_ACTIONS: ReadonlyArray<string> = [
  "ce:GetSavingsPlansCoverage",
  "ce:GetSavingsPlansUtilization",
  "ce:GetReservationCoverage",
  "ce:GetReservationUtilization",
];

/*
 * The window: the 30 full days before yesterday. Cost Explorer takes an
 * end before today only, and the newest day is still being reported.
 */
export function getAwsCommitmentWindow(now: Date): { start: Date; end: Date } {
  const end: Date = addUtcDays(startOfUtcDay(now), -1);

  return { start: addUtcDays(end, -CLOUD_COMMITMENT_WINDOW_DAYS), end };
}

// An amount as Cost Explorer writes it: text ("120.5"), or a number.
function readAmount(value: unknown): number {
  const amount: number =
    typeof value === "number" ? value : Number(readText(value));
  return Number.isFinite(amount) ? amount : 0;
}

// Whether Cost Explorer answered that it has nothing for the window.
function isDataUnavailable(error: unknown): boolean {
  const body: string =
    error instanceof LlmProviderError
      ? error.responseBody || error.message
      : error instanceof Error
        ? error.message
        : String(error);

  return awsErrorCodeOf(body) === "DataUnavailableException";
}

interface CommitmentCall {
  credentials: AwsCredentials;
  region: string;
  options: CloudConnectorCallOptions;
  budget: CloudReadBudget;
}

async function send(
  call: CommitmentCall,
  target: string,
  body: JSONObject,
  step: string,
): Promise<JSONObject> {
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
}

/*
 * A read that has nothing to say for the window: an account with no
 * commitment of the kind (DataUnavailableException). Anything else is
 * thrown.
 */
async function sendOrNothing(
  call: CommitmentCall,
  target: string,
  body: JSONObject,
  step: string,
): Promise<JSONObject | null> {
  try {
    return await send(call, target, body, step);
  } catch (error) {
    if (isDataUnavailable(error)) {
      return null;
    }

    throw error;
  }
}

function timePeriod(window: { start: Date; end: Date }): JSONObject {
  return {
    Start: toCloudCostDay(window.start),
    End: toCloudCostDay(window.end),
  };
}

const RESERVATION_FILTER: JSONObject = {
  Dimensions: {
    Key: "SERVICE",
    Values: [...AWS_RESERVATION_SERVICES],
  },
};

// Savings Plans: the spend they covered and what ran on demand, and what of them went unused.
export async function readAwsSavingsPlans(
  call: CommitmentCall & { window: { start: Date; end: Date } },
): Promise<CloudCommitmentKindFigures> {
  let coveredSpend: number = 0;
  let onDemandSpend: number = 0;
  let token: string = "";

  for (let page: number = 0; page < AWS_COMMITMENT_MAX_PAGES; page++) {
    const body: JSONObject = {
      TimePeriod: timePeriod(call.window),
      Granularity: "MONTHLY",
    };

    if (token) {
      body["NextToken"] = token;
    }

    const answer: JSONObject | null = await sendOrNothing(
      call,
      SAVINGS_PLANS_COVERAGE_TARGET,
      body,
      "Savings Plans coverage request",
    );

    if (!answer) {
      break;
    }

    for (const raw of readArray(answer["SavingsPlansCoverages"])) {
      const coverage: JSONObject = readObject(readObject(raw)["Coverage"]);
      coveredSpend += readAmount(coverage["SpendCoveredBySavingsPlans"]);
      onDemandSpend += readAmount(coverage["OnDemandCost"]);
    }

    const next: string = readText(answer["NextToken"]);

    if (!next || next === token) {
      break;
    }

    token = next;
  }

  const utilization: JSONObject | null = await sendOrNothing(
    call,
    SAVINGS_PLANS_UTILIZATION_TARGET,
    { TimePeriod: timePeriod(call.window), Granularity: "MONTHLY" },
    "Savings Plans utilization request",
  );
  const total: JSONObject = readObject(
    readObject(utilization ? utilization["Total"] : {})["Utilization"],
  );

  return {
    kind: CloudCommitmentKind.SavingsPlans,
    coveredSpend: roundCost(coveredSpend),
    onDemandSpend: roundCost(onDemandSpend),
    commitmentSpend: roundCost(readAmount(total["TotalCommitment"])),
    unusedSpend: roundCost(readAmount(total["UnusedCommitment"])),
  };
}

/*
 * Reserved Instances of Amazon EC2 and Amazon RDS: the on-demand cost of
 * the hours they covered and of the hours that ran on demand, and their
 * amortized fee with what of it paid for hours nobody ran.
 */
export async function readAwsReservations(
  call: CommitmentCall & { window: { start: Date; end: Date } },
): Promise<CloudCommitmentKindFigures> {
  const coverage: JSONObject | null = await sendOrNothing(
    call,
    RESERVATION_COVERAGE_TARGET,
    {
      TimePeriod: timePeriod(call.window),
      Granularity: "MONTHLY",
      Metrics: ["Hour", "Cost"],
      Filter: RESERVATION_FILTER,
    },
    "reservation coverage request",
  );

  // The window's total, or each month's added up when no total is given.
  let onDemandSpend: number = 0;
  const total: JSONObject = readObject(coverage ? coverage["Total"] : {});

  if (Object.keys(readObject(total["CoverageCost"])).length > 0) {
    onDemandSpend = readAmount(
      readObject(total["CoverageCost"])["OnDemandCost"],
    );
  } else {
    for (const raw of readArray(coverage ? coverage["CoveragesByTime"] : [])) {
      onDemandSpend += readAmount(
        readObject(readObject(readObject(raw)["Total"])["CoverageCost"])[
          "OnDemandCost"
        ],
      );
    }
  }

  const utilization: JSONObject | null = await sendOrNothing(
    call,
    RESERVATION_UTILIZATION_TARGET,
    {
      TimePeriod: timePeriod(call.window),
      Granularity: "MONTHLY",
      Filter: RESERVATION_FILTER,
    },
    "reservation utilization request",
  );
  const used: JSONObject = readObject(utilization ? utilization["Total"] : {});

  return {
    kind: CloudCommitmentKind.Reservations,
    coveredSpend: roundCost(readAmount(used["OnDemandCostOfRIHoursUsed"])),
    onDemandSpend: roundCost(onDemandSpend),
    commitmentSpend: roundCost(readAmount(used["TotalAmortizedFee"])),
    unusedSpend: roundCost(readAmount(used["RICostForUnusedHours"])),
  };
}

/*
 * Why the commitments could not be read, in words the person can act on:
 * a refusal is fixed by running the setup command again.
 */
export function describeAwsCommitmentFailure(error: unknown): {
  state: CloudCostState;
  message: string;
} {
  if (error instanceof CloudReadBudgetSpent) {
    return {
      state: CloudCostState.Failed,
      message:
        "The read reached its limit before the commitments: they are read again tomorrow.",
    };
  }

  if (
    error instanceof LlmProviderError &&
    error.kind === CloudConnectionFailureKind.Permission
  ) {
    return {
      state: CloudCostState.NotAllowed,
      message: `The role may not read Savings Plans and Reserved Instances from Cost Explorer (${AWS_COMMITMENT_ACTIONS.join(
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
 * Both kinds, as one summary: read, or why not. A refused credential is
 * thrown, as every read throws it.
 */
export async function readAwsCommitments(
  call: CommitmentCall & { now: Date; isOrganization: boolean },
): Promise<CloudCommitmentSummary> {
  const window: { start: Date; end: Date } = getAwsCommitmentWindow(call.now);
  const base: Omit<CloudCommitmentSummary, "state" | "kinds"> = {
    currency: CLOUD_COST_DEFAULT_CURRENCY,
    days: CLOUD_COMMITMENT_WINDOW_DAYS,
    ...(call.isOrganization ? { isOrganization: true } : {}),
    readAt: call.now.toISOString(),
  };

  try {
    const savingsPlans: CloudCommitmentKindFigures = await readAwsSavingsPlans({
      ...call,
      window,
    });
    const reservations: CloudCommitmentKindFigures = await readAwsReservations({
      ...call,
      window,
    });

    return {
      ...base,
      state: CloudCostState.Reading,
      kinds: [savingsPlans, reservations],
    };
  } catch (error) {
    if (
      error instanceof LlmProviderError &&
      error.kind === CloudConnectionFailureKind.Authentication
    ) {
      throw error;
    }

    const failure: { state: CloudCostState; message: string } =
      describeAwsCommitmentFailure(error);

    return {
      ...base,
      state: failure.state,
      message: failure.message,
      kinds: [],
    };
  }
}
