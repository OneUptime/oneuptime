import { CodeTaskBlockerType } from "../../Types/AI/CodeTask";
import { CodeFixTaskTypeHelper } from "../../Types/AI/CodeFixTaskType";
import { JSONObject } from "../../Types/JSON";
import { getCodeFixOffer } from "./CodeFixSuggestion";
import SuggestionOffer, { parseSuggestionOffer } from "./SuggestionOffer";

/*
 * "FIX WITH AI" ON A PROBLEM ONEUPTIME FOUND IN A TELEMETRY PRODUCT - the
 * offer an insight of a lane's makes (Types/AI/TelemetryAi; a slow, failing
 * or under-traced operation in Traces, first): the pull request OneUptime AI
 * would open on its own, asked for by a person - what an AI rule that asks
 * before fixing leaves to them, and what anyone may ask for on any open
 * finding that has no fix yet.
 *
 * The server decides the offer (POST /telemetry-ai/fix-suggestion) by the
 * same gates its create route checks (POST /telemetry-ai/fix), so the page
 * never offers a fix that is then refused:
 *
 *   None        nothing at all: AI is off, the finding is closed or has its
 *               fix, or nothing the person could do here would start one;
 *   Act         Fix with AI - with a picker first when no repository was
 *               found to hold the code for certain;
 *   SetUp       the one step in the way: connect a repository in Code, or
 *               what Code's gate says (credits, a Runner, the plan);
 *   InProgress  the Code task already working on it.
 *
 * Pure: the server and the Dashboard import it alike.
 */

// A repository the fix can be asked in.
export interface TelemetryAiFixRepository {
  id: string;
  name: string;
}

// What stands between the person and the fix (a SetUp offer).
export interface TelemetryAiFixBlocker {
  type: CodeTaskBlockerType;
  message: string;
  // RunnerNotOnline: the Runner the repository picks, by name.
  runnerName?: string | undefined;
  // The repository Code's gate was asked about.
  repositoryId?: string | undefined;
}

export interface TelemetryAiFixSuggestion {
  offer: SuggestionOffer;
  blocker: TelemetryAiFixBlocker | null;
  // The repository the code was found in, when one holds it for certain.
  repository: TelemetryAiFixRepository | null;
  // When none does: the ones the person can ask in, to pick from.
  repositories: Array<TelemetryAiFixRepository>;
  // InProgress: the Code task already working on it.
  taskId: string | null;
  /*
   * Act: the Code recipe the pull request would be (CodeFixTaskType), when
   * the lane says - an exception's is a fix, or better handling of an
   * expected error - so the strip can say which. Absent: a request in Code.
   */
  recipe?: string | undefined;
}

export const NO_TELEMETRY_AI_FIX_SUGGESTION: TelemetryAiFixSuggestion = {
  offer: SuggestionOffer.None,
  blocker: null,
  repository: null,
  repositories: [],
  taskId: null,
};

export const TELEMETRY_AI_FIX_CONNECT_REPOSITORY_MESSAGE: string =
  "Connect the repository that holds this code in Code, so OneUptime AI can open a pull request in it.";

export interface TelemetryAiFixOfferInput {
  isAiEnabled: boolean;
  // An open finding of a lane's, with no fix linked, and evidence to fix by.
  isFixable: boolean;
  // A Code task about it is already queued or running.
  hasActiveFix: boolean;
  // A repository the person could ask in is connected.
  hasConnectedRepository: boolean;
  /*
   * What Code's gate says for the repository the fix would be asked in,
   * when it says anything.
   */
  blocker?: TelemetryAiFixBlocker | null | undefined;
}

export interface TelemetryAiFixOffer {
  offer: SuggestionOffer;
  blocker: TelemetryAiFixBlocker | null;
}

export function getTelemetryAiFixOffer(
  input: TelemetryAiFixOfferInput,
): TelemetryAiFixOffer {
  const offer: SuggestionOffer = getCodeFixOffer({
    isAiEnabled: input.isAiEnabled,
    applies: input.isFixable,
    hasActiveFix: input.hasActiveFix,
    hasConnectedRepository: input.hasConnectedRepository,
    // The finding is on screen: worth a quiet "connect a repository" link.
    isBackedByEvidence: true,
  });

  if (offer === SuggestionOffer.SetUp) {
    return {
      offer,
      blocker: {
        type: CodeTaskBlockerType.RepositoryNotConnected,
        message: TELEMETRY_AI_FIX_CONNECT_REPOSITORY_MESSAGE,
      },
    };
  }

  if (offer === SuggestionOffer.Act && input.blocker) {
    /*
     * The person may not ask in the repository: nothing they could do here
     * would start the fix, so nothing is offered.
     */
    if (input.blocker.type === CodeTaskBlockerType.NoPermission) {
      return { offer: SuggestionOffer.None, blocker: null };
    }

    return { offer: SuggestionOffer.SetUp, blocker: input.blocker };
  }

  return { offer, blocker: null };
}

function isBlockerType(value: unknown): value is CodeTaskBlockerType {
  return (
    typeof value === "string" &&
    (Object.values(CodeTaskBlockerType) as Array<string>).includes(value)
  );
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseRepository(value: unknown): TelemetryAiFixRepository | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: JSONObject = value as JSONObject;
  const id: string | null = readText(record["id"]);
  const name: string | null = readText(record["name"]);

  return id && name ? { id, name } : null;
}

function parseBlocker(value: unknown): TelemetryAiFixBlocker | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: JSONObject = value as JSONObject;

  if (!isBlockerType(record["type"])) {
    return null;
  }

  const message: string | null = readText(record["message"]);

  if (!message) {
    return null;
  }

  const blocker: TelemetryAiFixBlocker = {
    type: record["type"] as CodeTaskBlockerType,
    message,
  };

  const runnerName: string | null = readText(record["runnerName"]);

  if (runnerName) {
    blocker.runnerName = runnerName;
  }

  const repositoryId: string | null = readText(record["repositoryId"]);

  if (repositoryId) {
    blocker.repositoryId = repositoryId;
  }

  return blocker;
}

/*
 * Reads the suggestion route's answer. Whatever does not hold together - an
 * in-progress offer with no task, a set-up step with no blocker, an action
 * with nowhere to ask it - reads as no suggestion, so the page never draws
 * an action the answer does not fully back.
 */
export function parseTelemetryAiFixSuggestion(
  value: unknown,
): TelemetryAiFixSuggestion {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return NO_TELEMETRY_AI_FIX_SUGGESTION;
  }

  const record: JSONObject = value as JSONObject;
  const offer: SuggestionOffer = parseSuggestionOffer(record["offer"]);

  if (offer === SuggestionOffer.None) {
    return NO_TELEMETRY_AI_FIX_SUGGESTION;
  }

  const taskId: string | null = readText(record["taskId"]);

  if (offer === SuggestionOffer.InProgress) {
    return taskId
      ? { ...NO_TELEMETRY_AI_FIX_SUGGESTION, offer, taskId }
      : NO_TELEMETRY_AI_FIX_SUGGESTION;
  }

  const blocker: TelemetryAiFixBlocker | null = parseBlocker(record["blocker"]);

  if (offer === SuggestionOffer.SetUp) {
    return blocker
      ? { ...NO_TELEMETRY_AI_FIX_SUGGESTION, offer, blocker }
      : NO_TELEMETRY_AI_FIX_SUGGESTION;
  }

  const repository: TelemetryAiFixRepository | null = parseRepository(
    record["repository"],
  );
  const repositories: Array<TelemetryAiFixRepository> = (
    Array.isArray(record["repositories"])
      ? (record["repositories"] as Array<unknown>)
      : []
  )
    .map(parseRepository)
    .filter(
      (
        candidate: TelemetryAiFixRepository | null,
      ): candidate is TelemetryAiFixRepository => {
        return candidate !== null;
      },
    );

  // Act: somewhere to ask it.
  if (!repository && repositories.length === 0) {
    return NO_TELEMETRY_AI_FIX_SUGGESTION;
  }

  const recipe: string | null = readText(record["recipe"]);

  return {
    offer,
    blocker: null,
    repository,
    repositories: repository ? [] : repositories,
    taskId: null,
    ...(recipe && CodeFixTaskTypeHelper.isValidTaskType(recipe)
      ? { recipe }
      : {}),
  };
}

// The route's answer as JSON (the server's side of the parser above).
export function telemetryAiFixSuggestionToJSON(
  suggestion: TelemetryAiFixSuggestion,
): JSONObject {
  const blocker: JSONObject | null = suggestion.blocker
    ? {
        type: suggestion.blocker.type,
        message: suggestion.blocker.message,
        ...(suggestion.blocker.runnerName
          ? { runnerName: suggestion.blocker.runnerName }
          : {}),
        ...(suggestion.blocker.repositoryId
          ? { repositoryId: suggestion.blocker.repositoryId }
          : {}),
      }
    : null;

  return {
    offer: suggestion.offer,
    blocker,
    repository: suggestion.repository
      ? { id: suggestion.repository.id, name: suggestion.repository.name }
      : null,
    repositories: suggestion.repositories.map(
      (repository: TelemetryAiFixRepository): JSONObject => {
        return { id: repository.id, name: repository.name };
      },
    ),
    taskId: suggestion.taskId,
    ...(suggestion.recipe ? { recipe: suggestion.recipe } : {}),
  };
}
