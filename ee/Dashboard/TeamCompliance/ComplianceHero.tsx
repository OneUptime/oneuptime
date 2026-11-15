import {
  ComplianceSummary,
  ComplianceVerdict,
  ComplianceVerdictKind,
  MemberStatusFilter,
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
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { useWriteDatesInSentenceLanguage } from "Common/UI/Utils/SentenceLanguage";
import {
  composedValue,
  getInlineSeparator,
  PluralTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import EmptyValue from "Common/UI/Components/Detail/EmptyValue";

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

// What the subline says the verdict was checked against, by how many rules.
const CHECKED_AGAINST: PluralTemplate = {
  one: "Checked against {{count}} active rule",
  other: "Checked against {{count}} active rules",
};

const CHECKED_AGAINST_WITH_PAUSED: PluralTemplate = {
  one: "Checked against {{count}} active rule ({{paused}} paused)",
  other: "Checked against {{count}} active rules ({{paused}} paused)",
};

/*
 * When it was checked: a clause after "Checked against ...", a sentence of
 * its own after a sentence that says nothing is measured.
 */
const CHECKED_AT: string = translationKey("checked {{time}}");

const LAST_CHECKED_AT: string = translationKey("Last checked {{time}}.");

const BAR_LABEL: string = translationKey("{{compliant}}, {{attention}}");

const COMPLIANT_OF_MEMBERS: PluralTemplate = {
  one: "{{compliant}} of {{count}} member compliant",
  other: "{{compliant}} of {{count}} members compliant",
};

const NEED_ATTENTION: PluralTemplate = {
  one: "{{count}} needs attention",
  other: "{{count}} need attention",
};

const SHOW_COMPLIANT_MEMBERS: PluralTemplate = {
  one: "Show the {{count}} compliant member",
  other: "Show the {{count}} compliant members",
};

const SHOW_MEMBERS_NEEDING_ATTENTION: PluralTemplate = {
  one: "Show the {{count}} member who needs attention",
  other: "Show the {{count}} members who need attention",
};

const PAUSED_RULES: PluralTemplate = {
  one: "{{count}} paused",
  other: "{{count}} paused",
};

/*
 * The time it was checked, written in the language of the sentence around
 * it (TranslatedSentence): "vor 3 Minuten" in a German sentence, never in an
 * English one.
 */
const CheckedAt: FunctionComponent<{ date: Date }> = (props: {
  date: Date;
}): ReactElement => {
  const writeDates: <T>(write: () => T) => T =
    useWriteDatesInSentenceLanguage();

  return (
    <time
      dateTime={props.date.toISOString()}
      title={writeDates((): string => {
        return OneUptimeDate.getDateAsLocalFormattedString(props.date);
      })}
    >
      {writeDates((): string => {
        return OneUptimeDate.fromNow(props.date);
      })}
    </time>
  );
};

const ComplianceHero: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
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
  const verdict: ComplianceVerdict = getComplianceVerdict(summary, translator);
  const presentation: VerdictPresentation = PRESENTATIONS[verdict.kind];
  const evaluatedAt: Date | null = getEvaluatedAt(props.status);

  const isMeasured: boolean =
    verdict.kind === ComplianceVerdictKind.AllCompliant ||
    verdict.kind === ComplianceVerdictKind.NeedsAttention;

  const getCheckedAgainst: () => string = (): string => {
    if (!isMeasured) {
      return verdict.detail;
    }

    return summary.pausedRuleCount > 0
      ? translator.translatePlural(
          CHECKED_AGAINST_WITH_PAUSED,
          summary.activeRuleCount,
          { paused: translator.formatNumber(summary.pausedRuleCount) },
        )
      : translator.translatePlural(CHECKED_AGAINST, summary.activeRuleCount);
  };

  const getTime: () => ReactElement = (): ReactElement => {
    if (!evaluatedAt) {
      return <></>;
    }

    /*
     * After "Checked against N active rules" the time reads as one clause,
     * set off as the language sets off two facts on a line; after a
     * sentence (the states where nothing is measured) it gets a sentence of
     * its own.
     */
    return (
      <>
        {isMeasured ? getInlineSeparator(translator.language) : " "}
        <TranslatedSentence
          template={isMeasured ? CHECKED_AT : LAST_CHECKED_AT}
          slots={{ time: <CheckedAt date={evaluatedAt} /> }}
        />
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
          aria-label={translator.translateTemplate(BAR_LABEL, {
            compliant: composedValue((sentence: Translator): string => {
              return sentence.translatePlural(
                COMPLIANT_OF_MEMBERS,
                summary.memberCount,
                { compliant: sentence.formatNumber(summary.compliantCount) },
              );
            }),
            attention: composedValue((sentence: Translator): string => {
              return sentence.translatePlural(
                NEED_ATTENTION,
                summary.attentionCount,
              );
            }),
          })}
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
            {translator.translateTemplate("{{percent}}% compliant", {
              percent: translator.formatNumber(compliantPercent),
            })}
          </span>
          {summary.attentionCount > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full bg-red-500"
              />
              {translator.translateTemplate("{{percent}}% need attention", {
                percent: translator.formatNumber(100 - compliantPercent),
              })}
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
    // English, a key: looked up here.
    label: string;
    value: number;
    tone?: "positive" | "critical" | undefined;
    filter?: MemberStatusFilter | undefined;
    // In the reader's words already.
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
    const value: string = translator.formatNumber(data.value);

    return (
      <div className="min-w-0" data-testid={data.testId}>
        <dt className="text-xs font-medium text-gray-500">
          {translator.translateText(data.label)}
        </dt>
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
              {value}
              <Icon
                icon={IconProp.ChevronRight}
                className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
              />
            </button>
          ) : (
            <span
              className={`text-base font-semibold tabular-nums ${valueClassName}`}
            >
              {isMeasured || !filter ? value : <EmptyValue />}
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
                {/* In the reader's words already (getComplianceVerdict). */}
                <StatusBadge
                  text={verdict.badgeText}
                  type={presentation.badgeType}
                  isUserContent={true}
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
            {translator.translateTemplate(
              "Could not check again - showing the last results that loaded. {{error}}",
              { error: props.refreshError },
            )}
          </p>
        ) : (
          <></>
        )}
      </div>

      <dl
        aria-label={translator.translateText("Team compliance at a glance")}
        className="grid grid-cols-2 gap-5 rounded-b-xl border-t border-gray-100 bg-gray-50 px-5 py-4 sm:px-6 lg:grid-cols-4"
      >
        {getFact({
          testId: "compliance-fact-members",
          label: translationKey("Members"),
          value: summary.memberCount,
        })}
        {getFact({
          testId: "compliance-fact-compliant",
          label: translationKey("Compliant"),
          value: summary.compliantCount,
          tone: "positive",
          filter: MemberStatusFilter.Compliant,
          pressLabel: translator.translatePlural(
            SHOW_COMPLIANT_MEMBERS,
            summary.compliantCount,
          ),
        })}
        {getFact({
          testId: "compliance-fact-attention",
          label: translationKey("Need attention"),
          value: summary.attentionCount,
          tone: "critical",
          filter: MemberStatusFilter.NeedsAttention,
          pressLabel: translator.translatePlural(
            SHOW_MEMBERS_NEEDING_ATTENTION,
            summary.attentionCount,
          ),
        })}
        {getFact({
          testId: "compliance-fact-rules",
          label: translationKey("Active rules"),
          value: summary.activeRuleCount,
          hint:
            summary.pausedRuleCount > 0
              ? translator.translatePlural(
                  PAUSED_RULES,
                  summary.pausedRuleCount,
                )
              : undefined,
        })}
      </dl>
    </section>
  );
};

export default ComplianceHero;
