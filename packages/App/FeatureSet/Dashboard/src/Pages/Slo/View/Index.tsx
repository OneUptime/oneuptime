import PageComponentProps from "../../PageComponentProps";
import { getSloDetailsFormFields } from "../SloFormFields";
import EventOverviewSkeleton from "../../../Components/EventView/EventOverviewSkeleton";
import SloActiveBurnEventsCard from "../../../Components/Slo/SloActiveBurnEventsCard";
import SloBudgetBurnDownCard from "../../../Components/Slo/SloBudgetBurnDownCard";
import SloBurnRateRulesSummaryCard from "../../../Components/Slo/SloBurnRateRulesSummaryCard";
import SloFeed from "../../../Components/Slo/SloFeed";
import SloKpiStrip from "../../../Components/Slo/SloKpiStrip";
import SloNoticeBanner from "../../../Components/Slo/SloNoticeBanner";
import SloOverviewGettingStartedCard from "../../../Components/Slo/SloOverviewGettingStartedCard";
import SloOverviewHero from "../../../Components/Slo/SloOverviewHero";
import useSloOverviewData, {
  getSloNoticeFingerprint,
  UseSloOverviewDataResult,
} from "../../../Components/Slo/useSloOverviewData";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import LabelsElement from "Common/UI/Components/Label/Labels";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import { getLowestBurnRateThreshold } from "Common/Utils/Slo/SloProjection";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * SLO Overview — the "are we within budget?" page.
 *
 * Top to bottom: the notice banner for anything that stops measurement; the
 * hero with the verdict and what the SLO is; the four headline numbers; then
 * the incident overview's two-thirds / one-third grid — how the budget has
 * been spent and recent activity, beside open events and burn rate rules —
 * and finally the editable name, description and labels. Configuration lives
 * on Settings, monitors on the Monitors and Monitor Rules pages, and detailed
 * history on Metrics.
 *
 * A brand-new SLO has no monitors and no monitor rules (the create form no
 * longer asks for monitors), so it gets a getting-started card in place of
 * numbers that could only read "not evaluated".
 *
 * Data comes from ONE poll (useSloOverviewData) shared with every card
 * through props and refresh tokens. The old page fetched the same SLO row
 * three times a minute.
 */
const SloView: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const data: UseSloOverviewDataResult = useSloOverviewData({
    sloId: modelId,
  });

  /*
   * The banner fetches its own row (its props are shared with every SLO
   * sub-page), so it is re-read only when something a notice depends on
   * changed, not on every poll. The first load only records the baseline:
   * the banner already fetched on mount.
   */
  const [bannerRefreshCount, setBannerRefreshCount] = useState<number>(0);
  const lastNoticeFingerprintRef: MutableRefObject<string> = useRef<string>("");

  const noticeFingerprint: string = data.slo
    ? getSloNoticeFingerprint(data.slo)
    : "";

  useEffect(() => {
    if (!noticeFingerprint) {
      return;
    }

    if (
      lastNoticeFingerprintRef.current &&
      lastNoticeFingerprintRef.current !== noticeFingerprint
    ) {
      setBannerRefreshCount((count: number) => {
        return count + 1;
      });
    }

    lastNoticeFingerprintRef.current = noticeFingerprint;
  }, [noticeFingerprint]);

  const banner: ReactElement = (
    <SloNoticeBanner
      sloId={modelId}
      refreshToggle={bannerRefreshCount.toString()}
    />
  );

  /*
   * The banner mounts with the content, not over the skeleton: until the row
   * loads, the page cannot tell whether the getting-started card below will
   * already say what the banner would.
   */
  if (!data.hasLoaded) {
    return <EventOverviewSkeleton statCount={4} loadingText="Loading SLO" />;
  }

  if (data.error || !data.slo) {
    return (
      <Fragment>
        {banner}
        <ErrorMessage
          message={data.error || "This SLO could not be loaded."}
          onRefreshClick={data.refresh}
        />
      </Fragment>
    );
  }

  const slo: ServiceLevelObjective = data.slo;
  // Resolved per render; every render follows a poll, so "now" stays current.
  const now: Date = OneUptimeDate.getCurrentDate();

  const monitorIds: Array<ObjectID> = (
    (slo.monitors as Array<Monitor> | undefined) || []
  )
    .filter((monitor: Monitor) => {
      return Boolean(monitor._id);
    })
    .map((monitor: Monitor) => {
      return new ObjectID(monitor._id!.toString());
    });

  const enabledBurnRateRules: Array<ServiceLevelObjectiveBurnRateRule> =
    data.burnRateRules.filter((rule: ServiceLevelObjectiveBurnRateRule) => {
      return rule.isEnabled === true;
    });

  /*
   * Only when both are KNOWN to be zero: a failed rule count must not turn a
   * working SLO's overview into onboarding.
   */
  const isGettingStarted: boolean =
    monitorIds.length === 0 && data.monitorRuleCount === 0;

  /*
   * A new SLO's "no monitors attached" notice IS the getting-started card; a
   * warning banner above it repeating the same call to action read as two
   * separate problems. A disabled or archived SLO keeps its banner, because
   * the card does not say that measurement is switched off.
   */
  const showBanner: boolean =
    !isGettingStarted || slo.isEnabled === false || slo.isArchived === true;

  return (
    <Fragment>
      {showBanner ? banner : <></>}

      <div className="mb-5">
        <SloOverviewHero
          sloId={modelId}
          slo={slo}
          monitorCount={monitorIds.length}
          owners={data.owners}
          isLoadingOwners={data.isLoadingOwners}
          isRefreshing={data.isRefreshing}
          refreshError={data.refreshError}
          onRefresh={data.refresh}
        />
      </div>

      {isGettingStarted ? (
        <></>
      ) : (
        <SloKpiStrip
          className="mb-5"
          slo={slo}
          lowestEnabledBurnRateThreshold={getLowestBurnRateThreshold(
            enabledBurnRateRules.map(
              (rule: ServiceLevelObjectiveBurnRateRule) => {
                return rule.burnRateThreshold;
              },
            ),
          )}
          now={now}
        />
      )}

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          {isGettingStarted ? (
            <SloOverviewGettingStartedCard
              sloId={modelId}
              enabledBurnRateRuleCount={enabledBurnRateRules.length}
            />
          ) : (
            <SloBudgetBurnDownCard
              sloId={modelId}
              slo={slo}
              refreshToken={
                slo.lastEvaluatedAt
                  ? OneUptimeDate.fromString(slo.lastEvaluatedAt).toISOString()
                  : ""
              }
            />
          )}

          <SloFeed
            sloId={modelId}
            title="Recent activity"
            description="Status changes, burn-rate alerts and incidents, and edits to this SLO's rules, monitors and owners."
          />
        </div>

        <div className="min-w-0">
          <SloActiveBurnEventsCard
            sloId={modelId}
            refreshToken={data.refreshCount}
          />
          <SloBurnRateRulesSummaryCard
            sloId={modelId}
            rules={data.burnRateRules}
            currentBurnRate={slo.currentBurnRate}
            error={data.burnRateRulesError}
          />
        </div>
      </div>

      <CardModelDetail<ServiceLevelObjective>
        name="SLO Details"
        cardProps={{
          title: "SLO Details",
          description:
            "The name, description and labels this SLO is listed and searched by.",
        }}
        documentationLink={new Route("/docs/slo/error-budget")}
        isEditable={true}
        onSaveSuccess={() => {
          // The hero shows the description and labels, so it must not keep the old ones.
          data.refresh();
        }}
        /*
         * Derived from the create form's own fields so a placeholder or
         * description changed there changes here too. Everything else about
         * the SLO is edited on the Settings, Monitors and Monitor Rules pages.
         */
        formFields={getSloDetailsFormFields()}
        modelDetailProps={{
          modelType: ServiceLevelObjective,
          id: "slo-details",
          modelId: modelId,
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FieldType.LongText,
              placeholder: "No description",
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: (item: ServiceLevelObjective): ReactElement => {
                const labels: Array<Label> =
                  (item.labels as Array<Label> | undefined) || [];

                if (labels.length === 0) {
                  return <span className="text-gray-400">No labels</span>;
                }

                return <LabelsElement labels={labels} />;
              },
            },
          ],
        }}
      />
    </Fragment>
  );
};

export default SloView;
