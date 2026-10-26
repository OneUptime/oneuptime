import { CodeTaskBlockerType } from "../../Types/AI/CodeTask";
import { JSONObject } from "../../Types/JSON";
import { ProfileCategory, isProfileCategory } from "../Profiles/ProfileTypes";
import { getCodeFixOffer } from "./CodeFixSuggestion";
import SuggestionOffer, { parseSuggestionOffer } from "./SuggestionOffer";

/*
 * IS THIS HOT FUNCTION WORTH "FIX WITH AI"?
 *
 * The Profiler's function panel offers to have OneUptime AI make a function
 * faster - a Code task in the repository that holds it, with the profile as
 * its evidence. It offers that only where the fix belongs in the
 * application's own code and would win back real time:
 *
 *   - the function is the application's own code (a library's or the
 *     runtime's code is not the person's to change);
 *   - its OWN-CODE TIME (ProfileHotspot.getOwnCodeValue: the time in it and
 *     in the library, runtime and system code it calls, down to the next
 *     function of the application's own) is at least 5% of the window -
 *     a parser whose time goes to JSON.parse qualifies, the request handler
 *     above it does not;
 *   - or, when the page compares two windows (before and after a deploy),
 *     that share grew by at least 3 points: a regression is worth fixing
 *     before it is the biggest thing in the profile;
 *   - the window holds enough samples for the share to mean something (100),
 *     and the function enough of them (20);
 *   - the profile measures time or memory: CPU time, wall time, memory in
 *     use, allocations or lock waits. A goroutine count is a snapshot of
 *     where goroutines wait, not work to make faster.
 *
 * Then the shared code-fix decision applies (CodeFixSuggestion): AI off ->
 * nothing; a fix already on its way -> a link to it; no repository the
 * GitHub App can reach -> a quiet link to connect one (the hotspot is the
 * evidence on screen). And a Code blocker - the plan, the credits, the
 * daily limit, a Runner - is a set-up step too, said in Code's own words.
 *
 * The server's suggestion route and its create route both decide with this
 * helper, so the panel never offers a fix the server then refuses.
 */

// The least own-code share of the window a function must take, in percent.
export const PROFILE_FIX_MIN_OWN_SHARE_PERCENT: number = 5;

/*
 * The least growth of that share between two windows, in percentage points,
 * for a regression to be worth a fix while it is still small.
 */
export const PROFILE_FIX_MIN_GROWTH_POINTS: number = 3;

// The fewest samples of the function, and of its whole window.
export const PROFILE_FIX_MIN_FUNCTION_SAMPLES: number = 20;
export const PROFILE_FIX_MIN_WINDOW_SAMPLES: number = 100;

// The kinds of profile whose hot functions are work to make lighter.
export const PROFILE_FIX_CATEGORIES: ReadonlyArray<ProfileCategory> = [
  ProfileCategory.Cpu,
  ProfileCategory.Wall,
  ProfileCategory.Memory,
  ProfileCategory.Allocations,
  ProfileCategory.Locks,
];

// What the profile says about one function, as the rule reads it.
export interface ProfileHotspotEvidence {
  category: ProfileCategory;
  isOwnCode: boolean;
  // 0-100: own-code time as a share of the window.
  ownShare: number;
  // The same share in the window it is compared with, when there is one.
  ownShareBefore?: number | undefined;
  functionSampleCount: number;
  windowSampleCount: number;
}

// Why a function is worth a fix: it is hot, or it got hotter.
export enum ProfileFixReason {
  Hot = "Hot",
  Grew = "Grew",
}

/*
 * The server's refusal when the rule says no, in the same words the docs
 * use. The panel never offers the button then, so people only meet this
 * through the API.
 */
export const PROFILE_NOT_WORTH_FIXING_MESSAGE: string = `This function is not worth an AI fix. Fix with AI acts on the application's own code that takes at least ${PROFILE_FIX_MIN_OWN_SHARE_PERCENT}% of the profile's time or memory, or whose share grew by ${PROFILE_FIX_MIN_GROWTH_POINTS} points or more since the window it is compared with, in a window of at least ${PROFILE_FIX_MIN_WINDOW_SAMPLES} samples.`;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/*
 * Why the function is worth a fix, or null. Growth is named first: "this
 * got slower after the deploy" is the more useful thing to tell the AI.
 */
export function getProfileFixReason(
  evidence: ProfileHotspotEvidence,
): ProfileFixReason | null {
  if (
    !evidence.isOwnCode ||
    !PROFILE_FIX_CATEGORIES.includes(evidence.category)
  ) {
    return null;
  }

  if (
    !isFiniteNumber(evidence.ownShare) ||
    !isFiniteNumber(evidence.functionSampleCount) ||
    !isFiniteNumber(evidence.windowSampleCount)
  ) {
    return null;
  }

  if (
    evidence.functionSampleCount < PROFILE_FIX_MIN_FUNCTION_SAMPLES ||
    evidence.windowSampleCount < PROFILE_FIX_MIN_WINDOW_SAMPLES
  ) {
    return null;
  }

  if (
    isFiniteNumber(evidence.ownShareBefore) &&
    evidence.ownShare - evidence.ownShareBefore >= PROFILE_FIX_MIN_GROWTH_POINTS
  ) {
    return ProfileFixReason.Grew;
  }

  if (evidence.ownShare >= PROFILE_FIX_MIN_OWN_SHARE_PERCENT) {
    return ProfileFixReason.Hot;
  }

  return null;
}

export function isProfileHotspotWorthFixing(
  evidence: ProfileHotspotEvidence,
): boolean {
  return getProfileFixReason(evidence) !== null;
}

// A repository a fix can be asked in.
export interface ProfileFixRepository {
  id: string;
  name: string;
}

// What stands between the person and the fix (a SetUp offer).
export interface ProfileFixBlocker {
  type: CodeTaskBlockerType;
  message: string;
}

export interface ProfileFixOfferInput {
  evidence: ProfileHotspotEvidence;
  isAiEnabled: boolean;
  // A Code task for this function is already queued or running.
  hasActiveFix: boolean;
  // The project has a repository the GitHub App can open a pull request in.
  hasConnectedRepository: boolean;
  /*
   * What the Code gate says for the repository the fix would be asked in,
   * when it says anything.
   */
  blocker?: ProfileFixBlocker | null | undefined;
}

export interface ProfileFixOffer {
  offer: SuggestionOffer;
  reason: ProfileFixReason | null;
  blocker: ProfileFixBlocker | null;
}

export function getProfileFixOffer(
  input: ProfileFixOfferInput,
): ProfileFixOffer {
  const reason: ProfileFixReason | null = getProfileFixReason(input.evidence);

  const offer: SuggestionOffer = getCodeFixOffer({
    isAiEnabled: input.isAiEnabled,
    applies: reason !== null,
    hasActiveFix: input.hasActiveFix,
    hasConnectedRepository: input.hasConnectedRepository,
    // The hotspot is on screen: worth a quiet "connect a repository" link.
    isBackedByEvidence: true,
  });

  if (offer === SuggestionOffer.None) {
    return { offer, reason: null, blocker: null };
  }

  if (offer === SuggestionOffer.SetUp) {
    return {
      offer,
      reason,
      blocker: {
        type: CodeTaskBlockerType.RepositoryNotConnected,
        message: CONNECT_A_REPOSITORY_MESSAGE,
      },
    };
  }

  if (offer === SuggestionOffer.Act && input.blocker) {
    /*
     * The person may not ask in the repository: nothing they could do here
     * would start the fix, so nothing is offered.
     */
    if (input.blocker.type === CodeTaskBlockerType.NoPermission) {
      return { offer: SuggestionOffer.None, reason: null, blocker: null };
    }

    return { offer: SuggestionOffer.SetUp, reason, blocker: input.blocker };
  }

  return { offer, reason, blocker: null };
}

export const CONNECT_A_REPOSITORY_MESSAGE: string =
  "Connect the GitHub repository that holds this code, so OneUptime AI can open a pull request in it.";

/*
 * What POST /ai-investigation/profile-fix-suggestion answers and the
 * function panel reads.
 */
export interface ProfileFixSuggestion extends ProfileFixOffer {
  evidence: ProfileHotspotEvidence | null;
  /*
   * The repository the function's file was found in, when one was: the
   * fix is asked there.
   */
  repository: ProfileFixRepository | null;
  /*
   * When no repository holds the file for certain: the ones the person can
   * ask in, to pick from.
   */
  repositories: Array<ProfileFixRepository>;
  // The Code task already working on this function (InProgress).
  taskId: string | null;
}

export const NO_PROFILE_FIX_SUGGESTION: ProfileFixSuggestion = {
  offer: SuggestionOffer.None,
  reason: null,
  blocker: null,
  evidence: null,
  repository: null,
  repositories: [],
  taskId: null,
};

function parseRepository(value: unknown): ProfileFixRepository | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: JSONObject = value as JSONObject;

  if (
    typeof record["id"] !== "string" ||
    record["id"].length === 0 ||
    typeof record["name"] !== "string"
  ) {
    return null;
  }

  return { id: record["id"], name: record["name"] };
}

export function parseProfileHotspotEvidence(
  value: unknown,
): ProfileHotspotEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: JSONObject = value as JSONObject;

  if (
    !isProfileCategory(record["category"]) ||
    typeof record["isOwnCode"] !== "boolean" ||
    !isFiniteNumber(record["ownShare"]) ||
    !isFiniteNumber(record["functionSampleCount"]) ||
    !isFiniteNumber(record["windowSampleCount"])
  ) {
    return null;
  }

  const evidence: ProfileHotspotEvidence = {
    category: record["category"] as ProfileCategory,
    isOwnCode: record["isOwnCode"] as boolean,
    ownShare: record["ownShare"] as number,
    functionSampleCount: record["functionSampleCount"] as number,
    windowSampleCount: record["windowSampleCount"] as number,
  };

  if (isFiniteNumber(record["ownShareBefore"])) {
    evidence.ownShareBefore = record["ownShareBefore"];
  }

  return evidence;
}

function parseBlocker(value: unknown): ProfileFixBlocker | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: JSONObject = value as JSONObject;

  if (
    typeof record["type"] !== "string" ||
    !(Object.values(CodeTaskBlockerType) as Array<string>).includes(
      record["type"],
    ) ||
    typeof record["message"] !== "string" ||
    record["message"].length === 0
  ) {
    return null;
  }

  return {
    type: record["type"] as CodeTaskBlockerType,
    message: record["message"],
  };
}

/*
 * Reads the suggestion route's answer. Whatever does not hold together - a
 * fix offered for a function the rule would not offer, nowhere to ask it, a
 * set-up step that does not say what it is, work in progress with no task -
 * reads as no suggestion, so the panel never draws an action the answer
 * does not fully back.
 */
export function parseProfileFixSuggestion(
  value: unknown,
): ProfileFixSuggestion {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return NO_PROFILE_FIX_SUGGESTION;
  }

  const record: JSONObject = value as JSONObject;
  const offer: SuggestionOffer = parseSuggestionOffer(record["offer"]);

  if (offer === SuggestionOffer.None) {
    return NO_PROFILE_FIX_SUGGESTION;
  }

  const evidence: ProfileHotspotEvidence | null = parseProfileHotspotEvidence(
    record["evidence"],
  );

  if (!evidence) {
    return NO_PROFILE_FIX_SUGGESTION;
  }

  const reason: ProfileFixReason | null = getProfileFixReason(evidence);

  if (!reason) {
    return NO_PROFILE_FIX_SUGGESTION;
  }

  const repository: ProfileFixRepository | null = parseRepository(
    record["repository"],
  );
  const repositories: Array<ProfileFixRepository> = (
    Array.isArray(record["repositories"])
      ? (record["repositories"] as Array<unknown>)
      : []
  )
    .map(parseRepository)
    .filter(
      (
        candidate: ProfileFixRepository | null,
      ): candidate is ProfileFixRepository => {
        return candidate !== null;
      },
    );
  const blocker: ProfileFixBlocker | null = parseBlocker(record["blocker"]);
  const taskId: string | null =
    typeof record["taskId"] === "string" && record["taskId"].length > 0
      ? record["taskId"]
      : null;

  if (offer === SuggestionOffer.InProgress) {
    if (!taskId) {
      return NO_PROFILE_FIX_SUGGESTION;
    }

    return {
      ...NO_PROFILE_FIX_SUGGESTION,
      offer,
      reason,
      evidence,
      taskId,
    };
  }

  if (offer === SuggestionOffer.SetUp) {
    if (!blocker) {
      return NO_PROFILE_FIX_SUGGESTION;
    }

    return {
      ...NO_PROFILE_FIX_SUGGESTION,
      offer,
      reason,
      evidence,
      blocker,
      repository,
    };
  }

  // A finished fix is something this suggestion never says (it says None).
  if (offer !== SuggestionOffer.Act) {
    return NO_PROFILE_FIX_SUGGESTION;
  }

  // Act: somewhere to ask it.
  if (!repository && repositories.length === 0) {
    return NO_PROFILE_FIX_SUGGESTION;
  }

  return {
    offer,
    reason,
    blocker: null,
    evidence,
    repository,
    repositories: repository ? [] : repositories,
    taskId: null,
  };
}

// The route's answer as JSON (the server's side of the parser above).
export function profileFixSuggestionToJSON(
  suggestion: ProfileFixSuggestion,
): JSONObject {
  return {
    offer: suggestion.offer,
    reason: suggestion.reason,
    blocker: suggestion.blocker
      ? { type: suggestion.blocker.type, message: suggestion.blocker.message }
      : null,
    evidence: suggestion.evidence
      ? (JSON.parse(JSON.stringify(suggestion.evidence)) as JSONObject)
      : null,
    repository: suggestion.repository
      ? { id: suggestion.repository.id, name: suggestion.repository.name }
      : null,
    repositories: suggestion.repositories.map(
      (repository: ProfileFixRepository): JSONObject => {
        return { id: repository.id, name: repository.name };
      },
    ),
    taskId: suggestion.taskId,
  };
}
