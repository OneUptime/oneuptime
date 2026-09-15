import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { ResourceOwnerEntry } from "../ResourceOwners/OwnerEntry";
import OwnersCell from "../ResourceOwners/OwnersCell";
import SloOverviewActionLink from "./SloOverviewActionLink";
import SloStatusPill from "./SloStatusPill";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { PillSize } from "Common/UI/Components/Pill/Pill";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import { SLO_EVALUATION_CADENCE_MINUTES } from "Common/Utils/Slo/SloEvaluation";
import {
  getSloHeadline,
  getSloMonitorCountText,
  getSloTargetText,
  getSloWindowText,
} from "Common/Utils/Slo/SloOverviewText";
import {
  getRollingWindowFill,
  SloRollingWindowFill,
} from "Common/Utils/Slo/SloProjection";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  sloId: ObjectID;
  slo: ServiceLevelObjective;
  monitorCount: number;
  owners: Array<ResourceOwnerEntry> | undefined;
  isLoadingOwners: boolean;
  isRefreshing: boolean;
  refreshError: string;
  onRefresh: () => void;
}

interface HeroChip {
  key: string;
  text: string;
  type: StatusBadgeType;
  tooltip?: string | undefined;
}

/*
 * The top of the SLO overview: the verdict first, then what the SLO is.
 *
 * The page title above already names the SLO, so the hero spends its space
 * on the answer to "are we within budget?" — the status pill with a sentence
 * saying what it means — then the facts a reader needs to interpret every
 * number below it: the target, the window, how many monitors it measures,
 * and, while a rolling window is still filling, how full it is. That last
 * hint used to be a full-width blue "Window not yet full" banner above
 * everything; it describes a number, not a problem, so it is a chip here.
 *
 * Owners sit under the evaluation time, one glance away without competing
 * with the verdict. Labels are deliberately absent: the page header
 * (ModelPage) already shows them beside the title, and a second copy here
 * read as clutter.
 */
const SloOverviewHero: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const slo: ServiceLevelObjective = props.slo;

  const lastEvaluatedAt: Date | null = slo.lastEvaluatedAt
    ? OneUptimeDate.fromString(slo.lastEvaluatedAt)
    : null;

  const headline: string = getSloHeadline({
    isEnabled: slo.isEnabled,
    isArchived: slo.isArchived,
    sloStatus: slo.sloStatus,
    lastEvaluatedAt: slo.lastEvaluatedAt,
    monitorCount: props.monitorCount,
  });

  const windowFill: SloRollingWindowFill | null = getRollingWindowFill({
    windowType: slo.windowType,
    windowDays: slo.windowDays,
    targetPercentage: slo.targetPercentage,
    errorBudgetTotalSeconds: slo.errorBudgetTotalSeconds,
    multiMonitorMode: slo.multiMonitorMode,
  });

  const chips: Array<HeroChip> = [];

  const targetText: string | null = getSloTargetText(slo.targetPercentage);

  if (targetText) {
    chips.push({
      key: "target",
      text: targetText,
      type: StatusBadgeType.Neutral,
    });
  }

  chips.push({
    key: "window",
    text: getSloWindowText({
      windowType: slo.windowType,
      windowDays: slo.windowDays,
      timezone: slo.timezone,
    }),
    type: StatusBadgeType.Neutral,
  });

  if (windowFill && windowFill.isNotYetFull) {
    chips.push({
      key: "window-fill",
      text: windowFill.label,
      type: StatusBadgeType.Info,
      tooltip:
        "This SLO is younger than its compliance window, so it is measured over the data that exists so far and its error budget is still growing. Expect the numbers to steady as the window fills.",
    });
  }

  chips.push({
    key: "monitors",
    text: getSloMonitorCountText(props.monitorCount),
    type:
      props.monitorCount === 0
        ? StatusBadgeType.Warning
        : StatusBadgeType.Neutral,
  });

  if (slo.isEnabled === false) {
    chips.push({
      key: "disabled",
      text: "Disabled",
      type: StatusBadgeType.Warning,
    });
  }

  if (slo.isArchived === true) {
    chips.push({
      key: "archived",
      text: "Archived",
      type: StatusBadgeType.Neutral,
    });
  }

  const ownersRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SLO_VIEW_OWNERS] as Route,
    { modelId: props.sloId },
  );

  type GetOwnersElementFunction = () => ReactElement;

  const getOwnersElement: GetOwnersElementFunction = (): ReactElement => {
    if (props.isLoadingOwners && !props.owners) {
      return (
        <div
          aria-hidden="true"
          className="h-6 w-20 animate-pulse rounded-full bg-gray-100"
        ></div>
      );
    }

    if (!props.owners) {
      // The owner lookup failed; say nothing rather than invite adding owners that may exist.
      return <span className="text-sm text-gray-400">Unavailable</span>;
    }

    if (props.owners.length === 0) {
      return (
        <SloOverviewActionLink
          title="Add owners"
          to={ownersRoute}
          icon={IconProp.Add}
        />
      );
    }

    return <OwnersCell owners={props.owners} maxVisible={5} />;
  };

  return (
    <section
      aria-label="SLO summary"
      data-testid="slo-overview-hero"
      className="rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      <div className="px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              {slo.sloStatus ? (
                <SloStatusPill status={slo.sloStatus} size={PillSize.Normal} />
              ) : (
                /*
                 * Never a pill that could read as a verdict: an SLO the worker
                 * has not touched makes no reliability claim yet.
                 */
                <StatusBadge
                  text="Not evaluated yet"
                  type={StatusBadgeType.Neutral}
                />
              )}
              <h2
                data-testid="slo-overview-headline"
                className="text-base font-semibold text-gray-900"
              >
                {headline}
              </h2>
            </div>

            {slo.description ? (
              <p className="mt-2 max-w-3xl whitespace-pre-line break-words text-sm text-gray-600">
                {slo.description}
              </p>
            ) : (
              <p className="mt-2 text-sm text-gray-400">
                No description yet. Say what this objective protects in SLO
                Details below.
              </p>
            )}

            <ul
              aria-label="SLO at a glance"
              className="mt-3 flex flex-wrap items-center gap-2"
            >
              {chips.map((chip: HeroChip) => {
                return (
                  <li
                    key={chip.key}
                    title={chip.tooltip}
                    data-testid={`slo-overview-chip-${chip.key}`}
                  >
                    <StatusBadge text={chip.text} type={chip.type} />
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex flex-shrink-0 flex-col gap-3 md:items-end">
            <div className="flex flex-row-reverse items-center justify-end gap-3 md:flex-col md:items-end">
              <Button
                title="Refresh"
                icon={IconProp.Refresh}
                buttonStyle={ButtonStyleType.OUTLINE}
                buttonSize={ButtonSize.Small}
                isLoading={props.isRefreshing}
                onClick={props.onRefresh}
                dataTestId="slo-overview-refresh"
              />
              <p
                data-testid="slo-overview-last-evaluated"
                className="text-xs text-gray-500 md:text-right"
              >
                {lastEvaluatedAt ? (
                  <>
                    Evaluated{" "}
                    <time
                      dateTime={lastEvaluatedAt.toISOString()}
                      title={OneUptimeDate.getDateAsLocalFormattedString(
                        lastEvaluatedAt,
                      )}
                    >
                      {OneUptimeDate.fromNow(lastEvaluatedAt)}
                    </time>
                    {` · every ${SLO_EVALUATION_CADENCE_MINUTES} min`}
                  </>
                ) : (
                  `Not evaluated yet · runs every ${SLO_EVALUATION_CADENCE_MINUTES} min`
                )}
              </p>
            </div>
            <div
              data-testid="slo-overview-owners"
              className="flex min-w-0 items-center gap-2 md:justify-end"
            >
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Owners
              </span>
              <div className="min-w-0">{getOwnersElement()}</div>
            </div>
          </div>
        </div>

        {props.refreshError ? (
          <p role="alert" className="mt-3 text-xs text-red-700">
            {`Could not refresh — showing the last numbers that loaded. ${props.refreshError}`}
          </p>
        ) : (
          <></>
        )}
      </div>
    </section>
  );
};

export default SloOverviewHero;
