import { CodeTaskResponse } from "./CodeApi";
import { getProductionReviewsRoute, getRepositoryRoute } from "./CodePaths";
import {
  PRODUCTION_REVIEW_COPY,
  inReviewHostWords,
} from "./CodeProductionReviewCopy";
import CodeFixTaskType from "Common/Types/AI/CodeFixTaskType";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Link from "Common/Types/Link";
import ObjectID from "Common/Types/ObjectID";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * A task's trail, once its page has read the task: Project > Code > the
 * repository > Task #42 - and > Log on a turn's Log, whose own address
 * knows only that it is some task's log. The repository and the task are
 * named as they are (record names); Project, Code and Log are translated
 * where the trail is drawn.
 *
 * A pull request's production review sits under its repository's
 * Production Reviews: Project > Code > the repository > Production Reviews
 * > Pull request #42 - in its host's words, so a GitLab merge request's is
 * Merge request !12, as its page's title and button say it.
 */
export const getCodeTaskTrail: (data: {
  taskId: string;
  response: Pick<CodeTaskResponse, "task" | "repository">;
  translator: Translator;
  // The Log page adds its own crumb after the task's.
  isLog?: boolean | undefined;
}) => Array<Link> = (data: {
  taskId: string;
  response: Pick<CodeTaskResponse, "task" | "repository">;
  translator: Translator;
  isLog?: boolean | undefined;
}): Array<Link> => {
  const taskRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.CODE_TASK_VIEW] as Route,
    { modelId: new ObjectID(data.taskId) },
  );

  const links: Array<Link> = [
    {
      title: "Project",
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
    },
    {
      title: "Code",
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.CODE] as Route),
    },
  ];

  if (data.response.repository) {
    links.push({
      title: data.response.repository.name,
      to: getRepositoryRoute(data.response.repository.id),
      isRecordName: true,
    });
  }

  if (
    data.response.task.recipe ===
    CodeFixTaskType.GitHubPullRequestProductionReview
  ) {
    if (data.response.repository) {
      links.push({
        title: PRODUCTION_REVIEW_COPY.pageTitle,
        to: getProductionReviewsRoute(data.response.repository.id),
      });
    }

    links.push({
      title: data.response.task.origin.label
        ? data.translator.translateTemplate(
            inReviewHostWords(
              PRODUCTION_REVIEW_COPY.pullRequestFallbackTitle,
              data.response.repository?.provider,
            ),
            { label: data.response.task.origin.label },
          )
        : data.translator.translateTemplate(PRODUCTION_REVIEW_COPY.recipeLabel),
      to: taskRoute,
      isRecordName: true,
    });

    return links;
  }

  links.push({
    title: data.response.task.taskNumber
      ? data.translator.translateTemplate("Task #{{number}}", {
          number: data.response.task.taskNumber.toString(),
        })
      : data.translator.translateTemplate("Task"),
    to: taskRoute,
    isRecordName: true,
  });

  if (data.isLog) {
    links.push({
      title: "Log",
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.CODE_TASK_VIEW_LOG] as Route,
        { modelId: new ObjectID(data.taskId) },
      ),
    });
  }

  return links;
};
