import {
  ComplianceSummary,
  ComplianceVerdict,
  ComplianceVerdictKind,
  MemberStatusFilter,
  countOf,
  getComplianceVerdict,
  getEvaluatedAt,
  summarizeCompliance,
} from "./ComplianceView";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import type { TeamComplianceStatusJSON } from "Common/Types/Team/TeamComplianceStatus";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * The verdict at the top of Teams > Compliance: one sentence that answers
 * "can everyone on this team actually be reached the way we require?", the
 * evidence for it, and the time it was checked.
 *
 * Built on the SLO overview hero's structure (icon tile, status badge,
 * headline, a fact strip underneath) so the two read as the same product.
 * Every class is one Theme.css already remaps for dark mode.
 */
export interface ComponentProps {
  status: TeamComplianceStatusJSON;
  isRefreshing: boolean;
  // A refresh that failed over results that are still shown; "" otherwise.
  refreshError: string;
  onRefresh: () => void;
  // The members section's current status filter, drawn as pressed facts.
  memberFilter: MemberStatusFilter;
  onShowMembers: (filter: MemberStatusFilter) => void;
}

interface VerdictPresentation {
  icon: IconProp;
  badgeType: StatusBadgeType;
  tileClassName: string;
}

const PRESENTATIONS: Record<ComplianceVerdictKind, VerdictPresentation> = {
  [ComplianceVerdictKind.NoRules]: {
    icon: IconProp.ShieldCheck,
    badgeType: StatusBadgeType.Neutral,
    tileClassName: "bg-gray-100 text-gray-500",
  },
  [ComplianceVerdictKind.NoActiveRules]: {
    icon: IconProp.PauseCircle,
    badgeType: StatusBadgeType.Neutral,
    tileClassName: "bg-gray-100 text-gray-500",
  },
  [ComplianceVerdictKind.NoMembers]: {
    icon: IconProp.UserGroup,
    badgeType: StatusBadgeType.Neutral,
    tileClassName: "bg-gray-100 text-gray-500",
  },
  [ComplianceVerdictKind.AllCompliant]: {
    icon: IconProp.ShieldCheck,
    badgeType: StatusBadgeType.Success,
    tileClassName: "bg-emerald-50 text-emerald-700",
  },
  [ComplianceVerdictKind.NeedsAttention]: {
    icon: IconProp.ShieldExclamation,
    badgeType: StatusBadgeType.Danger,
    tileClassName: "bg-red-50 text-red-700",
  },
};

// How often "checked 3 minutes ago" is re-worded while the page stays open.
const RELATIVE_TIME_TICK_MS: number = 60 * 1000;

const ComplianceHero: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [, setTick] = useState<number>(0);

  useEffect(() => {
    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      setTick((tick: number): number => {
        return tick + 1;
      });
    }, RELATIVE_TIME_TICK_MS);

    return () => {
      clearInterval(interval);
    };
  }, []);

  const summary: ComplianceSummary = summarizeCompliance(props.status);
  const verdict: ComplianceVerdict = getComplianceVerdict(summary);
  const presentation: VerdictPresentation = PRESENTATIONS[verdict.kind];
  const evaluatedAt: Date | null = getEvaluatedAt(props.status);

  const isMeasured: boolean =
    verdict.kind === ComplianceVerdictKind.AllCompliant ||
    verdict.kind === ComplianceVerdictKind.NeedsAttention;

  const getCheckedAgainst: () => string = (): string => {
    if (!isMeasured) {
      return verdict.detail;
    }

    const paused: string =
      summary.pausedRuleCount > 0 ? ` (${summary.pausedRuleCount} paused)` : "";

    return `Checked against ${countOf(summary.activeRuleCount, "active rule")}${paused}`;
  };

  const getTime: () => ReactElement = (): ReactElement => {
    if (!evaluatedAt) {
      return <></>;
    }

    return (
      <>
        {" · checked "}
        <time
          dateTime={evaluatedAt.toISOString()}
          title={OneUptimeDate.getDateAsLocalFormattedString(evaluatedAt)}
        >
          {OneUptimeDate.fromNow(evaluatedAt)}
        </time>
      </>
    );
  };

  const getBar: () => ReactElement = (): ReactElement => {
    if (!isMeasured) {
      return <></>;
    }

    const compliantPercent: number = Math.round(
      (summary.compliantCount / summary.memberCount) * 100,
    );

    return (
      <div className="mt-5" data-testid="compliance-hero-bar">
        <div
          role="img"
          aria-label={`${summary.compliantCount} of ${countOf(
            summary.memberCount,
            "member",
          )} compliant, ${summary.attentionCount} ${
            summary.attentionCount === 1 ? "needs" : "need"
          } attention`}
          className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100"
        >
          {summary.compliantCount > 0 ? (
            <div
              data-testid="compliance-hero-bar-compliant"
              className="h-2 bg-emerald-500 transition-all duration-300"
              style={{
                width: `${(summary.compliantCount / summary.memberCount) * 100}%`,
              }}
            />
          ) : (
            <></>
          )}
          {summary.attentionCount > 0 ? (
            <div
              data-testid="compliance-hero-bar-attention"
              className="h-2 bg-red-500 transition-all duration-300"
              style={{
                width: `${(summary.attentionCount / summary.memberCount) * 100}%`,
              }}
            />
          ) : (
            <></>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full bg-emerald-500"
            />
            {`${compliantPercent}% compliant`}
          </span>
          {summary.attentionCount > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full bg-red-500"
              />
              {`${100 - compliantPercent}% need attention`}
            </span>
          ) : (
            <></>
          )}
        </div>
      </div>
    );
  };

  /*
   * A count that filters the members section when pressed - the number an
   * admin is looking at and the control that acts on it are the same object.
   * Only a count that has members behind it is pressable: a button that
   * filters down to nobody is a dead end.
   */
  const getFact: (data: {
    testId: string;
    label: string;
    value: number;
    tone?: "positive" | "critical" | undefined;
    filter?: MemberStatusFilter | undefined;
    pressLabel?: string | undefined;
    hint?: string | undefined;
  }) => ReactElement = (data: {
    testId: string;
    label: string;
    value: number;
    tone?: "positive" | "critical" | undefined;
    filter?: MemberStatusFilter | undefined;
    pressLabel?: string | undefined;
    hint?: string | undefined;
  }): ReactElement => {
    let valueClassName: string = "text-gray-900";

    if (isMeasured && data.tone === "critical" && data.value > 0) {
      valueClassName = "text-red-700";
    }

    if (isMeasured && data.tone === "positive" && data.value > 0) {
      valueClassName = "text-emerald-700";
    }

    const filter: MemberStatusFilter | undefined = data.filter;
    const isPressable: boolean =
      Boolean(filter) && isMeasured && data.value > 0;
    const isPressed: boolean = isPressable && props.memberFilter === filter;

    return (
      <div className="min-w-0" data-testid={data.testId}>
        <dt className="text-xs font-medium text-gray-500">{data.label}</dt>
        <dd className="mt-1 flex items-baseline gap-1.5">
          {isPressable && filter ? (
            <button
              type="button"
              aria-pressed={isPressed}
              aria-controls="compliance-members"
              aria-label={data.pressLabel}
              onClick={() => {
                props.onShowMembers(
                  isPressed ? MemberStatusFilter.All : filter,
                );
              }}
              className={`inline-flex items-center gap-1 rounded text-base font-semibold tabular-nums underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${valueClassName} ${
                isPressed ? "underline" : ""
              }`}
            >
              {data.value}
              <Icon
                icon={IconProp.ChevronRight}
                className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
              />
            </button>
          ) : (
            <span
              className={`text-base font-semibold tabular-nums ${valueClassName}`}
            >
              {isMeasured || !filter ? data.value : "\u2014"}
            </span>
          )}
          {data.hint ? (
            <span className="truncate text-xs text-gray-500">{data.hint}</span>
          ) : (
            <></>
          )}
        </dd>
      </div>
    );
  };

  return (
    <section
      aria-labelledby="compliance-hero-headline"
      data-testid="compliance-hero"
      className="mb-5 rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      <div className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-4">
            <div
              data-testid="compliance-hero-icon"
              className={`max-sm:hidden h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl sm:flex ${presentation.tileClassName}`}
            >
              <Icon icon={presentation.icon} className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <div data-testid="compliance-hero-badge">
                <StatusBadge
                  text={verdict.badgeText}
                  type={presentation.badgeType}
                />
              </div>
              <h2
                id="compliance-hero-headline"
                data-testid="compliance-hero-headline"
                className="mt-2 text-xl font-semibold tracking-tight text-gray-900"
              >
                {verdict.headline}
              </h2>
              <p
                data-testid="compliance-hero-subline"
                className="mt-1.5 max-w-3xl text-sm leading-6 text-gray-600"
              >
                {getCheckedAgainst()}
                {getTime()}
              </p>
            </div>
          </div>
          <div className="flex-shrink-0">
            <Button
              title="Refresh"
              icon={IconProp.Refresh}
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              isLoading={props.isRefreshing}
              onClick={props.onRefresh}
              dataTestId="compliance-hero-refresh"
            />
          </div>
        </div>

        {getBar()}

        {props.refreshError ? (
          <p
            role="alert"
            data-testid="compliance-hero-refresh-error"
            className="mt-4 text-sm text-red-700"
          >
            {`Could not check again - showing the last results that loaded. ${props.refreshError}`}
          </p>
        ) : (
          <></>
        )}
      </div>

      <dl
        aria-label="Team compliance at a glance"
        className="grid grid-cols-2 gap-5 rounded-b-xl border-t border-gray-100 bg-gray-50 px-5 py-4 sm:px-6 lg:grid-cols-4"
      >
        {getFact({
          testId: "compliance-fact-members",
          label: "Members",
          value: summary.memberCount,
        })}
        {getFact({
          testId: "compliance-fact-compliant",
          label: "Compliant",
          value: summary.compliantCount,
          tone: "positive",
          filter: MemberStatusFilter.Compliant,
          pressLabel: `Show the ${countOf(summary.compliantCount, "compliant member")}`,
        })}
        {getFact({
          testId: "compliance-fact-attention",
          label: "Need attention",
          value: summary.attentionCount,
          tone: "critical",
          filter: MemberStatusFilter.NeedsAttention,
          pressLabel: `Show the ${countOf(
            summary.attentionCount,
            "member who needs",
            "members who need",
          )} attention`,
        })}
        {getFact({
          testId: "compliance-fact-rules",
          label: "Active rules",
          value: summary.activeRuleCount,
          hint:
            summary.pausedRuleCount > 0
              ? `${summary.pausedRuleCount} paused`
              : undefined,
        })}
      </dl>
    </section>
  );
};

export default ComplianceHero;
