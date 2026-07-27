import ObjectID from "Common/Types/ObjectID";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import AlertBanner, {
  AlertBannerType,
} from "Common/UI/Components/AlertBanner/AlertBanner";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  getSloNotice,
  isRollingWindowNotYetFull,
  SloNotice,
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
   * Bump to re-fetch — e.g. after the SLO Details form saves, so a banner
   * the user just fixed disappears without a page reload.
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
              isEnabled: true,
              sloStatus: true,
              sliType: true,
              targetPercentage: true,
              windowType: true,
              windowDays: true,
              multiMonitorMode: true,
              errorBudgetTotalSeconds: true,
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
    isEnabled: slo.isEnabled,
    sloStatus: slo.sloStatus,
    sliType: slo.sliType,
    monitorCount: ((slo.monitors as Array<Monitor> | undefined) || []).length,
    targetPercentage: slo.targetPercentage,
    lastEvaluatedAt: slo.lastEvaluatedAt,
  });

  if (notice) {
    return (
      <AlertBanner
        className="mb-5"
        type={toBannerType(notice.type)}
        title={notice.title}
      >
        <p className="text-sm text-gray-700">{notice.body}</p>
      </AlertBanner>
    );
  }

  /*
   * The "window not yet full" flag both the SLOs Overview and the Error
   * Budgets docs promise: a rolling-window SLO younger than its window is
   * measured against a proportionally smaller budget, so its early
   * percentages move around far more than they eventually will. Shown
   * only when nothing more urgent applies.
   */
  const isWindowNotFull: boolean = isRollingWindowNotYetFull({
    windowType: slo.windowType,
    windowDays: slo.windowDays,
    targetPercentage: slo.targetPercentage,
    errorBudgetTotalSeconds: slo.errorBudgetTotalSeconds,
    multiMonitorMode: slo.multiMonitorMode,
  });

  if (isWindowNotFull) {
    return (
      <AlertBanner
        className="mb-5"
        type={AlertBannerType.Info}
        title="Window not yet full"
      >
        <p className="text-sm text-gray-700">
          This SLO is younger than its {slo.windowDays || 30}-day compliance
          window, so it is measured over the data that exists so far and its
          error budget is smaller than it will eventually be. Expect the numbers
          to steady as the window fills.
        </p>
      </AlertBanner>
    );
  }

  return <Fragment />;
};

export default SloNoticeBanner;
