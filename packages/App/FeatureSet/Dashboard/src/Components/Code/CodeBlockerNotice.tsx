import {
  CODE_TASK_ADD_AI_CREDITS,
  CODE_TASK_BLOCKER_FIXES,
  CODE_TASK_BLOCKER_SENTENCES,
  CODE_TASK_BLOCKER_WHO_CAN_FIX,
  CodeTaskBlockerFix,
} from "./CodeTaskCopy";
import {
  getProjectBalanceAccess,
  ProjectBalanceAccess,
} from "../ProjectBalance/ProjectBalanceAccess";
import { WHO_CAN_ADD_AI_CREDITS } from "../ProjectBalance/ProjectBalanceCopy";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import LlmProvider from "Common/Models/DatabaseModels/LlmProvider";
import Project from "Common/Models/DatabaseModels/Project";
import Runner from "Common/Models/DatabaseModels/Runner";
import Route from "Common/Types/API/Route";
import { CodeTaskBlocker, CodeTaskBlockerType } from "Common/Types/AI/CodeTask";
import IconProp from "Common/Types/Icon/IconProp";
import Permission from "Common/Types/Permission";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { ProjectBalanceType } from "Common/Utils/Project/ProjectBalance";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  blocker: CodeTaskBlocker;
}

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
 *   - an LLM provider or a Runner: whoever may create one.
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
      return toAccess(PermissionGate.check(new Runner(), ModelAction.Create));
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
 * LLM provider, a Runner): the link is offered to them, everyone else is
 * told who can, and nobody is told anything while their permissions are
 * on the way.
 */
const CodeBlockerNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const access: ProjectBalanceAccess = getBlockerFixAccess(props.blocker.type);
  const fix: CodeTaskBlockerFix | undefined =
    props.blocker.type === CodeTaskBlockerType.NoAiCredits
      ? {
          pageMap: PageMap.SETTINGS_AI_CREDITS,
          title: CODE_TASK_ADD_AI_CREDITS,
        }
      : CODE_TASK_BLOCKER_FIXES[props.blocker.type];
  const whoCanFix: string | undefined =
    props.blocker.type === CodeTaskBlockerType.NoAiCredits
      ? WHO_CAN_ADD_AI_CREDITS
      : CODE_TASK_BLOCKER_WHO_CAN_FIX[props.blocker.type];
  const isPermission: boolean =
    props.blocker.type === CodeTaskBlockerType.NoPermission;
  const sentence: string | undefined =
    CODE_TASK_BLOCKER_SENTENCES[props.blocker.type];

  return (
    <div
      data-testid="code-blocker"
      data-blocker={props.blocker.type}
      className={`flex items-start gap-3 rounded-lg px-4 py-3 text-sm ${
        isPermission ? "bg-gray-50 text-gray-700" : "bg-amber-50 text-amber-900"
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
          {sentence
            ? translator.translateText(sentence)
            : props.blocker.message}
        </p>
        {fix && access === ProjectBalanceAccess.Yes ? (
          <Link
            to={RouteUtil.populateRouteParams(RouteMap[fix.pageMap] as Route)}
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
      </div>
    </div>
  );
};

export default CodeBlockerNotice;
