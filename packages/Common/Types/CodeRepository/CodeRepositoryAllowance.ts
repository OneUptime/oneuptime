/*
 * WHICH OF THE PROJECT'S CODE REPOSITORIES OneUptime AI MAY USE for one
 * incident or alert: read while it investigates or fixes, and open a pull
 * request in.
 *
 * An investigation rule and an auto remediation rule each name, under More
 * fields, the code repositories OneUptime AI may use for what they match.
 * The maintainer: "if no code repo is selected - it should be able to read
 * and investigate all the repos that are connected". So:
 *
 *   - no rule set up: every connected repository;
 *   - a matching rule that names none: every connected repository;
 *   - matching rules that name some: the repositories any of them names.
 *
 * Only the project's own repositories are ever used, whatever a rule names
 * (a rule can only name those - the rule services refuse any other - and
 * every reader reads repositories by project). A repository a rule names
 * that is later deleted or disconnected is simply not there to use.
 *
 * Shared by the server and the Dashboard, so it imports nothing.
 */

/*
 * How many repositories one rule may name. A rule that would name more
 * means all of them: leaving the list empty says so.
 */
export const MAX_CODE_REPOSITORIES_PER_RULE: number = 100;

export const RULE_TOO_MANY_CODE_REPOSITORIES_MESSAGE: string = `A rule can name at most ${MAX_CODE_REPOSITORIES_PER_RULE} code repositories. Leave the list empty to let OneUptime AI use all of them.`;

export interface CodeRepositoryAllowance {
  // Every connected repository of the project.
  isEveryRepository: boolean;
  // Otherwise these (lower-case ids), and only these.
  repositoryIds: Array<string>;
}

export const EVERY_CODE_REPOSITORY: CodeRepositoryAllowance = {
  isEveryRepository: true,
  repositoryIds: [],
};

export const NO_CODE_REPOSITORY: CodeRepositoryAllowance = {
  isEveryRepository: false,
  repositoryIds: [],
};

/*
 * An id from a stored value, a relation row ({ _id } or { id }), an
 * ObjectID (which keeps its text in _id), a dropdown option ({ value }) or a
 * text.
 */
function readId(value: unknown): string {
  if (typeof value === "string") {
    return value.trim().toLowerCase();
  }

  if (value && typeof value === "object") {
    const row: { _id?: unknown; id?: unknown; value?: unknown } = value as {
      _id?: unknown;
      id?: unknown;
      value?: unknown;
    };

    return readId(row._id ?? row.id ?? row.value);
  }

  return "";
}

// The repository ids a rule's list holds (rows, ids or option values), each once.
export function readCodeRepositoryIds(value: unknown): Array<string> {
  const values: Array<unknown> = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];

  const ids: Array<string> = [];

  for (const item of values) {
    const id: string = readId(item);

    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
}

/*
 * Why a rule cannot be saved with this list of repositories, or null when it
 * can. Whether each is the project's own is checked with every other
 * reference the rule writes (ProjectReferencesService).
 */
export function getRuleCodeRepositoriesProblem(value: unknown): string | null {
  return readCodeRepositoryIds(value).length > MAX_CODE_REPOSITORIES_PER_RULE
    ? RULE_TOO_MANY_CODE_REPOSITORIES_MESSAGE
    : null;
}

/*
 * The repositories OneUptime AI may use for a signal, from the rules that
 * match it. `rulesSetUp` is false when the project has no rule of this kind
 * at all: then every repository may be used. With rules set up and none
 * matching, none may (nothing would have started a run).
 */
export function getCodeRepositoryAllowance(data: {
  rulesSetUp: boolean;
  matchingRules: Array<{ codeRepositories?: unknown }>;
}): CodeRepositoryAllowance {
  if (!data.rulesSetUp) {
    return EVERY_CODE_REPOSITORY;
  }

  if (data.matchingRules.length === 0) {
    return NO_CODE_REPOSITORY;
  }

  const repositoryIds: Array<string> = [];

  for (const rule of data.matchingRules) {
    const ruleRepositoryIds: Array<string> = readCodeRepositoryIds(
      rule.codeRepositories,
    );

    if (ruleRepositoryIds.length === 0) {
      return EVERY_CODE_REPOSITORY;
    }

    for (const id of ruleRepositoryIds) {
      if (!repositoryIds.includes(id)) {
        repositoryIds.push(id);
      }
    }
  }

  return { isEveryRepository: false, repositoryIds };
}

/*
 * The allowance a run stores and reads back (AIRun.taskContext): the ids it
 * names, or undefined for every repository. A stored list that is not a list
 * of ids reads as every repository only when nothing was stored at all.
 */
export function toStoredCodeRepositoryIds(
  allowance: CodeRepositoryAllowance,
): Array<string> | undefined {
  return allowance.isEveryRepository ? undefined : [...allowance.repositoryIds];
}

export function fromStoredCodeRepositoryIds(
  stored: unknown,
): CodeRepositoryAllowance {
  if (stored === undefined || stored === null) {
    return EVERY_CODE_REPOSITORY;
  }

  return {
    isEveryRepository: false,
    repositoryIds: readCodeRepositoryIds(stored),
  };
}

// Whether the allowance lets OneUptime AI use this repository.
export function isCodeRepositoryAllowed(
  allowance: CodeRepositoryAllowance | null | undefined,
  repositoryId: unknown,
): boolean {
  // No allowance given: nothing narrows what may be read.
  if (!allowance || allowance.isEveryRepository) {
    return true;
  }

  const id: string = readId(repositoryId);

  return Boolean(id) && allowance.repositoryIds.includes(id);
}

// Whether the allowance lets OneUptime AI use any repository at all.
export function allowsAnyCodeRepository(
  allowance: CodeRepositoryAllowance | null | undefined,
): boolean {
  return (
    !allowance ||
    allowance.isEveryRepository ||
    allowance.repositoryIds.length > 0
  );
}

/*
 * The repositories of a list the allowance lets OneUptime AI use, in the
 * list's order.
 */
export function keepAllowedCodeRepositories<T>(data: {
  allowance: CodeRepositoryAllowance | null | undefined;
  repositories: Array<T>;
  getId: (repository: T) => unknown;
}): Array<T> {
  return data.repositories.filter((repository: T): boolean => {
    return isCodeRepositoryAllowed(data.allowance, data.getId(repository));
  });
}
