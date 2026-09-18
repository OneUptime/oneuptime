import CoverageMatrix, {
  CoverageModel,
  buildCoverageModel,
} from "../../../../Components/OnCallPolicy/Readiness/CoverageMatrix";
import {
  ReadinessCoverageCellWire,
  ReadinessMethodWire,
  ReadinessStatusValue,
  getCoverageGaps,
  getStatusConsequence,
  getVerifiedMethods,
} from "../../../../Components/OnCallPolicy/Readiness/ReadinessTypes";
import StatTile, {
  StatTileTone,
} from "../../../../Components/OnCallPolicy/Readiness/StatTile";
import PageMap from "../../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../../Utils/RouteMap";
import PageComponentProps from "../../../PageComponentProps";
import { UserOnCallContextValue, useUserOnCallContext } from "./Context";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Users > View > On-Call > Readiness — the section's overview, and the page the
 * old combined route now redirects to.
 *
 * It answers ONE question: would a page routed to this person actually arrive
 * right now? Everything that ANSWERS that question is here (the status, the
 * verified method count, the coverage grid) and everything that CHANGES it is
 * on a page of its own, reachable from the "what to do next" list at the
 * bottom. That division is the whole point of the reorganisation: the previous
 * single page put a diagnosis and four screens of repair controls in one
 * scroll, so the diagnosis was read on the way past rather than acted on.
 */

const STATUS_LABELS: Record<ReadinessStatusValue, string> = {
  Ready: "Ready",
  PartiallyReady: "Needs setup",
  NotReachable: "Unreachable",
};

const STATUS_ICONS: Record<ReadinessStatusValue, IconProp> = {
  Ready: IconProp.CheckCircle,
  PartiallyReady: IconProp.Alert,
  NotReachable: IconProp.BellSlash,
};

const STATUS_TONES: Record<ReadinessStatusValue, StatTileTone> = {
  Ready: "positive",
  PartiallyReady: "warning",
  NotReachable: "critical",
};

interface NextStep {
  pageMapKey: PageMap;
  title: string;
  icon: IconProp;
  getDescription: (context: UserOnCallContextValue) => string;
}

/*
 * The five pages this one hands off to, in the order somebody fixing a broken
 * responder needs them: a method first, because a rule with nothing to point at
 * is not a rule, and then the four rule types.
 */
const NEXT_STEPS: Array<NextStep> = [
  {
    pageMapKey: PageMap.USER_VIEW_NOTIFICATION_METHODS,
    title: "Notification methods",
    icon: IconProp.Bell,
    getDescription: (context: UserOnCallContextValue): string => {
      return context.isSelf
        ? "The devices and addresses your rules can send to."
        : `Add or remove the devices and addresses ${context.firstName}'s rules can send to.`;
    },
  },
  {
    pageMapKey: PageMap.USER_VIEW_INCIDENT_ON_CALL_RULES,
    title: "Incident on-call rules",
    icon: IconProp.Alert,
    getDescription: (context: UserOnCallContextValue): string => {
      return context.isSelf
        ? "How you are notified when an incident is assigned to you."
        : `How ${context.firstName} is notified when an incident is assigned to them.`;
    },
  },
  {
    pageMapKey: PageMap.USER_VIEW_INCIDENT_EPISODE_ON_CALL_RULES,
    title: "Incident episode on-call rules",
    icon: IconProp.Squares,
    getDescription: (context: UserOnCallContextValue): string => {
      return context.isSelf
        ? "How you are notified when an incident episode is assigned to you."
        : `How ${context.firstName} is notified when an incident episode is assigned to them.`;
    },
  },
  {
    pageMapKey: PageMap.USER_VIEW_ALERT_ON_CALL_RULES,
    title: "Alert on-call rules",
    icon: IconProp.ExclaimationCircle,
    getDescription: (context: UserOnCallContextValue): string => {
      return context.isSelf
        ? "How you are notified when an alert is assigned to you."
        : `How ${context.firstName} is notified when an alert is assigned to them.`;
    },
  },
  {
    pageMapKey: PageMap.USER_VIEW_ALERT_EPISODE_ON_CALL_RULES,
    title: "Alert episode on-call rules",
    icon: IconProp.Squares,
    getDescription: (context: UserOnCallContextValue): string => {
      return context.isSelf
        ? "How you are notified when an alert episode is assigned to you."
        : `How ${context.firstName} is notified when an alert episode is assigned to them.`;
    },
  },
];

const UserViewOnCallReadiness: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const context: UserOnCallContextValue = useUserOnCallContext();

  const {
    displayName,
    firstName,
    isSelf,
    readiness,
    readinessSummary,
    readinessError,
    isLoadingReadiness,
    delivery,
    canEdit,
  } = context;

  const getReadinessHeader: () => ReactElement = (): ReactElement => {
    if (isLoadingReadiness && !readinessSummary) {
      return (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index: number): ReactElement => {
            return (
              <div
                key={`tile-skeleton-${index}`}
                className="h-16 animate-pulse rounded-xl border border-gray-200 bg-gray-50"
              />
            );
          })}
        </div>
      );
    }

    if (readinessError) {
      return (
        <ErrorMessage
          message={readinessError}
          onRefreshClick={() => {
            context.reloadReadiness(true).catch(() => {
              // reloadReadiness routes every failure into the error state.
            });
          }}
        />
      );
    }

    if (!readiness) {
      return <></>;
    }

    const verifiedMethods: Array<ReadinessMethodWire> =
      getVerifiedMethods(readiness);
    const gaps: Array<ReadinessCoverageCellWire> = getCoverageGaps(readiness);
    const coveredCount: number = readiness.coverage.length - gaps.length;

    return (
      <div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            icon={STATUS_ICONS[readiness.status]}
            label="Status"
            value={STATUS_LABELS[readiness.status]}
            tone={STATUS_TONES[readiness.status]}
          />
          <StatTile
            icon={IconProp.Bell}
            label={
              readiness.methods.length > verifiedMethods.length
                ? `Verified methods (${
                    readiness.methods.length - verifiedMethods.length
                  } unverified)`
                : "Verified methods"
            }
            value={`${verifiedMethods.length}`}
            tone={verifiedMethods.length > 0 ? "positive" : "critical"}
          />
          <StatTile
            icon={IconProp.TableCells}
            label="Rule coverage"
            value={
              readiness.coverage.length > 0
                ? `${coveredCount} of ${readiness.coverage.length}`
                : "Not reported"
            }
          />
          <StatTile
            icon={IconProp.Alert}
            label={gaps.length === 1 ? "Gap" : "Gaps"}
            value={`${gaps.length}`}
            tone={gaps.length > 0 ? "warning" : "neutral"}
          />
        </div>

        {/*
         * Stated once, above everything, because it changes what every gap
         * below means. A reader who knows the product assumes the fallback is
         * on — it is on by default and on almost everywhere — and reads an
         * amber cell as "late page" when in this project it is "no page".
         */}
        {readinessSummary?.isFallbackEnabled ? (
          <></>
        ) : (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <Icon
              icon={IconProp.Alert}
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500"
            />
            <p className="text-sm leading-relaxed text-amber-800">
              On-call notification fallback is switched off for this project, so
              a missing notification rule is not a late page — it is no page at
              all. Every gap below is dropped rather than delivered on another
              channel.
            </p>
          </div>
        )}

        <p className="mt-4 text-sm leading-relaxed text-gray-700">
          {getStatusConsequence(readiness, delivery, displayName)}
        </p>

        {readiness.reasons.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {readiness.reasons.map(
              (reason: string, index: number): ReactElement => {
                return (
                  <li
                    key={`reason-${index}`}
                    className="flex items-start gap-2 text-xs leading-relaxed text-gray-600"
                  >
                    <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-gray-400" />
                    {reason}
                  </li>
                );
              },
            )}
          </ul>
        ) : (
          <></>
        )}

        {/*
         * The reminder stays on this page as well as on the methods page, and
         * only while something is actually wrong. An administrator can now add
         * a method on somebody's behalf, but they still cannot VERIFY one — the
         * code goes to the device — so "ask them to finish" remains a real and
         * frequently correct action.
         */}
        {isSelf || readiness.status === "Ready" ? (
          <></>
        ) : (
          <a
            href={context.getReminderHref(readiness)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
          >
            <Icon icon={IconProp.Email} className="h-3.5 w-3.5" />
            Email {firstName} the setup link
          </a>
        )}
      </div>
    );
  };

  const getCoverageBody: () => ReactElement = (): ReactElement => {
    if (isLoadingReadiness && !readinessSummary) {
      return (
        <div className="h-40 animate-pulse rounded-xl border border-gray-200 bg-gray-50" />
      );
    }

    if (!readiness) {
      /*
       * Deliberately not an empty grid. An unreported coverage matrix and a
       * matrix full of holes look identical once drawn, and only one of them is
       * a reason to go and add rules.
       */
      return (
        <p className="text-sm text-gray-500">
          Coverage could not be loaded, so the grid is not shown.{" "}
          {canEdit
            ? "The rule pages are still editable."
            : "The rule pages still list the rules."}
        </p>
      );
    }

    const model: CoverageModel = buildCoverageModel(readiness.coverage);

    return <CoverageMatrix model={model} />;
  };

  return (
    <Fragment>
      <Card
        title="On-call readiness"
        description={
          isSelf
            ? "Whether a page routed to you would actually arrive right now."
            : `Whether a page routed to ${
                displayName || "this user"
              } would actually arrive right now.`
        }
        buttons={[
          {
            title: "Recheck",
            icon: IconProp.Reload,
            buttonStyle: ButtonStyleType.OUTLINE,
            buttonSize: ButtonSize.Small,
            disabled: isLoadingReadiness,
            onClick: () => {
              /*
               * Explicitly bypasses the readiness service's 60s cache. This is
               * the one interaction where the reader has just CHANGED the
               * answer — they fixed a rule or added a method on another page —
               * and a cached summary redrawing them as still broken reads as
               * "the fix did not work".
               */
              context.reloadReadiness(true).catch(() => {
                // reloadReadiness routes every failure into the error state.
              });
            },
          },
        ]}
      >
        {getReadinessHeader()}
      </Card>

      <Card
        title="Coverage"
        description={
          isSelf
            ? "A rule for every severity and rule type you can be paged for. A hole here is a page that does not arrive the way it was meant to."
            : `A rule for every severity and rule type ${firstName} can be paged for. A hole here is a page that does not arrive the way it was meant to.`
        }
      >
        {getCoverageBody()}
      </Card>

      {/*
       * The hand-off. This page diagnoses and does not repair, so it has to say
       * where the repairs live — a diagnosis with no route to the fix is how
       * the previous single page ended up being scrolled past.
       */}
      <Card
        title="What you can change"
        description={
          isSelf
            ? "Your on-call configuration, one page per thing you can change."
            : `${firstName}'s on-call configuration, one page per thing you can change.`
        }
      >
        <ul className="divide-y divide-gray-200">
          {NEXT_STEPS.map((step: NextStep): ReactElement => {
            return (
              <li key={step.pageMapKey} className="py-3">
                <Link
                  className="flex items-start gap-3"
                  to={RouteUtil.populateRouteParams(
                    RouteMap[step.pageMapKey] as Route,
                    { modelId: context.userId },
                  )}
                >
                  <Icon
                    icon={step.icon}
                    className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
                  />
                  <span>
                    <span className="block text-sm font-medium text-gray-900">
                      {step.title}
                    </span>
                    <span className="block text-sm text-gray-500">
                      {step.getDescription(context)}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </Fragment>
  );
};

export default UserViewOnCallReadiness;
