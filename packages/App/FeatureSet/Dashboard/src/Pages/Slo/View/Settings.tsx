import PageComponentProps from "../../PageComponentProps";
import { getValueOrQuietDash } from "Common/UI/Components/Table/TableEmptyValue";
import { EMPTY_VALUE_MARK } from "Common/Types/EmptyValueMark";
import {
  SLO_ARCHIVE_CARD_DESCRIPTION,
  SLO_ARCHIVE_CONFIRM_MESSAGE,
  SLO_UNARCHIVE_CARD_DESCRIPTION,
  SLO_UNARCHIVE_CONFIRM_MESSAGE,
} from "../../../Components/Slo/SloArchiveCopy";
import SloEvaluationCard from "../../../Components/Slo/SloEvaluationCard";
import SloNoticeBanner from "../../../Components/Slo/SloNoticeBanner";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  pickSloFormFields,
  SLO_SLI_TYPE_CHOICE_DESCRIPTIONS,
  SLO_SLI_TYPE_NAMES,
  SLO_WINDOW_TYPE_DESCRIPTIONS,
} from "../SloFormFields";
// The Metric SLO fields' controls, for What It Measures.
import "../SloMetricQueryFieldElements";
import { describeRequestErrorBudgetInLanguage } from "../../../Components/Slo/SloRequestTextInLanguage";
import {
  describeSloErrorBudget,
  describeSloWindow,
  getSloDowntimeSettingsFormFields,
  getSloObjectiveSettingsFormFields,
  getSloPeriodSettingsFormFields,
  orderDowntimeMonitorStatuses,
  SLO_MULTI_MONITOR_MODE_DESCRIPTIONS,
  SLO_MULTI_MONITOR_MODE_NAMES,
} from "../SloSettingsFormFields";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import Service from "Common/Models/DatabaseModels/Service";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import SliType from "Common/Types/ServiceLevelObjective/SliType";
import {
  isEventSliType,
  isRequestSliType,
} from "Common/Utils/Slo/SloRequestSli";
import SloMetricSummary from "../../../Components/Slo/SloMetricSummary";
import { formatMilliseconds } from "Common/Utils/Milliseconds";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Route from "Common/Types/API/Route";
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
  useEffect,
  useMemo,
  useState,
} from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  getGlobalTranslator,
  translateTemplate,
  translateText,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { translateRecordName } from "Common/Utils/DefaultRecordNames";
import { StateListType } from "Common/Utils/StateOrder";

/*
 * Each card's dialog is titled like the button that opens it. All three
 * said "Edit Service Level Objective" over the two or three fields of one
 * card.
 */
const SLO_SETTINGS_DIALOG_TITLES: {
  measures: string;
  objective: string;
  period: string;
  downtime: string;
} = {
  measures: translationKey("Edit What It Measures"),
  objective: translationKey("Edit Objective"),
  period: translationKey("Edit Period"),
  downtime: translationKey("Edit Downtime Calculation"),
};

// The columns What It Measures edits, in the create form's own fields.
const SLO_MEASURES_COLUMNS: Array<string> = [
  "sliType",
  "services",
  "latencyThresholdInMilliseconds",
  // Which of the services' requests count (#8444).
  "requestFilter",
  // A Metric SLO's metric, and which of its events are good (#8445).
  "metricQueryConfig",
];

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
      <p className="font-medium text-gray-900">{getValueOrQuietDash(value)}</p>
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
      translateTemplate("Every non-operational status"),
      translateTemplate(
        "The default. Statuses added to the project later are counted too.",
      ),
    );
  }

  return (
    <ul
      className="flex flex-wrap gap-2"
      aria-label={translateText("Statuses that count as downtime")}
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
            {status.name
              ? translateRecordName(
                  getGlobalTranslator(),
                  StateListType.MonitorStatus,
                  status.name,
                )
              : translateText("Unnamed status")}
          </li>
        );
      })}
    </ul>
  );
};

type RefreshBannerFunction = () => void;

const SloSettings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();
  // The route is <sloId>/settings, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  /*
   * Bumped after any card saves, and after the archive card archives or
   * unarchives, so the notice banner re-reads the SLO: a banner saying "This
   * SLO is archived" must disappear the moment the user unarchives right
   * below it. (The Evaluation switch needs no bump: the banner hears it
   * through ModelSwitchEvents, wherever it is flipped.) A counter rather
   * than a timestamp, because two saves inside the same second would
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
   *
   * The objective's fields are built again when the reader switches
   * language: Target (%)'s help is a sentence filled in with its figures
   * when it is built (getSloTargetHelpText), not a key the field looks up
   * as it draws, so Edit Objective would otherwise keep the language the
   * page opened in.
   */
  const objectiveFormFields: Array<ModelField<ServiceLevelObjective>> =
    useMemo((): Array<ModelField<ServiceLevelObjective>> => {
      return getSloObjectiveSettingsFormFields();
    }, [translator.language]);
  const periodFormFields: Array<ModelField<ServiceLevelObjective>> =
    useMemo((): Array<ModelField<ServiceLevelObjective>> => {
      return getSloPeriodSettingsFormFields();
    }, []);
  const downtimeFormFields: Array<ModelField<ServiceLevelObjective>> =
    useMemo((): Array<ModelField<ServiceLevelObjective>> => {
      return getSloDowntimeSettingsFormFields();
    }, []);
  const measuresFormFields: Array<ModelField<ServiceLevelObjective>> =
    useMemo((): Array<ModelField<ServiceLevelObjective>> => {
      return pickSloFormFields(SLO_MEASURES_COLUMNS);
    }, [translator.language]);

  /*
   * What the SLO measures, for the cards that depend on it: a request SLO
   * has no downtime to calculate. Read again after What It Measures saves.
   * Null until it is known, so the Downtime Calculation card never flashes
   * up on a request SLO's page.
   */
  const [sliType, setSliType] = useState<SliType | null>(null);
  const [measuresSaveCount, setMeasuresSaveCount] = useState<number>(0);

  useEffect(() => {
    let isCurrent: boolean = true;

    ModelAPI.getItem<ServiceLevelObjective>({
      modelType: ServiceLevelObjective,
      id: modelId,
      select: {
        sliType: true,
      },
    })
      .then((slo: ServiceLevelObjective | null) => {
        if (isCurrent) {
          setSliType(slo?.sliType || SliType.MonitorUptime);
        }
      })
      .catch(() => {
        // Without the type, the page shows the cards every SLO has.
      });

    return () => {
      isCurrent = false;
    };
  }, [modelId.toString(), measuresSaveCount]);

  // Counted in events, from traces or a metric (#8445): no downtime to calculate.
  const isRequestSlo: boolean = isEventSliType(sliType);

  return (
    <Fragment>
      <SloNoticeBanner
        sloId={modelId}
        refreshToggle={bannerRefreshCount.toString()}
      />

      <CardModelDetail<ServiceLevelObjective>
        name="SLO What It Measures"
        cardProps={{
          title: "What It Measures",
          description:
            "Where this SLO's numbers come from: the uptime of its monitors, the requests its services serve, or a metric they send.",
        }}
        isEditable={true}
        editButtonText="Edit What It Measures"
        editModalTitle={SLO_SETTINGS_DIALOG_TITLES.measures}
        formFields={measuresFormFields}
        onSaveSuccess={(): void => {
          refreshBanner();
          setMeasuresSaveCount((count: number): number => {
            return count + 1;
          });
        }}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: ServiceLevelObjective,
          id: "slo-settings-measures",
          modelId: modelId,
          // The services, threshold and metric rows show by the SLI type.
          selectMoreFields: {
            sliType: true,
            latencyThresholdInMilliseconds: true,
            metricQueryConfig: true,
          },
          fields: [
            {
              field: {
                sliType: true,
              },
              title: "SLI Type",
              fieldType: FieldType.Element,
              getElement: (item: ServiceLevelObjective): ReactElement => {
                const type: SliType = item.sliType || SliType.MonitorUptime;
                const name: string | undefined = SLO_SLI_TYPE_NAMES[type];
                const description: string | undefined =
                  SLO_SLI_TYPE_CHOICE_DESCRIPTIONS[type];

                return getValueElement(
                  name ? translator.translateText(name) || name : type,
                  description
                    ? translator.translateText(description) || description
                    : undefined,
                );
              },
            },
            {
              field: {
                services: {
                  name: true,
                },
              },
              title: "Services",
              fieldType: FieldType.Element,
              showIf: (item: ServiceLevelObjective): boolean => {
                return isEventSliType(item.sliType);
              },
              getElement: (item: ServiceLevelObjective): ReactElement => {
                const services: Array<Service> =
                  (item.services as Array<Service> | undefined) || [];

                if (services.length === 0) {
                  return (
                    <p className="font-medium text-yellow-700">
                      {translator.translateText("No services chosen")}
                    </p>
                  );
                }

                return (
                  <ul className="flex flex-wrap gap-2">
                    {services.map((service: Service) => {
                      return (
                        <li
                          key={service._id?.toString() || service.name}
                          className="rounded-md bg-gray-100 px-2 py-0.5 text-sm font-medium text-gray-800"
                        >
                          {service.name}
                        </li>
                      );
                    })}
                  </ul>
                );
              },
            },
            {
              field: {
                latencyThresholdInMilliseconds: true,
              },
              title: "Latency Threshold",
              fieldType: FieldType.Element,
              showIf: (item: ServiceLevelObjective): boolean => {
                return item.sliType === SliType.RequestLatency;
              },
              getElement: (item: ServiceLevelObjective): ReactElement => {
                return getValueElement(
                  typeof item.latencyThresholdInMilliseconds === "number"
                    ? formatMilliseconds(
                        translator,
                        item.latencyThresholdInMilliseconds,
                      )
                    : EMPTY_VALUE_MARK,
                  translator.translateTemplate(
                    "A request served within this counts as fast enough.",
                  ),
                );
              },
            },
            /*
             * Which of the services' requests count (#8444): the traces
             * search, as written, or every request when there is none.
             */
            {
              field: {
                requestFilter: true,
              },
              title: "Request Filter",
              fieldType: FieldType.Element,
              showIf: (item: ServiceLevelObjective): boolean => {
                return isRequestSliType(item.sliType);
              },
              getElement: (item: ServiceLevelObjective): ReactElement => {
                const filter: string = (item.requestFilter || "").trim();

                if (!filter) {
                  return getValueElement(
                    translator.translateText("Every request of its services") ||
                      "Every request of its services",
                  );
                }

                return (
                  <div>
                    <code
                      className="break-all rounded bg-gray-100 px-1.5 py-0.5 font-mono text-sm text-gray-900"
                      data-testid="slo-settings-request-filter"
                    >
                      {filter}
                    </code>
                    <p className="mt-1 text-sm text-gray-500">
                      {translator.translateTemplate(
                        "Only the requests that match this traces search count.",
                      )}
                    </p>
                  </div>
                );
              },
            },
            /*
             * A Metric SLO's metric (#8445): its name, then what makes an
             * event good and which of its series count, as written.
             */
            {
              field: {
                metricQueryConfig: true,
              },
              title: "Metric",
              fieldType: FieldType.Element,
              showIf: (item: ServiceLevelObjective): boolean => {
                return item.sliType === SliType.Metric;
              },
              getElement: (item: ServiceLevelObjective): ReactElement => {
                return (
                  <SloMetricSummary
                    metricQueryConfig={item.metricQueryConfig}
                  />
                );
              },
            },
          ],
        }}
      />

      <CardModelDetail<ServiceLevelObjective>
        name="SLO Objective"
        cardProps={{
          title: "Objective",
          description:
            "How reliable this SLO must be, and how early it warns before the error budget runs out.",
        }}
        isEditable={true}
        editButtonText="Edit Objective"
        editModalTitle={SLO_SETTINGS_DIALOG_TITLES.objective}
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
            // A request SLO's budget is in requests, not downtime.
            sliType: true,
          },
          fields: [
            {
              field: {
                targetPercentage: true,
              },
              title: "Target",
              fieldType: FieldType.Element,
              getElement: (item: ServiceLevelObjective): ReactElement => {
                // "99,9 %" in German: the figures the reader's way.
                return getValueElement(
                  formatSloPercent(
                    item.targetPercentage,
                    undefined,
                    translator,
                  ) || EMPTY_VALUE_MARK,
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
                  undefined,
                  translator,
                );

                return getValueElement(
                  threshold
                    ? translator.translateTemplate(
                        "{{threshold}} of error budget remaining",
                        { threshold: threshold },
                      )
                    : EMPTY_VALUE_MARK,
                  translator.translateTemplate(
                    "Below this the SLO turns At Risk.",
                  ),
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
                if (isEventSliType(item.sliType)) {
                  // "0.1% of requests: 1 bad request in every 1,000".
                  return getValueElement(
                    describeRequestErrorBudgetInLanguage(
                      {
                        targetPercentage: item.targetPercentage,
                        sliType: item.sliType,
                      },
                      translator,
                    ) || EMPTY_VALUE_MARK,
                    item.sliType === SliType.Metric
                      ? translator.translateTemplate(
                          "The bad events this objective allows before it is breached.",
                        )
                      : translator.translateTemplate(
                          "The bad requests this objective allows before it is breached.",
                        ),
                  );
                }

                // "0,1 % jedes Monats: 43 Min., 12 Sek. ..." in German.
                return getValueElement(
                  describeSloErrorBudget(
                    {
                      targetPercentage: item.targetPercentage,
                      windowType: item.windowType,
                      windowDays: item.windowDays,
                    },
                    translator,
                  ) || EMPTY_VALUE_MARK,
                  translator.translateTemplate(
                    "The downtime this objective allows before it is breached.",
                  ),
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
        editModalTitle={SLO_SETTINGS_DIALOG_TITLES.period}
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
                  describeSloWindow(
                    {
                      windowType: windowType,
                      windowDays: item.windowDays,
                      timezone: item.timezone,
                    },
                    translator,
                  ),
                  translator.translateText(
                    SLO_WINDOW_TYPE_DESCRIPTIONS[windowType],
                  ),
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
                    ? translator.translateTemplate(
                        "Months start and end at midnight in this timezone.",
                      )
                    : translator.translateTemplate(
                        "The default. Months start and end at midnight UTC.",
                      ),
                );
              },
            },
          ],
        }}
      />

      {/*
       * A request SLO counts requests, not downtime: it has nothing for this
       * card to calculate. Drawn once the SLI type is known.
       */}
      {sliType === null || isRequestSlo ? (
        <></>
      ) : (
        <CardModelDetail<ServiceLevelObjective>
          name="SLO Downtime Calculation"
          cardProps={{
            title: "Downtime Calculation",
            description:
              "Which monitor statuses spend error budget, and how downtime is combined when this SLO measures more than one monitor.",
          }}
          isEditable={true}
          editButtonText="Edit Downtime Calculation"
          editModalTitle={SLO_SETTINGS_DIALOG_TITLES.downtime}
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
                    translator.translateTerm(
                      SLO_MULTI_MONITOR_MODE_NAMES[mode],
                    ),
                    translator.translateText(
                      SLO_MULTI_MONITOR_MODE_DESCRIPTIONS[mode],
                    ),
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
                description:
                  "Time in any of these statuses counts as downtime.",
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
      )}

      <SloEvaluationCard sloId={modelId} />

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
