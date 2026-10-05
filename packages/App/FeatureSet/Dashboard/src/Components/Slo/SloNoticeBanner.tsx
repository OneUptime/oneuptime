import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import AlertBanner, {
  AlertBannerType,
} from "Common/UI/Components/AlertBanner/AlertBanner";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { subscribeToModelSwitchSaved } from "Common/UI/Components/ModelSwitch/ModelSwitchEvents";
import useSaveModelSwitch, {
  SaveModelSwitch,
} from "Common/UI/Components/ModelSwitch/useSaveModelSwitch";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import {
  getSloNotice,
  SloNotice,
  SloNoticeActionTarget,
  SloNoticeType,
} from "Common/Utils/Slo/SloHealth";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import SloEvaluationSwitchCopy, {
  SLO_EVALUATION_SWITCH_COLUMN,
  TURN_SLO_EVALUATION_ON_BUTTON_TEST_ID,
  TURN_SLO_EVALUATION_ON_ERROR_TEST_ID,
} from "./SloEvaluationSwitchCopy";

export interface ComponentProps {
  sloId: ObjectID;
  /**
   * Bump to re-fetch — e.g. after a Settings card saves, so a banner the
   * user just fixed disappears without a page reload.
   */
  refreshToggle?: string | undefined;
}

type ToBannerTypeFunction = (type: SloNoticeType) => AlertBannerType;

const toBannerType: ToBannerTypeFunction = (
  type: SloNoticeType,
): AlertBannerType => {
  if (type === SloNoticeType.Danger) {
    return AlertBannerType.Danger;
  }

  if (type === SloNoticeType.Warning) {
    return AlertBannerType.Warning;
  }

  return AlertBannerType.Info;
};

/*
 * SloHealth names where a notice can be fixed without importing routes
 * (it is loaded by plain-node tests and the dashboard SLO widget); this is
 * where a destination becomes a page. TurnEvaluationOn is not a page: the
 * banner turns evaluation on itself, with a button.
 */
type SloNoticeLinkTarget = Exclude<
  SloNoticeActionTarget,
  SloNoticeActionTarget.TurnEvaluationOn
>;

const ACTION_PAGES: Record<SloNoticeLinkTarget, PageMap> = {
  [SloNoticeActionTarget.Settings]: PageMap.SLO_VIEW_SETTINGS,
  [SloNoticeActionTarget.Monitors]: PageMap.SLO_VIEW_MONITORS,
  [SloNoticeActionTarget.MonitorRules]: PageMap.SLO_VIEW_MONITOR_RULES,
};

/*
 * A disabled SLO's banner, with the button that turns evaluation back on in
 * place. The button is hidden only while there is nothing honest to say
 * about it: the permission snapshot has not arrived yet (PermissionGate).
 * Someone who may not turn evaluation on sees it locked, with why.
 */
const getTurnEvaluationOnBanner: (
  notice: SloNotice,
  turnEvaluationOn: SaveModelSwitch,
) => ReactElement = (
  notice: SloNotice,
  turnEvaluationOn: SaveModelSwitch,
): ReactElement => {
  const showButton: boolean =
    turnEvaluationOn.gate.isAllowed ||
    Boolean(turnEvaluationOn.gate.disabledReason);

  return (
    <AlertBanner
      className="mb-5"
      type={toBannerType(notice.type)}
      icon={IconProp.PauseCircle}
      title={notice.title}
      rightElement={
        showButton ? (
          <Button
            title={SloEvaluationSwitchCopy.turnOnButton}
            icon={IconProp.Play}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            dataTestId={TURN_SLO_EVALUATION_ON_BUTTON_TEST_ID}
            isLoading={turnEvaluationOn.isSaving}
            disabled={!turnEvaluationOn.gate.isAllowed}
            tooltip={turnEvaluationOn.gate.disabledReason}
            onClick={turnEvaluationOn.save}
          />
        ) : undefined
      }
      dataTestId="slo-notice-banner"
    >
      <>
        <p>{notice.body}</p>
        {turnEvaluationOn.error ? (
          <p
            className="mt-1 text-sm text-red-600"
            role="alert"
            data-testid={TURN_SLO_EVALUATION_ON_ERROR_TEST_ID}
          >
            {turnEvaluationOn.error}
          </p>
        ) : (
          <></>
        )}
      </>
    </AlertBanner>
  );
};

/**
 * Explains, in one banner, why an SLO is not showing the numbers the user
 * expects — rendered at the top of every SLO sub-page.
 *
 * Before this existed the two statuses that mean "we are measuring
 * nothing" — Misconfigured and Paused — rendered as a bare grey pill on
 * the overview: no cause, no remedy, and nothing at all on the Charts,
 * Burn Rate Rules, Alerts or Owners tabs. An SRE could configure a
 * fast-burn rule on a disabled SLO and never learn it would not fire.
 *
 * The reasons come from Common/Utils/Slo/SloHealth, which mirrors the
 * evaluation worker's guard clauses in the worker's own order, so the
 * banner cannot disagree with why the worker actually stopped. It fetches
 * its own SLO rather than taking one as a prop so every sub-page can drop
 * it in with only the model id — the same shape as the sibling
 * Components/Monitor/DisabledWarning.
 *
 * It only ever speaks about states that stop or block measurement. The
 * "window not yet full" note used to be a banner here too, but it describes
 * a number rather than a problem, and a page-wide box for it read like an
 * outage; the overview shows window fill beside the budget instead.
 *
 * A failed fetch renders nothing: the banner is supplementary, and the
 * page's own error surface already owns real failures.
 *
 * A disabled SLO's banner carries "Turn evaluation on", which turns it back
 * on right there: it saves what the Evaluation card's switch on Settings
 * saves, and the switch follows it (ModelSwitchEvents). The banner hears
 * that switch the same way, so flipping it on Settings clears or raises the
 * banner above it without a reload.
 */
const SloNoticeBanner: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [slo, setSlo] = useState<ServiceLevelObjective | null>(null);

  // Bumped whenever evaluation is switched on or off, here or elsewhere.
  const [switchSaveCount, setSwitchSaveCount] = useState<number>(0);

  const turnEvaluationOn: SaveModelSwitch =
    useSaveModelSwitch<ServiceLevelObjective>({
      modelType: ServiceLevelObjective,
      modelId: props.sloId,
      column: SLO_EVALUATION_SWITCH_COLUMN,
      value: true,
    });

  useEffect(() => {
    return subscribeToModelSwitchSaved({
      modelType: ServiceLevelObjective,
      modelId: props.sloId,
      column: SLO_EVALUATION_SWITCH_COLUMN,
      onSaved: (): void => {
        setSwitchSaveCount((count: number): number => {
          return count + 1;
        });
      },
    });
  }, [props.sloId.toString()]);

  useEffect(() => {
    let cancelled: boolean = false;

    const fetchSlo: PromiseVoidFunction = async (): Promise<void> => {
      try {
        const item: ServiceLevelObjective | null =
          await ModelAPI.getItem<ServiceLevelObjective>({
            modelType: ServiceLevelObjective,
            id: props.sloId,
            select: {
              isArchived: true,
              isEnabled: true,
              sloStatus: true,
              sliType: true,
              targetPercentage: true,
              lastEvaluatedAt: true,
              monitors: {
                _id: true,
              },
            },
          });

        if (!cancelled) {
          setSlo(item);
        }
      } catch {
        if (!cancelled) {
          setSlo(null);
        }
      }
    };

    fetchSlo().catch(() => {
      // Handled above; the banner stays hidden.
    });

    return () => {
      cancelled = true;
    };
  }, [props.sloId.toString(), props.refreshToggle, switchSaveCount]);

  if (!slo) {
    return <Fragment />;
  }

  const notice: SloNotice | null = getSloNotice({
    isArchived: slo.isArchived,
    isEnabled: slo.isEnabled,
    sloStatus: slo.sloStatus,
    sliType: slo.sliType,
    monitorCount: ((slo.monitors as Array<Monitor> | undefined) || []).length,
    targetPercentage: slo.targetPercentage,
    lastEvaluatedAt: slo.lastEvaluatedAt,
  });

  if (!notice) {
    return <Fragment />;
  }

  if (notice.action?.target === SloNoticeActionTarget.TurnEvaluationOn) {
    return getTurnEvaluationOnBanner(notice, turnEvaluationOn);
  }

  const actionRoute: Route | null = notice.action
    ? RouteUtil.populateRouteParams(
        RouteMap[ACTION_PAGES[notice.action.target]] as Route,
        { modelId: props.sloId },
      )
    : null;

  /*
   * "Open Settings" on the Settings page would be a link to the page the
   * user is already reading; the body still says where the fix lives.
   */
  const actionElement: ReactElement | undefined =
    notice.action && actionRoute && !Navigation.isOnThisPage(actionRoute) ? (
      <Link
        to={actionRoute}
        className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500"
      >
        <span>{notice.action.label}</span>
        <Icon icon={IconProp.ArrowRight} className="h-4 w-4" />
      </Link>
    ) : undefined;

  return (
    <AlertBanner
      className="mb-5"
      type={toBannerType(notice.type)}
      title={notice.title}
      rightElement={actionElement}
      dataTestId="slo-notice-banner"
    >
      <p>{notice.body}</p>
    </AlertBanner>
  );
};

export default SloNoticeBanner;
