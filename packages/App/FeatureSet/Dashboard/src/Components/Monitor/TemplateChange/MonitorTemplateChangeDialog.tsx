import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorTemplate from "Common/Models/DatabaseModels/MonitorTemplate";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  MonitorTemplateChangeKind,
  MonitorTemplateChangeView,
  MonitorTemplateLinkResult,
  isMonitorTemplateChangeActive,
} from "Common/Types/Monitor/MonitorTemplateChange";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Modal, {
  ModalSecondaryButton,
  ModalWidth,
} from "Common/UI/Components/Modal/Modal";
import RadioButtons from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Toast from "Common/UI/Utils/Toast";
import {
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
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
  getMonitorTemplateChange,
  retryMonitorTemplateChange,
  startMonitorTemplateChange,
  stopMonitorTemplateChange,
  unlinkOneMonitor,
} from "./MonitorTemplateChangeApi";
import {
  APPLY_SETTINGS_DESCRIPTION,
  APPLY_SETTINGS_TITLE,
  MonitorTemplateChangePhase,
  NEVER_MADE_AGAIN,
  RETRY_BUTTON,
  SETTINGS_KEPT,
  SETTINGS_REPLACED,
  UNLINK_CHOICE_DESCRIPTIONS,
  UNLINK_CHOICE_TITLES,
  UnlinkChoice,
  WHAT_STAYS,
  getMonitorTemplateChangePhase,
  isMonitorTemplateChangePhaseActive,
} from "./MonitorTemplateChangeModel";
import MonitorTemplateChangeProgress from "./MonitorTemplateChangeProgress";
import useMonitorTemplateChangePolling, {
  MonitorTemplateChangePolling,
} from "./useMonitorTemplateChangePolling";

/*
 * CHANGING MONITORS' TEMPLATE, ONE OR TEN THOUSAND (issues #11260, #11266).
 *
 *   - Move to Another Template (a template's Linked Monitors) and Link to
 *     Template (the Monitors list): pick the template, keep "Use the
 *     template's criteria and interval" on or switch it off, and read what
 *     changes before anything does.
 *   - Unlink from Template: keep the settings as the monitor's own, or clear
 *     the template's criteria - the two choices the people moving a fleet
 *     asked for.
 *   - A template's Delete that clears its criteria from its monitors first
 *     (asked in the delete's own dialog: MonitorTemplateDeleteChoice): its
 *     progress, until the template is gone.
 *
 * One monitor unlinked from its row changes at once. Anything more runs on
 * the server as a change (MonitorTemplateChangeRunner) and the dialog becomes
 * its progress: Stop while it runs, Retry for what failed, and closing it
 * never stops it.
 */

export enum MonitorTemplateChangeDialogMode {
  Move = "move",
  LinkTo = "linkTo",
  Unlink = "unlink",
  /*
   * A change already asked for (Link Existing Monitors, a Delete that clears
   * its monitors first), or one still running.
   */
  Progress = "progress",
}

export interface MonitorTemplateChangeDialogTemplate {
  id: string;
  name: string;
  monitorType?: MonitorType | undefined;
}

export interface ComponentProps {
  mode: MonitorTemplateChangeDialogMode;
  // The monitors picked: Move, Link to Template, Unlink.
  monitors?: Array<Monitor> | undefined;
  /*
   * The template the dialog is about: the one the monitors move off (Move),
   * or are unlinked from (Unlink: none on the Monitors list, which unlinks
   * each from its own).
   */
  template?: MonitorTemplateChangeDialogTemplate | undefined;
  // Progress: the change to show.
  changeId?: string | undefined;
  onClose: () => void;
  // Something changed: the lists and counts should be read again.
  onChanged?: (() => void) | undefined;
  // A change that deleted its template has: the template's page is gone.
  onTemplateDeleted?: (() => void) | undefined;
}

// The templates a picker offers, read once, by name.
const TEMPLATE_LIST_LIMIT: number = 1000;

const MonitorTemplateChangeDialog: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const monitors: Array<Monitor> = props.monitors || [];
  const monitorIds: Array<string> = useMemo((): Array<string> => {
    return monitors.flatMap((monitor: Monitor): Array<string> => {
      return monitor.id ? [monitor.id.toString()] : [];
    });
  }, [monitors]);
  const count: number = monitorIds.length;

  const [changeId, setChangeId] = useState<string | null>(
    props.changeId || null,
  );
  const [isActing, setIsActing] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string>("");
  const [now, setNow] = useState<number>(Date.now());

  // Move and Link to Template.
  const [templates, setTemplates] = useState<Array<MonitorTemplate>>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState<boolean>(false);
  const [templatesError, setTemplatesError] = useState<string>("");
  const [pickedTemplateId, setPickedTemplateId] = useState<string>("");
  const [applyTemplateSettings, setApplyTemplateSettings] =
    useState<boolean>(true);

  // Unlink.
  const [unlinkChoice, setUnlinkChoice] = useState<string>(
    UnlinkChoice.KeepSettings,
  );

  const isPicking: boolean =
    props.mode === MonitorTemplateChangeDialogMode.Move ||
    props.mode === MonitorTemplateChangeDialogMode.LinkTo;

  useEffect(() => {
    if (!isPicking) {
      return;
    }

    let isCancelled: boolean = false;
    setIsLoadingTemplates(true);

    ModelAPI.getList<MonitorTemplate>({
      modelType: MonitorTemplate,
      query:
        props.mode === MonitorTemplateChangeDialogMode.Move &&
        props.template?.monitorType
          ? { monitorType: props.template.monitorType }
          : {},
      limit: TEMPLATE_LIST_LIMIT,
      skip: 0,
      select: { _id: true, templateName: true, monitorType: true },
      sort: { templateName: SortOrder.Ascending },
    })
      .then((result: ListResult<MonitorTemplate>) => {
        if (isCancelled) {
          return;
        }

        setTemplates(
          result.data.filter((template: MonitorTemplate): boolean => {
            return template.id?.toString() !== props.template?.id;
          }),
        );
      })
      .catch((err: unknown) => {
        if (!isCancelled) {
          setTemplatesError(API.getFriendlyMessage(err));
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingTemplates(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isPicking]);

  // The progress reads how long the change has waited to start.
  useEffect(() => {
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      setNow(Date.now());
    }, 5000);

    return () => {
      clearInterval(timer);
    };
  }, []);

  const onFinished: (view: MonitorTemplateChangeView) => void = useCallback(
    (view: MonitorTemplateChangeView): void => {
      props.onChanged?.();

      if (view.isTemplateDeleted) {
        Toast.success(
          translator.translateTemplate("{{templateName}} was deleted.", {
            templateName:
              view.monitorTemplateName || translatableTerm("The template"),
          }),
        );
      }
    },
    [props.onChanged],
  );

  const polling: MonitorTemplateChangePolling = useMonitorTemplateChangePolling(
    {
      changeId: changeId,
      onFinished: onFinished,
    },
  );

  /*
   * While a change runs, its view carries its first lines only. Once it is
   * done, every line is read once, so each group of what was left out or
   * failed counts all its monitors - three thousand refused for one reason
   * read as three thousand, not as the first two hundred.
   */
  const allLinesReadFor: React.MutableRefObject<string | null> = useRef<
    string | null
  >(null);
  // The change shown now: a retry started since shows its own lines.
  const shownChangeId: React.MutableRefObject<string | null> = useRef<
    string | null
  >(changeId);
  shownChangeId.current = changeId;

  useEffect(() => {
    const finished: MonitorTemplateChangeView | null = polling.view;

    if (
      !finished ||
      isMonitorTemplateChangeActive(finished.status) ||
      !finished.isLinesTruncated ||
      allLinesReadFor.current === finished.id
    ) {
      return;
    }

    allLinesReadFor.current = finished.id;

    getMonitorTemplateChange(finished.id, { allLines: true })
      .then((complete: MonitorTemplateChangeView) => {
        if (shownChangeId.current === complete.id) {
          polling.setView(complete);
        }
      })
      .catch(() => {
        // The first lines stay, and the list says it shows only those.
      });
  }, [polling.view]);

  const pickedTemplate: MonitorTemplate | undefined = templates.find(
    (template: MonitorTemplate): boolean => {
      return template.id?.toString() === pickedTemplateId;
    },
  );

  // Link to Template: the monitors of another type than the template's are left out.
  const ofPickedType: number = pickedTemplate?.monitorType
    ? monitors.filter((monitor: Monitor): boolean => {
        return monitor.monitorType === pickedTemplate.monitorType;
      }).length
    : count;

  const startChange: (request: {
    kind: MonitorTemplateChangeKind;
    monitorTemplateId?: string | undefined;
    applyTemplateSettings?: boolean | undefined;
    clearTemplateSettings?: boolean | undefined;
  }) => Promise<void> = async (request: {
    kind: MonitorTemplateChangeKind;
    monitorTemplateId?: string | undefined;
    applyTemplateSettings?: boolean | undefined;
    clearTemplateSettings?: boolean | undefined;
  }): Promise<void> => {
    const started: MonitorTemplateChangeView = await startMonitorTemplateChange(
      {
        monitorTemplateId: request.monitorTemplateId,
        settings: {
          kind: request.kind,
          applyTemplateSettings: request.applyTemplateSettings === true,
          clearTemplateSettings: request.clearTemplateSettings === true,
          deleteTemplateWhenDone: false,
        },
        monitorIds: monitorIds,
      },
    );

    polling.setView(started);
    setChangeId(started.id);
  };

  const submit: () => Promise<void> = async (): Promise<void> => {
    if (isActing) {
      return;
    }

    setIsActing(true);
    setActionError("");

    try {
      if (isPicking) {
        await startChange({
          kind: MonitorTemplateChangeKind.Link,
          monitorTemplateId: pickedTemplateId,
          applyTemplateSettings: applyTemplateSettings,
        });
      } else if (props.mode === MonitorTemplateChangeDialogMode.Unlink) {
        const isClearing: boolean = unlinkChoice === UnlinkChoice.ClearCriteria;

        // One monitor from its template's row: at once, no change to watch.
        if (count === 1 && props.template?.id) {
          const result: MonitorTemplateLinkResult = await unlinkOneMonitor({
            monitorTemplateId: props.template.id,
            monitorId: monitorIds[0]!,
            clearTemplateSettings: isClearing,
          });

          const resolved: number =
            result.resolvedIncidentCount + result.resolvedAlertCount;

          Toast.success(
            !isClearing
              ? (translator.translateText(
                  "Unlinked. The monitor keeps its settings as its own.",
                ) as string)
              : resolved === 0
                ? (translator.translateText(
                    "Unlinked, and its criteria cleared.",
                  ) as string)
                : translator.translatePlural(
                    {
                      one: "Unlinked, and its criteria cleared. {{count}} open incident or alert was resolved.",
                      other:
                        "Unlinked, and its criteria cleared. {{count}} open incidents and alerts were resolved.",
                    },
                    resolved,
                    { count: translator.formatNumber(resolved) },
                  ),
          );
          props.onChanged?.();
          props.onClose();
          return;
        }

        await startChange({
          kind: MonitorTemplateChangeKind.Unlink,
          monitorTemplateId: props.template?.id,
          clearTemplateSettings: isClearing,
        });
      }
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    } finally {
      setIsActing(false);
    }
  };

  const stop: () => Promise<void> = async (): Promise<void> => {
    if (!changeId || isActing) {
      return;
    }

    setIsActing(true);
    setActionError("");

    try {
      polling.setView(await stopMonitorTemplateChange(changeId));
      void polling.refresh();
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    } finally {
      setIsActing(false);
    }
  };

  const retry: () => Promise<void> = async (): Promise<void> => {
    if (!changeId || isActing) {
      return;
    }

    setIsActing(true);
    setActionError("");

    try {
      const retried: MonitorTemplateChangeView =
        await retryMonitorTemplateChange(changeId);

      polling.setView(retried);
      setChangeId(retried.id);
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    } finally {
      setIsActing(false);
    }
  };

  const view: MonitorTemplateChangeView | null = polling.view;
  const isOnProgress: boolean = Boolean(changeId);
  const phase: MonitorTemplateChangePhase | null = view
    ? getMonitorTemplateChangePhase(view, now)
    : null;
  const isActive: boolean = phase
    ? isMonitorTemplateChangePhaseActive(phase)
    : isOnProgress;

  // ---- The dialog's title, buttons and what they do.

  let title: string = translationKey("Change Monitors' Template");
  let submitButtonText: string | undefined = undefined;
  let submitButtonStyleType: ButtonStyleType = ButtonStyleType.PRIMARY;
  let isSubmitDisabled: boolean = false;
  let onSubmit: (() => void) | undefined = undefined;
  let secondaryButton: ModalSecondaryButton | undefined = undefined;
  let closeButtonText: string = translationKey("Cancel");
  let closeButtonStyleType: ButtonStyleType | undefined = undefined;

  switch (props.mode) {
    case MonitorTemplateChangeDialogMode.Move:
      title = translationKey("Move to Another Template");
      break;
    case MonitorTemplateChangeDialogMode.LinkTo:
      title = translationKey("Link to Template");
      break;
    case MonitorTemplateChangeDialogMode.Unlink:
      title =
        count === 1
          ? translationKey("Unlink Monitor from Template")
          : translationKey("Unlink Monitors from Template");
      break;
    default:
      title = translationKey("Change Monitors' Template");
  }

  if (!isOnProgress) {
    onSubmit = () => {
      void submit();
    };

    if (isPicking) {
      submitButtonText =
        props.mode === MonitorTemplateChangeDialogMode.Move
          ? translator.translatePlural(
              {
                one: "Move {{count}} Monitor",
                other: "Move {{count}} Monitors",
              },
              count,
              { count: translator.formatNumber(count) },
            )
          : translator.translatePlural(
              {
                one: "Link {{count}} Monitor",
                other: "Link {{count}} Monitors",
              },
              ofPickedType,
              { count: translator.formatNumber(ofPickedType) },
            );
      isSubmitDisabled =
        !pickedTemplateId || isLoadingTemplates || ofPickedType === 0;
    } else if (props.mode === MonitorTemplateChangeDialogMode.Unlink) {
      const isClearing: boolean = unlinkChoice === UnlinkChoice.ClearCriteria;

      submitButtonText = isClearing
        ? translator.translatePlural(
            {
              one: "Unlink and Clear",
              other: "Unlink and Clear {{count}} Monitors",
            },
            count,
            { count: translator.formatNumber(count) },
          )
        : translator.translatePlural(
            { one: "Unlink", other: "Unlink {{count}} Monitors" },
            count,
            { count: translator.formatNumber(count) },
          );
      submitButtonStyleType = isClearing
        ? ButtonStyleType.DANGER
        : ButtonStyleType.PRIMARY;
      isSubmitDisabled = count === 0;
    }
  } else if (view) {
    closeButtonText = translationKey("Close");

    if (isActive) {
      if (!view.isStopRequested) {
        secondaryButton = {
          title: translationKey("Stop"),
          dataTestId: "monitor-template-change-stop",
          disabled: isActing,
          onClick: () => {
            void stop();
          },
        };
      }
    } else if (view.retryableCount > 0) {
      submitButtonText = translator.translatePlural(
        RETRY_BUTTON,
        view.retryableCount,
        { count: translator.formatNumber(view.retryableCount) },
      );
      onSubmit = () => {
        void retry();
      };
    } else {
      closeButtonText = translationKey("Done");
      closeButtonStyleType = ButtonStyleType.PRIMARY;
    }
  }

  const onClose: () => void = (): void => {
    if (view?.isTemplateDeleted) {
      props.onTemplateDeleted?.();
      return;
    }

    props.onClose();
  };

  // ---- What the choosing step says.

  const selectionLine: ReactElement | null =
    count === 0 ? null : count === 1 && monitors[0]?.name ? (
      <p className="text-sm text-gray-600">
        <IsolatedText text={monitors[0].name} />
      </p>
    ) : (
      <p className="text-sm text-gray-600">
        {translator.translatePlural(
          {
            one: "{{count}} monitor selected",
            other: "{{count}} monitors selected",
          },
          count,
          { count: translator.formatNumber(count) },
        )}
      </p>
    );

  const whatChanges: Array<string> = isPicking
    ? [
        translator.translatePlural(
          applyTemplateSettings ? SETTINGS_REPLACED : SETTINGS_KEPT,
          count,
        ),
        translator.translatePlural(WHAT_STAYS, count),
        translator.translatePlural(NEVER_MADE_AGAIN, count),
      ]
    : props.mode === MonitorTemplateChangeDialogMode.Unlink
      ? [
          translator.translatePlural(WHAT_STAYS, count),
          translator.translatePlural(NEVER_MADE_AGAIN, count),
        ]
      : [];

  const templateOptions: Array<DropdownOption | DropdownOptionGroup> =
    useMemo((): Array<DropdownOption | DropdownOptionGroup> => {
      const toOption: (template: MonitorTemplate) => DropdownOption = (
        template: MonitorTemplate,
      ): DropdownOption => {
        return {
          value: template.id!.toString(),
          label: template.templateName || template.id!.toString(),
        };
      };

      if (props.mode === MonitorTemplateChangeDialogMode.Move) {
        return templates.map(toOption);
      }

      // Link to Template: the templates of each type together.
      const byType: Map<string, Array<DropdownOption>> = new Map<
        string,
        Array<DropdownOption>
      >();

      for (const template of templates) {
        const type: string = template.monitorType || "";
        const options: Array<DropdownOption> = byType.get(type) || [];
        options.push(toOption(template));
        byType.set(type, options);
      }

      return Array.from(byType.entries()).map(
        ([type, options]: [string, Array<DropdownOption>]) => {
          return {
            label: type
              ? (translator.translateText(
                  MonitorTypeHelper.getTitle(type as MonitorType),
                ) as string)
              : (translator.translateText("Other") as string),
            options: options,
          };
        },
      );
    }, [templates, props.mode]);

  const selectedOption: DropdownOption | undefined = templateOptions
    .flatMap(
      (option: DropdownOption | DropdownOptionGroup): Array<DropdownOption> => {
        return "options" in option ? option.options : [option];
      },
    )
    .find((option: DropdownOption): boolean => {
      return option.value === pickedTemplateId;
    });

  return (
    <Modal
      title={title}
      modalWidth={ModalWidth.Medium}
      isLoading={isActing && !isOnProgress}
      error={actionError || undefined}
      onClose={onClose}
      closeButtonText={closeButtonText}
      disableCloseOnBackdropClick={true}
      {...(secondaryButton ? { secondaryButton: secondaryButton } : {})}
      {...(submitButtonText ? { submitButtonText: submitButtonText } : {})}
      {...(onSubmit ? { onSubmit: onSubmit } : {})}
      disableSubmitButton={isSubmitDisabled}
      submitButtonStyleType={submitButtonStyleType}
      {...(closeButtonStyleType !== undefined
        ? { closeButtonStyleType: closeButtonStyleType }
        : {})}
    >
      <div className="space-y-4" data-testid="monitor-template-change-dialog">
        {!isOnProgress && isPicking && (
          <>
            {selectionLine}
            {templatesError && (
              <Alert
                type={AlertType.DANGER}
                title={templatesError}
                dataTestId="monitor-template-change-templates-error"
              />
            )}
            <div>
              <FieldLabelElement
                title="Template"
                required={true}
                hideOptionalLabel={true}
                description={
                  props.mode === MonitorTemplateChangeDialogMode.Move
                    ? translator.translateTemplate(
                        "{{monitorType}} templates, other than this one.",
                        {
                          monitorType: translatableTerm(
                            MonitorTypeHelper.getTitle(
                              props.template?.monitorType || MonitorType.Manual,
                            ),
                          ),
                        },
                      )
                    : translator.translateText(
                        "A monitor of another type than the template's is left out.",
                      )
                }
              />
              <Dropdown
                id="monitor-template-change-template"
                dataTestId="monitor-template-change-template"
                ariaLabel="Template"
                options={templateOptions}
                value={selectedOption}
                isClearable={false}
                disabled={isActing || isLoadingTemplates}
                placeholder={
                  isLoadingTemplates
                    ? "Reading the templates…"
                    : "Pick a template"
                }
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  setPickedTemplateId(
                    Array.isArray(value)
                      ? String(value[0] || "")
                      : String(value || ""),
                  );
                }}
              />
              {!isLoadingTemplates &&
                !templatesError &&
                templates.length === 0 && (
                  <p className="mt-2 text-sm text-gray-500">
                    {translator.translateText(
                      "There is no other template of this type yet. Create one under Monitors > Settings > Templates.",
                    )}
                  </p>
                )}
              {props.mode === MonitorTemplateChangeDialogMode.LinkTo &&
                pickedTemplate &&
                ofPickedType < count && (
                  <p
                    className="mt-2 text-sm text-amber-700"
                    data-testid="monitor-template-change-other-types"
                  >
                    {translator.translatePlural(
                      {
                        one: "{{count}} of the selected monitors is of another type and is left out.",
                        other:
                          "{{count}} of the selected monitors are of another type and are left out.",
                      },
                      count - ofPickedType,
                      { count: translator.formatNumber(count - ofPickedType) },
                    )}
                  </p>
                )}
            </div>
            <Toggle
              title={translator.translateText(APPLY_SETTINGS_TITLE) as string}
              description={
                translator.translateText(APPLY_SETTINGS_DESCRIPTION) as string
              }
              value={applyTemplateSettings}
              dataTestId="monitor-template-change-apply"
              onChange={(value: boolean) => {
                setApplyTemplateSettings(value);
              }}
            />
          </>
        )}

        {!isOnProgress &&
          props.mode === MonitorTemplateChangeDialogMode.Unlink && (
            <>
              {selectionLine}
              <RadioButtons
                dataTestId="monitor-template-change-unlink-choice"
                initialValue={UnlinkChoice.KeepSettings}
                onChange={(value: string) => {
                  setUnlinkChoice(value || UnlinkChoice.KeepSettings);
                }}
                options={[
                  UnlinkChoice.KeepSettings,
                  UnlinkChoice.ClearCriteria,
                ].map((choice: UnlinkChoice) => {
                  return {
                    value: choice,
                    title: translator.translatePlural(
                      UNLINK_CHOICE_TITLES[choice],
                      count,
                    ),
                    description: translator.translatePlural(
                      UNLINK_CHOICE_DESCRIPTIONS[choice],
                      count,
                    ),
                  };
                })}
              />
            </>
          )}

        {!isOnProgress && whatChanges.length > 0 && (
          <ul
            className="list-disc space-y-1 ps-5 text-sm text-gray-600"
            data-testid="monitor-template-change-what-changes"
          >
            {whatChanges.map((line: string, index: number) => {
              return <li key={index}>{line}</li>;
            })}
          </ul>
        )}

        {isOnProgress && (
          <>
            {polling.error && (
              <Alert
                type={AlertType.WARNING}
                title={polling.error}
                dataTestId="monitor-template-change-poll-error"
              />
            )}
            {view ? (
              <MonitorTemplateChangeProgress view={view} now={now} />
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

export default MonitorTemplateChangeDialog;

// Whether a change shown in the dialog has finished (for the pages around it).
export function isChangeFinished(view: MonitorTemplateChangeView): boolean {
  return !isMonitorTemplateChangeActive(view.status);
}
