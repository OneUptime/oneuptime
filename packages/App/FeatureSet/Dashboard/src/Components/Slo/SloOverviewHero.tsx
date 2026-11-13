import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  canAddOwners,
  getOwnerKeys,
  OwnersChange,
  OwnersTarget,
} from "../Owners/AddOwners";
import AddOwnersPopup, {
  AddOwnersPlaceButton,
  AddOwnersTextButton,
  useAddOwnersPopup,
} from "../Owners/AddOwnersPopup";
import { ResourceOwnerEntry } from "../ResourceOwners/OwnerEntry";
import OwnersCell from "../ResourceOwners/OwnersCell";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveOwnerTeam from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceLevelObjectiveOwnerUser from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import { AnchoredFieldPopup } from "Common/UI/Types/UseAnchoredFieldPopup";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SloStatus from "Common/Types/ServiceLevelObjective/SloStatus";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Link from "Common/UI/Components/Link/Link";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  getRollingWindowFillTextInLanguage,
  getSloEvaluationCadenceText,
  getSloHeadlineInLanguage,
  getSloMonitorCountInLanguage,
  getSloWindowTextInLanguage,
} from "./SloOverviewTextInLanguage";
import {
  getRollingWindowFill,
  SloRollingWindowFill,
} from "Common/Utils/Slo/SloProjection";
import { formatSloPercent } from "Common/Utils/Slo/SloWidgetFormat";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import ErrorSentence from "Common/UI/Components/ErrorMessage/ErrorSentence";

export interface ComponentProps {
  sloId: ObjectID;
  slo: ServiceLevelObjective;
  monitorCount: number;
  owners: Array<ResourceOwnerEntry> | undefined;
  isLoadingOwners: boolean;
  isRefreshing: boolean;
  refreshError: string;
  onRefresh: () => void;
  /*
   * Told after the owners' Add owners list added an owner (or the server
   * refused one), so the page reads the owners again.
   */
  onOwnersChanged?: ((change: OwnersChange) => void) | undefined;
}

interface StatusPresentation {
  icon: IconProp;
  badgeType: StatusBadgeType;
  className: string;
}

const NEUTRAL_STATUS: StatusPresentation = {
  icon: IconProp.Clock,
  badgeType: StatusBadgeType.Neutral,
  className: "bg-gray-100 text-gray-500",
};

const STATUS_PRESENTATIONS: Record<SloStatus, StatusPresentation> = {
  [SloStatus.Healthy]: {
    icon: IconProp.CheckCircle,
    badgeType: StatusBadgeType.Success,
    className: "bg-green-50 text-green-700",
  },
  [SloStatus.AtRisk]: {
    icon: IconProp.Alert,
    badgeType: StatusBadgeType.Warning,
    className: "bg-yellow-50 text-yellow-700",
  },
  [SloStatus.BudgetExhausted]: {
    icon: IconProp.Alert,
    badgeType: StatusBadgeType.Danger,
    className: "bg-red-50 text-red-700",
  },
  [SloStatus.Misconfigured]: {
    ...NEUTRAL_STATUS,
    icon: IconProp.WrenchScrewdriver,
  },
  [SloStatus.Paused]: {
    ...NEUTRAL_STATUS,
    icon: IconProp.PauseCircle,
  },
};

// Keep the verdict separate from the supporting facts so both are easy to scan.
const SloOverviewHero: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const slo: ServiceLevelObjective = props.slo;

  /*
   * Owners are added right here: "Add owners" on an SLO nobody owns, the
   * empty place after the avatars on one that has owners, each opening the
   * Add owners list under it - offered to a reader who may add one.
   */
  const sloIdString: string = props.sloId.toString();
  const ownersTarget: OwnersTarget = useMemo((): OwnersTarget => {
    return {
      ownerUserModelType: ServiceLevelObjectiveOwnerUser,
      ownerTeamModelType: ServiceLevelObjectiveOwnerTeam,
      resourceIdField: "serviceLevelObjectiveId",
      resourceId: props.sloId,
    };
  }, [sloIdString]);
  const ownersPopup: AnchoredFieldPopup = useAddOwnersPopup(
    props.owners?.length || 0,
  );
  const ownerKeys: Set<string> = useMemo((): Set<string> => {
    return getOwnerKeys(props.owners);
  }, [props.owners]);
  const mayAddOwners: boolean = canAddOwners(ownersTarget);
  const lastEvaluatedAt: Date | null = slo.lastEvaluatedAt
    ? OneUptimeDate.fromString(slo.lastEvaluatedAt)
    : null;

  const headline: string = getSloHeadlineInLanguage(
    {
      isEnabled: slo.isEnabled,
      isArchived: slo.isArchived,
      sloStatus: slo.sloStatus,
      lastEvaluatedAt: slo.lastEvaluatedAt,
      monitorCount: props.monitorCount,
    },
    translator,
  );

  const windowFill: SloRollingWindowFill | null = getRollingWindowFill({
    windowType: slo.windowType,
    windowDays: slo.windowDays,
    targetPercentage: slo.targetPercentage,
    errorBudgetTotalSeconds: slo.errorBudgetTotalSeconds,
    multiMonitorMode: slo.multiMonitorMode,
  });

  // Archived and disabled objectives must not show a stale health verdict.
  const statusText: string = slo.isArchived
    ? "Archived"
    : slo.isEnabled === false
      ? "Disabled"
      : slo.sloStatus || "Not evaluated yet";

  const statusPresentation: StatusPresentation = slo.isArchived
    ? { ...NEUTRAL_STATUS, icon: IconProp.Archive }
    : slo.isEnabled === false
      ? { ...NEUTRAL_STATUS, icon: IconProp.PauseCircle }
      : (slo.sloStatus && STATUS_PRESENTATIONS[slo.sloStatus]) ||
        NEUTRAL_STATUS;

  const monitorsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SLO_VIEW_MONITORS] as Route,
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
      return (
        <span className="text-sm text-gray-400">
          {translator.translateText("Unavailable")}
        </span>
      );
    }

    /*
     * "No owners", and "+ Add owners" beside it for a reader who may add
     * one - the monitor overview's words and control, so the two read alike.
     */
    if (props.owners.length === 0) {
      return (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="text-gray-500">
            {translator.translateText("No owners")}
          </span>
          {mayAddOwners ? (
            <AddOwnersTextButton
              popup={ownersPopup}
              dataTestId="slo-overview-add-owners"
            />
          ) : (
            <></>
          )}
        </div>
      );
    }

    return (
      <div className="flex items-center gap-1.5">
        <OwnersCell owners={props.owners} maxVisible={5} />
        {mayAddOwners ? (
          <AddOwnersPlaceButton
            popup={ownersPopup}
            dataTestId="slo-overview-add-more-owners"
          />
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <section
      aria-label={translator.translateTemplate("SLO summary")}
      data-testid="slo-overview-hero"
      className="rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      <div className="p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-4">
            <div
              className={`max-sm:hidden h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl sm:flex ${statusPresentation.className}`}
            >
              <Icon icon={statusPresentation.icon} className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <StatusBadge
                text={statusText}
                type={statusPresentation.badgeType}
              />
              <h2
                data-testid="slo-overview-headline"
                className="mt-2 text-xl font-semibold tracking-tight text-gray-900"
              >
                {headline}
              </h2>
              {slo.description ? (
                <p
                  data-testid="slo-overview-description"
                  className="mt-1.5 max-w-3xl whitespace-pre-line break-words text-sm leading-6 text-gray-600"
                >
                  {/*
                   * Written by someone, in their language: an English
                   * description on an Arabic page keeps its full stop at
                   * its end.
                   */}
                  <IsolatedText text={slo.description} />
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-shrink-0 items-center justify-between gap-4 lg:flex-col lg:items-end lg:gap-3">
            <div className="flex-shrink-0">
              <Button
                title="Refresh"
                icon={IconProp.Refresh}
                buttonStyle={ButtonStyleType.NORMAL}
                buttonSize={ButtonSize.Small}
                isLoading={props.isRefreshing}
                onClick={props.onRefresh}
                dataTestId="slo-overview-refresh"
              />
            </div>
            <div className="min-w-0 text-right">
              <p
                data-testid="slo-overview-last-evaluated"
                className="text-xs text-gray-600"
              >
                {lastEvaluatedAt ? (
                  <TranslatedSentence
                    template="Evaluated {{time}}"
                    slots={{
                      time: (
                        <time
                          dateTime={lastEvaluatedAt.toISOString()}
                          title={OneUptimeDate.getDateAsLocalFormattedString(
                            lastEvaluatedAt,
                          )}
                        >
                          {OneUptimeDate.fromNow(lastEvaluatedAt)}
                        </time>
                      ),
                    }}
                  />
                ) : (
                  translator.translateText("Not evaluated yet")
                )}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {getSloEvaluationCadenceText(translator)}
              </p>
            </div>
          </div>
        </div>

        {props.refreshError ? (
          <p role="alert" className="mt-4 text-sm text-red-700">
            <ErrorSentence
              template="Could not refresh — showing the last numbers that loaded. {{error}}"
              error={props.refreshError}
            />
          </p>
        ) : null}
      </div>

      <dl
        aria-label={translator.translateTemplate("SLO at a glance")}
        className="grid grid-cols-1 gap-5 rounded-b-xl border-t border-gray-100 bg-gray-50 px-5 py-4 sm:grid-cols-2 sm:px-6 xl:grid-cols-4"
      >
        <div className="min-w-0" data-testid="slo-overview-chip-target">
          <dt className="text-xs font-medium text-gray-500">
            {translator.translateText("Target")}
          </dt>
          <dd className="mt-1 text-base font-semibold tabular-nums text-gray-900">
            {formatSloPercent(slo.targetPercentage, undefined, translator) ||
              translator.translateText("Not set")}
          </dd>
        </div>
        <div className="min-w-0" data-testid="slo-overview-chip-window">
          <dt className="text-xs font-medium text-gray-500">
            {translator.translateText("Compliance window")}
          </dt>
          <dd className="mt-1 flex flex-wrap items-center gap-2 text-sm font-medium text-gray-900">
            <span className="break-words">
              {getSloWindowTextInLanguage(
                {
                  windowType: slo.windowType,
                  windowDays: slo.windowDays,
                  timezone: slo.timezone,
                },
                translator,
              )}
            </span>
            {windowFill && windowFill.isNotYetFull ? (
              <span
                data-testid="slo-overview-chip-window-fill"
                title={translator.translateTemplate(
                  "This SLO is younger than its compliance window, so it is measured over the data that exists so far and its error budget is still growing. Expect the numbers to steady as the window fills.",
                )}
              >
                <StatusBadge
                  text={getRollingWindowFillTextInLanguage(
                    windowFill,
                    translator,
                  )}
                  type={StatusBadgeType.Info}
                />
              </span>
            ) : null}
          </dd>
        </div>
        <div className="min-w-0" data-testid="slo-overview-chip-monitors">
          <dt className="text-xs font-medium text-gray-500">
            {translator.translateText("Monitors")}
          </dt>
          <dd className="mt-1">
            <Link
              to={monitorsRoute}
              className="inline-flex items-center gap-1 rounded text-sm font-medium text-gray-900 hover:text-indigo-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {props.monitorCount === 0 ? (
                <span className="text-yellow-700">
                  {getSloMonitorCountInLanguage(props.monitorCount, translator)}
                </span>
              ) : (
                getSloMonitorCountInLanguage(props.monitorCount, translator)
              )}
              <Icon
                icon={IconProp.ChevronRight}
                className="h-4 w-4 flex-shrink-0 text-gray-400"
              />
            </Link>
          </dd>
        </div>
        <div className="min-w-0" data-testid="slo-overview-owners">
          <dt className="text-xs font-medium text-gray-500">
            {translator.translateText("Owners")}
          </dt>
          <dd className="mt-1">
            {getOwnersElement()}
            {mayAddOwners && props.owners ? (
              <AddOwnersPopup
                popup={ownersPopup}
                target={ownersTarget}
                ownerKeys={ownerKeys}
                onOwnersChanged={props.onOwnersChanged}
              />
            ) : (
              <></>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
};

export default SloOverviewHero;
