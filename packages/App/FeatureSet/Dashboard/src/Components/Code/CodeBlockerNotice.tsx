import {
  CODE_TASK_ADD_AI_CREDITS,
  CODE_TASK_BLOCKER_FIXES,
  CODE_TASK_BLOCKER_SENTENCES,
  CodeTaskBlockerFix,
} from "./CodeTaskCopy";
import {
  getProjectBalanceAccess,
  ProjectBalanceAccess,
} from "../ProjectBalance/ProjectBalanceAccess";
import { WHO_CAN_ADD_AI_CREDITS } from "../ProjectBalance/ProjectBalanceCopy";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { CodeTaskBlocker, CodeTaskBlockerType } from "Common/Types/AI/CodeTask";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { ProjectBalanceType } from "Common/Utils/Project/ProjectBalance";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  blocker: CodeTaskBlocker;
}

/*
 * Why AI cannot work in this repository right now, said once, above the
 * request box, with the one link that fixes it - what the server would
 * refuse a request for (CodeTaskGate), in the reader's language, so the box
 * never says one thing while sending says another. A read-only member is
 * told what they can do (read), not shown a fix they cannot make, and so is
 * someone out of AI credits who may not add them: AI Credits is linked only
 * for a project owner or someone with Manage Billing, everyone else is told
 * who can, and nobody is told anything while their permissions are on the
 * way.
 */
const CodeBlockerNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const aiCreditsAccess: ProjectBalanceAccess | null =
    props.blocker.type === CodeTaskBlockerType.NoAiCredits
      ? getProjectBalanceAccess(ProjectBalanceType.AI)
      : null;
  const fix: CodeTaskBlockerFix | undefined =
    aiCreditsAccess === ProjectBalanceAccess.Yes
      ? {
          pageMap: PageMap.SETTINGS_AI_CREDITS,
          title: CODE_TASK_ADD_AI_CREDITS,
        }
      : CODE_TASK_BLOCKER_FIXES[props.blocker.type];
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
        {fix ? (
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
        {aiCreditsAccess === ProjectBalanceAccess.No ? (
          <p data-testid="code-blocker-who-can" className="mt-1 leading-6">
            {translator.translateText(WHO_CAN_ADD_AI_CREDITS)}
          </p>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default CodeBlockerNotice;
