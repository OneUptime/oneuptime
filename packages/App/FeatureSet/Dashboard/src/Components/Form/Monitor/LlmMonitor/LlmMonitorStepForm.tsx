import MonitorStepLlmMonitor, {
  LLM_MONITOR_WINDOW_OPTIONS,
  MonitorStepLlmMonitorUtil,
} from "Common/Types/Monitor/MonitorStepLlmMonitor";
import Service from "Common/Models/DatabaseModels/Service";
import ObjectID from "Common/Types/ObjectID";
import {
  LlmAnswerIssue,
  LlmAnswerIssueUtil,
} from "Common/Types/Telemetry/LlmAnswerIssue";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import HorizontalRule from "Common/UI/Components/HorizontalRule/HorizontalRule";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { LLM_ISSUE_STYLES } from "../../../LlmConversations/LlmConversationCopy";
import LlmMonitorPreview from "../../../LlmAlerts/LlmMonitorPreview";

/*
 * The settings of an AI / LLM monitor, in the words of the question it
 * answers - "tell me when the AI answers badly":
 *
 *   - which problems make an answer bad (all five by default);
 *   - whether a slow answer is bad too, and how slow;
 *   - how far back each check looks;
 *   - which apps it watches (every app by default);
 *   - under More fields, one model only.
 *
 * Under the settings, what the monitor would count right now.
 */

export interface ComponentProps {
  monitorStepLlmMonitor: MonitorStepLlmMonitor;
  onMonitorStepLlmMonitorChanged: (value: MonitorStepLlmMonitor) => void;
  telemetryServices: Array<Service>;
}

export interface LlmMonitorFormValues {
  issues: Array<string>;
  slowAnswerSeconds: number | string | undefined;
  lastXSecondsOfCalls: number;
  telemetryServiceIds: Array<string>;
  model: string;
}

const MORE_LLM_MONITOR_FIELDS: FormFieldCollapsibleSection<LlmMonitorFormValues> =
  getAdvancedFormSection<LlmMonitorFormValues>();

export const LLM_MONITOR_WINDOW_LABELS: Record<number, string> = {
  300: translationKey("Last 5 minutes"),
  900: translationKey("Last 15 minutes"),
  1800: translationKey("Last 30 minutes"),
  3600: translationKey("Last 1 hour"),
  21600: translationKey("Last 6 hours"),
  86400: translationKey("Last 24 hours"),
};

export function getLlmMonitorWindowOptions(
  current: number,
): Array<DropdownOption> {
  const seconds: Array<number> = [...LLM_MONITOR_WINDOW_OPTIONS];

  // A window set through the API keeps its place in the list.
  if (!seconds.includes(current)) {
    seconds.push(current);
    seconds.sort((left: number, right: number): number => {
      return left - right;
    });
  }

  return seconds.map((value: number): DropdownOption => {
    return {
      label: LLM_MONITOR_WINDOW_LABELS[value] || `${value}s`,
      value: value,
    };
  });
}

export function getLlmIssueOptions(): Array<DropdownOption> {
  return LlmAnswerIssueUtil.getAllIssues().map(
    (issue: LlmAnswerIssue): DropdownOption => {
      return {
        label: LLM_ISSUE_STYLES[issue].title,
        value: issue,
      };
    },
  );
}

export function toLlmMonitorFormValues(
  monitor: MonitorStepLlmMonitor,
): LlmMonitorFormValues {
  const normalized: MonitorStepLlmMonitor = MonitorStepLlmMonitorUtil.fromJSON(
    MonitorStepLlmMonitorUtil.toJSON(monitor),
  );

  return {
    issues: normalized.issues,
    slowAnswerSeconds:
      normalized.slowAnswerSeconds > 0 ? normalized.slowAnswerSeconds : "",
    lastXSecondsOfCalls: normalized.lastXSecondsOfCalls,
    telemetryServiceIds: normalized.telemetryServiceIds.map(
      (id: ObjectID): string => {
        return id.toString();
      },
    ),
    model: normalized.model,
  };
}

export function toLlmMonitorConfig(
  values: LlmMonitorFormValues,
): MonitorStepLlmMonitor {
  const slowAnswerSeconds: number = Number(values.slowAnswerSeconds);

  return MonitorStepLlmMonitorUtil.fromJSON({
    issues: Array.isArray(values.issues) ? values.issues : [],
    slowAnswerSeconds:
      Number.isFinite(slowAnswerSeconds) && slowAnswerSeconds > 0
        ? slowAnswerSeconds
        : 0,
    lastXSecondsOfCalls: Number(values.lastXSecondsOfCalls),
    telemetryServiceIds: (values.telemetryServiceIds || []).filter(
      (id: string): boolean => {
        return Boolean(id);
      },
    ),
    model: values.model || "",
  });
}

const LlmMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [formValues, setFormValues] = useState<LlmMonitorFormValues>(
    toLlmMonitorFormValues(props.monitorStepLlmMonitor),
  );

  useEffect(() => {
    setFormValues(toLlmMonitorFormValues(props.monitorStepLlmMonitor));
  }, [props.monitorStepLlmMonitor]);

  const config: MonitorStepLlmMonitor = toLlmMonitorConfig(formValues);

  return (
    <div>
      <BasicForm
        id="llm-monitor-filter"
        hideSubmitButton={true}
        initialValues={formValues}
        onChange={(values: LlmMonitorFormValues) => {
          setFormValues(values);
          props.onMonitorStepLlmMonitorChanged(toLlmMonitorConfig(values));
        }}
        fields={[
          {
            field: {
              issues: true,
            },
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownOptions: getLlmIssueOptions(),
            title: "Count an answer as bad when it",
            description:
              "Failed: the call ended in an error. Refused: the AI declined, or a safety filter blocked the answer. Cut off: it hit the token limit. Empty: no text and no tool call. Flagged: an evaluation your app sent said it was bad.",
            hideOptionalLabel: true,
          },
          {
            field: {
              slowAnswerSeconds: true,
            },
            fieldType: FormFieldSchemaType.Number,
            title: "Or takes longer than (seconds)",
            description:
              "Leave empty to ignore how long answers take. With no problem picked above, only slow answers count.",
            placeholder: "30",
            hideOptionalLabel: true,
          },
          {
            field: {
              lastXSecondsOfCalls: true,
            },
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: getLlmMonitorWindowOptions(
              formValues.lastXSecondsOfCalls,
            ),
            title: "Look at answers from the",
            description: "Each check counts the answers in this window.",
            hideOptionalLabel: true,
          },
          {
            field: {
              telemetryServiceIds: true,
            },
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownOptions: props.telemetryServices.map(
              (service: Service): DropdownOption => {
                return {
                  label: service.name || "",
                  value: service.id?.toString() || "",
                };
              },
            ),
            title: "Apps",
            description:
              "The apps whose AI answers count. Leave empty to watch every app.",
            hideOptionalLabel: true,
          },
          {
            field: {
              model: true,
            },
            fieldType: FormFieldSchemaType.Text,
            title: "Model",
            description:
              "Only count answers from this model, as your app reports it (for example gpt-4o). Leave empty for every model.",
            placeholder: "gpt-4o",
            hideOptionalLabel: true,
            collapsibleSection: MORE_LLM_MONITOR_FIELDS,
          },
        ]}
      />
      <div>
        <HorizontalRule />
        <FieldLabelElement
          title="Preview"
          description="What this monitor would count right now, so you can check the settings before you save."
          hideOptionalLabel={true}
          isHeading={true}
        />
        <div className="mt-5 mb-5">
          <LlmMonitorPreview step={config} />
        </div>
      </div>
    </div>
  );
};

export default LlmMonitorStepForm;
