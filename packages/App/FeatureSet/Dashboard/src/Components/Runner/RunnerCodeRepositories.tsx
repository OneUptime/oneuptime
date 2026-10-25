import { getRepositorySettingsRoute } from "../Code/CodePaths";
import { CodeRepositorySetting } from "../Code/CodeRepositorySettingsCopy";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import Link from "Common/UI/Components/Link/Link";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * On a Runner's own page, in its Runner Details beside what it may run: the
 * code repositories AI works in on this Runner - the ones that pick it
 * (their Runner setting in Code) and, while it is the project's default
 * Runner, the ones that pick none and follow the default
 * (Common/Types/Runner/CodeRepositoryRunner). It is what replaced the "Runs
 * AI Code Fixes" switch a Runner had, in the same place: a repository picks
 * its Runner, so the Runner says which work on it, each a link to the
 * repository's settings that lands on its Runner, where the pick is changed
 * (More settings opens there). With none, one short line says where a
 * repository picks its Runner.
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

/*
 * The repositories AI works in on the Runner - the ones that pick it and,
 * while it is the project's default (`isProjectDefault`), the ones that
 * follow the default - by name, or null when they cannot be read.
 */
export async function loadRunnerCodeRepositories(
  runnerId: ObjectID,
  options?: { isProjectDefault?: boolean | undefined } | undefined,
): Promise<Array<RunnerCodeRepositoryRow> | null> {
  try {
    const picking: ListResult<CodeRepository> =
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

    /*
     * A repository that picks none follows the default, unless it picked
     * the Global Runner itself.
     */
    const following: Array<CodeRepository> = options?.isProjectDefault
      ? (
          await ModelAPI.getList<CodeRepository>({
            modelType: CodeRepository,
            query: {
              runnerId: new IsNull(),
            },
            select: {
              _id: true,
              name: true,
              isGlobalRunnerPicked: true,
            },
            sort: { name: SortOrder.Ascending },
            limit: MAX_LISTED_CODE_REPOSITORIES,
            skip: 0,
          })
        ).data.filter((repository: CodeRepository): boolean => {
          return repository.isGlobalRunnerPicked !== true;
        })
      : [];

    return [...picking.data, ...following]
      .map((repository: CodeRepository): RunnerCodeRepositoryRow => {
        return {
          id: repository._id?.toString() || "",
          name: repository.name || "",
        };
      })
      .sort(
        (a: RunnerCodeRepositoryRow, b: RunnerCodeRepositoryRow): number => {
          return a.name.localeCompare(b.name);
        },
      )
      .slice(0, MAX_LISTED_CODE_REPOSITORIES);
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
