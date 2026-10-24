import Route from "Common/Types/API/Route";
import { ProfileInsightEvidence } from "Common/Types/AI/AIInsightEvidence";
import AIInsightStatus, {
  AIInsightStatusHelper,
} from "Common/Types/AI/AIInsightStatus";
import AIInsightType from "Common/Types/AI/AIInsightType";
import ObjectID from "Common/Types/ObjectID";
import {
  buildProfileMonitorRoute,
  suggestFunctionShareThreshold,
} from "../../Utils/ProfilesView";
import {
  ProfileFixRequestBody,
  ProfileWindowRequest,
} from "../Profiles/ProfilesApi";

/*
 * What a slow-code finding offers "Fix with AI" for: the function, read in
 * the window it was found in, against the window it was compared with -
 * the same request the Profiler's function panel sends, so the server
 * checks the same gates and the task gets the same evidence. React-free,
 * so App's tests read it.
 *
 * Offered only on an open finding with no fix linked yet: an AI rule that
 * asks before fixing leaves the pull request to a person, here.
 */

function readWindow(
  startTime: string | undefined,
  endTime: string | undefined,
): ProfileWindowRequest | null {
  const start: Date = new Date(startTime || "");
  const end: Date = new Date(endTime || "");

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start.getTime() >= end.getTime()
  ) {
    return null;
  }

  return { startTime: start, endTime: end };
}

export function getProfileInsightFixRequest(
  evidence: ProfileInsightEvidence | undefined | null,
): ProfileFixRequestBody | null {
  if (!evidence || !evidence.serviceId || !evidence.functionName) {
    return null;
  }

  const window: ProfileWindowRequest | null = readWindow(
    evidence.windowStartTime,
    evidence.windowEndTime,
  );

  if (!window) {
    return null;
  }

  const request: ProfileFixRequestBody = {
    serviceId: evidence.serviceId,
    functionName: evidence.functionName,
    fileName: evidence.fileName || "",
    profileType: evidence.profileType || "",
    window,
  };

  const beforeWindow: ProfileWindowRequest | null = readWindow(
    evidence.baselineStartTime,
    evidence.baselineEndTime,
  );

  if (beforeWindow) {
    request.beforeWindow = beforeWindow;
  }

  return request;
}

/*
 * What a slow-code finding's Create Monitor opens: the Profiles monitor the
 * Profiler's function panel offers ("Alert me when its share passes 55%"),
 * on the function in its service, for the kind of profile it was found in,
 * with a threshold above the share it takes now - so the monitor alerts
 * the next time it grows, not the moment it is saved. The share a monitor
 * reads is the function's whole share (every stack it is in), which its
 * sample count gives; never less than the share the finding names. Null
 * when the finding does not name its function.
 */
export function getProfileInsightMonitorRoute(
  evidence: ProfileInsightEvidence | undefined | null,
): Route | null {
  const functionName: string = (evidence?.functionName || "").trim();

  if (!evidence || !functionName) {
    return null;
  }

  const sampleShare: number =
    evidence.windowSampleCount > 0
      ? (evidence.functionSampleCount / evidence.windowSampleCount) * 100
      : 0;
  const share: number = Math.max(
    Number.isFinite(evidence.ownShare) ? evidence.ownShare : 0,
    Number.isFinite(sampleShare) ? sampleShare : 0,
  );

  return buildProfileMonitorRoute({
    serviceId: ObjectID.isValidUUID(evidence.serviceId || "")
      ? evidence.serviceId
      : undefined,
    functionName,
    profileType: evidence.profileType || evidence.category || "cpu",
    threshold: suggestFunctionShareThreshold(share),
  });
}

// Whether a finding offers "Fix with AI": open, slow code, and no fix yet.
export function doesInsightOfferProfileFix(insight: {
  insightType?: string | undefined;
  status?: AIInsightStatus | null | undefined;
  fixAiRunId?: unknown;
  evidence?: { profile?: ProfileInsightEvidence | undefined } | undefined;
}): boolean {
  return (
    insight.insightType === AIInsightType.ProfileHotspot &&
    !insight.fixAiRunId &&
    Boolean(insight.status) &&
    !AIInsightStatusHelper.isTerminalStatus(
      insight.status as AIInsightStatus,
    ) &&
    getProfileInsightFixRequest(insight.evidence?.profile) !== null
  );
}
