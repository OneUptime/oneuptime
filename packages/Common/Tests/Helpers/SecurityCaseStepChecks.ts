import { AddressBlockEvidence } from "../../Server/Utils/SecurityCase/StepChecks/Evidence/AddressBlocks";
import { AddressFactsReading } from "../../Server/Utils/SecurityCase/StepChecks/Evidence/AddressFacts";
import {
  AddressCoverage,
  AddressCoverageReading,
  AddressRequestsReading,
} from "../../Server/Utils/SecurityCase/StepChecks/Evidence/AddressRequests";
import { ContainmentStateReading } from "../../Server/Utils/SecurityCase/StepChecks/Evidence/ContainmentState";
import { MonitorsDownReading } from "../../Server/Utils/SecurityCase/StepChecks/Evidence/MonitorsDown";
import {
  StepCheckCase,
  StepCheckContext,
  StepCheckEvidence,
  StepCheckTarget,
} from "../../Server/Utils/SecurityCase/StepChecks/StepCheck";
import ObjectID from "../../Types/ObjectID";
import { SecurityCaseStepCheckEvidence } from "../../Types/SecurityCase/SecurityCaseStepCheckEvidence";
import SecurityCaseStepCheckState from "../../Types/SecurityCase/SecurityCaseStepCheckState";
import {
  ResponsePhase,
  ResponseStep,
  ResponseStepCheck,
  ResponseStepCompletion,
  ResponseTask,
} from "../../Utils/SecurityCase/ResponsePlan/ResponsePlanTypes";

/*
 * The evidence a Response Plan step's check reads (#10340), answered the way
 * the real readers answer it: an app's requests are a list of requests -
 * when each came and what the app answered - counted over the window and
 * the moment the check asks about exactly as AddressRequests' statements
 * count them in ClickHouse; a product's state is what the product said.
 *
 * A reader that is told to fail throws, as a reader that cannot read its
 * source does.
 */

export const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
export const CASE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
export const ADDRESS: string = "35.196.249.14";
export const MINUTE: number = 60 * 1000;

// The case's first detection; checks are run at moments after it.
export const DETECTED_AT: Date = new Date("2026-11-17T19:00:00.000Z");

export function at(minutes: number): Date {
  return new Date(DETECTED_AT.getTime() + minutes * MINUTE);
}

// One request that reached the app, as its trace or its access log line says.
export interface AppRequest {
  // Minutes after the case's first detection.
  minute: number;
  // The HTTP status the app answered; 0 when the span or the line says none.
  status: number;
  // A span that failed (statusCode Error) with no HTTP status broke something.
  isFailed?: boolean | undefined;
  address?: string | undefined;
  traceId?: string | undefined;
}

export function requests(
  count: number,
  from: Omit<AppRequest, "minute"> & { minute: number; everyMinutes?: number },
): Array<AppRequest> {
  const made: Array<AppRequest> = [];

  for (let index: number = 0; index < count; index++) {
    made.push({
      minute: from.minute + index * (from.everyMinutes ?? 1),
      status: from.status,
      isFailed: from.isFailed,
      address: from.address,
      traceId: from.traceId ? `${from.traceId}-${index}` : undefined,
    });
  }

  return made;
}

function isThrough(request: AppRequest): boolean {
  return (
    (request.status >= 200 && request.status < 400) ||
    request.status >= 500 ||
    (request.status === 0 && request.isFailed === true)
  );
}

function isUnknown(request: AppRequest): boolean {
  return request.status === 0 && request.isFailed !== true;
}

/*
 * What AddressRequests reads of these requests over [start, end], with the
 * same counts its aggregate statement makes: after `since` (strictly), 4xx
 * turned away, 2xx/3xx/5xx or a failed span through, no status unknown, the
 * last half hour recent.
 */
export function readRequests(data: {
  appRequests: Array<AppRequest>;
  address: string;
  start: Date;
  end: Date;
  since: Date | null;
}): AddressRequestsReading {
  const inWindow: Array<AppRequest & { at: Date }> = data.appRequests
    .filter((request: AppRequest): boolean => {
      return (request.address || ADDRESS) === data.address;
    })
    .map((request: AppRequest): AppRequest & { at: Date } => {
      return { ...request, at: at(request.minute) };
    })
    .filter((request: AppRequest & { at: Date }): boolean => {
      return (
        request.at.getTime() >= data.start.getTime() &&
        request.at.getTime() <= data.end.getTime()
      );
    })
    .sort((left: { at: Date }, right: { at: Date }): number => {
      return left.at.getTime() - right.at.getTime();
    });
  const since: number = (data.since || new Date(0)).getTime();
  const recentSince: number = data.end.getTime() - 30 * MINUTE;
  const afterSince: Array<AppRequest & { at: Date }> = inWindow.filter(
    (request: { at: Date }): boolean => {
      return request.at.getTime() > since;
    },
  );
  const through: Array<AppRequest & { at: Date }> = inWindow.filter(isThrough);
  const throughAfterSince: Array<AppRequest & { at: Date }> =
    afterSince.filter(isThrough);

  return {
    address: data.address,
    windowStart: data.start,
    windowEnd: data.end,
    since: data.since,
    total: inWindow.length,
    firstSeenAt: inWindow[0]?.at || null,
    lastSeenAt: inWindow[inWindow.length - 1]?.at || null,
    afterSince: afterSince.length,
    firstAfterSince: afterSince[0]?.at || null,
    rejected: inWindow.filter((request: AppRequest): boolean => {
      return request.status >= 400 && request.status < 500;
    }).length,
    through: through.length,
    unknown: inWindow.filter(isUnknown).length,
    throughAfterSince: throughAfterSince.length,
    firstThroughAfterSince: throughAfterSince[0]?.at || null,
    recent: inWindow.filter((request: { at: Date }): boolean => {
      return request.at.getTime() >= recentSince;
    }).length,
    throughTraceIds: Array.from(
      new Set(
        through
          .map((request: AppRequest): string => {
            return request.traceId || "";
          })
          .filter(Boolean),
      ),
    ).slice(0, 20),
  };
}

export const SEES_ADDRESSES: AddressCoverageReading = {
  coverage: AddressCoverage.Sees,
  topAddresses: ["198.51.100.20"],
  addressCount: 1,
};

// What each reader answers; a reader left out answers nothing, one named in `failing` throws.
export interface FakeEvidence {
  appRequests?: Array<AppRequest>;
  coverage?: AddressCoverageReading;
  blocks?: Array<AddressBlockEvidence>;
  userState?: ContainmentStateReading;
  hostState?: ContainmentStateReading;
  monitors?: MonitorsDownReading;
  facts?: AddressFactsReading;
  failing?: Array<keyof StepCheckEvidence>;
}

export interface RecordingEvidence {
  evidence: StepCheckEvidence;
  // Each read the check made, by reader, with what it asked.
  reads: Array<{ reader: keyof StepCheckEvidence; asked: unknown }>;
}

export function fakeEvidence(fake: FakeEvidence = {}): RecordingEvidence {
  const reads: Array<{ reader: keyof StepCheckEvidence; asked: unknown }> = [];
  const read: (reader: keyof StepCheckEvidence, asked: unknown) => void = (
    reader: keyof StepCheckEvidence,
    asked: unknown,
  ): void => {
    reads.push({ reader, asked });

    if (fake.failing?.includes(reader)) {
      throw new Error(`${reader} could not be read`);
    }
  };

  const evidence: StepCheckEvidence = {
    readAddressRequests: async (asked: {
      address: string;
      start: Date;
      end: Date;
      since: Date | null;
    }): Promise<AddressRequestsReading> => {
      read("readAddressRequests", asked);
      return readRequests({ ...asked, appRequests: fake.appRequests || [] });
    },
    countAddressRequests: async (asked: {
      address: string;
      start: Date;
      end: Date;
    }): Promise<number> => {
      read("countAddressRequests", asked);
      return readRequests({
        ...asked,
        since: null,
        appRequests: fake.appRequests || [],
      }).total;
    },
    readAddressCoverage: async (): Promise<AddressCoverageReading> => {
      read("readAddressCoverage", {});
      return fake.coverage || SEES_ADDRESSES;
    },
    readAddressBlocks: async (
      address: string,
    ): Promise<Array<AddressBlockEvidence>> => {
      read("readAddressBlocks", address);
      return fake.blocks || [];
    },
    readUserState: async (user: string): Promise<ContainmentStateReading> => {
      read("readUserState", user);
      return fake.userState || { answers: [] };
    },
    readHostState: async (host: string): Promise<ContainmentStateReading> => {
      read("readHostState", host);
      return fake.hostState || { answers: [] };
    },
    readMonitorsDown: async (): Promise<MonitorsDownReading> => {
      read("readMonitorsDown", {});
      return fake.monitors || { monitors: [], down: [] };
    },
    readAddressFacts: async (address: string): Promise<AddressFactsReading> => {
      read("readAddressFacts", address);
      return (
        fake.facts || {
          recordName: "",
          threatIntelFeeds: 0,
          signedInUsers: 0,
          signedInUser: "",
        }
      );
    },
  };

  return { evidence, reads };
}

export function stepCheckCase(
  overrides: Partial<StepCheckCase> = {},
): StepCheckCase {
  return {
    projectId: PROJECT_ID,
    securityCaseId: CASE_ID,
    createdAt: at(2),
    firstDetectedAt: DETECTED_AT,
    lastDetectedAt: DETECTED_AT,
    entities: [],
    matches: null,
    plan: {
      steps: [],
      done: 0,
      total: 0,
      checked: 0,
      isReadyToMarkContained: false,
      isContainmentVerified: false,
      regressedStepKeys: [],
    },
    hasIncident: false,
    ...overrides,
  };
}

// A step of the plan, as the builder writes it, about `value`.
export function planStep(key: string, value: string = ""): ResponseStep {
  return {
    key,
    phase: key.startsWith("contain:")
      ? ResponsePhase.Contain
      : ResponsePhase.Confirm,
    text: { template: "Step", values: value ? { value } : {} },
    quotes: [],
    isOutsideOneUptime: false,
    completion: ResponseStepCompletion.ByTask,
    isDone: false,
    isCheckedByOneUptime: false,
  };
}

// A person's tick of the step, `minute` minutes after the first detection.
export function tick(stepKey: string, minute: number): ResponseTask {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    responseStepKey: stepKey,
    isDone: true,
    doneAt: at(minute),
    doneByName: "Jane Doe",
  };
}

// What OneUptime found the last time, as the runner hands it to the check.
export function previousCheck(data: {
  stepKey: string;
  state: SecurityCaseStepCheckState;
  evidence: SecurityCaseStepCheckEvidence;
  stateSince: Date;
  checkedAt?: Date;
}): ResponseStepCheck {
  return {
    stepKey: data.stepKey,
    state: data.state,
    evidence: data.evidence,
    stateSince: data.stateSince,
    checkedAt: data.checkedAt || data.stateSince,
  };
}

export function stepTarget(data: {
  step: ResponseStep;
  previous?: ResponseStepCheck | null;
  task?: ResponseTask | null;
}): StepCheckTarget {
  return {
    step: data.step,
    value: (data.step.text.values["value"] || "").trim(),
    previous: data.previous || null,
    task: data.task || null,
  };
}

export function context(data: {
  target: StepCheckTarget;
  evidence: StepCheckEvidence;
  minute: number;
  securityCase?: Partial<StepCheckCase>;
}): StepCheckContext {
  return {
    securityCase: stepCheckCase(data.securityCase),
    target: data.target,
    now: at(data.minute),
    evidence: data.evidence,
  };
}
