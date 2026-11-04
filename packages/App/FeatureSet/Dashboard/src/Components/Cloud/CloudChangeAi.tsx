import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  CLOUD_AI_CHANGE_BY,
  CLOUD_AI_CHANGE_LOGS,
  CloudAiChangeFix,
  CloudAiChangeSubject,
  describeCloudAiChangeApproval,
  describeCloudAiChangeSubject,
  getCloudAiChangeLogsRoute,
} from "./CloudAiChangeWords";
import { CloudAiChange } from "./CloudChangesScope";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * A CHANGE ONEUPTIME AI MADE, ON A CLOUD CHANGES LIST (the account's
 * Changes, a resource's Changes).
 *
 * The cloud recorded it under the Cloud AI agent's role, as
 * "oneuptime-ai-scale-out-1a2b3c4d", which read like anyone's change. The
 * By column says OneUptime AI, with the role's session under it as the
 * cloud's audit log names it; a line under what changed links the change
 * to its fix: the incident or alert it fixed, who approved it (or that it
 * ran on its own), and its entry in the account's AI Logs. On a phone,
 * where the By column folds away, the line starts with OneUptime AI.
 */

export const CLOUD_CHANGE_AI_LINE_TEST_ID: string = "cloud-change-ai";
export const CLOUD_CHANGE_AI_ACTOR_TEST_ID: string = "cloud-change-ai-actor";

function recordRoute(subject: CloudAiChangeSubject): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[
      subject.kind === "incident" ? PageMap.INCIDENT_VIEW : PageMap.ALERT_VIEW
    ] as Route,
    { modelId: new ObjectID(subject.recordId) },
  );
}

// The account's AI Logs page, or null without an account to name.
export function getCloudAccountAiLogsRoute(
  cloudAccountId: string | null,
): Route | null {
  if (!cloudAccountId || !ObjectID.isValidUUID(cloudAccountId)) {
    return null;
  }

  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_AI_LOGS] as Route,
    { modelId: new ObjectID(cloudAccountId) },
  );
}

// OneUptime AI's mark: its name, with the AI's sparkles.
const AiMark: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span className="inline-flex items-center gap-1 font-medium text-indigo-700">
      <Icon
        icon={IconProp.Sparkles}
        className="h-3.5 w-3.5 flex-shrink-0"
        aria-hidden={true}
      />
      <span>
        {translator.translateText(CLOUD_AI_CHANGE_BY) || CLOUD_AI_CHANGE_BY}
      </span>
    </span>
  );
};

const Separator: FunctionComponent = (): ReactElement => {
  return (
    <span className="text-gray-300" aria-hidden={true}>
      ·
    </span>
  );
};

export interface CloudChangeAiLineProps {
  change: CloudAiChange;
  // The fix as the reader read it; null until it is read, or when it may not be.
  fix: CloudAiChangeFix | null;
  /*
   * Where the account's AI Logs are, when the page knows: an account's
   * Changes names its own; a resource's names the account each change was
   * made in.
   */
  cloudAccountId: string | null;
}

/*
 * The line under a change OneUptime AI made: on a phone its mark, then the
 * record it fixed (a link), who approved it, and its AI Logs entry (a
 * link), set apart by dots.
 */
export const CloudChangeAiLine: FunctionComponent<CloudChangeAiLineProps> = (
  props: CloudChangeAiLineProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const subject: CloudAiChangeSubject | null = describeCloudAiChangeSubject({
    change: props.change,
    fix: props.fix,
  });
  const approval: { template: string; name: string | null } | null =
    describeCloudAiChangeApproval(props.fix);
  const logs: Route | null = getCloudAiChangeLogsRoute({
    aiLogsRoute: getCloudAccountAiLogsRoute(
      props.cloudAccountId || props.change.cloudAccountId,
    ),
    suggestionId: props.change.suggestionId,
  });

  const facts: Array<{ key: string; element: ReactElement }> = [];

  if (subject) {
    facts.push({
      key: "subject",
      element: (
        <Link
          to={recordRoute(subject)}
          className="font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
          dataTestId={`${CLOUD_CHANGE_AI_LINE_TEST_ID}-${subject.kind}`}
        >
          {translator.translateTemplate(subject.template, subject.values)}
        </Link>
      ),
    });
  }

  if (approval) {
    facts.push({
      key: "approval",
      element: (
        <span
          className="min-w-0 break-words"
          data-testid={`${CLOUD_CHANGE_AI_LINE_TEST_ID}-approval`}
        >
          {approval.name ? (
            <TranslatedSentence
              template={approval.template}
              slots={{
                name: (
                  <span className="font-medium text-gray-700">
                    {approval.name}
                  </span>
                ),
              }}
            />
          ) : (
            translator.translateText(approval.template)
          )}
        </span>
      ),
    });
  }

  if (logs) {
    facts.push({
      key: "logs",
      element: (
        <Link
          to={logs}
          className="text-indigo-600 hover:text-indigo-800 hover:underline"
          dataTestId={`${CLOUD_CHANGE_AI_LINE_TEST_ID}-logs`}
        >
          {translator.translateText(CLOUD_AI_CHANGE_LOGS) ||
            CLOUD_AI_CHANGE_LOGS}
        </Link>
      ),
    });
  }

  return (
    <div
      className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-gray-600"
      data-testid={CLOUD_CHANGE_AI_LINE_TEST_ID}
    >
      {/* Its By column folds away on a phone: the line says who, there. */}
      <span
        className="inline-flex items-center gap-x-1.5 md:hidden"
        data-testid={`${CLOUD_CHANGE_AI_LINE_TEST_ID}-mark`}
      >
        <AiMark />
        {facts.length > 0 ? <Separator /> : <></>}
      </span>
      {facts.map(
        (fact: { key: string; element: ReactElement }, index: number) => {
          return (
            <Fragment key={fact.key}>
              {index > 0 ? <Separator /> : <></>}
              {fact.element}
            </Fragment>
          );
        },
      )}
    </div>
  );
};

/*
 * The By column of a change OneUptime AI made: OneUptime AI, with who the
 * cloud's own audit log names under it (the agent's role session), on one
 * line, whole on hover.
 */
export const CloudChangeAiActor: FunctionComponent<{ actor: string }> = (props: {
  actor: string;
}): ReactElement => {
  return (
    <div
      className="min-w-0 max-w-[14rem] text-sm"
      data-testid={CLOUD_CHANGE_AI_ACTOR_TEST_ID}
    >
      <AiMark />
      {props.actor ? (
        <div
          className="max-w-[8rem] truncate text-xs text-gray-500"
          title={props.actor}
          data-testid={`${CLOUD_CHANGE_AI_ACTOR_TEST_ID}-session`}
        >
          {props.actor}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};
