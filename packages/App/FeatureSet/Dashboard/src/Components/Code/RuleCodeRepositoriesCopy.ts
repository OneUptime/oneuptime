import { readCodeRepositoryIds } from "Common/Types/CodeRepository/CodeRepositoryAllowance";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What a rule's "Code Repositories" field says - an AI rule's, under More
 * fields - React-free, so the table, the field and App's tests read these
 * exact strings.
 *
 * The maintainer: "there should be a dropdown here to select the code repo
 * for remediation and also investigation rules, if no code repo is selected
 * - it should be able to read and investigate all the repos that are
 * connected". So the field starts empty, and empty says what it does: all
 * connected repositories (Common/Types/CodeRepository/CodeRepositoryAllowance).
 */
export const RULE_CODE_REPOSITORIES_FIELD_COPY: {
  title: string;
  placeholder: string;
  /*
   * The field's line on every AI rule. Not "and open pull requests in
   * them": a rule that doesn't fix opens none, and on one that does, the
   * pull request switches under it say so.
   */
  aiRuleDescription: string;
  manageHint: string;
  hiddenRepository: string;
  allRepositoriesSummary: string;
  emptyList: string;
} = {
  title: translationKey("Code Repositories"),
  placeholder: translationKey("All connected repositories"),
  aiRuleDescription: translationKey(
    "OneUptime AI may use all of your connected repositories. Pick some to let it use only those.",
  ),
  manageHint: translationKey(
    "Connect and manage repositories on the {{codeRepositoriesLink}} page.",
  ),
  /*
   * A repository a rule names that the reader may not read. Drawn as a
   * chip, which cuts its text at 14rem: "A repository you do not have
   * access to" lost its last word there.
   */
  hiddenRepository: translationKey("A repository you cannot access"),
  // What a folded More fields line says while the rule names none.
  allRepositoriesSummary: translationKey(
    "OneUptime AI may read all connected repositories.",
  ),
  /*
   * What the open list says while the project has no repository: the line
   * under the field says where one is connected.
   */
  emptyList: translationKey("No repositories are connected yet."),
};

// The data-testids of the field.
export const RULE_CODE_REPOSITORIES_PICKER_TEST_ID: string =
  "rule-code-repositories-picker";

export const RULE_CODE_REPOSITORIES_LOADING_TEST_ID: string =
  "rule-code-repositories-loading";

export const RULE_CODE_REPOSITORIES_HINT_TEST_ID: string =
  "rule-code-repositories-hint";

// The repositories the rule being edited names: rows, ids or dropdown picks.
export function getRuleCodeRepositoryIds(values: unknown): Array<string> {
  const repositories: unknown =
    values && typeof values === "object"
      ? (values as { codeRepositories?: unknown }).codeRepositories
      : undefined;

  return readCodeRepositoryIds(repositories);
}

// Whether the rule being edited names any repository.
export function hasRuleCodeRepositories(values: unknown): boolean {
  return getRuleCodeRepositoryIds(values).length > 0;
}

/*
 * What a folded More fields line says after the field's name while it names
 * some: how many. Null for all of them, the default.
 */
export function getRuleCodeRepositoriesFoldedValue(
  values: unknown,
): string | null {
  const count: number = getRuleCodeRepositoryIds(values).length;

  return count > 0 ? String(count) : null;
}

// One repository as the field lists it.
export interface RuleCodeRepositoryChoice {
  id: string;
  name: string;
  // GitHub's organization/name, when it says more than the name.
  fullName?: string | undefined;
  /*
   * One the rule names that the reader was not shown: one they may not
   * read. Its name is the field's words for that, to be translated.
   */
  isHidden?: boolean | undefined;
}

/*
 * The field's choices: the project's repositories by name, then - so a
 * rule never loses one on an edit - each it names that the reader was not
 * shown (one they may not read), last.
 */
export function getRuleCodeRepositoryChoices(data: {
  repositories: Array<RuleCodeRepositoryChoice>;
  pickedIds: Array<string>;
  hiddenLabel: string;
}): Array<RuleCodeRepositoryChoice> {
  const known: Set<string> = new Set<string>(
    data.repositories.map((repository: RuleCodeRepositoryChoice): string => {
      return repository.id.toLowerCase();
    }),
  );

  const hidden: Array<RuleCodeRepositoryChoice> = data.pickedIds
    .filter((id: string): boolean => {
      return !known.has(id.toLowerCase());
    })
    .map((id: string): RuleCodeRepositoryChoice => {
      return { id, name: data.hiddenLabel, isHidden: true };
    });

  return [...data.repositories, ...hidden];
}
