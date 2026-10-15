import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Probe from "Common/Models/DatabaseModels/Probe";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import {
  DEFAULT_DISCOVERY_IMPORT_SETTINGS,
  DiscoveryImportAlerting,
  DiscoveryImportDeviceOutcome,
  DiscoveryImportHostResult,
  DiscoveryImportSettings,
  DiscoveryImportView,
  MAX_HOSTS_PER_DISCOVERY_IMPORT,
  isDiscoveryImportActive,
} from "Common/Types/NetworkDevice/DiscoveryImport";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { DiscoveryScanStatus } from "Common/Utils/NetworkDiscovery/DiscoveryScanStatus";
import ScanModeUtil from "Common/Utils/NetworkDiscovery/ScanModeUtil";
import ScanNameUtil from "Common/Utils/NetworkDiscovery/ScanNameUtil";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, {
  ModalSecondaryButton,
  ModalWidth,
} from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DiscoveredHostFilter,
  DiscoveredHostNameFilter,
  DiscoveredHostQuery,
  getDiscoveredHostsToImport,
  getInitialSelection,
  isSelectableDiscoveredHost,
  markDiscoveredHostsAsRegistered,
  normalizeDiscoveredHosts,
} from "../DiscoveredHostFilter";
import { getDiscoveredHosts } from "../DiscoveryScanOutcome";
import { isWaitingForDiscoveryProgress } from "../DiscoveryScanProgress";
import DiscoveryScanStatusMessage from "../DiscoveryScanStatusMessage";
import { findOrCreateRecommendedTemplate } from "../RecommendedMonitorTemplate";
import DiscoveredHostTable from "./DiscoveredHostTable";
import {
  getDiscoveryImport,
  getLatestDiscoveryImport,
  retryDiscoveryImport,
  startDiscoveryImport,
  stopDiscoveryImport,
} from "./DiscoveryImportApi";
import DiscoveryImportMonitoringStep, {
  RECOMMENDED_TEMPLATE_CHOICE_VALUE,
  getTemplateChoiceValue,
} from "./DiscoveryImportMonitoringStep";
import {
  DiscoveryImportTemplateChoice,
  getDiscoveryImportBlocker,
} from "./DiscoveryImportOutcome";
import DiscoveryImportProgressPanel from "./DiscoveryImportProgressPanel";
import {
  DiscoveryImportProgressModel,
  getDiscoveryImportProgressModel,
} from "./DiscoveryImportProgressModel";
import {
  DiscoveryImportProjectFacts,
  loadDiscoveryImportProjectFacts,
} from "./DiscoveryImportProjectFacts";
import useDiscoveryImportPolling, {
  DiscoveryImportPolling,
} from "./useDiscoveryImportPolling";

/*
 * IMPORTING A DISCOVERY SCAN'S HOSTS (Network > Discovery > Review Results).
 *
 * Three steps, each one question, in the order a reviewer answers them:
 *
 *   1. Choose devices - which hosts, narrowed by search, by what they
 *      answered and by whether anything named them.
 *   2. Monitoring - how often they are checked, and who hears about a
 *      problem, with the outcome spelled out before anything is created.
 *   3. Import - progress anyone can trust, the failures with their reasons,
 *      the finished summary, and a retry of only what failed.
 *
 * The import runs on the server (DiscoveryImportRunner), so the dialog can
 * be closed at any point: reopening Review Results on the scan shows the
 * import where it stands, and the scans table shows it running.
 *
 * The dialog is wide on purpose (OneUptime issue #4811's screenshot is a
 * 760-pixel column of 514 checkboxes under a paragraph of prose): the host
 * list is a table, and the monitoring step sets its choices beside the
 * account of what they add up to.
 */

export enum DiscoveryImportStep {
  Choose = "Choose",
  Monitoring = "Monitoring",
  Progress = "Progress",
}

export interface DiscoveryImportDialogProps {
  // The scan row the dialog was opened from; it is read again, fresh.
  scan: NetworkDeviceDiscoveryScan;
  // The project's probes, to tell whether the scan's probe is a global one.
  probes: Array<Probe>;
  onClose: () => void;
  // An import was started, finished or retried: refresh what shows imports.
  onImportsChanged: () => void;
  // Open on this import's progress rather than on the choice of hosts.
  importId?: string | undefined;
}

/*
 * The columns the dialog reads the scan with: its identity and state, the
 * hosts it found, and what the row names and explanations read. Fresh on
 * every open - the table row may be minutes old, and the scan can have been
 * edited in another tab.
 */
export const DISCOVERY_IMPORT_SCAN_SELECT: {
  [key: string]: boolean;
} = {
  _id: true,
  projectId: true,
  name: true,
  cidr: true,
  status: true,
  statusMessage: true,
  discoveredDevices: true,
  probeId: true,
  isSnmpEnabled: true,
  useShortDeviceNames: true,
  isNetbiosLookupEnabled: true,
};

const DEFAULT_QUERY: DiscoveredHostQuery = {
  answered: DiscoveredHostFilter.All,
  name: DiscoveredHostNameFilter.Any,
  search: "",
  hideAlreadyAdded: false,
};

/*
 * The hosts the dialog reasons about: what the probe found, normalised, with
 * the hosts a finished import of this sitting created marked as added - so
 * they read "Already added" at once, before the scan is read again.
 */
export function getReviewHosts(data: {
  scan: NetworkDeviceDiscoveryScan | null;
  importedAddresses: Set<string>;
}): Array<DiscoveredNetworkDevice> {
  if (
    !data.scan ||
    data.scan.status === DiscoveryScanStatus.Pending ||
    isWaitingForDiscoveryProgress(data.scan)
  ) {
    return [];
  }

  return markDiscoveredHostsAsRegistered({
    hosts: normalizeDiscoveredHosts(getDiscoveredHosts(data.scan)),
    importedIpAddresses: data.importedAddresses,
  });
}

// The addresses an import put in the inventory, or found there.
export function getImportedAddresses(
  results: ReadonlyArray<DiscoveryImportHostResult> | undefined,
): Array<string> {
  return (results || [])
    .filter((result: DiscoveryImportHostResult): boolean => {
      return (
        result.device === DiscoveryImportDeviceOutcome.Created ||
        result.device === DiscoveryImportDeviceOutcome.AlreadyAdded
      );
    })
    .map((result: DiscoveryImportHostResult): string => {
      return result.ipAddress;
    });
}

/*
 * The template the settings pick, among the choices: the one whose id they
 * name, or - for the recommended template Import would create - the choice
 * with no id.
 */
export function getPickedTemplate(data: {
  settings: DiscoveryImportSettings;
  templates: ReadonlyArray<DiscoveryImportTemplateChoice>;
}): DiscoveryImportTemplateChoice | null {
  if (data.settings.alerting !== DiscoveryImportAlerting.MonitorTemplate) {
    return null;
  }

  const picked: string = data.settings.monitorTemplateId || "";

  return (
    data.templates.find((choice: DiscoveryImportTemplateChoice): boolean => {
      return getTemplateChoiceValue(choice) === picked;
    }) || null
  );
}

const StepIndicator: FunctionComponent<{ step: DiscoveryImportStep }> = (props: {
  step: DiscoveryImportStep;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const steps: Array<{ step: DiscoveryImportStep; title: string }> = [
    { step: DiscoveryImportStep.Choose, title: "Choose devices" },
    { step: DiscoveryImportStep.Monitoring, title: "Monitoring" },
    { step: DiscoveryImportStep.Progress, title: "Import" },
  ];
  const currentIndex: number = steps.findIndex(
    (item: { step: DiscoveryImportStep }): boolean => {
      return item.step === props.step;
    },
  );

  return (
    <nav
      aria-label={translator.translateText("Import steps")}
      data-testid="discovery-import-steps"
    >
      {/*
       * A phone has no room for three steps on a line: it says which step
       * this is, and the line of steps starts at sm.
       */}
      <p className="text-sm sm:hidden" aria-hidden="true">
        <span className="font-semibold text-indigo-700">
          {translator.translateText(steps[currentIndex]?.title || "")}
        </span>
        <span className="text-gray-500">
          {" · "}
          {translator.translateTemplate("Step {{step}} of {{count}}", {
            step: currentIndex + 1,
            count: steps.length,
          })}
        </span>
      </p>
      <ol className="items-center gap-x-2 gap-y-1 text-sm max-sm:hidden sm:flex sm:flex-wrap">
        {steps.map(
          (
            item: { step: DiscoveryImportStep; title: string },
            index: number,
          ): ReactElement => {
            const isCurrent: boolean = index === currentIndex;
            const isDone: boolean = index < currentIndex;

            return (
              <li key={item.step} className="flex items-center gap-2">
                {index > 0 && (
                  <span
                    aria-hidden="true"
                    className="h-px w-6 bg-gray-300 sm:w-10"
                  />
                )}
                <span
                  aria-current={isCurrent ? "step" : undefined}
                  className={`flex items-center gap-2 ${
                    isCurrent
                      ? "font-semibold text-indigo-700"
                      : isDone
                        ? "text-gray-700"
                        : "text-gray-400"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                      isCurrent
                        ? "bg-indigo-600 text-white"
                        : isDone
                          ? "bg-indigo-100 text-indigo-700"
                          : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {isDone ? (
                      <Icon icon={IconProp.Check} className="h-3.5 w-3.5" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  {translator.translateText(item.title)}
                </span>
              </li>
            );
          },
        )}
      </ol>
    </nav>
  );
};

const DiscoveryImportDialog: FunctionComponent<DiscoveryImportDialogProps> = (
  props: DiscoveryImportDialogProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [scan, setScan] = useState<NetworkDeviceDiscoveryScan | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");
  const [step, setStep] = useState<DiscoveryImportStep>(
    DiscoveryImportStep.Choose,
  );
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState<DiscoveredHostQuery>(DEFAULT_QUERY);
  const [settings, setSettings] = useState<DiscoveryImportSettings>({
    ...DEFAULT_DISCOVERY_IMPORT_SETTINGS,
  });
  const [facts, setFacts] = useState<DiscoveryImportProjectFacts | null>(null);
  const [isLoadingFacts, setIsLoadingFacts] = useState<boolean>(false);
  const [factsError, setFactsError] = useState<string>("");
  const [isActing, setIsActing] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string>("");
  const [importId, setImportId] = useState<string | null>(
    props.importId || null,
  );
  const [lastImport, setLastImport] = useState<DiscoveryImportView | null>(
    null,
  );
  const [importedAddresses, setImportedAddresses] = useState<Set<string>>(
    new Set<string>(),
  );
  const [allResults, setAllResults] =
    useState<Array<DiscoveryImportHostResult> | null>(null);
  const [isLoadingAllResults, setIsLoadingAllResults] =
    useState<boolean>(false);
  const [allResultsError, setAllResultsError] = useState<string>("");
  const [now, setNow] = useState<number>(Date.now());
  const openRequestRef: React.MutableRefObject<number> = useRef<number>(0);

  const scanId: string = props.scan._id?.toString() || "";

  /*
   * Read the scan as it is now, and seed the selection from it: every host
   * that can be imported, ticked. Called on open and after an import
   * finishes, so hosts it imported read "Already added".
   */
  const readScan: (options: {
    reseedSelection: boolean;
  }) => Promise<NetworkDeviceDiscoveryScan | null> = useCallback(
    async (options: {
      reseedSelection: boolean;
    }): Promise<NetworkDeviceDiscoveryScan | null> => {
      if (!props.scan.id) {
        throw new BadDataException("This discovery scan could not be found.");
      }

      const fresh: NetworkDeviceDiscoveryScan | null =
        await ModelAPI.getItem<NetworkDeviceDiscoveryScan>({
          modelType: NetworkDeviceDiscoveryScan,
          id: props.scan.id,
          select: DISCOVERY_IMPORT_SCAN_SELECT as never,
        });

      if (!fresh) {
        throw new BadDataException("This discovery scan could not be found.");
      }

      setScan(fresh);

      if (options.reseedSelection) {
        setSelection(
          getInitialSelection(
            getReviewHosts({
              scan: fresh,
              importedAddresses: new Set<string>(),
            }),
          ),
        );
      }

      return fresh;
    },
    [props.scan.id],
  );

  useEffect(() => {
    openRequestRef.current += 1;
    const request: number = openRequestRef.current;

    setIsLoading(true);
    setLoadError("");

    const open: () => Promise<void> = async (): Promise<void> => {
      try {
        const [, latest]: [
          NetworkDeviceDiscoveryScan | null,
          DiscoveryImportView | null,
        ] = await Promise.all([
          readScan({ reseedSelection: true }),
          props.importId || !scanId
            ? Promise.resolve<DiscoveryImportView | null>(null)
            : getLatestDiscoveryImport(scanId).catch(
                (): DiscoveryImportView | null => {
                  // The scan can be reviewed without its import history.
                  return null;
                },
              ),
        ]);

        if (request !== openRequestRef.current) {
          return;
        }

        if (props.importId) {
          setStep(DiscoveryImportStep.Progress);
        } else if (latest && isDiscoveryImportActive(latest.status)) {
          setImportId(latest.id);
          setStep(DiscoveryImportStep.Progress);
        } else {
          setLastImport(latest);
        }
      } catch (err) {
        if (request === openRequestRef.current) {
          setLoadError(API.getFriendlyMessage(err));
        }
      } finally {
        if (request === openRequestRef.current) {
          setIsLoading(false);
        }
      }
    };

    void open();
  }, [scanId]);

  // The clock the "waiting" state is told apart by, while an import is active.
  useEffect(() => {
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      setNow(Date.now());
    }, 5000);

    return () => {
      clearInterval(timer);
    };
  }, []);

  const onFinished: (view: DiscoveryImportView) => void = useCallback(
    (view: DiscoveryImportView): void => {
      setImportedAddresses((current: Set<string>) => {
        return new Set<string>([
          ...current,
          ...getImportedAddresses(view.results),
        ]);
      });
      props.onImportsChanged();
      readScan({ reseedSelection: false }).catch(() => {
        // The marked addresses above keep the list right until the next open.
      });
    },
    [props.onImportsChanged, readScan],
  );

  const polling: DiscoveryImportPolling = useDiscoveryImportPolling({
    importId: step === DiscoveryImportStep.Progress ? importId : null,
    onFinished: onFinished,
  });

  const hosts: Array<DiscoveredNetworkDevice> = useMemo(() => {
    return getReviewHosts({
      scan: scan,
      importedAddresses: importedAddresses,
    });
  }, [scan, importedAddresses]);

  const naming: { useShortDeviceNames?: boolean | null | undefined } = {
    useShortDeviceNames: scan?.useShortDeviceNames,
  };

  const fullQuery: DiscoveredHostQuery = useMemo(() => {
    return { ...query, naming: naming };
  }, [query, scan?.useShortDeviceNames]);

  const hostsToImport: Array<DiscoveredNetworkDevice> = useMemo(() => {
    return getDiscoveredHostsToImport({
      hosts: hosts,
      filter: fullQuery,
      selectedIpAddresses: selection,
    });
  }, [hosts, fullQuery, selection]);

  const isIcmpOnly: boolean = ScanModeUtil.isIcmpOnly(scan);
  const probeId: string = scan?.probeId?.toString() || "";
  const probe: Probe | undefined = probeId
    ? props.probes.find((item: Probe): boolean => {
        return item.id?.toString() === probeId;
      })
    : undefined;

  const pickedTemplate: DiscoveryImportTemplateChoice | null = getPickedTemplate(
    {
      settings: settings,
      templates: facts?.templates || [],
    },
  );

  const blocker: string | null = getDiscoveryImportBlocker({
    hostCount: hostsToImport.length,
    settings: settings,
    template: pickedTemplate,
  });

  const loadFacts: () => Promise<void> = async (): Promise<void> => {
    if (facts || isLoadingFacts) {
      return;
    }

    setIsLoadingFacts(true);
    setFactsError("");

    try {
      const loaded: DiscoveryImportProjectFacts =
        await loadDiscoveryImportProjectFacts();

      setFacts(loaded);

      // The recommended template, picked up front for whoever turns monitors on.
      setSettings((current: DiscoveryImportSettings) => {
        if (current.monitorTemplateId || loaded.templates.length === 0) {
          return current;
        }

        return {
          ...current,
          monitorTemplateId: getTemplateChoiceValue(loaded.templates[0]!),
        };
      });
    } catch (err) {
      setFactsError(API.getFriendlyMessage(err));
    } finally {
      setIsLoadingFacts(false);
    }
  };

  const goToMonitoring: () => void = (): void => {
    setActionError("");
    setStep(DiscoveryImportStep.Monitoring);
    void loadFacts();
  };

  const startImport: () => Promise<void> = async (): Promise<void> => {
    if (blocker || isActing || !scanId) {
      return;
    }

    setIsActing(true);
    setActionError("");

    try {
      let monitorTemplateId: string | undefined = undefined;

      if (settings.alerting === DiscoveryImportAlerting.MonitorTemplate) {
        if (!pickedTemplate) {
          throw new BadDataException(
            "Pick the monitor template each device is monitored with.",
          );
        }

        monitorTemplateId = pickedTemplate.id;

        if (
          !monitorTemplateId &&
          settings.monitorTemplateId === RECOMMENDED_TEMPLATE_CHOICE_VALUE
        ) {
          const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

          if (!projectId || !facts?.seedIds) {
            throw new BadDataException(
              "The recommended template could not be created for this project. Pick another template.",
            );
          }

          monitorTemplateId = (
            await findOrCreateRecommendedTemplate({
              projectId: projectId,
              seedIds: facts.seedIds,
            })
          ).toString();
        }
      }

      const started: DiscoveryImportView = await startDiscoveryImport({
        scanId: scanId,
        ipAddresses: hostsToImport.map(
          (host: DiscoveredNetworkDevice): string => {
            return host.ipAddress;
          },
        ),
        settings: {
          pollingIntervalInMinutes: settings.pollingIntervalInMinutes,
          applyVendorTemplates: settings.applyVendorTemplates,
          alerting: settings.alerting,
          ...(monitorTemplateId
            ? { monitorTemplateId: monitorTemplateId }
            : {}),
        },
      });

      polling.setView(started);
      setImportId(started.id);
      setAllResults(null);
      setStep(DiscoveryImportStep.Progress);
      props.onImportsChanged();
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    } finally {
      setIsActing(false);
    }
  };

  const stopImport: () => Promise<void> = async (): Promise<void> => {
    if (!importId || isActing) {
      return;
    }

    setIsActing(true);
    setActionError("");

    try {
      polling.setView(await stopDiscoveryImport(importId));
      void polling.refresh();
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    } finally {
      setIsActing(false);
    }
  };

  const retryImport: () => Promise<void> = async (): Promise<void> => {
    if (!importId || isActing) {
      return;
    }

    setIsActing(true);
    setActionError("");

    try {
      const retried: DiscoveryImportView = await retryDiscoveryImport(importId);

      polling.setView(retried);
      setImportId(retried.id);
      setAllResults(null);
      setAllResultsError("");
      props.onImportsChanged();
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    } finally {
      setIsActing(false);
    }
  };

  const showAllResults: () => Promise<void> = async (): Promise<void> => {
    if (!importId) {
      return;
    }

    setIsLoadingAllResults(true);
    setAllResultsError("");

    try {
      const full: DiscoveryImportView = await getDiscoveryImport(importId, {
        allResults: true,
      });

      setAllResults(full.results || []);
    } catch (err) {
      setAllResultsError(API.getFriendlyMessage(err));
    } finally {
      setIsLoadingAllResults(false);
    }
  };

  const importMore: () => void = (): void => {
    setActionError("");
    setAllResults(null);
    setImportId(null);
    polling.setView(null);
    setQuery(DEFAULT_QUERY);
    setSelection(getInitialSelection(hosts));
    setStep(DiscoveryImportStep.Choose);
  };

  const viewLastImport: () => void = (): void => {
    if (!lastImport) {
      return;
    }

    setImportId(lastImport.id);
    polling.setView(lastImport);
    setAllResults(null);
    setStep(DiscoveryImportStep.Progress);
  };

  const scanLabel: string =
    ScanNameUtil.getScanLabel(scan || props.scan) ||
    (translator.translateText("this scan") as string);

  const description: string = isIcmpOnly
    ? translator.translateTemplate(
        "Hosts that answered ping in {{range}}. This scan checked ICMP only, so every host imports as a device pinged by the scan's probe.",
        { range: scanLabel },
      )
    : translator.translateTemplate(
        "Hosts that answered in {{range}}. A host that answered SNMP imports with the credentials that answered it; the rest are pinged by the scan's probe until you add some.",
        { range: scanLabel },
      );

  const progressView: DiscoveryImportView | null = polling.view;
  const progressModel: DiscoveryImportProgressModel | null = progressView
    ? getDiscoveryImportProgressModel(progressView, now)
    : null;

  // Whether the scan still has a host to import, for "Import more devices".
  const hasImportableHostsLeft: boolean = hosts.some(
    (host: DiscoveredNetworkDevice): boolean => {
      return isSelectableDiscoveredHost(host);
    },
  );

  let secondaryButton: ModalSecondaryButton | undefined = undefined;
  let submitButtonText: string | undefined = undefined;
  let onSubmit: (() => void) | undefined = undefined;
  let closeButtonText: string = "Cancel";
  let isSubmitDisabled: boolean = false;
  let leftFooterElement: ReactElement | undefined = undefined;

  if (step === DiscoveryImportStep.Choose) {
    secondaryButton = {
      title: translator.translateText("Next") as string,
      dataTestId: "discovery-import-next",
      disabled: isLoading || hostsToImport.length === 0,
      onClick: goToMonitoring,
    };
    leftFooterElement = (
      <p
        className="text-sm text-gray-600"
        data-testid="discovery-import-choose-summary"
      >
        {hostsToImport.length > MAX_HOSTS_PER_DISCOVERY_IMPORT
          ? translator.translateTemplate(
              "One import brings in up to {{max}} hosts: narrow the selection, then import the rest after.",
              { max: translator.formatNumber(MAX_HOSTS_PER_DISCOVERY_IMPORT) },
            )
          : translator.translatePlural(
              {
                one: "{{count}} host will be imported",
                other: "{{count}} hosts will be imported",
              },
              hostsToImport.length,
              { count: translator.formatNumber(hostsToImport.length) },
            )}
      </p>
    );

    if (hostsToImport.length > MAX_HOSTS_PER_DISCOVERY_IMPORT) {
      secondaryButton.disabled = true;
    }
  } else if (step === DiscoveryImportStep.Monitoring) {
    secondaryButton = {
      title: translator.translateText("Back") as string,
      dataTestId: "discovery-import-back",
      onClick: () => {
        setActionError("");
        setStep(DiscoveryImportStep.Choose);
      },
    };
    submitButtonText = translator.translatePlural(
      {
        one: "Import {{count}} device",
        other: "Import {{count}} devices",
      },
      hostsToImport.length,
      { count: translator.formatNumber(hostsToImport.length) },
    );
    onSubmit = () => {
      void startImport();
    };
    isSubmitDisabled = Boolean(blocker) || isLoadingFacts;
  } else if (progressModel) {
    closeButtonText = "Close";

    if (progressModel.isActive) {
      if (!progressView?.isStopRequested) {
        secondaryButton = {
          title: translator.translateText("Stop import") as string,
          dataTestId: "discovery-import-stop",
          disabled: isActing,
          onClick: () => {
            void stopImport();
          },
        };
      }
    } else {
      if (progressModel.retryableCount > 0) {
        submitButtonText = translator.translatePlural(
          {
            one: "Retry {{count}} host",
            other: "Retry {{count}} hosts",
          },
          progressModel.retryableCount,
          { count: translator.formatNumber(progressModel.retryableCount) },
        );
        onSubmit = () => {
          void retryImport();
        };
      } else {
        submitButtonText = "Done";
        onSubmit = props.onClose;
      }

      if (hasImportableHostsLeft) {
        secondaryButton = {
          title: translator.translateText("Import more devices") as string,
          dataTestId: "discovery-import-more",
          onClick: importMore,
        };
      }
    }
  }

  const isScanPartial: boolean =
    scan?.status === DiscoveryScanStatus.InProgress ||
    scan?.status === DiscoveryScanStatus.Failed;

  return (
    <Modal
      title="Import Discovered Devices"
      description={step === DiscoveryImportStep.Progress ? scanLabel : description}
      modalWidth={ModalWidth.Large}
      isBodyLoading={isLoading}
      isLoading={isActing && step !== DiscoveryImportStep.Progress}
      error={actionError || loadError || undefined}
      onClose={props.onClose}
      closeButtonText={closeButtonText}
      disableCloseOnBackdropClick={step !== DiscoveryImportStep.Choose}
      {...(secondaryButton ? { secondaryButton: secondaryButton } : {})}
      {...(submitButtonText ? { submitButtonText: submitButtonText } : {})}
      {...(onSubmit ? { onSubmit: onSubmit } : {})}
      {...(leftFooterElement ? { leftFooterElement: leftFooterElement } : {})}
      disableSubmitButton={isSubmitDisabled}
      submitButtonStyleType={ButtonStyleType.PRIMARY}
    >
      <div className="space-y-5" data-testid="discovery-import-dialog">
        <StepIndicator step={step} />

        {step === DiscoveryImportStep.Choose && scan && (
          <div className="space-y-4">
            {isScanPartial && (
              <Alert
                type={AlertType.INFO}
                strongTitle={
                  scan.status === DiscoveryScanStatus.InProgress
                    ? "This scan is still running"
                    : "These are partial results"
                }
                title={
                  scan.status === DiscoveryScanStatus.InProgress
                    ? "You can import the hosts found so far. This list is a snapshot: open Review Results again to see the hosts found since."
                    : "The scan stopped before it finished, but the hosts it already found can be imported."
                }
              />
            )}
            {lastImport && (
              <div
                className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                data-testid="discovery-import-last"
              >
                <p className="text-sm text-gray-700">
                  {translator.translateTemplate(
                    "Last import from this scan, {{time}}: {{imported}} imported, {{failed}} failed.",
                    {
                      time: OneUptimeDate.fromNow(
                        OneUptimeDate.fromString(
                          lastImport.completedAt || lastImport.createdAt,
                        ),
                      ),
                      imported: translator.formatNumber(
                        lastImport.progress.devicesCreated,
                      ),
                      failed: translator.formatNumber(
                        lastImport.progress.devicesFailed +
                          lastImport.progress.devicesNotReached +
                          lastImport.progress.monitorsFailed,
                      ),
                    },
                  )}
                </p>
                <button
                  type="button"
                  className="self-start text-sm font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:underline sm:self-auto"
                  data-testid="discovery-import-view-last"
                  onClick={viewLastImport}
                >
                  {translator.translateText("View results")}
                </button>
              </div>
            )}
            {scan.statusMessage && (
              <DiscoveryScanStatusMessage
                message={scan.statusMessage}
                scanLabel={scanLabel}
              />
            )}
            <DiscoveredHostTable
              hosts={hosts}
              scan={scan}
              isGlobalProbe={probe?.isGlobalProbe}
              isIcmpOnly={isIcmpOnly}
              query={fullQuery}
              onQueryChange={(next: DiscoveredHostQuery) => {
                setQuery({
                  answered: next.answered,
                  name: next.name,
                  search: next.search,
                  hideAlreadyAdded: next.hideAlreadyAdded,
                });
              }}
              selectedIpAddresses={selection}
              onSelectionChange={(
                update: (
                  current: Record<string, boolean>,
                ) => Record<string, boolean>,
              ) => {
                setSelection(update);
              }}
            />
          </div>
        )}

        {step === DiscoveryImportStep.Monitoring && (
          <DiscoveryImportMonitoringStep
            hosts={hostsToImport}
            probeName={probe?.name || undefined}
            settings={settings}
            onSettingsChange={setSettings}
            facts={facts}
            isLoadingFacts={isLoadingFacts}
            factsError={factsError || undefined}
            template={pickedTemplate}
            isDisabled={isActing}
          />
        )}

        {step === DiscoveryImportStep.Progress && (
          <>
            {polling.error && (
              <Alert
                type={AlertType.WARNING}
                title={translator.translateTemplate(
                  "Showing the last progress received. Retrying: {{error}}",
                  { error: polling.error },
                )}
                dataTestId="discovery-import-poll-error"
              />
            )}
            {progressView ? (
              <DiscoveryImportProgressPanel
                view={progressView}
                allResults={allResults}
                isLoadingAllResults={isLoadingAllResults}
                allResultsError={allResultsError || undefined}
                onShowAllResults={() => {
                  void showAllResults();
                }}
                now={now}
              />
            ) : (
              <p className="py-6 text-center text-sm text-gray-500">
                {translator.translateText("Reading the import…")}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};

export default DiscoveryImportDialog;
