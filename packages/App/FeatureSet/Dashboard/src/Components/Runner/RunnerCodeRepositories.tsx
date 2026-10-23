import { getRepositorySettingsRoute } from "../Code/CodePaths";
import { CodeRepositorySetting } from "../Code/CodeRepositorySettingsCopy";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import Link from "Common/UI/Components/Link/Link";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * On a Runner's own page, in its Runner Details beside what it may run: the
 * code repositories that pick it - AI works in them on this Runner (their
 * Runner setting in Code). It is what replaced the "Runs AI Code Fixes"
 * switch a Runner had, in the same place: a repository picks its Runner, so
 * the Runner says which do, each a link to the repository's settings that
 * lands on its Runner, where the pick is changed (More settings opens
 * there). With none, one short line says where a repository picks its
 * Runner.
 *
 * The page reads them once (loadRunnerCodeRepositories) and draws the row
 * only when it could: not for someone who may not read code repositories,
 * nor on a plan without Code - the row would be about repositories they
 * cannot see.
 */

export const RUNNER_CODE_REPOSITORIES_TEST_ID: string =
  "runner-code-repositories";

// The most repositories the row lists; a Runner rarely has this many.
export const MAX_LISTED_CODE_REPOSITORIES: number = 50;

export const RunnerCodeRepositoriesCopy: {
  title: string;
  empty: string;
} = {
  title: translationKey("Code Repositories"),
  empty: translationKey(
    "None. A repository picks its Runner in its settings in Code.",
  ),
};

export interface RunnerCodeRepositoryRow {
  id: string;
  name: string;
}

// The repositories that pick the Runner, or null when they cannot be read.
export async function loadRunnerCodeRepositories(
  runnerId: ObjectID,
): Promise<Array<RunnerCodeRepositoryRow> | null> {
  try {
    const result: ListResult<CodeRepository> =
      await ModelAPI.getList<CodeRepository>({
        modelType: CodeRepository,
        query: {
          runnerId: runnerId,
        },
        select: {
          _id: true,
          name: true,
        },
        sort: { name: SortOrder.Ascending },
        limit: MAX_LISTED_CODE_REPOSITORIES,
        skip: 0,
      });

    return result.data.map((repository: CodeRepository) => {
      return {
        id: repository._id?.toString() || "",
        name: repository.name || "",
      };
    });
  } catch {
    return null;
  }
}

export interface ComponentProps {
  repositories: Array<RunnerCodeRepositoryRow>;
}

/*
 * The row's value: each repository a link to its settings, in a line that
 * wraps - or, with none, where a repository picks its Runner.
 */
const RunnerCodeRepositoryList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.repositories.length === 0) {
    return (
      <span
        className="text-gray-500"
        data-testid={`${RUNNER_CODE_REPOSITORIES_TEST_ID}-empty`}
      >
        {translator.translateText(RunnerCodeRepositoriesCopy.empty)}
      </span>
    );
  }

  return (
    <ul
      className="flex flex-wrap gap-x-4 gap-y-1"
      data-testid={RUNNER_CODE_REPOSITORIES_TEST_ID}
    >
      {props.repositories.map((repository: RunnerCodeRepositoryRow) => {
        return (
          <li key={repository.id} className="min-w-0 max-w-full">
            <Link
              to={getRepositorySettingsRoute(
                repository.id,
                CodeRepositorySetting.Runner,
              )}
              className="break-words font-medium text-indigo-600 hover:text-indigo-500 hover:underline"
              dataTestId={`${RUNNER_CODE_REPOSITORIES_TEST_ID}-link`}
            >
              <>{repository.name}</>
            </Link>
          </li>
        );
      })}
    </ul>
  );
};

export default RunnerCodeRepositoryList;
