import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { CodeRepositorySetting } from "./CodeRepositorySettingsCopy";
import Route from "Common/Types/API/Route";
import { CodeTaskRepositoryJSON } from "Common/Types/AI/CodeTask";
import ObjectID from "Common/Types/ObjectID";
import { getRouteToPageAnchor } from "Common/UI/Utils/PageAnchor";

/*
 * Where Code's pages are, and how a repository is named across them. React-
 * free, so the trail builder, the pages and App's tests read one place.
 *
 *   Code (…/code)                     ask AI, and every task
 *   Repositories (…/code/repositories) the connected repositories
 *   a repository (…/repositories/:id) its own request box and tasks
 *   …/repositories/:id/production-reviews its pull requests' reviews
 *   …/repositories/:id/settings#runner its settings, at one of them
 *   a task (…/tasks/:id)              its conversation
 */

// Code's first page: the request box and every task.
export const getCodeHomeRoute: () => Route = (): Route => {
  return RouteUtil.populateRouteParams(RouteMap[PageMap.CODE] as Route);
};

// The connected repositories, with the way to connect more.
export const getRepositoriesRoute: () => Route = (): Route => {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.CODE_REPOSITORIES] as Route,
  );
};

// A repository's page in Code: its request box and its tasks.
export const getRepositoryRoute: (repositoryId: string) => Route = (
  repositoryId: string,
): Route => {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.CODE_REPOSITORY_VIEW] as Route,
    { modelId: new ObjectID(repositoryId) },
  );
};

// A repository's pull requests, reviewed against production.
export const getProductionReviewsRoute: (repositoryId: string) => Route = (
  repositoryId: string,
): Route => {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.CODE_REPOSITORY_VIEW_PRODUCTION_REVIEWS] as Route,
    { modelId: new ObjectID(repositoryId) },
  );
};

/*
 * A repository's settings in Code - landing on one of them when it is
 * named: ".../settings#runner" opens the page at its Runner, with More
 * settings, where it is, open (Common/UI/Utils/PageAnchor).
 */
export const getRepositorySettingsRoute: (
  repositoryId: string | ObjectID,
  setting?: CodeRepositorySetting | undefined,
) => Route = (
  repositoryId: string | ObjectID,
  setting?: CodeRepositorySetting | undefined,
): Route => {
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.CODE_REPOSITORY_VIEW_SETTINGS] as Route,
    { modelId: new ObjectID(repositoryId.toString()) },
  );

  return setting ? getRouteToPageAnchor(route, setting) : route;
};

// A task's page in Code: its conversation.
export const getTaskRoute: (taskId: string) => Route = (
  taskId: string,
): Route => {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.CODE_TASK_VIEW] as Route,
    { modelId: new ObjectID(taskId) },
  );
};

// "acme/checkout-api", or nothing when GitHub's names are not known.
export const getRepositoryFullName: (
  repository: Pick<
    CodeTaskRepositoryJSON,
    "name" | "organizationName" | "repositoryName"
  >,
) => string = (
  repository: Pick<
    CodeTaskRepositoryJSON,
    "name" | "organizationName" | "repositoryName"
  >,
): string => {
  if (!repository.organizationName || !repository.repositoryName) {
    return "";
  }

  return `${repository.organizationName}/${repository.repositoryName}`;
};
