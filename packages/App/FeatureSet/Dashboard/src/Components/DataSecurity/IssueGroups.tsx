import AppLink from "../AppLink/AppLink";
import {
  DECLARED_CODE_ANSWER,
  DECLARED_CODE_STATE_TONES,
  DECLARED_CODE_STATE_WORDS,
  DECLARED_CODE_UNNAMED_REPOSITORY,
  DECLARED_CODE_VIEW_PROGRESS,
  DECLARED_CODE_VIEW_PULL_REQUEST,
  DECLARED_CODE_VIEW_PULL_REQUEST_NUMBER,
  DECLARED_CODE_VIEW_TASK,
} from "../AutoRemediation/DeclaredCodeChangeWords";
import { DeclaredCodeChangeMark } from "../AutoRemediation/DeclaredCodeChangeLine";
import { IssueStatusPill, SeverityPill } from "./DataSecurityPills";
import {
  FIX_THE_CAUSE,
  GROUPS_LABEL,
  GROUP_MEMBERS_CUT,
  GROUP_STORES_FILTERED,
  HIDE_GROUP_STORES,
  OTHER_ISSUES,
  SHOW_GROUP_STORES,
  getGroupHeadline,
  getGroupProgress,
} from "./IssueGroupsCopy";
import { getIssueViewRoute } from "./IssueListRoute";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";
import Route from "Common/Types/API/Route";
import {
  DataSecurityCheckInfo,
  getDataSecurityCheck,
} from "Common/Types/DataSecurity/DataSecurityCheckCatalog";
import { DataSecurityIssueGroupJSON } from "Common/Types/DataSecurity/DataSecurityIssueGroup";
import DataSecurityIssueStatus from "Common/Types/DataSecurity/DataSecurityIssueStatus";
import IconProp from "Common/Types/Icon/IconProp";
import { DeclaredCodeChangeState } from "Common/Utils/AiRemediation/DeclaredCodeChange";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * GROUP BY CAUSE, ON THE ISSUES LIST (#10370).
 *
 * Above the list's rows, each group of issues one mistake made: "40
 * issues, one cause: the static-site module", what its check finds, how
 * many are fixed and how many are left, where its pull request stands, and
 * Fix the Cause - one action for the group (IssueGroupFixModal). Its
 * stores fold under it, each linking to its issue; the list's filters
 * narrow them as they narrow the rows, so the two never disagree about
 * which issues match. Under the groups, the issues in none.
 *
 * Inside the list's card: sections between dividers, never a card in it.
 */

export const ISSUE_GROUPS_TEST_ID: string = "data-security-issue-groups";

const LINK_CLASS_NAME: string =
  "inline-flex items-center gap-1 rounded text-xs font-medium text-indigo-600 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

export interface ComponentProps {
  // The groups to draw, each with at least one issue the list's filters match.
  groups: Array<DataSecurityIssueGroupJSON>;
  // The issues the filters match, by group: what folds under each.
  membersByGroup: ReadonlyMap<string, Array<DataSecurityIssue>>;
  // The list's filters narrow its issues: a group says how many of its stores match.
  isFiltered: boolean;
  // More issues matched than were read: the riskiest are shown.
  cutAt?: number | undefined;
  // The group a link asked for: opened, and scrolled to.
  focusedGroupId?: string | undefined;
  onFix: (group: DataSecurityIssueGroupJSON) => void;
}

// Where the group's pull request stands, with what to do about it.
const GroupFixLine: FunctionComponent<{
  group: DataSecurityIssueGroupJSON;
}> = (props: { group: DataSecurityIssueGroupJSON }): ReactElement => {
  const translator: Translator = useTranslator();
  const fix: DataSecurityIssueGroupJSON["fix"] = props.group.fix;

  if (
    !fix ||
    !DECLARED_CODE_STATE_WORDS[fix.state as DeclaredCodeChangeState]
  ) {
    return <></>;
  }

  const state: DeclaredCodeChangeState = fix.state as DeclaredCodeChangeState;

  if (state === DeclaredCodeChangeState.Hidden || !fix.taskId) {
    return (
      <p className="mt-2 text-xs leading-5 text-gray-600">
        {translator.translateText(DECLARED_CODE_STATE_WORDS[state])}
      </p>
    );
  }

  const taskRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.CODE_TASK_VIEW] as Route,
    { modelId: fix.taskId },
  );
  const taskWords: string =
    state === DeclaredCodeChangeState.Writing
      ? DECLARED_CODE_VIEW_PROGRESS
      : state === DeclaredCodeChangeState.WaitingForYou
        ? DECLARED_CODE_ANSWER
        : DECLARED_CODE_VIEW_TASK;

  return (
    <div
      className="mt-2 flex items-start gap-2"
      data-testid={`${ISSUE_GROUPS_TEST_ID}-fix`}
      data-state={state}
    >
      <DeclaredCodeChangeMark tone={DECLARED_CODE_STATE_TONES[state]} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="break-words text-xs leading-5 text-gray-700">
          {translator.translateTemplate(
            DECLARED_CODE_STATE_WORDS[state],
            {
              repository:
                fix.repositoryName ||
                translator.translateText(DECLARED_CODE_UNNAMED_REPOSITORY) ||
                DECLARED_CODE_UNNAMED_REPOSITORY,
            },
            { setsValuesApart: true },
          )}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {fix.pullRequestUrl ? (
            <a
              href={fix.pullRequestUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={LINK_CLASS_NAME}
            >
              <span>
                {fix.pullRequestNumber ? (
                  <TranslatedSentence
                    template={DECLARED_CODE_VIEW_PULL_REQUEST_NUMBER}
                    slots={{
                      number: <span dir="ltr">#{fix.pullRequestNumber}</span>,
                    }}
                  />
                ) : (
                  translator.translateText(DECLARED_CODE_VIEW_PULL_REQUEST)
                )}
              </span>
              <Icon icon={IconProp.ExternalLink} className="h-3 w-3" />
            </a>
          ) : (
            <></>
          )}
          <Link to={taskRoute} className={LINK_CLASS_NAME}>
            <>{translator.translateText(taskWords)}</>
          </Link>
        </div>
      </div>
    </div>
  );
};

// One of a group's stores, with its issue.
const GroupMember: FunctionComponent<{ issue: DataSecurityIssue }> = (props: {
  issue: DataSecurityIssue;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const issueId: string = props.issue._id?.toString() || "";
  const storeName: string =
    props.issue.dataStore?.name || props.issue.dataStoreId?.toString() || "";
  const kind: string = props.issue.dataStore?.kind || "";

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <SeverityPill severity={props.issue.severity} />
      <AppLink
        className="min-w-0 text-sm font-medium text-gray-900 hover:underline [overflow-wrap:anywhere]"
        to={getIssueViewRoute(issueId)}
      >
        <IsolatedText text={storeName} />
      </AppLink>
      {kind ? (
        <span className="text-xs text-gray-500">
          {translator.translateText(kind) || kind}
        </span>
      ) : (
        <></>
      )}
      {props.issue.status &&
      props.issue.status !== DataSecurityIssueStatus.Open ? (
        <IssueStatusPill status={props.issue.status} />
      ) : (
        <></>
      )}
    </li>
  );
};

const IssueGroupRow: FunctionComponent<{
  group: DataSecurityIssueGroupJSON;
  members: Array<DataSecurityIssue>;
  isFiltered: boolean;
  isFocused: boolean;
  onFix: (group: DataSecurityIssueGroupJSON) => void;
}> = (props: {
  group: DataSecurityIssueGroupJSON;
  members: Array<DataSecurityIssue>;
  isFiltered: boolean;
  isFocused: boolean;
  onFix: (group: DataSecurityIssueGroupJSON) => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(props.isFocused);
  const rowRef: React.RefObject<HTMLLIElement> = useRef<HTMLLIElement>(null);
  const group: DataSecurityIssueGroupJSON = props.group;
  const check: DataSecurityCheckInfo | undefined = getDataSecurityCheck(
    group.checkId,
  );
  const storesId: string = `issue-group-${group.groupId}-stores`;
  const fixedShare: number =
    group.issueCount > 0
      ? Math.round((group.fixedIssueCount * 100) / group.issueCount)
      : 0;

  useEffect(() => {
    if (props.isFocused) {
      setIsOpen(true);
      rowRef.current?.scrollIntoView?.({ block: "center" });
    }
  }, [props.isFocused]);

  return (
    <li
      ref={rowRef}
      className={`py-4 first:pt-0 ${props.isFocused ? "rounded-md bg-indigo-50/40" : ""}`}
      data-testid={`${ISSUE_GROUPS_TEST_ID}-group`}
      data-group-id={group.groupId}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-indigo-50 text-indigo-600"
        >
          <Icon icon={IconProp.Squares} className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <p
            className="text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]"
            data-testid={`${ISSUE_GROUPS_TEST_ID}-headline`}
          >
            {getGroupHeadline(group, translator)}
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
            {check ? (
              <>
                <span>{translator.translateText(check.title)}</span>
                <span aria-hidden="true">
                  <InlineSeparator markOnly />
                </span>
              </>
            ) : (
              <></>
            )}
            <span data-testid={`${ISSUE_GROUPS_TEST_ID}-progress`}>
              {getGroupProgress(group, translator)}
            </span>
            {/*
             * The open issues are what the list shows first: a group says so
             * only when the filters narrow them further.
             */}
            {props.isFiltered && props.members.length < group.openIssueCount ? (
              <>
                <span aria-hidden="true">
                  <InlineSeparator markOnly />
                </span>
                <span>
                  {translator.translatePlural(
                    GROUP_STORES_FILTERED,
                    props.members.length,
                  )}
                </span>
              </>
            ) : (
              <></>
            )}
          </div>

          {/* How far along: the words beside it say it, so it is a picture. */}
          <div
            aria-hidden="true"
            className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-gray-200"
          >
            <div
              className="h-full rounded-full bg-green-500"
              style={{ width: `${fixedShare}%` }}
            />
          </div>

          <GroupFixLine group={group} />

          <button
            type="button"
            className="mt-2 inline-flex items-center gap-1 rounded text-xs font-medium text-indigo-600 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            aria-expanded={isOpen}
            aria-controls={storesId}
            data-testid={`${ISSUE_GROUPS_TEST_ID}-toggle`}
            onClick={() => {
              setIsOpen(!isOpen);
            }}
          >
            <Icon
              icon={isOpen ? IconProp.ChevronDown : IconProp.ChevronRight}
              className="h-3 w-3"
            />
            <span>
              {isOpen
                ? translator.translateText(HIDE_GROUP_STORES)
                : translator.translatePlural(
                    SHOW_GROUP_STORES,
                    props.members.length,
                  )}
            </span>
          </button>

          {isOpen ? (
            <ul
              id={storesId}
              className="mt-1 divide-y divide-gray-100"
              data-testid={`${ISSUE_GROUPS_TEST_ID}-stores`}
            >
              {props.members.map((issue: DataSecurityIssue): ReactElement => {
                return (
                  <GroupMember
                    key={issue._id?.toString() || ""}
                    issue={issue}
                  />
                );
              })}
            </ul>
          ) : (
            <></>
          )}
        </div>

        {group.openIssueCount > 0 ? (
          <Button
            title={FIX_THE_CAUSE}
            icon={IconProp.Wrench}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            dataTestId={`${ISSUE_GROUPS_TEST_ID}-fix-button`}
            onClick={() => {
              props.onFix(group);
            }}
          />
        ) : (
          <></>
        )}
      </div>
    </li>
  );
};

const IssueGroups: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.groups.length === 0) {
    return <></>;
  }

  return (
    <section
      aria-label={translator.translateText(GROUPS_LABEL)}
      className="mb-4 border-b border-gray-200 pb-4"
      data-testid={ISSUE_GROUPS_TEST_ID}
    >
      <ul className="divide-y divide-gray-100">
        {props.groups.map((group: DataSecurityIssueGroupJSON): ReactElement => {
          return (
            <IssueGroupRow
              key={group.groupId}
              group={group}
              members={props.membersByGroup.get(group.groupId) || []}
              isFiltered={props.isFiltered}
              isFocused={props.focusedGroupId === group.groupId}
              onFix={props.onFix}
            />
          );
        })}
      </ul>

      {props.cutAt ? (
        <p className="mt-2 text-xs text-gray-500">
          {translator.translatePlural(GROUP_MEMBERS_CUT, props.cutAt)}
        </p>
      ) : (
        <></>
      )}

      <h3 className="mt-4 text-sm font-semibold text-gray-900">
        {translator.translateText(OTHER_ISSUES)}
      </h3>
    </section>
  );
};

export default IssueGroups;
