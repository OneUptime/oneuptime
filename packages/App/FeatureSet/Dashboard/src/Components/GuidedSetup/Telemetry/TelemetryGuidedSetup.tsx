import TelemetrySetupApi, {
  TelemetryMonitorCreateResult,
  TelemetrySetupMonitor,
  TelemetrySetupService,
  getTelemetryRecommendations,
  mayCreateMonitors,
} from "./TelemetrySetupApi";
import CardListSkeleton from "Common/UI/Components/Skeleton/CardListSkeleton";
import {
  TELEMETRY_SETUP,
  TELEMETRY_SETUP_COPY,
  TelemetrySetupProgressFacts,
  TelemetrySetupRunValue,
  TelemetrySetupStep,
  describeWhoIsToldAboutAlerts,
  getAlertDoneLine,
  getInitialPick,
  getTelemetrySetupProgress,
  isTelemetrySetupFinished,
  joinMonitorIds,
  splitMonitorIds,
} from "./TelemetrySetup";
import TelemetryWhoIsTold from "./TelemetryWhoIsTold";
import {
  TelemetrySetupRowFacts,
  getTelemetryAlertRows,
  getTelemetrySendRows,
} from "./TelemetrySetupResources";
import GuidedSetupFrame, { GuidedSetupFrameStep } from "../GuidedSetupFrame";
import { getDescribeItPrompt } from "../AskAiGuidedSetupLinks";
import useGuidedSetupRunSync from "../UseGuidedSetupRunSync";
import GuidedSetupRunStore, {
  GuidedSetupRun,
  GuidedSetupRunSync,
  getFirstOpenStepKey,
} from "../GuidedSetupProgress";
import WebsiteDownApi from "../WebsiteDown/WebsiteDownApi";
import {
  WhoIsToldMode,
  getWhoIsToldMode,
} from "../WebsiteDown/WebsiteDownSetup";
import AppLink from "../../AppLink/AppLink";
import {
  MonitorBatchPayAsYouGoConsent,
  isMonitorBatchConsentRequired,
} from "../../Billing/PayAsYouGo";
import ResourceConnectionWatch from "../../ResourceOnboarding/ResourceConnectionWatch";
import TelemetryDocumentation from "../../Telemetry/Documentation";
import {
  getFirstDataMilestonesOfProducts,
  getProductsSetUpByGuide,
} from "../../Telemetry/TelemetryGuideProducts";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Service from "Common/Models/DatabaseModels/Service";
import ActivationMilestone from "Common/Types/Analytics/ActivationMilestone";
import Route from "Common/Types/API/Route";
import ProductKey from "Common/Types/Product/ProductKey";
import {
  WELCOME_STEP_MINUTES,
  WelcomeStep,
} from "Common/Types/WelcomeChecklist/WelcomeChecklist";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { MonitorRecommendation } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import API from "Common/UI/Utils/API/API";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import UserUtil from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import ErrorSentence, {
  ErrorInSentence,
} from "Common/UI/Components/ErrorMessage/ErrorSentence";

/*
 * GUIDED SETUP: SEND LOGS, METRICS AND TRACES, THEN GET ALERTED ON THEM
 * (issue #6806), drawn in GuidedSetupFrame. The rules and words are
 * TelemetrySetup.ts; the records TelemetrySetupApi.ts.
 */

const routeOf: (page: PageMap, modelId?: string | undefined) => Route = (
  page: PageMap,
  modelId?: string | undefined,
): Route => {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: modelId,
  });
};

/*
 * A row of the step's actions, lined up with the words above: the row's gap
 * spaces them (a Button has no margin of its own).
 */
const ACTIONS_CLASS_NAME: string = "flex flex-wrap items-center gap-3";

const linkClassName: string =
  "text-sm font-medium text-indigo-600 hover:text-indigo-800 underline-offset-2 hover:underline";

// What the guide of step 1 sets up: a service's traces, metrics and logs.
const GUIDE_PRODUCTS: Array<ProductKey> = getProductsSetUpByGuide({
  telemetryType: "traces",
  everySignal: true,
});

// The first data of those products, which step 1 tells apart from a service.
const GUIDE_FIRST_DATA_MILESTONES: Array<ActivationMilestone> =
  getFirstDataMilestonesOfProducts(GUIDE_PRODUCTS);

const TelemetryGuidedSetup: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const userId: string = UserUtil.getUserId()?.toString() || "";

  const store: GuidedSetupRunStore = useMemo(() => {
    return new GuidedSetupRunStore({
      setup: TELEMETRY_SETUP,
      projectId: ProjectUtil.getCurrentProjectId()?.toString() || "",
      userId: userId,
    });
  }, [userId]);
  const runSync: GuidedSetupRunSync = useGuidedSetupRunSync(store);

  /*
   * Step 2's monitors: for the data the project's first data says arrived
   * (#7146), read as the step opens, and the setup's three until then.
   */
  const [recommendations, setRecommendations] = useState<
    Array<MonitorRecommendation>
  >(() => {
    return getTelemetryRecommendations();
  });

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");
  const [run, setRun] = useState<GuidedSetupRun>({});
  const [service, setService] = useState<TelemetrySetupService | null>(null);
  const [reporting, setReporting] = useState<Array<TelemetrySetupService>>([]);
  const [monitors, setMonitors] = useState<Array<TelemetrySetupMonitor>>([]);
  const [whoMode, setWhoMode] = useState<WhoIsToldMode>(
    WhoIsToldMode.OwnerEmailOnly,
  );
  const [openStepKey, setOpenStepKey] = useState<string | null>(
    TelemetrySetupStep.Send,
  );

  // Step 2.
  const [coveredIds, setCoveredIds] = useState<Array<string> | null>(null);
  const [picked, setPicked] = useState<Array<string>>([]);
  const [pickError, setPickError] = useState<string>("");
  const [hasAcknowledgedBilling, setHasAcknowledgedBilling] =
    useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");
  const [failures, setFailures] = useState<
    TelemetryMonitorCreateResult["failures"]
  >([]);

  const facts: TelemetrySetupProgressFacts = {
    hasReportingService: Boolean(service?.hasReported),
    monitorCount: monitors.length,
    isAlertSkipped: run[TelemetrySetupRunValue.AlertSkipped] === true,
    isAlertConfirmed: run[TelemetrySetupRunValue.AlertConfirmed] === true,
  };

  const progress: ReturnType<typeof getTelemetrySetupProgress> =
    getTelemetrySetupProgress(facts);

  const saveRun: (values: Record<string, string | boolean | null>) => void = (
    values: Record<string, string | boolean | null>,
  ): void => {
    setRun(store.save(values));
  };

  // Reads the run's records: what exists decides which step opens.
  useEffect(() => {
    let isActive: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      // The server's run (#7253): another device's, or this one's.
      const stored: GuidedSetupRun = await store.load();
      let nextRun: GuidedSetupRun = stored;
      let loadedService: TelemetrySetupService | null = null;
      let loadedMonitors: Array<TelemetrySetupMonitor> = [];

      const serviceId: string | boolean | undefined =
        stored[TelemetrySetupRunValue.ServiceId];

      if (typeof serviceId === "string") {
        loadedService = await TelemetrySetupApi.loadService(serviceId).catch(
          () => {
            return null;
          },
        );

        if (!loadedService) {
          // The service is gone: this run starts again.
          store.forget();
          nextRun = {};
        }
      }

      if (loadedService) {
        loadedMonitors = await TelemetrySetupApi.loadMonitors(
          splitMonitorIds(nextRun[TelemetrySetupRunValue.MonitorIds]),
        ).catch(() => {
          return [];
        });
      }

      const [loadedReporting, whoFacts] = await Promise.all([
        TelemetrySetupApi.loadReportingServices().catch(() => {
          return [] as Array<TelemetrySetupService>;
        }),
        WebsiteDownApi.loadWhoIsToldFacts(),
      ]);

      if (!isActive) {
        return;
      }

      setRun(nextRun);
      setService(loadedService);
      setMonitors(loadedMonitors);
      setReporting(loadedReporting);
      setWhoMode(getWhoIsToldMode(whoFacts));
      setOpenStepKey(
        getFirstOpenStepKey(
          getTelemetrySetupProgress({
            hasReportingService: Boolean(loadedService?.hasReported),
            monitorCount: loadedMonitors.length,
            isAlertSkipped:
              nextRun[TelemetrySetupRunValue.AlertSkipped] === true,
            isAlertConfirmed:
              nextRun[TelemetrySetupRunValue.AlertConfirmed] === true,
          }),
        ),
      );
      setIsLoading(false);
    };

    load().catch((err: Error) => {
      if (isActive) {
        setLoadError(API.getFriendlyMessage(err));
        setIsLoading(false);
      }
    });

    return () => {
      isActive = false;
    };
  }, [store]);

  /*
   * Step 2's offer, read once it is open: the monitors for the data that
   * arrived (#7146), and what the service has already.
   */
  useEffect(() => {
    if (openStepKey !== TelemetrySetupStep.Alert || !service) {
      return;
    }

    let isActive: boolean = true;

    const loadOffer: () => Promise<void> = async (): Promise<void> => {
      // Not known when it cannot be read: the setup's three are offered.
      let reached: Array<ActivationMilestone> | null = null;

      try {
        reached = await TelemetrySetupApi.loadFirstDataReached();
      } catch {
        reached = null;
      }

      const offer: Array<MonitorRecommendation> =
        getTelemetryRecommendations(reached);

      // Unknown coverage offers them all; the server refuses nothing twice.
      let covered: Array<string> = [];

      try {
        covered = await TelemetrySetupApi.loadCoveredRecommendationIds({
          service: service,
          recommendations: offer,
          translator: translator,
        });
      } catch {
        covered = [];
      }

      if (!isActive) {
        return;
      }

      setRecommendations(offer);
      setCoveredIds(covered);
      setPicked(
        getInitialPick({
          recommendationIds: offer.map(
            (recommendation: MonitorRecommendation): string => {
              return recommendation.recommendationId;
            },
          ),
          coveredIds: covered,
        }),
      );
    };

    void loadOffer();

    return () => {
      isActive = false;
    };
  }, [openStepKey, service?.id]);

  if (isLoading) {
    return <PageSkeleton />;
  }

  if (loadError) {
    return <Alert type={AlertType.DANGER} title={loadError} />;
  }

  const chooseService: (pickedService: TelemetrySetupService) => void = (
    pickedService: TelemetrySetupService,
  ): void => {
    saveRun({
      [TelemetrySetupRunValue.ServiceId]: pickedService.id,
      [TelemetrySetupRunValue.MonitorIds]: null,
      [TelemetrySetupRunValue.AlertSkipped]: null,
      [TelemetrySetupRunValue.AlertConfirmed]: null,
    });
    setService({ ...pickedService, hasReported: true });
    setMonitors([]);
    setCoveredIds(null);
    setOpenStepKey(TelemetrySetupStep.Alert);
  };

  /*
   * STEP 1: SEND YOUR FIRST DATA.
   */
  const sendContent: ReactElement = service?.hasReported ? (
    <div className="space-y-4">
      <p className="text-sm text-gray-700">
        {translator.translateTemplate("{{service}} is sending data.", {
          service: service.name,
        })}
      </p>
      <div className={ACTIONS_CLASS_NAME}>
        <Button
          title={TELEMETRY_SETUP_COPY.continueButton}
          buttonStyle={ButtonStyleType.PRIMARY}
          dataTestId="guided-setup-send-continue"
          onClick={() => {
            setOpenStepKey(
              // The next step not done, or the summary.
              getFirstOpenStepKey(progress),
            );
          }}
        />
      </div>
    </div>
  ) : (
    <div className="space-y-5">
      <p className="text-sm text-gray-500">
        {translator.translateText(TELEMETRY_SETUP_COPY.sendHelp)}
      </p>
      <TelemetryDocumentation
        telemetryType="traces"
        everySignal={true}
        isBare={true}
      />
      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-900">
          {translator.translateText(TELEMETRY_SETUP_COPY.waitTitle)}
        </h3>
        {/*
         * A service, not the key's first data as the Setup Guide tabs also
         * take (#7754): step 2 alerts on that service, and every way this
         * guide offers names one. Its OpenTelemetry snippets set
         * service.name (an SDK falls back to unknown_service otherwise),
         * and the Sentry snippet's release, my-service@1.0.0, names
         * my-service.
         *
         * Data that names none - an OpenTelemetry Collector or another
         * tool's agent with no service.name - is still seen (#7888): while
         * no service of the project has reported, the project's first data
         * with no service registered says so, and how to name one, and the
         * step waits on. With services that report, data may be one of
         * theirs: they are offered below.
         */}
        <ResourceConnectionWatch
          modelType={Service}
          viewPage={PageMap.SERVICE_VIEW}
          viewText="View service"
          products={GUIDE_PRODUCTS}
          isServiceRequired={true}
          firstDataMilestones={
            reporting.length === 0 ? GUIDE_FIRST_DATA_MILESTONES : undefined
          }
          onConnected={(record: BaseModel) => {
            const id: string = record._id?.toString() || "";
            const name: unknown = record.getColumnValue("name");

            if (id) {
              chooseService({
                id: id,
                name: typeof name === "string" ? name : "",
                hasReported: true,
              });
            }
          }}
        />
      </div>
      {reporting.length > 0 ? (
        <div data-testid="guided-setup-reporting-services">
          <h3 className="text-sm font-semibold text-gray-900">
            {translator.translateText(TELEMETRY_SETUP_COPY.existingTitle)}
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            {translator.translateText(TELEMETRY_SETUP_COPY.existingHelp)}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {reporting.map((candidate: TelemetrySetupService) => {
              return (
                <button
                  key={candidate.id}
                  type="button"
                  className="inline-flex max-w-full items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  data-testid={`guided-setup-use-service-${candidate.id}`}
                  onClick={() => {
                    chooseService(candidate);
                  }}
                >
                  <span className="truncate">
                    {translator.translateTemplate(
                      TELEMETRY_SETUP_COPY.useService,
                      { service: candidate.name },
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <></>
      )}
    </div>
  );

  /*
   * STEP 2: GET ALERTED.
   */
  const covered: Array<string> = coveredIds || [];
  const offered: Array<MonitorRecommendation> = recommendations.filter(
    (recommendation: MonitorRecommendation): boolean => {
      return !covered.includes(recommendation.recommendationId);
    },
  );
  const pickedTypes: Array<MonitorType> = recommendations
    .filter((recommendation: MonitorRecommendation): boolean => {
      return picked.includes(recommendation.recommendationId);
    })
    .map((recommendation: MonitorRecommendation): MonitorType => {
      return recommendation.monitorType;
    });
  const needsBillingConsent: boolean =
    isMonitorBatchConsentRequired(pickedTypes);
  const canCreate: boolean = mayCreateMonitors();
  const serviceName: string = service?.name || "";

  const createPicked: () => Promise<void> = async (): Promise<void> => {
    if (!service) {
      return;
    }

    if (picked.length === 0) {
      setPickError(
        translator.translateText(TELEMETRY_SETUP_COPY.nothingPicked) || "",
      );
      return;
    }

    setPickError("");
    setSaveError("");
    setFailures([]);
    setIsSaving(true);

    try {
      const result: TelemetryMonitorCreateResult =
        await TelemetrySetupApi.createMonitors({
          service: service,
          recommendations: recommendations,
          recommendationIds: picked,
          hasAcknowledgedBilling: hasAcknowledgedBilling,
          translator: translator,
        });

      const ids: Array<string> = [
        ...splitMonitorIds(run[TelemetrySetupRunValue.MonitorIds]),
        ...result.createdIds,
      ];

      saveRun({
        [TelemetrySetupRunValue.MonitorIds]: joinMonitorIds(ids) || null,
        [TelemetrySetupRunValue.AlertSkipped]: null,
      });

      const loaded: Array<TelemetrySetupMonitor> =
        await TelemetrySetupApi.loadMonitors(ids).catch(() => {
          return [];
        });

      setMonitors(loaded);
      setFailures(result.failures);

      /*
       * Some were refused: what was made is watched now, so it leaves the
       * pick and the offer, and Create - or the panel's Try again - makes
       * only what is still missing, never a second copy (#10276). A read
       * that fails keeps the pick as it was.
       */
      if (result.failures.length > 0 && result.createdIds.length > 0) {
        const nowCovered: Array<string> | null =
          await TelemetrySetupApi.loadCoveredRecommendationIds({
            service: service,
            recommendations: recommendations,
            translator: translator,
          }).catch(() => {
            return null;
          });

        if (nowCovered) {
          setCoveredIds(nowCovered);
          setPicked((current: Array<string>): Array<string> => {
            return current.filter((recommendationId: string): boolean => {
              return !nowCovered.includes(recommendationId);
            });
          });
        }
      }

      if (result.failures.length === 0 && loaded.length > 0) {
        setOpenStepKey(null);
      }
    } catch (err) {
      setSaveError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  const notNow: ReactElement = (
    <Button
      title={TELEMETRY_SETUP_COPY.notNow}
      buttonStyle={ButtonStyleType.LINK}
      dataTestId="guided-setup-not-now"
      onClick={() => {
        saveRun({ [TelemetrySetupRunValue.AlertSkipped]: true });
        setOpenStepKey(null);
      }}
    />
  );

  const whoIsTold: ReactElement = (
    <div className="space-y-1" data-testid="guided-setup-who-is-told">
      <p className="text-sm text-gray-700">
        {translator.translateText(TELEMETRY_SETUP_COPY.alertsNotIncidents)}
      </p>
      <p className="text-sm text-gray-700">
        {describeWhoIsToldAboutAlerts({
          translator: translator,
          mode: whoMode,
        })}{" "}
        {whoMode === WhoIsToldMode.ExistingPolicy ? (
          <></>
        ) : (
          <AppLink
            to={routeOf(PageMap.ON_CALL_DUTY_GUIDED_SETUP)}
            className={linkClassName}
            dataTestId="guided-setup-page-someone"
          >
            {translator.translateText(TELEMETRY_SETUP_COPY.whoPageSomeone) ||
              ""}
          </AppLink>
        )}
      </p>
    </div>
  );

  const alertContent: ReactElement =
    coveredIds === null ? (
      <CardListSkeleton count={2} lines={1} />
    ) : (
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          {translator.translateTemplate(TELEMETRY_SETUP_COPY.alertHelp, {
            service: serviceName,
          })}
        </p>
        <ul
          className="divide-y divide-gray-100 rounded-md border border-gray-200"
          data-testid="guided-setup-recommendations"
        >
          {recommendations.map((recommendation: MonitorRecommendation) => {
            const isCovered: boolean = covered.includes(
              recommendation.recommendationId,
            );

            return (
              <li
                key={recommendation.recommendationId}
                className="px-3 py-3"
                data-testid={`guided-setup-recommendation-${recommendation.templateId}`}
              >
                {isCovered ? (
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-sm font-medium text-gray-900">
                      {translator.translateText(recommendation.name)}
                    </span>
                    <span className="flex-shrink-0 text-sm text-emerald-700">
                      {translator.translateText(
                        TELEMETRY_SETUP_COPY.alreadyWatched,
                      )}
                    </span>
                  </div>
                ) : (
                  <CheckboxElement
                    title={recommendation.name}
                    description={recommendation.description}
                    value={picked.includes(recommendation.recommendationId)}
                    disabled={!canCreate}
                    onChange={(value: boolean) => {
                      setPickError("");
                      setPicked(
                        value
                          ? [...picked, recommendation.recommendationId]
                          : picked.filter((id: string): boolean => {
                              return id !== recommendation.recommendationId;
                            }),
                      );
                    }}
                    dataTestId={`guided-setup-pick-${recommendation.templateId}`}
                  />
                )}
              </li>
            );
          })}
        </ul>
        {whoIsTold}
        {!canCreate ? (
          <Alert
            type={AlertType.INFO}
            title={
              translator.translateText(
                TELEMETRY_SETUP_COPY.cannotCreateMonitors,
              ) || ""
            }
          />
        ) : (
          <></>
        )}
        {canCreate && offered.length > 0 ? (
          <MonitorBatchPayAsYouGoConsent
            monitorTypes={pickedTypes}
            value={hasAcknowledgedBilling}
            onChange={setHasAcknowledgedBilling}
          />
        ) : (
          <></>
        )}
        {pickError || saveError ? (
          <p role="alert" className="text-sm text-red-600">
            <ErrorInSentence
              message={pickError || saveError}
              showWhereToLook={true}
            />
          </p>
        ) : (
          <></>
        )}
        {failures.length > 0 ? (
          <ul
            role="alert"
            className="list-disc space-y-1 ps-5 text-sm text-red-600"
            data-testid="guided-setup-create-failures"
          >
            {failures.map(
              (failure: { name: string; message: string }, index: number) => {
                return (
                  <li key={`${failure.name}-${index}`}>
                    <ErrorSentence
                      template="{{name}}: {{reason}}"
                      error={failure.message}
                      errorPlaceholder="reason"
                      values={{ name: failure.name }}
                    />
                  </li>
                );
              },
            )}
          </ul>
        ) : (
          <></>
        )}
        <div className={ACTIONS_CLASS_NAME}>
          {/*
           * One filled button, the thing to do next: Continue once every
           * recommended monitor is watched, else Create (with Not now).
           */}
          {offered.length === 0 ? (
            <Button
              title={TELEMETRY_SETUP_COPY.continueButton}
              buttonStyle={ButtonStyleType.PRIMARY}
              dataTestId="guided-setup-alert-continue"
              onClick={() => {
                saveRun({ [TelemetrySetupRunValue.AlertConfirmed]: true });
                setOpenStepKey(null);
              }}
            />
          ) : (
            <>
              {canCreate ? (
                <Button
                  title={translator.translatePlural(
                    {
                      one: "Create {{count}} monitor",
                      other: "Create {{count}} monitors",
                    },
                    picked.length,
                  )}
                  isTitleTranslated={true}
                  buttonStyle={ButtonStyleType.PRIMARY}
                  isLoading={isSaving}
                  disabled={needsBillingConsent && !hasAcknowledgedBilling}
                  dataTestId="guided-setup-create-monitors"
                  onClick={() => {
                    void createPicked();
                  }}
                />
              ) : (
                <></>
              )}
              {notNow}
            </>
          )}
          {monitors.length > 0 && failures.length > 0 ? (
            <Button
              title={TELEMETRY_SETUP_COPY.continueButton}
              buttonStyle={ButtonStyleType.NORMAL}
              dataTestId="guided-setup-alert-continue-anyway"
              onClick={() => {
                setOpenStepKey(null);
              }}
            />
          ) : (
            <></>
          )}
        </div>
      </div>
    );

  /*
   * What the panel lists (#10276): the service, then the monitors - made,
   * picked and not made yet, or refused - read from this page's records
   * and the run's.
   */
  const rowFacts: TelemetrySetupRowFacts = {
    service: service ? { id: service.id, name: service.name } : null,
    serviceRoute: service
      ? routeOf(PageMap.SERVICE_VIEW, service.id)
      : undefined,
    monitors: monitors.map((monitor: TelemetrySetupMonitor) => {
      return {
        id: monitor.id,
        name: monitor.name,
        route: routeOf(PageMap.MONITOR_VIEW, monitor.id),
      };
    }),
    picked: offered
      .filter((recommendation: MonitorRecommendation): boolean => {
        return picked.includes(recommendation.recommendationId);
      })
      .map((recommendation: MonitorRecommendation) => {
        return {
          recommendationId: recommendation.recommendationId,
          name:
            translator.translateText(recommendation.name) ||
            recommendation.name,
        };
      }),
    refused: failures,
    isSaving: isSaving,
    isSkipped: facts.isAlertSkipped,
    onRetry: () => {
      void createPicked();
    },
  };

  const steps: Array<GuidedSetupFrameStep> = [
    {
      ...progress[0]!,
      title: TELEMETRY_SETUP_COPY.sendTitle,
      outcome: TELEMETRY_SETUP_COPY.sendOutcome,
      doneLine: service
        ? translator.translateTemplate("{{service}} is sending data.", {
            service: service.name,
          })
        : undefined,
      content: sendContent,
      resources: getTelemetrySendRows(rowFacts),
    },
    {
      ...progress[1]!,
      title: TELEMETRY_SETUP_COPY.alertTitle,
      outcome: TELEMETRY_SETUP_COPY.alertOutcome,
      doneLine: getAlertDoneLine({
        translator: translator,
        serviceName: serviceName,
        monitorCount: monitors.length,
        isSkipped: facts.isAlertSkipped,
      }),
      content: alertContent,
      resources: getTelemetryAlertRows(rowFacts),
    },
  ];

  /*
   * THE SUMMARY.
   */
  const summary: ReactElement = (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-gray-900">
        {translator.translateTemplate(TELEMETRY_SETUP_COPY.summaryTitle, {
          service: serviceName,
        })}
      </h2>
      <dl className="mt-4 divide-y divide-gray-100">
        <div
          className="py-3 sm:grid sm:grid-cols-4 sm:gap-4"
          data-testid="guided-setup-summary-watched-by"
        >
          <dt className="text-sm font-medium text-gray-900">
            {translator.translateText(TELEMETRY_SETUP_COPY.summaryWatchedBy)}
          </dt>
          <dd className="mt-1 text-sm text-gray-700 sm:col-span-3 sm:mt-0">
            {monitors.length > 0 ? (
              <ul className="space-y-1">
                {monitors.map((monitor: TelemetrySetupMonitor) => {
                  return (
                    <li key={monitor.id}>
                      <AppLink
                        to={routeOf(PageMap.MONITOR_VIEW, monitor.id)}
                        className={linkClassName}
                      >
                        {monitor.name}
                      </AppLink>
                    </li>
                  );
                })}
              </ul>
            ) : facts.isAlertConfirmed ? (
              translator.translateTemplate(TELEMETRY_SETUP_COPY.allWatched, {
                service: serviceName,
              })
            ) : (
              translator.translateText(TELEMETRY_SETUP_COPY.summaryNotWatched)
            )}
          </dd>
        </div>
        <div
          className="py-3 sm:grid sm:grid-cols-4 sm:gap-4"
          data-testid="guided-setup-summary-who-is-told"
        >
          <dt className="text-sm font-medium text-gray-900">
            {translator.translateText(TELEMETRY_SETUP_COPY.summaryWhoIsTold)}
          </dt>
          <dd className="mt-1 text-sm text-gray-700 sm:col-span-3 sm:mt-0">
            {/*
             * Read from the monitors the setup made, as their own "When
             * this goes down" says it (#7164); the counts' sentence when
             * there is no monitor, or none could be read.
             */}
            <TelemetryWhoIsTold
              monitors={monitors}
              fallback={describeWhoIsToldAboutAlerts({
                translator: translator,
                mode: whoMode,
              })}
            />
          </dd>
        </div>
      </dl>
      <h3 className="mt-5 text-sm font-semibold text-gray-900">
        {translator.translateText(TELEMETRY_SETUP_COPY.summaryNext)}
      </h3>
      {service ? (
        <ul className="mt-2 space-y-1">
          <li>
            <AppLink
              to={routeOf(PageMap.SERVICE_VIEW_LOGS, service.id)}
              className={linkClassName}
            >
              {translator.translateText(TELEMETRY_SETUP_COPY.nextLogs) || ""}
            </AppLink>
          </li>
          <li>
            <AppLink
              to={routeOf(PageMap.SERVICE_VIEW_TRACES, service.id)}
              className={linkClassName}
            >
              {translator.translateText(TELEMETRY_SETUP_COPY.nextTraces) || ""}
            </AppLink>
          </li>
          <li>
            <AppLink
              to={routeOf(PageMap.SERVICE_VIEW_METRICS, service.id)}
              className={linkClassName}
            >
              {translator.translateText(TELEMETRY_SETUP_COPY.nextMetrics) || ""}
            </AppLink>
          </li>
          <li>
            <AppLink
              to={routeOf(PageMap.SERVICE_VIEW_RECOMMENDATIONS, service.id)}
              className={linkClassName}
              dataTestId="guided-setup-more-recommendations"
            >
              {translator.translateText(
                TELEMETRY_SETUP_COPY.nextRecommendations,
              ) || ""}
            </AppLink>
          </li>
        </ul>
      ) : (
        <></>
      )}
      <div className={`mt-5 ${ACTIONS_CLASS_NAME}`}>
        <Button
          title={TELEMETRY_SETUP_COPY.startOver}
          buttonStyle={ButtonStyleType.NORMAL}
          icon={IconProp.Add}
          dataTestId="guided-setup-start-over"
          onClick={() => {
            store.forget();
            setRun({});
            setService(null);
            setMonitors([]);
            setCoveredIds(null);
            setPicked([]);
            setFailures([]);
            setSaveError("");
            setHasAcknowledgedBilling(false);
            setOpenStepKey(TelemetrySetupStep.Send);
            TelemetrySetupApi.loadReportingServices()
              .then(setReporting)
              .catch(() => {
                setReporting([]);
              });
          }}
        />
      </div>
    </div>
  );

  return (
    <GuidedSetupFrame
      setup={TELEMETRY_SETUP}
      runSync={runSync}
      onRetryRunSync={() => {
        store.retry();
      }}
      steps={steps}
      openStepKey={openStepKey}
      onOpenStep={(key: string) => {
        setSaveError("");
        setOpenStepKey(key);
      }}
      summary={summary}
      isFinished={isTelemetrySetupFinished(facts)}
      minutes={WELCOME_STEP_MINUTES[WelcomeStep.Telemetry]}
      describeItPrompt={getDescribeItPrompt({
        setup: TELEMETRY_SETUP,
        translator: translator,
      })}
    />
  );
};

export default TelemetryGuidedSetup;
