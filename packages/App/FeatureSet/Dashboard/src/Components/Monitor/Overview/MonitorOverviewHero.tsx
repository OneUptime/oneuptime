import { OverviewSection } from "../../../Utils/OverviewSection";
import LiveDuration from "../../EventView/LiveDuration";
import RelativeTime from "../../EpisodeView/RelativeTime";
import { ResourceOwnerEntry } from "../../ResourceOwners/OwnerEntry";
import OwnersCell from "../../ResourceOwners/OwnersCell";
import SloOverviewActionLink from "../../Slo/SloOverviewActionLink";
import { getMonitorOverviewRoute } from "./MonitorOverviewLinks";
import {
  TONE_BADGE,
  TONE_TEXT_CLASS,
  TONE_TILE_CLASS,
  getFactGridClass,
} from "./MonitorOverviewTones";
import MonitorStatusDot from "./MonitorStatusDot";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorType, {
  MonitorTypeHelper,
  MonitorTypeProps,
} from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import StatusBadge from "Common/UI/Components/StatusBadge/StatusBadge";
import {
  MonitorOverviewFact,
  MonitorOverviewPresentation,
  MonitorOverviewPulse,
  MonitorOverviewRunState,
  MonitorOverviewSecondaryBadge,
} from "Common/Utils/Monitor/MonitorOverviewPresentationUtil";
import { MonitorOverviewTarget } from "Common/Utils/Monitor/MonitorOverviewTargetUtil";
import { formatDurationCompact } from "Common/Utils/Slo/SloDuration";
import React, { FunctionComponent, ReactElement, useMemo } from "react";

export interface ComponentProps {
  monitorId: ObjectID;
  monitorType: MonitorType;
  presentation: MonitorOverviewPresentation;
  owners: OverviewSection<Array<ResourceOwnerEntry>>;
  isRefreshing: boolean;
  refreshError: string;
  lastLoadedAt: Date | null;
  onRefresh: () => void;
}

/*
 * The icon in the hero's tile. A running monitor's icon follows its status
 * tone; every other run state has one icon, whatever the stored status says,
 * because the status is not what the hero is reporting then.
 */
const RUN_STATE_ICON: Record<
  Exclude<MonitorOverviewRunState, MonitorOverviewRunState.Running>,
  IconProp
> = {
  [MonitorOverviewRunState.Overdue]: IconProp.Clock,
  [MonitorOverviewRunState.Paused]: IconProp.PauseCircle,
  [MonitorOverviewRunState.NotChecking]: IconProp.SignalSlash,
  [MonitorOverviewRunState.NotConfigured]: IconProp.WrenchScrewdriver,
  [MonitorOverviewRunState.AwaitingFirstData]: IconProp.Clock,
  [MonitorOverviewRunState.Manual]: IconProp.Pencil,
};

export const getMonitorOverviewIcon: (
  presentation: MonitorOverviewPresentation,
) => IconProp = (presentation: MonitorOverviewPresentation): IconProp => {
  if (presentation.runState !== MonitorOverviewRunState.Running) {
    return RUN_STATE_ICON[presentation.runState];
  }

  switch (presentation.tone) {
    case "good":
      return IconProp.CheckCircle;
    case "warning":
      return IconProp.Alert;
    case "danger":
      return IconProp.ExclaimationCircle;
    default:
      return IconProp.Info;
  }
};

/*
 * When what is on screen loaded, as a clock time in the reader's zone. The
 * date is added once it is no longer today, so a page left open overnight
 * cannot point at the wrong 14:05.
 */
export const getLoadedAtText: (loadedAt: Date) => string = (
  loadedAt: Date,
): string => {
  const isToday: boolean =
    OneUptimeDate.getDateAsLocalDayMonthString(loadedAt) ===
    OneUptimeDate.getDateAsLocalDayMonthString(OneUptimeDate.getCurrentDate());

  if (!isToday) {
    return OneUptimeDate.getDateAsLocalShortDateTimeString(loadedAt);
  }

  return OneUptimeDate.getLocalTimeString(loadedAt, {
    use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
  });
};

/*
 * The top of the monitor overview: what state the monitor is in, in words,
 * how fresh that is, and the handful of facts behind it. Everything it says
 * comes from MonitorOverviewPresentationUtil, so the per-type and per-state
 * rules are tested once in Common and this only lays them out.
 */
const MonitorOverviewHero: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const presentation: MonitorOverviewPresentation = props.presentation;

  const typeProps: MonitorTypeProps | undefined = useMemo(() => {
    return MonitorTypeHelper.getAllMonitorTypeProps().find(
      (item: MonitorTypeProps) => {
        return item.monitorType === props.monitorType;
      },
    );
  }, [props.monitorType]);

  const typeTitle: string = typeProps?.title || props.monitorType;
  const typeIcon: IconProp = typeProps?.icon || IconProp.Activity;

  type GetBadgeRowFunction = () => ReactElement;

  const getBadgeRow: GetBadgeRowFunction = (): ReactElement => {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {presentation.badge.statusColor ? (
          <MonitorStatusDot
            dataTestId="monitor-overview-status-dot"
            color={presentation.badge.statusColor}
            className="h-2.5 w-2.5"
          />
        ) : (
          <></>
        )}
        <span data-testid="monitor-overview-badge">
          <StatusBadge
            text={presentation.badge.text}
            type={TONE_BADGE[presentation.badge.tone]}
          />
        </span>
        {presentation.secondaryBadges.map(
          (badge: MonitorOverviewSecondaryBadge, index: number) => {
            return (
              <span
                key={`${badge.text}-${index}`}
                data-testid="monitor-overview-secondary-badge"
              >
                <StatusBadge text={badge.text} type={TONE_BADGE[badge.tone]} />
              </span>
            );
          },
        )}
      </div>
    );
  };

  type GetTargetFunction = () => ReactElement;

  const getTarget: GetTargetFunction = (): ReactElement => {
    const target: MonitorOverviewTarget | null = presentation.target;
    const extraStepCount: number = target ? target.extraStepCount : 0;

    /*
     * A div, not a paragraph: Icon renders a div, and a div inside a <p> is
     * invalid markup that React warns about on every render.
     */
    return (
      <div
        data-testid="monitor-overview-target"
        className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500"
      >
        <Icon icon={typeIcon} className="h-4 w-4 flex-shrink-0 text-gray-400" />
        <span>{typeTitle}</span>
        {target ? (
          <>
            <span aria-hidden="true">·</span>
            <span
              data-testid="monitor-overview-target-value"
              className={
                target.isMono
                  ? "break-all font-mono text-gray-700"
                  : "break-all text-gray-700"
              }
              title={target.value}
            >
              {target.value}
            </span>
          </>
        ) : (
          <></>
        )}
        {extraStepCount > 0 ? (
          <span>{`(+${extraStepCount} more step${
            extraStepCount === 1 ? "" : "s"
          })`}</span>
        ) : (
          <></>
        )}
      </div>
    );
  };

  type GetPulseFunction = () => ReactElement;

  const getPulse: GetPulseFunction = (): ReactElement => {
    const pulse: MonitorOverviewPulse = presentation.pulse;

    let lastLine: ReactElement = (
      <p className="text-xs text-gray-600">{pulse.emptyText}</p>
    );

    if (pulse.label !== null && pulse.isUnavailable) {
      /*
       * The source could not be read, so this must not say "never": it says
       * the time is unknown instead.
       */
      lastLine = (
        <p className="text-xs text-gray-400">{`${pulse.label}: unavailable`}</p>
      );
    } else if (pulse.label !== null && pulse.at) {
      lastLine = (
        <p className="text-xs text-gray-600">
          {pulse.label} <RelativeTime date={pulse.at} />
        </p>
      );
    }

    return (
      <div data-testid="monitor-overview-pulse" className="min-w-0 text-right">
        {lastLine}
        {pulse.cadenceText ? (
          <p
            data-testid="monitor-overview-cadence"
            className="mt-1 text-xs text-gray-500"
          >
            {pulse.cadenceText}
            {pulse.nextAt ? " · next " : ""}
            {pulse.nextAt ? <RelativeTime date={pulse.nextAt} /> : <></>}
          </p>
        ) : (
          <></>
        )}
        {pulse.overdueSeconds !== undefined ? (
          <p
            data-testid="monitor-overview-overdue"
            className="mt-1 text-xs font-medium text-amber-700"
          >
            {`Overdue by ${formatDurationCompact(pulse.overdueSeconds)}`}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  };

  type GetOwnersFunction = () => ReactElement;

  const getOwners: GetOwnersFunction = (): ReactElement => {
    const owners: Array<ResourceOwnerEntry> | null = props.owners.value;

    if (props.owners.status === "loading" && !owners) {
      return <OwnersCell owners={undefined} isLoading={true} maxVisible={3} />;
    }

    // Unknown is not "nobody": a failed or forbidden read says so.
    if (!owners) {
      return (
        <span className="text-base font-semibold text-gray-400">
          Unavailable
        </span>
      );
    }

    if (owners.length === 0) {
      return (
        <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="text-gray-500">No owners</span>
          <Link
            to={getMonitorOverviewRoute({
              key: "owners",
              monitorId: props.monitorId,
            })}
            className="font-medium text-indigo-600 hover:underline"
          >
            Add owners
          </Link>
        </span>
      );
    }

    /*
     * A partial read (owner users readable, owner teams not) or a failed
     * refresh still shows who is known, but must not read as the complete,
     * current list.
     */
    if (props.owners.refreshError) {
      return (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <OwnersCell owners={owners} maxVisible={3} />
          <span
            data-testid="monitor-overview-owners-partial"
            className="text-xs font-normal text-gray-500"
            title={props.owners.refreshError}
          >
            List may be incomplete
          </span>
        </span>
      );
    }

    return <OwnersCell owners={owners} maxVisible={3} />;
  };

  type GetFactValueFunction = (fact: MonitorOverviewFact) => ReactElement;

  const getFactValue: GetFactValueFunction = (
    fact: MonitorOverviewFact,
  ): ReactElement => {
    if (fact.valueDate) {
      return <RelativeTime date={fact.valueDate} />;
    }

    if (fact.linkKey) {
      return (
        <Link
          to={getMonitorOverviewRoute({
            key: fact.linkKey,
            monitorId: props.monitorId,
            linkId: fact.linkId,
          })}
          className="hover:underline"
        >
          {fact.value}
        </Link>
      );
    }

    return <>{fact.value}</>;
  };

  type GetFactFunction = (fact: MonitorOverviewFact) => ReactElement;

  const getFact: GetFactFunction = (
    fact: MonitorOverviewFact,
  ): ReactElement => {
    if (fact.key === "owners") {
      return (
        <div
          key={fact.key}
          className="min-w-0"
          data-testid="monitor-overview-fact-owners"
        >
          <dt className="text-xs font-medium text-gray-500">{fact.label}</dt>
          <dd className="mt-1">{getOwners()}</dd>
        </div>
      );
    }

    const colorClassName: string = fact.isMuted
      ? "text-gray-400"
      : TONE_TEXT_CLASS[fact.tone || "neutral"];

    return (
      <div
        key={fact.key}
        className="min-w-0"
        data-testid={"monitor-overview-fact-" + fact.key}
      >
        <dt className="text-xs font-medium text-gray-500">{fact.label}</dt>
        <dd
          className={`mt-1 text-base font-semibold tabular-nums ${colorClassName}${
            fact.isMono ? " break-all font-mono" : ""
          }`}
        >
          {getFactValue(fact)}
          {fact.secondary ? (
            <span className="mt-0.5 block break-words text-xs font-normal text-gray-500">
              {fact.secondary}
            </span>
          ) : (
            <></>
          )}
        </dd>
      </div>
    );
  };

  return (
    <section
      aria-label="Monitor status"
      data-testid="monitor-overview-hero"
      className="rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      <div className="p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-4">
            <div
              data-testid="monitor-overview-icon"
              className={`max-sm:hidden h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl sm:flex ${
                TONE_TILE_CLASS[presentation.tone]
              }`}
            >
              <Icon
                icon={getMonitorOverviewIcon(presentation)}
                className="h-6 w-6"
              />
            </div>
            <div className="min-w-0">
              {getBadgeRow()}
              <h2
                data-testid="monitor-overview-headline"
                className="mt-2 text-xl font-semibold tracking-tight text-gray-900"
              >
                {presentation.headline.text}
                {presentation.headline.since ? (
                  <>
                    {" for "}
                    <span
                      title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                        presentation.headline.since,
                      )}
                    >
                      <LiveDuration startDate={presentation.headline.since} />
                    </span>
                  </>
                ) : (
                  <></>
                )}
              </h2>
              {presentation.explanation ? (
                <p
                  data-testid="monitor-overview-explanation"
                  className="mt-1.5 max-w-3xl text-sm leading-6 text-gray-600"
                >
                  {presentation.explanation}
                </p>
              ) : (
                <></>
              )}
              {presentation.lastKnownStatus ? (
                <p
                  data-testid="monitor-overview-last-known"
                  className="mt-1 text-sm text-gray-500"
                >
                  {presentation.lastKnownStatus}
                </p>
              ) : (
                <></>
              )}
              {getTarget()}
              {presentation.callToAction ? (
                <div className="mt-4">
                  <SloOverviewActionLink
                    variant="secondary"
                    title={presentation.callToAction.text}
                    to={getMonitorOverviewRoute({
                      key: presentation.callToAction.linkKey,
                      monitorId: props.monitorId,
                    })}
                  />
                </div>
              ) : (
                <></>
              )}
            </div>
          </div>

          <div className="flex flex-shrink-0 items-center justify-between gap-4 lg:flex-col lg:items-end lg:gap-3">
            <Button
              title="Refresh"
              icon={IconProp.Refresh}
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              isLoading={props.isRefreshing}
              onClick={props.onRefresh}
              dataTestId="monitor-overview-refresh"
            />
            {getPulse()}
          </div>
        </div>

        {/*
         * A clock time, not "3 minutes ago": an alert is re-read in full
         * whenever its text changes, so a relative time ticking inside it
         * interrupted a screen reader user once a minute for as long as
         * refreshes kept failing.
         */}
        {props.refreshError ? (
          <p
            role="alert"
            data-testid="monitor-overview-refresh-error"
            className="mt-4 text-sm text-red-700"
          >
            {"Couldn't refresh. Showing what loaded "}
            {props.lastLoadedAt ? (
              <>
                {"at "}
                <time
                  dateTime={OneUptimeDate.fromString(
                    props.lastLoadedAt,
                  ).toISOString()}
                  title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                    props.lastLoadedAt,
                  )}
                >
                  {getLoadedAtText(props.lastLoadedAt)}
                </time>
              </>
            ) : (
              <>earlier</>
            )}
            {`. ${props.refreshError}`}
          </p>
        ) : (
          <></>
        )}
      </div>

      <dl
        aria-label="Monitor at a glance"
        data-testid="monitor-overview-facts"
        className={`grid gap-5 rounded-b-xl border-t border-gray-100 bg-gray-50 px-5 py-4 sm:px-6 ${getFactGridClass(
          presentation.facts.length,
        )}`}
      >
        {presentation.facts.map((fact: MonitorOverviewFact) => {
          return getFact(fact);
        })}
      </dl>
    </section>
  );
};

export default MonitorOverviewHero;
