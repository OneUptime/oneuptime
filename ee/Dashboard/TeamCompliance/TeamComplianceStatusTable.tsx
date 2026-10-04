import {
  ComplianceSummary,
  MemberStatusCounts,
  MemberStatusFilter,
  SelfFix,
  areAllRulesPaused,
  countFilteredMembersByStatus,
  filterMembers,
  getActiveRules,
  getMemberDisplayName,
  getMemberFirstName,
  getMemberIssueForRule,
  getNextRuleSquareIndex,
  getNoActiveRulesAdvice,
  getRuleLabel,
  getRuleTitle,
  getSelfFixKey,
  getSelfFixes,
  summarizeCompliance,
} from "./ComplianceView";
import UserElement from "@oneuptime/dashboard/Components/User/User";
import PageMap from "@oneuptime/dashboard/Utils/PageMap";
import RouteMap, { RouteUtil } from "@oneuptime/dashboard/Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import type {
  TeamComplianceIssueJSON,
  TeamComplianceRuleJSON,
  TeamComplianceStatusJSON,
  TeamMemberComplianceJSON,
} from "Common/Types/Team/TeamComplianceStatus";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import FilterButtons from "Common/UI/Components/FilterButtons/FilterButtons";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * The members section of Teams > Compliance (OneUptime Enterprise): every
 * member of the team, worst first, with a square per active rule saying
 * whether they meet it, the reason for each rule they fail in words they can
 * act on, and the way to the page that fixes it.
 *
 * It renders the status the Compliance page already read - it makes no
 * request of its own - so its counts cannot disagree with the verdict above
 * it, and a rule change costs one refresh of the page rather than one per
 * section. Only that page renders it, so it is not a Dashboard plugin key.
 */
export interface ComponentProps {
  status: TeamComplianceStatusJSON;
  statusFilter: MemberStatusFilter;
  onStatusFilterChange: (filter: MemberStatusFilter) => void;
  // Narrow the list to members failing this rule (from the rules card).
  failingRuleId: string | null;
  onClearFailingRule: () => void;
  // May open another member's on-call setup (Users > View > On-call readiness).
  canViewMemberSetup: boolean;
  // The signed-in user: their own row links to their own settings.
  currentUserId: string;
}

// Members drawn at once; "Show more" adds this many again.
export const MEMBER_PAGE_SIZE: number = 25;

// Every "how to fix" link on a member row, the member's own included.
const FIX_LINK_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

const STATUS_FILTER_OPTIONS: Array<{
  value: MemberStatusFilter;
  label: string;
  count: (counts: MemberStatusCounts) => number;
}> = [
  {
    value: MemberStatusFilter.All,
    label: "All",
    count: (counts: MemberStatusCounts): number => {
      return counts.all;
    },
  },
  {
    value: MemberStatusFilter.NeedsAttention,
    label: "Needs attention",
    count: (counts: MemberStatusCounts): number => {
      return counts.needsAttention;
    },
  },
  {
    value: MemberStatusFilter.Compliant,
    label: "Compliant",
    count: (counts: MemberStatusCounts): number => {
      return counts.compliant;
    },
  },
];

interface MemberRuleResultsProps {
  member: TeamMemberComplianceJSON;
  // The active rules, in the rules card's order.
  rules: Array<TeamComplianceRuleJSON>;
  // The rule the list is narrowed to, whose square is picked out.
  highlightedRuleId: string | null;
}

/*
 * One square per active rule, in the rules card's order: a glance across a
 * row says how close the member is, and hovering or focusing a square says
 * which rule it is and - for a failure - why.
 *
 * The squares are ONE tab stop per member (a roving tabindex): with a stop
 * per square, 25 members and 6 rules put 150 presses of Tab between a
 * keyboard user and "Show more". Tab reaches the row's current square; the
 * arrow keys, Home and End move between squares, and every square still opens
 * its tooltip on focus - the only place a passing square names its rule.
 */
const MemberRuleResults: FunctionComponent<MemberRuleResultsProps> = (
  props: MemberRuleResultsProps,
): ReactElement => {
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const squareRefs: MutableRefObject<Array<HTMLSpanElement | null>> = useRef<
    Array<HTMLSpanElement | null>
  >([]);

  const count: number = props.rules.length;
  // A rule list that shrank under the stored square hands the stop back to the first.
  const tabStopIndex: number = activeIndex < count ? activeIndex : 0;

  const passing: number = props.rules.filter(
    (rule: TeamComplianceRuleJSON): boolean => {
      return !getMemberIssueForRule(props.member, rule.settingId);
    },
  ).length;

  const moveFocus: (event: React.KeyboardEvent, index: number) => void = (
    event: React.KeyboardEvent,
    index: number,
  ): void => {
    const next: number | null = getNextRuleSquareIndex({
      key: event.key,
      current: index,
      count: count,
    });

    if (next === null) {
      // Not ours: Tab and the rest keep their normal meaning.
      return;
    }

    event.preventDefault();
    setActiveIndex(next);
    squareRefs.current[next]?.focus();
  };

  return (
    <div className="flex items-center gap-2">
      <ul
        aria-label={`Rule results for ${getMemberDisplayName(props.member)}`}
        data-testid="compliance-member-rule-results"
        className="flex flex-wrap items-center gap-1"
      >
        {props.rules.map(
          (rule: TeamComplianceRuleJSON, index: number): ReactElement => {
            const issue: TeamComplianceIssueJSON | undefined =
              getMemberIssueForRule(props.member, rule.settingId);
            const ruleLabel: string = getRuleLabel(rule);
            const label: string = issue
              ? `${ruleLabel}: not met. ${issue.reason}`
              : `${ruleLabel}: met`;
            const isHighlighted: boolean =
              props.highlightedRuleId === rule.settingId;

            return (
              <li key={rule.settingId} className="flex">
                <Tooltip
                  richContent={
                    <div className="max-w-xs p-1 text-left">
                      <p className="text-xs font-semibold text-gray-900">
                        {ruleLabel}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-gray-600">
                        {issue ? issue.reason : "Meets this rule."}
                      </p>
                    </div>
                  }
                  interactive={false}
                >
                  <span
                    ref={(element: HTMLSpanElement | null) => {
                      squareRefs.current[index] = element;
                    }}
                    tabIndex={index === tabStopIndex ? 0 : -1}
                    role="img"
                    aria-label={label}
                    data-testid={`compliance-member-rule-${rule.settingId}`}
                    data-result={issue ? "fail" : "pass"}
                    onFocus={() => {
                      setActiveIndex(index);
                    }}
                    onKeyDown={(event: React.KeyboardEvent) => {
                      moveFocus(event, index);
                    }}
                    className={`inline-flex h-5 w-5 items-center justify-center rounded ring-1 ring-inset focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                      issue
                        ? "bg-red-50 ring-red-200"
                        : "bg-emerald-50 ring-emerald-200"
                    } ${isHighlighted ? "outline outline-2 outline-offset-1 outline-indigo-500" : ""}`}
                  >
                    <Icon
                      icon={issue ? IconProp.Close : IconProp.Check}
                      className={`h-3 w-3 ${
                        issue ? "text-red-600" : "text-emerald-600"
                      }`}
                    />
                  </span>
                </Tooltip>
              </li>
            );
          },
        )}
      </ul>
      <span className="whitespace-nowrap text-xs tabular-nums text-gray-500">
        {`${passing} of ${count}`}
      </span>
    </div>
  );
};

const TeamComplianceStatusTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [search, setSearch] = useState<string>("");
  const [visibleCount, setVisibleCount] = useState<number>(MEMBER_PAGE_SIZE);

  // A new filter is a new list: start it from the top again.
  useEffect(() => {
    setVisibleCount(MEMBER_PAGE_SIZE);
  }, [props.statusFilter, props.failingRuleId, search]);

  const members: Array<TeamMemberComplianceJSON> =
    props.status.userComplianceStatuses;
  const activeRules: Array<TeamComplianceRuleJSON> = getActiveRules(
    props.status.complianceSettings,
  );

  const failingRule: TeamComplianceRuleJSON | undefined = props.failingRuleId
    ? props.status.complianceSettings.find(
        (rule: TeamComplianceRuleJSON): boolean => {
          return rule.settingId === props.failingRuleId;
        },
      )
    : undefined;

  const getRuleTitleForIssue: (issue: TeamComplianceIssueJSON) => string = (
    issue: TeamComplianceIssueJSON,
  ): string => {
    const rule: TeamComplianceRuleJSON | undefined =
      props.status.complianceSettings.find(
        (candidate: TeamComplianceRuleJSON): boolean => {
          return candidate.settingId === issue.settingId;
        },
      );

    return getRuleTitle(
      rule || { ruleType: issue.ruleType, notificationChannels: [] },
    );
  };

  const getStatusChip: (member: TeamMemberComplianceJSON) => ReactElement = (
    member: TeamMemberComplianceJSON,
  ): ReactElement => {
    if (member.isCompliant) {
      return (
        <span
          data-testid="compliance-member-status"
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200"
        >
          <Icon icon={IconProp.CheckCircle} className="h-3 w-3" />
          Compliant
        </span>
      );
    }

    return (
      <span
        data-testid="compliance-member-status"
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-200"
      >
        <Icon icon={IconProp.Alert} className="h-3 w-3 text-red-500" />
        Needs attention
      </span>
    );
  };

  /*
   * The way to the fix. The signed-in member gets a link to each of their own
   * settings pages that fixes something they fail - the notification methods
   * page and the on-call rules page for a member failing one of each - once
   * per page. For anyone else, a viewer who may see that person's on-call
   * setup gets a link to it (Users > View > On-call readiness, where the rules
   * and methods can be repaired); everyone else gets no link to a page they
   * could not open.
   */
  const getFix: (member: TeamMemberComplianceJSON) => ReactElement = (
    member: TeamMemberComplianceJSON,
  ): ReactElement => {
    const isSelf: boolean =
      Boolean(props.currentUserId) && props.currentUserId === member.userId;

    if (isSelf) {
      /*
       * Links, like everyone else's fix: they go somewhere, and they should
       * look and behave (middle-click, copy link) like the rows around them.
       */
      return (
        <>
          {getSelfFixes(member).map((fix: SelfFix): ReactElement => {
            return (
              <Link
                key={getSelfFixKey(fix)}
                to={RouteUtil.addQuery(
                  RouteUtil.populateRouteParams(RouteMap[fix.page] as Route),
                  fix.query,
                )}
                className={FIX_LINK_CLASS_NAME}
              >
                <Icon icon={IconProp.Settings} className="h-3.5 w-3.5" />
                <span data-testid="compliance-member-fix-self">
                  {fix.title}
                </span>
                <Icon icon={IconProp.ChevronRight} className="h-3.5 w-3.5" />
              </Link>
            );
          })}
        </>
      );
    }

    if (!props.canViewMemberSetup) {
      return <></>;
    }

    return (
      <Link
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.USER_VIEW_ON_CALL_READINESS] as Route,
          { modelId: member.userId },
        )}
        className={FIX_LINK_CLASS_NAME}
      >
        <span data-testid="compliance-member-fix-link">
          {`Open ${getMemberFirstName(member)}'s on-call setup`}
        </span>
        <Icon icon={IconProp.ChevronRight} className="h-3.5 w-3.5" />
      </Link>
    );
  };

  const getMemberRow: (member: TeamMemberComplianceJSON) => ReactElement = (
    member: TeamMemberComplianceJSON,
  ): ReactElement => {
    return (
      <li
        key={member.userId}
        data-testid={`compliance-member-${member.userId}`}
        className="py-4 first:pt-0 last:pb-0"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <UserElement
              user={{
                /*
                 * Without _id the avatar route cannot be built and the row
                 * falls back to the blank profile picture.
                 */
                _id: member.userId,
                name: member.userName,
                email: member.userEmail,
                profilePictureId: member.userProfilePictureId,
              }}
              usernameClassName="text-sm font-medium text-gray-900"
            />
          </div>
          <div className="flex flex-shrink-0 flex-wrap items-center gap-3 pl-11 sm:pl-0">
            <MemberRuleResults
              member={member}
              rules={activeRules}
              highlightedRuleId={props.failingRuleId}
            />
            {getStatusChip(member)}
          </div>
        </div>

        {member.nonCompliantRules.length > 0 ? (
          <div className="mt-2.5 pl-11">
            <ul
              aria-label={`Why ${getMemberDisplayName(member)} needs attention`}
              data-testid="compliance-member-issues"
              className="space-y-1"
            >
              {member.nonCompliantRules.map(
                (
                  issue: TeamComplianceIssueJSON,
                  index: number,
                ): ReactElement => {
                  return (
                    <li
                      key={`${issue.settingId}-${index}`}
                      className="flex items-start gap-2 text-sm leading-relaxed text-gray-600"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-2 h-1 w-1 flex-shrink-0 rounded-full bg-red-400"
                      />
                      <span>
                        <span className="font-medium text-gray-900">
                          {getRuleTitleForIssue(issue)}:
                        </span>{" "}
                        {issue.reason}
                      </span>
                    </li>
                  );
                },
              )}
            </ul>
            <div className="mt-2.5 flex flex-wrap items-center gap-3">
              {getFix(member)}
            </div>
          </div>
        ) : (
          <></>
        )}
      </li>
    );
  };

  const getBody: () => ReactElement = (): ReactElement => {
    if (members.length === 0) {
      return (
        <EmptyState
          id="compliance-members-empty"
          icon={IconProp.UserGroup}
          iconClassName="mx-auto h-10 w-10 text-gray-400"
          paddingClassName="py-10"
          title="No members on this team yet"
          description="Add people on the team's Members page and how they measure up against these rules shows up here."
        />
      );
    }

    /*
     * With no rule active nobody is being checked, and a list of green
     * "Compliant" chips would claim a clean bill of health nobody earned.
     * "Turn a rule back on" is only said when turning any rule on would
     * check somebody: not for a rule of a type this build does not recognise
     * (on or off, it is never checked), nor for one whose every severity was
     * deleted (it has to be edited first).
     */
    if (activeRules.length === 0) {
      const summary: ComplianceSummary = summarizeCompliance(props.status);
      const nobody: string = `none of its ${members.length} ${
        members.length === 1 ? "member is" : "members are"
      } being checked`;

      return (
        <div
          data-testid="compliance-members-no-active-rules"
          className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center"
        >
          <p className="mx-auto max-w-md text-sm leading-relaxed text-gray-600">
            {areAllRulesPaused(summary)
              ? `Every rule on this team is paused, so ${nobody}. Turn a rule back on to see who meets it.`
              : `No rule on this team can be checked right now, so ${nobody}. ${getNoActiveRulesAdvice(summary)}`}
          </p>
        </div>
      );
    }

    const counts: MemberStatusCounts = countFilteredMembersByStatus({
      members: members,
      search: search,
      failingSettingId: props.failingRuleId,
    });
    const filtered: Array<TeamMemberComplianceJSON> = filterMembers({
      members: members,
      status: props.statusFilter,
      search: search,
      failingSettingId: props.failingRuleId,
    });
    const shown: Array<TeamMemberComplianceJSON> = filtered.slice(
      0,
      visibleCount,
    );
    const remaining: number = filtered.length - shown.length;
    const isFiltered: boolean =
      props.statusFilter !== MemberStatusFilter.All ||
      Boolean(props.failingRuleId) ||
      Boolean(search.trim());

    return (
      <div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div role="group" aria-label="Filter members by status">
            <FilterButtons
              options={STATUS_FILTER_OPTIONS.map(
                (option: {
                  value: MemberStatusFilter;
                  label: string;
                  count: (counts: MemberStatusCounts) => number;
                }) => {
                  return {
                    value: option.value,
                    label: option.label,
                    badge: option.count(counts),
                  };
                },
              )}
              selectedValue={props.statusFilter}
              onSelect={(value: string) => {
                props.onStatusFilterChange(value as MemberStatusFilter);
              }}
            />
          </div>
          <div className="relative w-full sm:w-64">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5">
              <Icon icon={IconProp.Search} className="h-4 w-4 text-gray-400" />
            </div>
            <input
              type="search"
              value={search}
              aria-label="Search members by name or email"
              placeholder="Search members"
              data-testid="compliance-members-search"
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setSearch(event.target.value);
              }}
              className="block w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        {failingRule ? (
          <div
            data-testid="compliance-members-rule-filter"
            className="mt-3 flex flex-wrap items-center gap-2"
          >
            <span className="text-xs text-gray-500">Failing</span>
            <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 py-0.5 pl-2 pr-1 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200">
              {getRuleLabel(failingRule)}
              <button
                type="button"
                aria-label="Clear the rule filter"
                data-testid="compliance-members-rule-filter-clear"
                onClick={props.onClearFailingRule}
                className="rounded p-0.5 text-indigo-500 hover:bg-indigo-100 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <Icon icon={IconProp.Close} className="h-3 w-3" />
              </button>
            </span>
          </div>
        ) : (
          <></>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <p
            aria-live="polite"
            data-testid="compliance-members-count"
            className="text-xs font-medium text-gray-500"
          >
            {isFiltered
              ? `${filtered.length} of ${members.length} ${
                  members.length === 1 ? "member" : "members"
                }`
              : `${members.length} ${members.length === 1 ? "member" : "members"}, worst first`}
          </p>
          {/*
           * What the squares mean, once, for the reader who has not hovered
           * one yet. Decorative for screen readers: every square carries its
           * own label.
           */}
          <div
            aria-hidden="true"
            data-testid="compliance-members-legend"
            className="flex items-center gap-3 text-xs text-gray-500"
          >
            <span className="inline-flex items-center gap-1">
              <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm bg-emerald-50 ring-1 ring-inset ring-emerald-200">
                <Icon
                  icon={IconProp.Check}
                  className="h-2.5 w-2.5 text-emerald-600"
                />
              </span>
              meets a rule
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm bg-red-50 ring-1 ring-inset ring-red-200">
                <Icon
                  icon={IconProp.Close}
                  className="h-2.5 w-2.5 text-red-600"
                />
              </span>
              fails it
            </span>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div
            data-testid="compliance-members-no-match"
            className="mt-3 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center"
          >
            <p className="text-sm text-gray-600">
              {failingRule &&
              props.statusFilter === MemberStatusFilter.Compliant
                ? `Everyone failing ${getRuleLabel(failingRule)} needs attention, so none of them is compliant.`
                : "No members match these filters."}
            </p>
            <button
              type="button"
              data-testid="compliance-members-clear-filters"
              onClick={() => {
                setSearch("");
                props.onStatusFilterChange(MemberStatusFilter.All);
                props.onClearFailingRule();
              }}
              className="mt-2 rounded text-sm font-medium text-indigo-600 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <ul
            aria-label="Team members"
            data-testid="compliance-members-list"
            className="mt-3 divide-y divide-gray-100"
          >
            {shown.map(getMemberRow)}
          </ul>
        )}

        {remaining > 0 ? (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3 border-t border-gray-100 pt-4">
            <span className="text-xs text-gray-500">
              {`Showing ${shown.length} of ${filtered.length}`}
            </span>
            <Button
              title={`Show ${Math.min(remaining, MEMBER_PAGE_SIZE)} more`}
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              dataTestId="compliance-members-show-more"
              onClick={() => {
                setVisibleCount((count: number): number => {
                  return count + MEMBER_PAGE_SIZE;
                });
              }}
            />
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <section
      id="compliance-members"
      aria-label="Member compliance"
      data-testid="compliance-members"
    >
      <Card
        title="Members"
        description={`How everyone on ${
          props.status.teamName || "this team"
        } measures up against the active rules, and what each of them still has to set up.`}
      >
        {getBody()}
      </Card>
    </section>
  );
};

export default TeamComplianceStatusTable;
