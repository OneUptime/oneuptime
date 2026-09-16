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
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
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
 * where a destination becomes a page.
 */
const ACTION_PAGES: Record<SloNoticeActionTarget, PageMap> = {
  [SloNoticeActionTarget.Settings]: PageMap.SLO_VIEW_SETTINGS,
  [SloNoticeActionTarget.Monitors]: PageMap.SLO_VIEW_MONITORS,
  [SloNoticeActionTarget.MonitorRules]: PageMap.SLO_VIEW_MONITOR_RULES,
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
 */
const SloNoticeBanner: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [slo, setSlo] = useState<ServiceLevelObjective | null>(null);

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
  }, [props.sloId.toString(), props.refreshToggle]);

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
