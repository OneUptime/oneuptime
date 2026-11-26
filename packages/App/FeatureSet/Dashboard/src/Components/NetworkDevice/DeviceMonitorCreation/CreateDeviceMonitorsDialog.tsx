import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import {
  DiscoveryImportAlerting,
  DiscoveryImportHostResult,
  DiscoveryImportView,
} from "Common/Types/NetworkDevice/DiscoveryImport";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import ErrorSentence from "Common/UI/Components/ErrorMessage/ErrorSentence";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Modal, {
  ModalSecondaryButton,
  ModalWidth,
} from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  getDiscoveryImport,
  retryDiscoveryImport,
  startDeviceMonitorCreation,
  stopDiscoveryImport,
} from "../DiscoveryImport/DiscoveryImportApi";
import { DiscoveryImportTemplateChoice } from "../DiscoveryImport/DiscoveryImportOutcome";
import DiscoveryImportProgressPanel from "../DiscoveryImport/DiscoveryImportProgressPanel";
import {
  DiscoveryImportProgressModel,
  getDiscoveryImportProgressModel,
} from "../DiscoveryImport/DiscoveryImportProgressModel";
import {
  DiscoveryImportProjectFacts,
  loadDiscoveryImportProjectFacts,
} from "../DiscoveryImport/DiscoveryImportProjectFacts";
import {
  LISTED_TEMPLATE_KINDS_RULE,
  MANAGE_TEMPLATES_LINK_TITLE,
} from "../DiscoveryImport/DiscoveryImportTemplateCopy";
import { resolveImportMonitorTemplateId } from "../DiscoveryImport/DiscoveryImportTemplateId";
import useDiscoveryImportPolling, {
  DiscoveryImportPolling,
} from "../DiscoveryImport/useDiscoveryImportPolling";
import {
  CREATE_MONITORS_ACTION_TITLE,
  CREATE_MONITORS_EXPLANATION,
  MONITOR_BACKED_DEVICES_NOTE,
  countMonitorBackedDevices,
  findTemplateChoice,
  getDefaultTemplateValue,
  getDeviceMonitorCreationBlocker,
  getSelectedDeviceIds,
  getTemplateOptions,
  readsDevicePolls,
} from "./DeviceMonitorCreationModel";

/*
 * CREATE MONITORS, ON THE DEVICES LIST (OneUptime issue #10990).
 *
 * One question - which template - and one press: the selected devices each
 * get a monitor from it, on the server, as an import's devices do. Then the
 * dialog is the run's progress: what was created, what was there already,
 * what was left out and why, with Stop while it runs and Retry for what
 * failed. Closing it never stops the run.
 */
export interface CreateDeviceMonitorsDialogProps {
  // The selected devices: their ids are sent, their monitoring methods read.
  devices: Array<NetworkDevice>;
  onClose: () => void;
}

const CreateDeviceMonitorsDialog: FunctionComponent<
  CreateDeviceMonitorsDialogProps
> = (props: CreateDeviceMonitorsDialogProps): ReactElement => {
  const translator: Translator = useTranslator();
  const [facts, setFacts] = useState<DiscoveryImportProjectFacts | null>(null);
  const [isLoadingFacts, setIsLoadingFacts] = useState<boolean>(true);
  const [factsError, setFactsError] = useState<string>("");
  const [pickedValue, setPickedValue] = useState<string>("");
  const [importId, setImportId] = useState<string | null>(null);
  const [isActing, setIsActing] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string>("");
  const [allResults, setAllResults] =
    useState<Array<DiscoveryImportHostResult> | null>(null);
  const [isLoadingAllResults, setIsLoadingAllResults] =
    useState<boolean>(false);
  const [allResultsError, setAllResultsError] = useState<string>("");
  const [now, setNow] = useState<number>(Date.now());
  const contentRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);

  const deviceIds: Array<string> = getSelectedDeviceIds(props.devices);
  const monitorBackedCount: number = countMonitorBackedDevices(props.devices);
  const isOnProgress: boolean = Boolean(importId);

  useEffect(() => {
    let isCancelled: boolean = false;

    loadDiscoveryImportProjectFacts()
      .then((loaded: DiscoveryImportProjectFacts) => {
        if (isCancelled) {
          return;
        }

        setFacts(loaded);
        setPickedValue(getDefaultTemplateValue(loaded.templates));
      })
      .catch((err: unknown) => {
        if (!isCancelled) {
          setFactsError(API.getFriendlyMessage(err));
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingFacts(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  // The progress model reads how long the run has gone on.
  useEffect(() => {
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      setNow(Date.now());
    }, 5000);

    return () => {
      clearInterval(timer);
    };
  }, []);

  const onFinished: (view: DiscoveryImportView) => void = useCallback(
    (_view: DiscoveryImportView): void => {
      // Nothing to refresh: the list shows devices, not their monitors.
    },
    [],
  );

  const polling: DiscoveryImportPolling = useDiscoveryImportPolling({
    importId: importId,
    onFinished: onFinished,
  });

  const templates: Array<DiscoveryImportTemplateChoice> =
    facts?.templates || [];
  const pickedTemplate: DiscoveryImportTemplateChoice | null =
    findTemplateChoice(templates, pickedValue);
  const blocker: string | null = getDeviceMonitorCreationBlocker({
    deviceCount: deviceIds.length,
    template: pickedTemplate,
  });

  const start: () => Promise<void> = async (): Promise<void> => {
    if (blocker || isActing || isLoadingFacts) {
      return;
    }

    setIsActing(true);
    setActionError("");

    try {
      // The recommended template is created first when it is the one picked.
      const monitorTemplateId: string | undefined =
        await resolveImportMonitorTemplateId({
          settings: {
            pollingIntervalInMinutes: 5,
            applyVendorTemplates: false,
            alerting: DiscoveryImportAlerting.MonitorTemplate,
            monitorTemplateId: pickedValue,
          },
          pickedTemplate: pickedTemplate,
          seedIds: facts?.seedIds,
        });

      const started: DiscoveryImportView = await startDeviceMonitorCreation({
        deviceIds: deviceIds,
        monitorTemplateId: monitorTemplateId || "",
      });

      polling.setView(started);
      setImportId(started.id);
      setAllResults(null);
      contentRef.current?.focus({ preventScroll: true });
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    } finally {
      setIsActing(false);
    }
  };

  const stop: () => Promise<void> = async (): Promise<void> => {
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

  const retry: () => Promise<void> = async (): Promise<void> => {
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

  const progressView: DiscoveryImportView | null = polling.view;
  const progressModel: DiscoveryImportProgressModel | null = progressView
    ? getDiscoveryImportProgressModel(progressView, now)
    : null;

  let secondaryButton: ModalSecondaryButton | undefined = undefined;
  let submitButtonText: string | undefined = undefined;
  let onSubmit: (() => void) | undefined = undefined;
  let closeButtonText: string = translationKey("Cancel");
  let closeButtonStyleType: ButtonStyleType | undefined = undefined;
  let isSubmitDisabled: boolean = false;

  if (!isOnProgress) {
    submitButtonText = translator.translatePlural(
      {
        one: "Create a monitor for {{count}} device",
        other: "Create monitors for {{count}} devices",
      },
      deviceIds.length,
      { count: translator.formatNumber(deviceIds.length) },
    );
    onSubmit = () => {
      void start();
    };
    isSubmitDisabled = Boolean(blocker) || isLoadingFacts;
  } else if (progressModel) {
    closeButtonText = translationKey("Close");

    if (progressModel.isActive) {
      if (!progressView?.isStopRequested) {
        secondaryButton = {
          title: translationKey("Stop"),
          dataTestId: "create-device-monitors-stop",
          disabled: isActing,
          onClick: () => {
            void stop();
          },
        };
      }
    } else if (progressModel.retryableCount > 0) {
      submitButtonText = translator.translatePlural(
        {
          one: "Retry {{count}} device",
          other: "Retry {{count}} devices",
        },
        progressModel.retryableCount,
        { count: translator.formatNumber(progressModel.retryableCount) },
      );
      onSubmit = () => {
        void retry();
      };
    } else {
      closeButtonText = translationKey("Done");
      closeButtonStyleType = ButtonStyleType.PRIMARY;
    }
  }

  const templateOptions: Array<DropdownOption | DropdownOptionGroup> =
    getTemplateOptions(translator, templates);
  const flatOptions: Array<DropdownOption> = templateOptions.flatMap(
    (option: DropdownOption | DropdownOptionGroup): Array<DropdownOption> => {
      return "options" in option ? option.options : [option];
    },
  );
  const selectedOption: DropdownOption | undefined = flatOptions.find(
    (option: DropdownOption): boolean => {
      return option.value === pickedValue;
    },
  );

  const templatesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.MONITORS_SETTINGS_TEMPLATES] as Route,
  );

  const description: string =
    deviceIds.length === 1 && props.devices[0]?.name
      ? props.devices[0].name
      : translator.translatePlural(
          {
            one: "{{count}} device selected",
            other: "{{count}} devices selected",
          },
          deviceIds.length,
          { count: translator.formatNumber(deviceIds.length) },
        );

  /*
   * A reason the picker can show beside itself: no template to pick, or
   * one no device's monitor can be made from. The rest (nothing selected,
   * too many) is said above the picker.
   */
  const isTemplateBlocker: boolean = Boolean(
    blocker && pickedTemplate && blocker === pickedTemplate.unusableReason,
  );

  return (
    <Modal
      title={CREATE_MONITORS_ACTION_TITLE}
      description={isOnProgress ? undefined : description}
      modalWidth={ModalWidth.Medium}
      isBodyLoading={false}
      isLoading={isActing && !isOnProgress}
      error={actionError || undefined}
      onClose={props.onClose}
      closeButtonText={closeButtonText}
      disableCloseOnBackdropClick={true}
      {...(secondaryButton ? { secondaryButton: secondaryButton } : {})}
      {...(submitButtonText ? { submitButtonText: submitButtonText } : {})}
      {...(onSubmit ? { onSubmit: onSubmit } : {})}
      disableSubmitButton={isSubmitDisabled}
      submitButtonStyleType={ButtonStyleType.PRIMARY}
      {...(closeButtonStyleType !== undefined
        ? { closeButtonStyleType: closeButtonStyleType }
        : {})}
    >
      <div
        className="space-y-4 focus:outline-none"
        data-testid="create-device-monitors-dialog"
        ref={contentRef}
        tabIndex={-1}
      >
        {!isOnProgress && (
          <>
            <p className="text-sm text-gray-600">
              {translator.translateText(CREATE_MONITORS_EXPLANATION)}
            </p>
            {blocker && !isTemplateBlocker && !isLoadingFacts && (
              <Alert
                type={AlertType.INFO}
                title={translator.translateText(blocker) || blocker}
                dataTestId="create-device-monitors-blocker"
              />
            )}
            {factsError && (
              <Alert
                type={AlertType.DANGER}
                title={
                  <ErrorSentence
                    template="The monitor templates could not be read: {{error}}"
                    error={factsError}
                  />
                }
                dataTestId="create-device-monitors-facts-error"
              />
            )}
            <div
              className="space-y-3"
              data-testid="create-device-monitors-template-picker"
            >
              <div>
                <FieldLabelElement
                  title="Monitor template"
                  required={true}
                  hideOptionalLabel={true}
                  description={
                    <span>
                      {translator.translateText(LISTED_TEMPLATE_KINDS_RULE)}{" "}
                      {/*
                       * In a new tab, so the selection here stays: a
                       * template added there is listed on opening this
                       * again.
                       */}
                      <Link
                        to={templatesRoute}
                        openInNewTab={true}
                        className="inline-flex items-center gap-0.5 font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                        dataTestId="create-device-monitors-manage-templates"
                      >
                        {translator.translateText(MANAGE_TEMPLATES_LINK_TITLE)}
                        <Icon
                          icon={IconProp.ExternalLink}
                          className="h-3 w-3 flex-shrink-0"
                        />
                        <span className="sr-only">
                          {" "}
                          {translator.translateText("(opens in a new tab)")}
                        </span>
                      </Link>
                    </span>
                  }
                />
                <Dropdown
                  id="create-device-monitors-template"
                  dataTestId="create-device-monitors-template"
                  ariaLabel="Monitor template"
                  options={templateOptions}
                  value={selectedOption}
                  isClearable={false}
                  disabled={isActing || isLoadingFacts}
                  placeholder={
                    isLoadingFacts
                      ? "Reading the templates…"
                      : "Pick a template"
                  }
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    setPickedValue(
                      Array.isArray(value)
                        ? String(value[0] || "")
                        : String(value || ""),
                    );
                  }}
                />
              </div>
              {isTemplateBlocker && pickedTemplate?.unusableReason && (
                <Alert
                  type={AlertType.DANGER}
                  title={pickedTemplate.unusableReason}
                  dataTestId="create-device-monitors-template-unusable"
                />
              )}
              {readsDevicePolls(pickedTemplate) && monitorBackedCount > 0 && (
                <p
                  className="text-xs text-gray-500"
                  data-testid="create-device-monitors-monitor-backed"
                >
                  {translator.translateText(MONITOR_BACKED_DEVICES_NOTE)}
                </p>
              )}
            </div>
          </>
        )}
        {isOnProgress && (
          <>
            {polling.error && (
              <Alert
                type={AlertType.WARNING}
                title={
                  <ErrorSentence
                    template="Showing the last progress received. Retrying: {{error}}"
                    error={polling.error}
                  />
                }
                dataTestId="create-device-monitors-poll-error"
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
                {translator.translateText("Reading where it stands…")}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};

export default CreateDeviceMonitorsDialog;
