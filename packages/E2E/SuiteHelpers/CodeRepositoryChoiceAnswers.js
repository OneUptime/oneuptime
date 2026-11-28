/*
 * THE REPOSITORIES A FIX WITH AI PICKER OFFERS, AS AN OFFLINE FIXTURE'S
 * SERVER ANSWERS THEM (#10921).
 *
 * When no repository was found to hold the code for certain, a finding's
 * Fix with AI (TelemetryAiFixStrip), a profile function's (ProfileFixStrip)
 * and a trace's Fix performance with AI (TracePerformanceSuggestion) ask
 * which one holds it. They no longer offer the suggestion's own list: each
 * is Code's searched repository field (CodeRepositorySearchField), which
 * reads through Code's routes (CodeRepositoryChoicesAPI), held to exactly
 * the repositories its fix accepts:
 *
 *   - POST /code-task/repositories: a page of the reader's repositories,
 *     searched (CodeRepositorySearch), in one of Code's two lists or both,
 *     by name - held first to those the reader may ask OneUptime AI to work
 *     in (askableOnly) and to those whose code OneUptime reads
 *     (codeReadableOnly, CodeReadableRepository), so its page, its count,
 *     its facts and its matches name only what the picker may offer
 *     (CodeTaskAPI, CodeTaskRepositoryList);
 *   - POST /code-task/repositories-by-id: the ones the field holds, by
 *     their ids, held the same way: one the read is not held to is left
 *     out, as a repository that is not there.
 *
 * A fixture answers both with answerCodeRepositoryChoices, beside the other
 * routes it models, handing it the project's repositories its reader may
 * read - each { id, name } with what the server knows of it:
 * organizationName, repositoryName and description (what a search and the
 * code-readable rule read), repositoryHostedAt (GitHub unless said),
 * repositoryUrl, and isConnected, isReachableFromServer and isAskable (each
 * true unless said):
 *
 *   const choices = answerCodeRepositoryChoices({ method, url, body, repositories });
 *   if (choices) {
 *     return choices;
 *   }
 *
 * The fixtures' readers have no Code task, so every repository's tasks at a
 * glance are none, and none are without a repository.
 */
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import {
  CodeRepositoryListGroup,
  MAX_CODE_REPOSITORIES_PER_PAGE,
  MAX_CODE_TASKS_PER_REQUEST,
} from "Common/Types/AI/CodeTask";
import { CodeHost } from "Common/Types/CodeRepository/CodeHost";
import { isCodeReadableRepository } from "Common/Types/CodeRepository/CodeReadableRepository";
import {
  matchesCodeRepositorySearch,
  readCodeRepositorySearch,
} from "Common/Types/CodeRepository/CodeRepositorySearch";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import ObjectID from "Common/Types/ObjectID";

const LIST_ROUTE = "/code-task/repositories";
const BY_ID_ROUTE = "/code-task/repositories-by-id";

// A whole number from a body, held between its bounds, as CodeTaskAPI reads one.
function readNumber(raw, defaultValue, min, max) {
  const value =
    typeof raw === "number" && Number.isFinite(raw)
      ? Math.floor(raw)
      : defaultValue;
  return Math.min(max, Math.max(min, value));
}

// Each repository as the server weighs it: how it is hosted and how it connects.
function toEntry(repository) {
  const provider = CodeHost.readType(repository.repositoryHostedAt);
  const isConnected = repository.isConnected !== false;

  return {
    repository,
    provider,
    isConnected,
    isAskable: repository.isAskable !== false,
    isCodeReadable: isCodeReadableRepository({
      organizationName: repository.organizationName,
      repositoryName: repository.repositoryName,
      repositoryUrl: repository.repositoryUrl,
      provider,
      isConnected,
      isReachableFromServer: repository.isReachableFromServer !== false,
    }),
  };
}

// The entries a read is held to (CodeTaskRepositoryList.keepHeldTo).
function keepHeldTo(entries, body) {
  return entries.filter((entry) => {
    return (
      (body.codeReadableOnly !== true || entry.isCodeReadable) &&
      (body.askableOnly !== true || entry.isAskable)
    );
  });
}

// A repository at a glance, as CodeTaskAPI writes it, with its tasks: none.
function toListItem(entry) {
  const repository = entry.repository;
  const item = {
    id: repository.id,
    name: repository.name || "",
    isConnected: entry.isConnected,
    provider: entry.provider,
  };

  for (const key of [
    "description",
    "organizationName",
    "repositoryName",
    "mainBranchName",
    "repositoryUrl",
  ]) {
    if (repository[key]) {
      item[key] = String(repository[key]);
    }
  }

  return {
    ...item,
    stats: { working: 0, waitingForYou: 0, openPullRequests: 0, taskCount: 0 },
  };
}

// By name, as the database orders them; the id keeps two of one name in order.
function byName(repositories) {
  return [...(repositories || [])].sort((left, right) => {
    return (
      String(left.name || "").localeCompare(String(right.name || "")) ||
      String(left.id).localeCompare(String(right.id))
    );
  });
}

// A page of the repositories (POST /code-task/repositories).
function repositoriesPage(repositories, body) {
  const search = readCodeRepositorySearch(body.search);
  const group = Object.values(CodeRepositoryListGroup).includes(body.group)
    ? body.group
    : null;
  const skip = readNumber(body.skip, 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = readNumber(
    body.limit,
    MAX_CODE_REPOSITORIES_PER_PAGE,
    1,
    MAX_CODE_REPOSITORIES_PER_PAGE,
  );

  const entries = keepHeldTo(byName(repositories).map(toEntry), body);
  const found = entries.filter((entry) => {
    return matchesCodeRepositorySearch(entry.repository, search);
  });
  const listed = found.filter((entry) => {
    if (group === CodeRepositoryListGroup.Connected) {
      return entry.isConnected;
    }
    if (group === CodeRepositoryListGroup.NotConnected) {
      return !entry.isConnected;
    }
    return true;
  });
  /*
   * By name - or by activity, which none has here, so by name too - with
   * those AI can work in first when both lists are asked for.
   */
  const ordered = listed
    .map((entry, index) => {
      return { entry, index };
    })
    .sort((left, right) => {
      if (
        group === null &&
        left.entry.isConnected !== right.entry.isConnected
      ) {
        return left.entry.isConnected ? -1 : 1;
      }
      return left.index - right.index;
    })
    .map((item) => {
      return item.entry;
    });
  const notConnected = entries.filter((entry) => {
    return !entry.isConnected;
  });
  const isOnGitHub = (entry) => {
    return entry.provider === CodeRepositoryType.GitHub;
  };
  const foundConnected = found.filter((entry) => {
    return entry.isConnected;
  }).length;

  return {
    repositories: ordered.slice(skip, skip + limit).map(toListItem),
    count: listed.length,
    facts: {
      total: entries.length,
      connected: entries.length - notConnected.length,
      notConnected: notConnected.length,
      areAllOnGitHub: entries.every(isOnGitHub),
      isAnyOnGitHub: entries.some(isOnGitHub),
      areAllNotConnectedOnGitHub: notConnected.every(isOnGitHub),
      isAnyNotConnectedOnGitHub: notConnected.some(isOnGitHub),
    },
    matches: {
      connected: foundConnected,
      notConnected: found.length - foundConnected,
    },
    tasksWithoutRepositoryCount: 0,
  };
}

// Some repositories by their ids (POST /code-task/repositories-by-id).
function repositoriesById(repositories, body) {
  if (!Array.isArray(body.repositoryIds)) {
    return new HTTPErrorResponse(
      400,
      { message: "Send the repositories to read as a list of their ids." },
      {},
    );
  }

  const ids = new Set(
    body.repositoryIds
      .filter((id) => {
        return typeof id === "string" && ObjectID.isValidUUID(id);
      })
      .slice(0, MAX_CODE_TASKS_PER_REQUEST)
      .map((id) => {
        return id.toLowerCase();
      }),
  );
  const held = keepHeldTo(
    byName(repositories)
      .filter((repository) => {
        return ids.has(String(repository.id).toLowerCase());
      })
      .map(toEntry),
    body,
  );

  return new HTTPResponse(200, { repositories: held.map(toListItem) }, {});
}

/*
 * The answer to <method> <url> with <body> - a URL, or text, absolute or a
 * path - or null when it is neither route.
 */
export function answerCodeRepositoryChoices(data) {
  const route = new URL(
    String(data.url),
    "http://fixture.invalid",
  ).pathname.replace(/^\/api(?=\/)/, "");

  if (String(data.method).toUpperCase() !== "POST") {
    return null;
  }

  const body =
    data.body && typeof data.body === "object" && !Array.isArray(data.body)
      ? data.body
      : {};

  if (route === LIST_ROUTE) {
    return new HTTPResponse(200, repositoriesPage(data.repositories, body), {});
  }

  if (route === BY_ID_ROUTE) {
    return repositoriesById(data.repositories, body);
  }

  return null;
}
