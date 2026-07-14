import CodeEditor from "../CodeEditor/CodeEditor";
import Icon from "../Icon/Icon";
import CodeType from "../../../Types/Code/CodeType";
import IconProp from "../../../Types/Icon/IconProp";
import { validateJson, ValidationResult } from "./JSONArgumentInputUtils";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A JSON editor tailored for Workflow component arguments.
 *
 * Plain JSON arguments used to render as a bare Monaco editor with no
 * feedback: authors only discovered a syntax mistake when the workflow ran
 * and threw a cryptic "Invalid JSON provided for argument …" error (see
 * App/FeatureSet/Workflow/Services/RunWorkflow.ts). This component validates
 * the JSON as you type, is aware of {{ variable }} tokens (which are filled
 * in at runtime and are therefore not literal JSON), and offers one-click
 * formatting — so most mistakes are caught and fixed before the run.
 *
 * The pure validation logic lives in ./JSONArgumentInputUtils so it can be
 * unit tested without a React/Monaco environment.
 */

export interface ComponentProps {
  value: string;
  placeholder?: string | undefined;
  // Form-level error (e.g. "required"), surfaced by the surrounding form.
  error?: string | undefined;
  tabIndex?: number | undefined;
  onChange: (value: string) => void;
  // Reports whether the current content is syntactically invalid JSON.
  onValidationChange?: ((isInvalid: boolean) => void) | undefined;
}

const JSONArgumentInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [validation, setValidation] = useState<ValidationResult>(() => {
    return validateJson(props.value || "");
  });

  useEffect(() => {
    const next: ValidationResult = validateJson(props.value || "");
    setValidation(next);
    props.onValidationChange?.(next.status === "invalid");
  }, [props.value]);

  /*
   * When this field is removed from the tree (e.g. an advanced section is
   * collapsed, or the settings panel closes), stop reporting an error so the
   * surrounding form isn't blocked by a field the user can no longer see.
   */
  useEffect(() => {
    return () => {
      props.onValidationChange?.(false);
    };
  }, []);

  const canFormat: boolean =
    validation.status === "valid" && !validation.hasVariables;

  type FormatJsonFunction = () => void;

  const formatJson: FormatJsonFunction = (): void => {
    try {
      const formatted: string = JSON.stringify(
        JSON.parse(props.value),
        null,
        2,
      );
      props.onChange(formatted);
    } catch {
      // Not valid JSON — nothing to format. Button is disabled in this case.
    }
  };

  type StatusChip = {
    label: string;
    icon: IconProp;
    className: string;
  };

  const getStatusChip: () => StatusChip | null = (): StatusChip | null => {
    switch (validation.status) {
      case "valid":
        return {
          label: validation.hasVariables
            ? "Valid JSON · uses variables"
            : "Valid JSON",
          icon: IconProp.CheckCircle,
          className: "text-green-600",
        };
      case "invalid":
        return {
          label: "Invalid JSON",
          icon: IconProp.Error,
          className: "text-red-600",
        };
      case "variable":
        return {
          label: "Variable",
          icon: IconProp.Variable,
          className: "text-indigo-500",
        };
      case "template":
        return {
          label: "Template logic",
          icon: IconProp.Code,
          className: "text-indigo-500",
        };
      case "empty":
      default:
        return null;
    }
  };

  const chip: StatusChip | null = getStatusChip();

  return (
    <div>
      <div className="flex items-center justify-between mb-1 min-h-[20px]">
        <div>
          {chip && (
            <span
              className={`inline-flex items-center gap-1 text-xs font-medium ${chip.className}`}
            >
              <Icon icon={chip.icon} className="h-3.5 w-3.5" />
              {chip.label}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={formatJson}
          disabled={!canFormat}
          title={
            validation.hasVariables
              ? "Formatting is unavailable while variables are used."
              : "Reformat the JSON with clean indentation."
          }
          className={
            canFormat
              ? "text-xs font-medium text-blue-500 hover:text-blue-600 cursor-pointer"
              : "text-xs font-medium text-gray-300 cursor-not-allowed"
          }
        >
          Format
        </button>
      </div>

      <CodeEditor
        type={CodeType.JSON}
        showLineNumbers={true}
        tabIndex={props.tabIndex}
        value={props.value}
        initialValue={props.value}
        placeholder={props.placeholder}
        error={
          props.error ||
          (validation.status === "invalid" ? validation.message : undefined)
        }
        onChange={(value: string) => {
          props.onChange(value);
        }}
      />

      {(validation.status === "variable" || validation.status === "template") &&
        validation.message && (
          <p className="mt-1 text-xs text-gray-500">{validation.message}</p>
        )}
    </div>
  );
};

export default JSONArgumentInput;
