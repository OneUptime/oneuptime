import PageComponentProps from "../../PageComponentProps";
import {
  SLO_ARCHIVE_CARD_DESCRIPTION,
  SLO_ARCHIVE_CONFIRM_MESSAGE,
  SLO_UNARCHIVE_CARD_DESCRIPTION,
  SLO_UNARCHIVE_CONFIRM_MESSAGE,
} from "../../../Components/Slo/SloArchiveCopy";
import SloNoticeBanner from "../../../Components/Slo/SloNoticeBanner";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { SLO_WINDOW_TYPE_DESCRIPTIONS } from "../SloFormFields";
import {
  describeSloErrorBudget,
  describeSloWindow,
  getSloDowntimeSettingsFormFields,
  getSloEvaluationSettingsFormFields,
  getSloObjectiveSettingsFormFields,
  getSloPeriodSettingsFormFields,
  orderDowntimeMonitorStatuses,
  SLO_MULTI_MONITOR_MODE_DESCRIPTIONS,
} from "../SloSettingsFormFields";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import SloMultiMonitorMode from "Common/Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import { formatSloPercent } from "Common/Utils/Slo/SloWidgetFormat";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";

const EM_DASH: string = "—";

/*
 * Shown when a status has no colour, the same neutral fallback the
 * monitor status bubble uses, so the dot never disappears in dark mode.
 */
const STATUS_DOT_FALLBACK_COLOR: string = "var(--ou-text-subtle, #9ca3af)";

type GetValueElementFunction = (
  value: string,
  description?: string | undefined,
) => ReactElement;

/*
 * A value with an optional line explaining what it means. Settings is where
 * people come to understand what an SLO does, so each choice is shown with
 * its consequence rather than as a bare enum value.
 */
const getValueElement: GetValueElementFunction = (
  value: string,
  description?: string | undefined,
): ReactElement => {
  return (
    <div className="space-y-1">
      <p className="font-medium text-gray-900">{value}</p>
      {description ? <p className="text-gray-500">{description}</p> : null}
    </div>
  );
};

type GetDowntimeStatusesElementFunction = (
  statuses: Array<MonitorStatus> | undefined,
) => ReactElement;

const getDowntimeStatusesElement: GetDowntimeStatusesElementFunction = (
  statuses: Array<MonitorStatus> | undefined,
): ReactElement => {
  const orderedStatuses: Array<MonitorStatus> =
    orderDowntimeMonitorStatuses(statuses);

  /*
   * An empty list is a setting, not missing data: the worker then counts
   * every non-operational status, so say that instead of leaving a blank.
   */
  if (orderedStatuses.length === 0) {
    return getValueElement(
      "Every non-operational status",
      "The default. Statuses added to the project later are counted too.",
    );
  }

  return (
    <ul
      className="flex flex-wrap gap-2"
      aria-label="Statuses that count as downtime"
    >
      {orderedStatuses.map((status: MonitorStatus, index: number) => {
        return (
          <li
            key={status._id?.toString() || index}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-xs font-medium text-gray-700"
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 flex-shrink-0 rounded-full"
              style={{
                backgroundColor: status.color
                  ? status.color.toString()
                  : STATUS_DOT_FALLBACK_COLOR,
              }}
            />
            {status.name || "Unnamed status"}
          </li>
        );
      })}
    </ul>
  );
};

type RefreshBannerFunction = () => void;

const SloSettings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  // The route is <sloId>/settings, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  /*
   * Bumped after any card saves, and after the archive card archives or
   * unarchives, so the notice banner re-reads the SLO: a banner saying "This
   * SLO is disabled" or "This SLO is archived" must disappear the moment the
   * user turns evaluation back on, or unarchives, right below it. A counter
   * rather than a timestamp, because two saves inside the same second would
   * otherwise produce the same toggle value and the second would not refresh.
   */
  const [bannerRefreshCount, setBannerRefreshCount] = useState<number>(0);

  const refreshBanner: RefreshBannerFunction = (): void => {
    setBannerRefreshCount((count: number): number => {
      return count + 1;
    });
  };

  /*
   * Built once per mount: the period fields carry the full timezone list,
   * and rebuilding it on every render would hand each form new field
   * objects for no reason.
   */
  const objectiveFormFields: Array<ModelField<ServiceLevelObjective>> =
    useMemo((): Array<ModelField<ServiceLevelObjective>> => {
      return getSloObjectiveSettingsFormFields();
    }, []);
  const periodFormFields: Array<ModelField<ServiceLevelObjective>> =
    useMemo((): Array<ModelField<ServiceLevelObjective>> => {
      return getSloPeriodSettingsFormFields();
    }, []);
  const downtimeFormFields: Array<ModelField<ServiceLevelObjective>> =
    useMemo((): Array<ModelField<ServiceLevelObjective>> => {
      return getSloDowntimeSettingsFormFields();
    }, []);
  const evaluationFormFields: Array<ModelField<ServiceLevelObjective>> =
    useMemo((): Array<ModelField<ServiceLevelObjective>> => {
      return getSloEvaluationSettingsFormFields();
    }, []);

  return (
    <Fragment>
      <SloNoticeBanner
        sloId={modelId}
        refreshToggle={bannerRefreshCount.toString()}
      />

      <CardModelDetail<ServiceLevelObjective>
        name="SLO Objective"
        cardProps={{
          title: "Objective",
          description:
            "How reliable this SLO's monitors must be, and how early it warns before the error budget runs out.",
        }}
        isEditable={true}
        editButtonText="Edit Objective"
        formFields={objectiveFormFields}
        onSaveSuccess={refreshBanner}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: ServiceLevelObjective,
          id: "slo-settings-objective",
          modelId: modelId,
          /*
           * ModelDetail selects only the keys of each row's `field`, and the
           * Error Budget row also reads the window: without these it would
           * silently describe every SLO as a 30-day rolling one.
           */
          selectMoreFields: {
            targetPercentage: true,
            windowDays: true,
          },
          fields: [
            {
              field: {
                targetPercentage: true,
              },
              title: "Target",
              fieldType: FieldType.Element,
              getElement: (item: ServiceLevelObjective): ReactElement => {
                return getValueElement(
                  formatSloPercent(item.targetPercentage) || EM_DASH,
                );
              },
            },
            {
              field: {
                atRiskThresholdPercentage: true,
              },
              title: "At-Risk Threshold",
              fieldType: FieldType.Element,
              getElement: (item: ServiceLevelObjective): ReactElement => {
                const threshold: string | null = formatSloPercent(
                  item.atRiskThresholdPercentage,
                );

                return getValueElement(
                  threshold
                    ? `${threshold} of error budget remaining`
                    : EM_DASH,
                  "Below this the SLO turns At Risk.",
                );
              },
            },
            {
              field: {
                windowType: true,
              },
              title: "Error Budget",
              fieldType: FieldType.Element,
              getElement: (item: ServiceLevelObjective): ReactElement => {
                return getValueElement(
                  describeSloErrorBudget({
                    targetPercentage: item.targetPercentage,
                    windowType: item.windowType,
                    windowDays: item.windowDays,
                  }) || EM_DASH,
                  "The downtime this objective allows before it is breached.",
                );
              },
            },
          ],
        }}
      />

      <CardModelDetail<ServiceLevelObjective>
        name="SLO Compliance Period"
        cardProps={{
          title: "Compliance Period",
          description:
            "The window the SLI and error budget are measured over. Burn rate rules keep the thresholds they were created with, so review them after changing the window.",
        }}
        isEditable={true}
        editButtonText="Edit Period"
        formFields={periodFormFields}
        onSaveSuccess={refreshBanner}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: ServiceLevelObjective,
          id: "slo-settings-period",
          modelId: modelId,
          // The window rows switch on windowType whichever row is keyed on it.
          selectMoreFields: {
            windowType: true,
            windowDays: true,
            timezone: true,
          },
          fields: [
            {
              field: {
                windowType: true,
              },
              title: "Window",
              fieldType: FieldType.Element,
              getElement: (item: ServiceLevelObjective): ReactElement => {
                const windowType: SloWindowType =
                  item.windowType || SloWindowType.Rolling;

                return getValueElement(
                  describeSloWindow({
                    windowType: windowType,
                    windowDays: item.windowDays,
                    timezone: item.timezone,
                  }),
                  SLO_WINDOW_TYPE_DESCRIPTIONS[windowType],
                );
              },
            },
            {
              field: {
                timezone: true,
              },
              title: "Timezone",
              fieldType: FieldType.Element,
              showIf: (item: ServiceLevelObjective): boolean => {
                return item.windowType === SloWindowType.CalendarMonth;
              },
              getElement: (item: ServiceLevelObjective): ReactElement => {
                return getValueElement(
                  item.timezone || "UTC",
                  item.timezone
                    ? "Months start and end at midnight in this timezone."
                    : "The default. Months start and end at midnight UTC.",
                );
              },
            },
          ],
        }}
      />

      <CardModelDetail<ServiceLevelObjective>
        name="SLO Downtime Calculation"
        cardProps={{
          title: "Downtime Calculation",
          description:
            "Which monitor statuses spend error budget, and how downtime is combined when this SLO measures more than one monitor.",
        }}
        isEditable={true}
        editButtonText="Edit Downtime Calculation"
        formFields={downtimeFormFields}
        onSaveSuccess={refreshBanner}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: ServiceLevelObjective,
          id: "slo-settings-downtime",
          modelId: modelId,
          fields: [
            {
              field: {
                multiMonitorMode: true,
              },
              title: "Multi Monitor Mode",
              fieldType: FieldType.Element,
              getElement: (item: ServiceLevelObjective): ReactElement => {
                // Unset only on rows older than the column's default.
                const mode: SloMultiMonitorMode =
                  item.multiMonitorMode || SloMultiMonitorMode.AnyDown;

                return getValueElement(
                  mode,
                  SLO_MULTI_MONITOR_MODE_DESCRIPTIONS[mode],
                );
              },
            },
            {
              field: {
                downtimeMonitorStatuses: {
                  name: true,
                  color: true,
                  priority: true,
                },
              },
              title: "Downtime Monitor Statuses",
              description: "Time in any of these statuses counts as downtime.",
              fieldType: FieldType.Element,
              getElement: (item: ServiceLevelObjective): ReactElement => {
                return getDowntimeStatusesElement(
                  item.downtimeMonitorStatuses as
                    | Array<MonitorStatus>
                    | undefined,
                );
              },
            },
          ],
        }}
      />

      <CardModelDetail<ServiceLevelObjective>
        name="SLO Evaluation"
        cardProps={{
          title: "Evaluation",
          description:
            "Whether OneUptime evaluates this SLO. A disabled SLO keeps its history and settings but stops measuring, and its burn rate rules stop firing.",
        }}
        isEditable={true}
        editButtonText="Edit Evaluation"
        formFields={evaluationFormFields}
        onSaveSuccess={refreshBanner}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: ServiceLevelObjective,
          id: "slo-settings-evaluation",
          modelId: modelId,
          fields: [
            {
              field: {
                isEnabled: true,
              },
              title: "Enabled",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                lastEvaluatedAt: true,
              },
              title: "Last Evaluated",
              fieldType: FieldType.Element,
              getElement: (item: ServiceLevelObjective): ReactElement => {
                if (!item.lastEvaluatedAt) {
                  return getValueElement(
                    "Not evaluated yet",
                    "OneUptime evaluates enabled SLOs every few minutes.",
                  );
                }

                const lastEvaluatedAt: Date = OneUptimeDate.fromString(
                  item.lastEvaluatedAt,
                );

                return (
                  <span
                    className="font-medium text-gray-900"
                    title={OneUptimeDate.getDateAsLocalFormattedString(
                      lastEvaluatedAt,
                    )}
                  >
                    {OneUptimeDate.fromNow(lastEvaluatedAt)}
                  </span>
                );
              },
            },
          ],
        }}
      />

      <ArchiveResourceCard<ServiceLevelObjective>
        modelType={ServiceLevelObjective}
        modelId={modelId}
        singularName="SLO"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.SLOS] as Route,
        )}
        archiveCardDescription={SLO_ARCHIVE_CARD_DESCRIPTION}
        unarchiveCardDescription={SLO_UNARCHIVE_CARD_DESCRIPTION}
        archiveConfirmMessage={SLO_ARCHIVE_CONFIRM_MESSAGE}
        unarchiveConfirmMessage={SLO_UNARCHIVE_CONFIRM_MESSAGE}
        onArchiveChange={refreshBanner}
      />
    </Fragment>
  );
};

export default SloSettings;
