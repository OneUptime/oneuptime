import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * On a Runner's own page: the code repositories that pick it - AI works in
 * them on this Runner (their Runner setting in Code). It is what replaced
 * the "Runs AI Code Fixes" switch a Runner had: a repository picks its
 * Runner, so the Runner's page says which do, each a link to the
 * repository's settings, where the pick is changed.
 *
 * Nothing is drawn for someone who may not read code repositories, or on a
 * plan without Code: the card would be about repositories they cannot see.
 */

export const RUNNER_CODE_REPOSITORIES_TEST_ID: string =
  "runner-code-repositories";

// The most repositories the card lists; a Runner rarely has this many.
export const MAX_LISTED_CODE_REPOSITORIES: number = 50;

export const RunnerCodeRepositoriesCopy: {
  title: string;
  description: string;
  empty: string;
} = {
  title: translationKey("Code Repositories"),
  description: translationKey("AI works in these repositories on this Runner."),
  empty: translationKey(
    "No code repository picks this Runner. To have AI work in a repository on it, pick it in the repository's settings in Code.",
  ),
};

export interface ComponentProps {
  runnerId: ObjectID;
}

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

const RunnerCodeRepositories: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [repositories, setRepositories] =
    useState<Array<RunnerCodeRepositoryRow> | null>(null);

  const runnerIdText: string = props.runnerId.toString();

  useEffect(() => {
    let isMounted: boolean = true;

    loadRunnerCodeRepositories(new ObjectID(runnerIdText))
      .then((rows: Array<RunnerCodeRepositoryRow> | null) => {
        if (isMounted) {
          setRepositories(rows);
        }
      })
      .catch(() => {
        // Nothing is drawn for a read that fails.
      });

    return () => {
      isMounted = false;
    };
  }, [runnerIdText]);

  if (!repositories) {
    return <></>;
  }

  return (
    <Card
      title={RunnerCodeRepositoriesCopy.title}
      description={RunnerCodeRepositoriesCopy.description}
    >
      <div data-testid={RUNNER_CODE_REPOSITORIES_TEST_ID}>
        {repositories.length === 0 ? (
          <p
            className="text-sm text-gray-500"
            data-testid={`${RUNNER_CODE_REPOSITORIES_TEST_ID}-empty`}
          >
            {translator.translateText(RunnerCodeRepositoriesCopy.empty)}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {repositories.map((repository: RunnerCodeRepositoryRow) => {
              return (
                <li key={repository.id} className="min-w-0 max-w-full">
                  <Link
                    to={RouteUtil.populateRouteParams(
                      RouteMap[PageMap.CODE_REPOSITORY_VIEW_SETTINGS] as Route,
                      { modelId: repository.id },
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
        )}
      </div>
    </Card>
  );
};

export default RunnerCodeRepositories;
