import {
  CODE_TASK_ADD_AI_CREDITS,
  CODE_TASK_BLOCKER_FIXES,
  CODE_TASK_BLOCKER_SENTENCES,
  CODE_TASK_BLOCKER_WHO_CAN_FIX,
  CODE_TASK_CONNECT_REPOSITORIES,
  CODE_TASK_REPOSITORY_CONNECTION_GONE,
  CODE_TASK_REPOSITORY_SETTINGS_FIXES,
  CODE_TASK_RUNNER_NOT_ONLINE_NAMED,
  CodeTaskBlockerFix,
} from "./CodeTaskCopy";
import { CodeHost } from "Common/Types/CodeRepository/CodeHost";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import { getRepositorySettingsRoute } from "./CodePaths";
import {
  getProjectBalanceAccess,
  ProjectBalanceAccess,
} from "../ProjectBalance/ProjectBalanceAccess";
import { WHO_CAN_ADD_AI_CREDITS } from "../ProjectBalance/ProjectBalanceCopy";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import LlmProvider from "Common/Models/DatabaseModels/LlmProvider";
import Project from "Common/Models/DatabaseModels/Project";
import Route from "Common/Types/API/Route";
import { CodeTaskBlocker, CodeTaskBlockerType } from "Common/Types/AI/CodeTask";
import IconProp from "Common/Types/Icon/IconProp";
import Permission from "Common/Types/Permission";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { ProjectBalanceType } from "Common/Utils/Project/ProjectBalance";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Connecting GitHub from the notice itself, on a page that can start it
 * (Code's first page): a repository AI cannot reach gets the button that
 * connects GitHub - or, for someone who may not connect it, why not.
 */
export interface CodeConnectGitHubFix {
  onConnect: () => void;
  // Why the reader may not connect GitHub (GitHubConnectLock), in their words.
  lockReason?: string | undefined;
}

export interface ComponentProps {
  blocker: CodeTaskBlocker;
  /*
   * For a repository AI cannot reach: connect GitHub right here, instead of
   * the link to Repositories, where it is connected.
   */
  connectGitHub?: CodeConnectGitHubFix | undefined;
  /*
   * The repository the notice is about, for a fix that opens its settings
   * (its Runner setting, CODE_TASK_REPOSITORY_SETTINGS_FIXES). Without it
   * that fix is not linked.
   */
  repositoryId?: string | undefined;
  /*
   * Drawn inside a strip of the same amber (the Profiler's Fix with AI):
   * its icon, words and fix without a box of its own, which would only
   * indent them in the strip.
   */
  isInline?: boolean | undefined;
  /*
   * Where the repository is hosted (CodeRepositoryType), when the page
   * knows: one that is not on GitHub and is not connected has lost its
   * connection to its Git server - nothing the GitHub App would mend - so
   * the notice says that, and links Repositories, where it connects again.
   * Unknown is GitHub.
   */
  provider?: string | undefined;
}

/*
 * What a blocker says, and what fixes it, for a repository on the host the
 * page knows: a repository off GitHub that is not connected is told its
 * connection is gone, not to connect GitHub.
 */
export const getBlockerCopy: (data: {
  type: CodeTaskBlockerType;
  provider?: string | undefined;
}) => {
  sentence: string | undefined;
  fix: CodeTaskBlockerFix | undefined;
} = (data: {
  type: CodeTaskBlockerType;
  provider?: string | undefined;
}): {
  sentence: string | undefined;
  fix: CodeTaskBlockerFix | undefined;
} => {
  if (
    data.type === CodeTaskBlockerType.RepositoryNotConnected &&
    CodeHost.readType(data.provider) !== CodeRepositoryType.GitHub
  ) {
    return {
      sentence: CODE_TASK_REPOSITORY_CONNECTION_GONE,
      fix: {
        pageMap: PageMap.CODE_REPOSITORIES,
        title: CODE_TASK_CONNECT_REPOSITORIES,
      },
    };
  }

  return {
    sentence: CODE_TASK_BLOCKER_SENTENCES[data.type],
    fix:
      data.type === CodeTaskBlockerType.NoAiCredits
        ? {
            pageMap: PageMap.SETTINGS_AI_CREDITS,
            title: CODE_TASK_ADD_AI_CREDITS,
          }
        : CODE_TASK_BLOCKER_FIXES[data.type],
  };
};

// A gate's answer as yes, no, or not yet known (the snapshot is on its way).
const toAccess: (gate: PermissionGateResult) => ProjectBalanceAccess = (
  gate: PermissionGateResult,
): ProjectBalanceAccess => {
  if (gate.isAllowed) {
    return ProjectBalanceAccess.Yes;
  }

  // Refused with a reason: the gate knows who this is, and it is not them.
  return gate.disabledReason
    ? ProjectBalanceAccess.No
    : ProjectBalanceAccess.Unknown;
};

/*
 * Whether the reader may make the fix the notice links to, as the page it
 * opens would let them:
 *
 *   - AI credits: a project owner or someone with Manage Billing
 *     (ProjectBalanceAccess, as the AI Credits page asks);
 *   - turning AI on: whoever may change Project.enableAi - the column's own
 *     update permissions, as the AI investigation card asks;
 *   - an LLM provider: whoever may create one;
 *   - the repository's Runner setting: whoever may change the repository;
 *   - its access token: whoever may connect repositories - create code
 *     repositories - as the server asks when it is replaced.
 *
 * The plan, the bill and a disconnected repository are linked for everyone:
 * those pages say themselves who may change them, as the plan banner on
 * every AI page does.
 */
export const getBlockerFixAccess: (
  type: CodeTaskBlockerType,
) => ProjectBalanceAccess = (
  type: CodeTaskBlockerType,
): ProjectBalanceAccess => {
  switch (type) {
    case CodeTaskBlockerType.NoAiCredits:
      return getProjectBalanceAccess(ProjectBalanceType.AI);
    case CodeTaskBlockerType.AiDisabled: {
      if (!PermissionGate.hasPermissionSnapshot()) {
        return ProjectBalanceAccess.Unknown;
      }

      const permissions: Array<Permission> =
        new Project().getColumnAccessControlFor("enableAi")?.update || [];

      return PermissionGate.holdsAnyOf(permissions)
        ? ProjectBalanceAccess.Yes
        : ProjectBalanceAccess.No;
    }
    case CodeTaskBlockerType.NoLlmProvider:
      return toAccess(
        PermissionGate.check(new LlmProvider(), ModelAction.Create),
      );
    case CodeTaskBlockerType.NoAgent:
    case CodeTaskBlockerType.RunnerNotOnline:
    case CodeTaskBlockerType.GlobalRunnersOff:
    case CodeTaskBlockerType.RepositoryNeedsOwnRunner:
      return toAccess(
        PermissionGate.check(new CodeRepository(), ModelAction.Update),
      );
    case CodeTaskBlockerType.RepositoryTokenRefused:
      return toAccess(
        PermissionGate.check(new CodeRepository(), ModelAction.Create),
      );
    default:
      return ProjectBalanceAccess.Yes;
  }
};

/*
 * Why AI cannot work in this repository right now, said once, above the
 * request box, with the one link that fixes it - what the server would
 * refuse a request for (CodeTaskGate), in the reader's language, so the box
 * never says one thing while sending says another. A read-only member is
 * told what they can do (read), not shown a fix they cannot make. The same
 * goes for a fix only some people may make (AI credits, the AI switch, an
 * LLM provider, the repository's Runner): the link is offered to them,
 * everyone else is told who can, and nobody is told anything while their
 * permissions are on the way.
 */
const CodeBlockerNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const access: ProjectBalanceAccess = getBlockerFixAccess(props.blocker.type);
  const copy: {
    sentence: string | undefined;
    fix: CodeTaskBlockerFix | undefined;
  } = getBlockerCopy({
    type: props.blocker.type,
    provider: props.provider,
  });
  const fix: CodeTaskBlockerFix | undefined =
    CODE_TASK_REPOSITORY_SETTINGS_FIXES.includes(props.blocker.type) &&
    !props.repositoryId
      ? undefined
      : copy.fix;
  const whoCanFix: string | undefined =
    props.blocker.type === CodeTaskBlockerType.NoAiCredits
      ? WHO_CAN_ADD_AI_CREDITS
      : CODE_TASK_BLOCKER_WHO_CAN_FIX[props.blocker.type];
  const isPermission: boolean =
    props.blocker.type === CodeTaskBlockerType.NoPermission;
  const sentence: string | undefined = copy.sentence;
  /*
   * GitHub connected from here, rather than on Repositories - only for a
   * repository on GitHub.
   */
  const connectHere: CodeConnectGitHubFix | undefined =
    props.blocker.type === CodeTaskBlockerType.RepositoryNotConnected &&
    CodeHost.readType(props.provider) === CodeRepositoryType.GitHub
      ? props.connectGitHub
      : undefined;

  const renderFix: () => ReactElement = (): ReactElement => {
    if (connectHere) {
      return connectHere.lockReason ? (
        <p data-testid="code-blocker-who-can" className="mt-1 leading-6">
          {connectHere.lockReason}
        </p>
      ) : (
        <button
          type="button"
          data-testid="code-blocker-fix"
          onClick={connectHere.onConnect}
          className="mt-1 inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-500 focus:outline-none focus-visible:underline"
        >
          {translator.translateText("Connect GitHub")}
          <Icon icon={IconProp.ArrowRight} className="h-3.5 w-3.5" />
        </button>
      );
    }

    return (
      <>
        {fix && access === ProjectBalanceAccess.Yes ? (
          <Link
            to={
              /*
               * The repository's own settings open at the setting that
               * fixes it - its Runner, with More settings open there; its
               * access token, in Repository Details on top.
               */
              CODE_TASK_REPOSITORY_SETTINGS_FIXES.includes(
                props.blocker.type,
              ) && props.repositoryId
                ? getRepositorySettingsRoute(props.repositoryId, fix.setting)
                : RouteUtil.populateRouteParams(RouteMap[fix.pageMap] as Route)
            }
            dataTestId="code-blocker-fix"
            className="mt-1 inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-500"
          >
            <>
              {translator.translateText(fix.title)}
              <Icon icon={IconProp.ArrowRight} className="h-3.5 w-3.5" />
            </>
          </Link>
        ) : (
          <></>
        )}
        {whoCanFix && access === ProjectBalanceAccess.No ? (
          <p data-testid="code-blocker-who-can" className="mt-1 leading-6">
            {translator.translateText(whoCanFix)}
          </p>
        ) : (
          <></>
        )}
      </>
    );
  };

  return (
    <div
      data-testid="code-blocker"
      data-blocker={props.blocker.type}
      className={`flex items-start text-sm ${
        props.isInline ? "gap-2" : "gap-3 rounded-lg px-4 py-3"
      } ${
        isPermission
          ? props.isInline
            ? "text-gray-700"
            : "bg-gray-50 text-gray-700 ring-1 ring-inset ring-gray-200"
          : props.isInline
            ? "text-amber-900"
            : "bg-amber-50 text-amber-900"
      }`}
    >
      <Icon
        icon={isPermission ? IconProp.Lock : IconProp.ExclaimationCircle}
        className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
          isPermission ? "text-gray-400" : "text-amber-600"
        }`}
      />
      <div className="min-w-0 flex-1">
        <p className="leading-6">
          {props.blocker.type === CodeTaskBlockerType.RunnerNotOnline &&
          props.blocker.runnerName ? (
            <TranslatedSentence
              template={CODE_TASK_RUNNER_NOT_ONLINE_NAMED}
              slots={{
                runner: (
                  <span
                    className="break-words font-semibold"
                    data-testid="code-blocker-runner"
                  >
                    {props.blocker.runnerName}
                  </span>
                ),
              }}
            />
          ) : sentence ? (
            translator.translateText(sentence)
          ) : (
            props.blocker.message
          )}
        </p>
        {renderFix()}
      </div>
    </div>
  );
};

export default CodeBlockerNotice;
