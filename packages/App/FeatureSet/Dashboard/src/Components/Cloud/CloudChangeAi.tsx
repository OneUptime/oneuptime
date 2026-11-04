import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  CLOUD_AI_CHANGE_BY,
  CLOUD_AI_CHANGE_LOGS,
  CloudAiChangeApproval,
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
import { useIsTableColumnDrawn } from "Common/UI/Components/Table/TableCellContext";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * A CHANGE ONEUPTIME AI MADE, ON A CLOUD CHANGES LIST (the account's
 * Changes, a resource's Changes).
 *
 * The cloud recorded it under the Cloud AI agent's role, as
 * "oneuptime-ai-scale-out-1a2b3c4d", which read like anyone's change. Each
 * column now says its part of it:
 *
 *   - By: who made it and who let it - OneUptime AI, and under it who
 *     approved the fix or that it ran on its own. The role's session, as
 *     the cloud's audit log names it, is on the name's hover: a prefix cut
 *     to fit ("oneuptime-ai-scal...") told the reader nothing.
 *   - Under what changed, one short line of two links: what it was for -
 *     the incident or alert it fixed (or the fix it rolled back) - and its
 *     entry in the account's AI Logs, apart by a gap, so where they wrap
 *     no dot is left at the end of a line.
 *
 * Where the By column is not drawn - a phone's card, or a person who turned
 * the column off - the line says who first, on a row of its own: OneUptime
 * AI, and who approved it.
 *
 * A rollback names no approver: the rollback arm runs it on its own once
 * the fix did not help, and "Approved by" there read as if someone had
 * approved the rollback.
 */

export const CLOUD_CHANGE_AI_LINE_TEST_ID: string = "cloud-change-ai";
export const CLOUD_CHANGE_AI_ACTOR_TEST_ID: string = "cloud-change-ai-actor";

// The Changes table's By column, which says who made a change.
export const CLOUD_CHANGES_BY_COLUMN_ID: string = "by";

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

/*
 * OneUptime AI's mark: its name, with the AI's sparkles. A div, not a
 * span: the icon draws a block of its own. Its hover says who the cloud's
 * audit log names (the agent's role session), when the change names one.
 */
const AiMark: FunctionComponent<{
  session?: string | undefined;
  dataTestId?: string | undefined;
}> = (props: {
  session?: string | undefined;
  dataTestId?: string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      className="inline-flex min-w-0 items-center gap-1 font-medium text-indigo-700"
      title={props.session || undefined}
      data-testid={props.dataTestId}
    >
      <Icon icon={IconProp.Sparkles} className="h-3.5 w-3.5 flex-shrink-0" />
      <span>
        {translator.translateText(CLOUD_AI_CHANGE_BY) || CLOUD_AI_CHANGE_BY}
      </span>
    </div>
  );
};

const Separator: FunctionComponent = (): ReactElement => {
  return (
    <span className="text-gray-300" aria-hidden={true}>
      ·
    </span>
  );
};

/*
 * Who let the change run: "Approved by Maya Chen", the name standing out,
 * or "Applied automatically".
 */
const ApprovalText: FunctionComponent<{
  approval: CloudAiChangeApproval;
  className: string;
  dataTestId: string;
}> = (props: {
  approval: CloudAiChangeApproval;
  className: string;
  dataTestId: string;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span className={props.className} data-testid={props.dataTestId}>
      {props.approval.name ? (
        <TranslatedSentence
          template={props.approval.template}
          slots={{
            name: (
              <span className="font-medium text-gray-700">
                {props.approval.name}
              </span>
            ),
          }}
        />
      ) : (
        translator.translateText(props.approval.template) ||
        props.approval.template
      )}
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
 * The line under a change OneUptime AI made: the record it fixed (a link)
 * and its AI Logs entry (a link) - and, where the By column is not drawn,
 * a row before them saying who made it and who approved it, a dot between
 * the two.
 */
export const CloudChangeAiLine: FunctionComponent<CloudChangeAiLineProps> = (
  props: CloudChangeAiLineProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // A phone's card, or a table whose By column was turned off, says who here.
  const isByColumnDrawn: boolean = useIsTableColumnDrawn(
    CLOUD_CHANGES_BY_COLUMN_ID,
  );
  const subject: CloudAiChangeSubject | null = describeCloudAiChangeSubject({
    change: props.change,
    fix: props.fix,
  });
  const approval: CloudAiChangeApproval | null = describeCloudAiChangeApproval({
    change: props.change,
    fix: props.fix,
  });
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
          {/*
            A whole sentence, its number set apart from the words around
            it where they read right to left: "#18" stays "#18".
          */}
          <TranslatedSentence
            template={subject.template}
            slots={{}}
            values={subject.values}
          />
        </Link>
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

  if (isByColumnDrawn && facts.length === 0) {
    return <></>;
  }

  return (
    <div
      className="mt-1 min-w-0 space-y-0.5 text-xs text-gray-600"
      data-testid={CLOUD_CHANGE_AI_LINE_TEST_ID}
    >
      {isByColumnDrawn ? (
        <></>
      ) : (
        <div
          className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5"
          data-testid={`${CLOUD_CHANGE_AI_LINE_TEST_ID}-mark`}
        >
          <AiMark />
          {approval ? (
            <>
              <Separator />
              <ApprovalText
                approval={approval}
                className="min-w-0 break-words"
                dataTestId={`${CLOUD_CHANGE_AI_LINE_TEST_ID}-approval`}
              />
            </>
          ) : (
            <></>
          )}
        </div>
      )}
      {facts.length > 0 ? (
        /*
         * Two links side by side, apart by a gap as the Remediation step's
         * links are, not by a dot: where they wrap - a rollback's longer
         * phrase, a long language - no dot is left at the end of a line.
         */
        <div
          className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-0.5"
          data-testid={`${CLOUD_CHANGE_AI_LINE_TEST_ID}-links`}
        >
          {facts.map((fact: { key: string; element: ReactElement }) => {
            return <Fragment key={fact.key}>{fact.element}</Fragment>;
          })}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export interface CloudChangeAiActorProps {
  // Who the cloud's audit log names: the agent's role session.
  actor: string;
  change: CloudAiChange;
  fix: CloudAiChangeFix | null;
}

/*
 * The By column of a change OneUptime AI made: OneUptime AI, the session
 * the cloud's audit log names on its hover, and under it who approved the
 * fix or that it ran on its own - once the reader's read of the fix says.
 */
export const CloudChangeAiActor: FunctionComponent<CloudChangeAiActorProps> = (
  props: CloudChangeAiActorProps,
): ReactElement => {
  const approval: CloudAiChangeApproval | null = describeCloudAiChangeApproval({
    change: props.change,
    fix: props.fix,
  });

  return (
    <div
      className="min-w-0 max-w-[14rem] text-sm"
      data-testid={CLOUD_CHANGE_AI_ACTOR_TEST_ID}
    >
      <AiMark
        session={props.actor}
        dataTestId={`${CLOUD_CHANGE_AI_ACTOR_TEST_ID}-name`}
      />
      {approval ? (
        <div className="mt-0.5 text-xs text-gray-500">
          <ApprovalText
            approval={approval}
            className="block break-words"
            dataTestId={`${CLOUD_CHANGE_AI_ACTOR_TEST_ID}-approval`}
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};
