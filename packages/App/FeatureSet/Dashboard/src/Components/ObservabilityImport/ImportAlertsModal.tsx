import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useRef,
  useState,
} from "react";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import IconProp from "Common/Types/Icon/IconProp";
import { FilterType } from "Common/Types/Monitor/CriteriaFilter";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import {
  AlertImportItem,
  AlertImportPlan,
  ImportItemStatus,
  ImportSourceKind,
  ImportedAlertRule,
  ImportedAlertSeverity,
} from "Common/Types/ObservabilityImport/ObservabilityImport";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import { getUniqueName } from "Common/UI/Components/Forms/Utils/UniqueName";
import {
  SteppedModalFooter,
  getSteppedModalFooter,
} from "Common/UI/Components/Forms/Utils/SteppedFormFooter";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import Toast from "Common/UI/Utils/Toast";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  AlertImportAction,
  AlertImportSeeds,
  buildImportedMonitorSteps,
} from "Common/Utils/ObservabilityImport/AlertImportMonitorBuilder";
import { DatadogMetricKind } from "Common/Utils/ObservabilityImport/Datadog/DatadogPromQL";
import {
  ALERT_SOURCE_KINDS,
  ImportReadError,
  ImportSourceDocument,
  readImportSource,
} from "Common/Utils/ObservabilityImport/ImportSource";
import {
  listDatadogMetricNames,
  planAlertImport,
} from "Common/Utils/ObservabilityImport/ObservabilityImport";
import {
  ImportFileField,
  ImportItemRow,
  ImportNoteList,
  ImportQueryCode,
  ImportSection,
  ImportSummary,
} from "./ImportParts";
import {
  ImportAiTarget,
  fetchMonitorNames,
  loadAlertImportSeeds,
  lookUpDatadogMetricKinds,
} from "./ObservabilityImportApi";

/*
 * IMPORT ALERTS (issue #7697): Monitors > ⋯.
 *
 * Two steps. The file: a Prometheus rule file (or PrometheusRule), Grafana's
 * export of its alert rules, or Datadog monitors exported as JSON, pasted or
 * uploaded - read here, in the browser. Then the preview: every rule, with
 * the monitor it becomes and how exactly, ticked to import unless it is not
 * converted or the source has it paused; whether a firing rule opens an
 * alert (the default, as Alertmanager pages) or an incident; and Create.
 *
 * Each ticked rule becomes a Metrics monitor with one PromQL step, created
 * one after the other through the same create the monitor form uses, with
 * the person's own permissions: a project's limit on active monitors, a
 * name taken meanwhile, refuse one and say so, and the rest are created.
 */

export interface ComponentProps {
  onClose: () => void;
  // Called once monitors were created, so the list can show them.
  onImported: (count: number) => void;
}

enum ImportStep {
  File = "file",
  Preview = "preview",
}

// A monitor's name is short text.
const NAME_MAX_LENGTH: number = 100;

const SOURCE_NAMES: Readonly<Partial<Record<ImportSourceKind, string>>> = {
  [ImportSourceKind.PrometheusRules]: translationKey("Prometheus rules"),
  [ImportSourceKind.GrafanaAlertRules]: translationKey("Grafana alert rules"),
  [ImportSourceKind.DatadogMonitors]: translationKey("Datadog monitors"),
};

const ACTION_OPTIONS: Array<DropdownOption> = [
  { label: translationKey("Open an alert"), value: AlertImportAction.Alert },
  {
    label: translationKey("Open an incident"),
    value: AlertImportAction.Incident,
  },
];

// When a rule fires, as one sentence per comparison.
const CONDITION_SENTENCES: Readonly<Partial<Record<FilterType, string>>> = {
  [FilterType.GreaterThan]: translationKey("Alerts above {{threshold}}"),
  [FilterType.GreaterThanOrEqualTo]: translationKey(
    "Alerts at or above {{threshold}}",
  ),
  [FilterType.LessThan]: translationKey("Alerts below {{threshold}}"),
  [FilterType.LessThanOrEqualTo]: translationKey(
    "Alerts at or below {{threshold}}",
  ),
  [FilterType.EqualTo]: translationKey("Alerts at {{threshold}}"),
  [FilterType.NotEqualTo]: translationKey(
    "Alerts at anything but {{threshold}}",
  ),
};

interface CreateFailure {
  name: string;
  error: string;
}

const ImportAlertsModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [step, setStep] = useState<ImportStep>(ImportStep.File);
  const [text, setText] = useState<string>("");
  const [fileError, setFileError] = useState<string>("");
  const [source, setSource] = useState<ImportSourceDocument | null>(null);
  const [overrides, setOverrides] = useState<Map<string, string>>(
    new Map<string, string>(),
  );
  const [metricKinds, setMetricKinds] = useState<
    Map<string, DatadogMetricKind>
  >(new Map<string, DatadogMetricKind>());
  const [takenNames, setTakenNames] = useState<Array<string>>([]);
  const [unticked, setUnticked] = useState<Set<string>>(new Set<string>());
  const [action, setAction] = useState<AlertImportAction>(
    AlertImportAction.Alert,
  );
  const [isReading, setIsReading] = useState<boolean>(false);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [failures, setFailures] = useState<Array<CreateFailure>>([]);
  const [error, setError] = useState<string>("");
  const isCreatingRef: React.MutableRefObject<boolean> = useRef<boolean>(false);

  const plan: AlertImportPlan | null = useMemo(() => {
    return source
      ? planAlertImport(source, {
          queryOverrides: overrides,
          knownMetricKinds: metricKinds,
        })
      : null;
  }, [source, overrides, metricKinds]);

  /*
   * Each rule's monitor name, unique in the project and in the import:
   * "NodeDown", then "NodeDown 2".
   */
  const names: Map<string, string> = useMemo(() => {
    const map: Map<string, string> = new Map<string, string>();
    const taken: Array<string> = [...takenNames];

    for (const item of plan?.items || []) {
      const name: string = getUniqueName({
        name: (item.name || "Imported alert rule").slice(0, NAME_MAX_LENGTH),
        existingNames: taken,
      });

      map.set(item.key, name);
      taken.push(name);
    }

    return map;
  }, [plan, takenNames]);

  const isImportable: (item: AlertImportItem) => boolean = (
    item: AlertImportItem,
  ): boolean => {
    return item.status !== ImportItemStatus.NotConverted && Boolean(item.rule);
  };

  const chosen: Array<AlertImportItem> = useMemo(() => {
    return (plan?.items || []).filter((item: AlertImportItem): boolean => {
      return isImportable(item) && !unticked.has(item.key);
    });
  }, [plan, unticked]);

  const readFile: () => Promise<void> = async (): Promise<void> => {
    let read: ImportSourceDocument;

    try {
      read = readImportSource({ text, accepts: ALERT_SOURCE_KINDS });
    } catch (err) {
      setFileError(
        err instanceof ImportReadError
          ? translator.translateTemplate(err.text, err.values)
          : API.getFriendlyMessage(err),
      );
      return;
    }

    setFileError("");
    setIsReading(true);

    try {
      const [existing, kinds]: [Array<string>, Map<string, DatadogMetricKind>] =
        await Promise.all([
          fetchMonitorNames(),
          lookUpDatadogMetricKinds(listDatadogMetricNames(read)),
        ]);
      const firstPlan: AlertImportPlan = planAlertImport(read, {
        knownMetricKinds: kinds,
      });

      setSource(read);
      setOverrides(new Map<string, string>());
      setMetricKinds(kinds);
      setTakenNames(existing);
      // A rule the source has paused starts unticked.
      setUnticked(
        new Set<string>(
          firstPlan.items
            .filter((item: AlertImportItem): boolean => {
              return !item.isEnabledInSource;
            })
            .map((item: AlertImportItem): string => {
              return item.key;
            }),
        ),
      );
      setFailures([]);
      setError("");
      setStep(ImportStep.Preview);
    } catch (err) {
      setFileError(API.getFriendlyMessage(err));
    }

    setIsReading(false);
  };

  const create: () => Promise<void> = async (): Promise<void> => {
    if (isCreatingRef.current || chosen.length === 0) {
      return;
    }

    isCreatingRef.current = true;
    setIsCreating(true);
    setProgress(0);
    setFailures([]);
    setError("");

    let seeds: AlertImportSeeds;

    try {
      seeds = await loadAlertImportSeeds();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      isCreatingRef.current = false;
      setIsCreating(false);
      return;
    }

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    const failed: Array<CreateFailure> = [];
    const created: Set<string> = new Set<string>();

    for (const item of chosen) {
      const name: string = names.get(item.key) || item.name;
      const rule: ImportedAlertRule = item.rule as ImportedAlertRule;

      try {
        const monitor: Monitor = new Monitor();
        monitor.name = name;
        monitor.monitorType = MonitorType.Metrics;

        if (rule.monitorDescription) {
          monitor.description = rule.monitorDescription;
        }

        if (projectId) {
          monitor.projectId = projectId;
        }

        monitor.monitorSteps = buildImportedMonitorSteps({
          rule,
          monitorName: name,
          seeds,
          action,
        });

        await ModelAPI.create<Monitor>({ model: monitor, modelType: Monitor });
        created.add(item.key);
      } catch (err) {
        failed.push({ name, error: API.getFriendlyMessage(err) });
      }

      setProgress(created.size + failed.length);
    }

    isCreatingRef.current = false;
    setIsCreating(false);

    if (created.size > 0) {
      Toast.success(
        translator.translatePlural(
          {
            one: "{{count}} monitor created.",
            other: "{{count}} monitors created.",
          },
          created.size,
        ),
      );
      props.onImported(created.size);
    }

    if (failed.length === 0) {
      props.onClose();
      return;
    }

    // What was created leaves the list; what failed stays, with why.
    setUnticked((current: Set<string>): Set<string> => {
      const next: Set<string> = new Set<string>(current);
      for (const key of created) {
        next.add(key);
      }
      return next;
    });
    setFailures(failed);
  };

  const renderRuleSummary: (rule: ImportedAlertRule) => ReactElement = (
    rule: ImportedAlertRule,
  ): ReactElement => {
    return (
      <div className="mt-1 space-y-1" data-testid="import-rule-summary">
        <ImportQueryCode query={rule.promQL} />
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600">
          <span>
            {translator.translateTemplate(
              CONDITION_SENTENCES[rule.filterType] ||
                "Alerts above {{threshold}}",
              { threshold: translator.formatNumber(rule.threshold) },
            )}
          </span>
          <span aria-hidden="true">·</span>
          <span>{translator.translateText(rule.rollingTime)}</span>
          <span aria-hidden="true">·</span>
          <span>{translator.translateText(rule.aggregation)}</span>
          <Pill
            text={
              rule.severity === ImportedAlertSeverity.Warning
                ? "Warning"
                : "Critical"
            }
            tone={
              rule.severity === ImportedAlertSeverity.Warning
                ? PillTone.Warning
                : PillTone.Danger
            }
          />
        </div>
      </div>
    );
  };

  const renderItem: (item: AlertImportItem) => ReactElement = (
    item: AlertImportItem,
  ): ReactElement => {
    const importable: boolean = isImportable(item);

    return (
      <ImportItemRow
        key={item.key}
        title={names.get(item.key) || item.name}
        subtitle={[item.group, item.sourceType]
          .filter((part: string): boolean => {
            return part.length > 0;
          })
          .join(" · ")}
        status={item.status}
        notes={item.notes}
        queries={[]}
        control={
          <Toggle
            value={importable && !unticked.has(item.key)}
            disabled={!importable || isCreating}
            ariaLabel={translator.translateTemplate("Import {{name}}", {
              name: names.get(item.key) || item.name,
            })}
            dataTestId="import-rule-toggle"
            onChange={(value: boolean) => {
              const next: Set<string> = new Set<string>(unticked);

              if (value) {
                next.delete(item.key);
              } else {
                next.add(item.key);
              }

              setUnticked(next);
            }}
          />
        }
        extra={item.rule ? renderRuleSummary(item.rule) : undefined}
        ai={
          item.status === ImportItemStatus.NotConverted && item.aiCandidate
            ? {
                candidate: item.aiCandidate,
                target: ImportAiTarget.Monitor,
                onUse: (promQL: string) => {
                  const targetKey: string | undefined =
                    item.aiCandidate?.targetKey;

                  if (targetKey) {
                    const next: Map<string, string> = new Map<string, string>(
                      overrides,
                    );
                    next.set(targetKey, promQL);
                    setOverrides(next);
                  }
                },
              }
            : undefined
        }
      />
    );
  };

  const renderPreviewStep: () => ReactElement = (): ReactElement => {
    if (!plan) {
      return <></>;
    }

    return (
      <div className="space-y-5" data-testid="alerts-import-preview">
        <div className="space-y-2">
          <p className="text-sm text-gray-600">
            {translator.translateText(SOURCE_NAMES[plan.source] || "")}
          </p>
          <ImportSummary
            statuses={plan.items.map(
              (item: AlertImportItem): ImportItemStatus => {
                return item.status;
              },
            )}
          />
          <ImportNoteList notes={plan.notes} />
          <p
            className="text-sm text-gray-700"
            data-testid="alerts-import-count"
            aria-live="polite"
          >
            {isCreating
              ? translator.translateTemplate(
                  "Creating monitor {{done}} of {{total}}…",
                  {
                    done: translator.formatNumber(progress + 1),
                    total: translator.formatNumber(chosen.length),
                  },
                )
              : translator.translatePlural(
                  {
                    one: "{{count}} monitor will be created.",
                    other: "{{count}} monitors will be created.",
                  },
                  chosen.length,
                )}
          </p>
        </div>

        <div>
          <FieldLabelElement
            title="When a rule fires"
            htmlFor="alerts-import-action"
            description="Each series that breaches opens its own, and resolves it when it recovers."
          />
          <Dropdown
            inputId="alerts-import-action"
            options={ACTION_OPTIONS}
            value={ACTION_OPTIONS.find((option: DropdownOption): boolean => {
              return option.value === action;
            })}
            isClearable={false}
            dataTestId="alerts-import-action"
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              if (value === AlertImportAction.Incident) {
                setAction(AlertImportAction.Incident);
              } else {
                setAction(AlertImportAction.Alert);
              }
            }}
          />
        </div>

        {failures.length > 0 ? (
          <div
            className="rounded-md border border-red-100 bg-red-50/50 p-3"
            data-testid="alerts-import-failures"
          >
            <p className="text-sm font-medium text-gray-900">
              {translator.translatePlural(
                {
                  one: "{{count}} monitor was not created:",
                  other: "{{count}} monitors were not created:",
                },
                failures.length,
              )}
            </p>
            <ul className="mt-1 space-y-1">
              {failures.map((failure: CreateFailure, index: number) => {
                return (
                  <li key={`${failure.name}-${index}`} className="text-sm">
                    <span className="font-medium text-gray-900">
                      {failure.name}
                    </span>
                    <span className="text-gray-600">
                      {" "}
                      <ErrorInSentence message={failure.error} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <></>
        )}

        <ImportSection title="Alert rules" dataTestId="alerts-import-items">
          {plan.items.map(renderItem)}
        </ImportSection>
      </div>
    );
  };

  const footer: SteppedModalFooter = getSteppedModalFooter({
    hasSteps: true,
    isOnLastStep: step === ImportStep.Preview,
    onAction:
      chosen.length > 0
        ? (): void => {
            void create();
          }
        : undefined,
    onNext:
      step === ImportStep.File
        ? (): void => {
            void readFile();
          }
        : undefined,
    nextButtonText: "Preview",
    isNextButtonDisabled: !text.trim() || isReading,
  });

  return (
    <Modal
      title="Import Alerts"
      description={
        step === ImportStep.File
          ? "Paste a Prometheus rule file, Grafana's export of its alert rules, or Datadog monitors exported as JSON, or upload the file."
          : "Each rule you keep ticked becomes a Metrics monitor that checks every minute."
      }
      isTitleTranslated={false}
      modalWidth={ModalWidth.Large}
      onClose={isCreating ? undefined : props.onClose}
      error={error || undefined}
      isLoading={isCreating || isReading}
      submitButtonText="Create Monitors"
      onSubmit={footer.onSubmit}
      secondaryButton={footer.secondaryButton}
      leftFooterElement={
        step === ImportStep.Preview ? (
          <Button
            title="Back"
            buttonStyle={ButtonStyleType.OUTLINE}
            icon={IconProp.ChevronLeft}
            disabled={isCreating}
            dataTestId="alerts-import-back"
            onClick={() => {
              setError("");
              setStep(ImportStep.File);
            }}
          />
        ) : (
          <></>
        )
      }
    >
      <div className="min-w-0" data-step={step}>
        {step === ImportStep.File ? (
          <ImportFileField
            id="alerts-import-text"
            label="Alert rules"
            hint="Each alerting rule becomes a Metrics monitor, which opens an alert for each series that breaches."
            value={text}
            error={fileError}
            onChange={(value: string) => {
              setText(value);
              setFileError("");
            }}
          />
        ) : (
          renderPreviewStep()
        )}
      </div>
    </Modal>
  );
};

export default ImportAlertsModal;
