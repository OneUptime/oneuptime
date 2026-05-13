import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import DashboardVariable, {
  DashboardVariableType,
} from "Common/Types/Dashboard/DashboardVariable";
import ObjectID from "Common/Types/ObjectID";

export interface ComponentProps {
  variables: Array<DashboardVariable>;
  telemetryAttributeOptions: Array<string>;
  metricNameOptions: Array<string>;
  onClose: () => void;
  onSave: (variables: Array<DashboardVariable>) => void;
}

interface VariableRowProps {
  variable: DashboardVariable;
  telemetryAttributeOptions: Array<string>;
  metricNameOptions: Array<string>;
  onChange: (variable: DashboardVariable) => void;
  onDelete: () => void;
  nameError?: string | undefined;
}

const RESERVED_NAME_PATTERN: RegExp = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const VariableRow: FunctionComponent<VariableRowProps> = (
  props: VariableRowProps,
): ReactElement => {
  const { variable } = props;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 mb-3">
      <div className="grid grid-cols-12 gap-3 items-start">
        <div className="col-span-4">
          <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide block mb-1">
            Name
          </label>
          <input
            type="text"
            className={`w-full text-sm border rounded-md px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-100 ${
              props.nameError ? "border-red-300" : "border-gray-200"
            }`}
            placeholder="cluster"
            value={variable.name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              props.onChange({ ...variable, name: e.target.value });
            }}
          />
          {props.nameError && (
            <p className="text-[11px] text-red-500 mt-1">{props.nameError}</p>
          )}
        </div>

        <div className="col-span-4">
          <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide block mb-1">
            Label
          </label>
          <input
            type="text"
            className="w-full text-sm border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-100"
            placeholder="Cluster"
            value={variable.label || ""}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              props.onChange({ ...variable, label: e.target.value });
            }}
          />
        </div>

        <div className="col-span-3">
          <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide block mb-1">
            Default
          </label>
          <input
            type="text"
            className="w-full text-sm border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-100"
            placeholder="(none)"
            value={variable.defaultValue || ""}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              props.onChange({ ...variable, defaultValue: e.target.value });
            }}
          />
          <label className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-500">
            <input
              type="checkbox"
              className="h-3.5 w-3.5"
              checked={Boolean(variable.isMultiSelect)}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                props.onChange({
                  ...variable,
                  isMultiSelect: e.target.checked,
                });
              }}
            />
            Allow multi-select
          </label>
        </div>

        <div className="col-span-1 flex items-end justify-end h-full pb-1">
          <button
            type="button"
            className="text-gray-400 hover:text-red-500 transition-colors p-1"
            onClick={props.onDelete}
            title="Remove variable"
          >
            <Icon icon={IconProp.Trash} className="w-4 h-4" />
          </button>
        </div>

        <div className="col-span-12">
          <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide block mb-1">
            Attribute Key
          </label>
          <input
            type="text"
            list={`attr-options-${variable.id}`}
            className="w-full text-sm border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-100 font-mono"
            placeholder="e.g. k8s.cluster.name"
            value={variable.attributeKey || ""}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              props.onChange({ ...variable, attributeKey: e.target.value });
            }}
          />
          <datalist id={`attr-options-${variable.id}`}>
            {props.telemetryAttributeOptions.map((attr: string) => {
              return <option key={attr} value={attr} />;
            })}
          </datalist>
          <p className="text-[11px] text-gray-400 mt-1">
            Widgets that filter on this attribute will be scoped to the selected
            value. Choosing &quot;All&quot; leaves widgets unfiltered.
          </p>
        </div>

        <div className="col-span-12">
          <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide block mb-1">
            Scope to Metric{" "}
            <span className="text-gray-300 normal-case">— optional</span>
          </label>
          <input
            type="text"
            list={`metric-options-${variable.id}`}
            className="w-full text-sm border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-100 font-mono"
            placeholder="e.g. k8s.container.cpu_usage"
            value={variable.metricName || ""}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              props.onChange({ ...variable, metricName: e.target.value });
            }}
          />
          <datalist id={`metric-options-${variable.id}`}>
            {props.metricNameOptions.map((name: string) => {
              return <option key={name} value={name} />;
            })}
          </datalist>
          <p className="text-[11px] text-gray-400 mt-1">
            Leave blank to list values across every metric. Set this to narrow
            the dropdown to values seen on one metric only.
          </p>
        </div>
      </div>
    </div>
  );
};

const DashboardVariablesModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [variables, setVariables] = useState<Array<DashboardVariable>>(
    props.variables.map((v: DashboardVariable) => {
      return { ...v };
    }),
  );

  const nameErrors: Record<string, string> = useMemo(() => {
    const errors: Record<string, string> = {};
    const seen: Set<string> = new Set();
    for (const v of variables) {
      const trimmed: string = (v.name || "").trim();
      if (!trimmed) {
        errors[v.id] = "Required";
        continue;
      }
      if (!RESERVED_NAME_PATTERN.test(trimmed)) {
        errors[v.id] = "Letters, digits and underscore only";
        continue;
      }
      const lower: string = trimmed.toLowerCase();
      if (seen.has(lower)) {
        errors[v.id] = "Duplicate name";
        continue;
      }
      seen.add(lower);
    }
    return errors;
  }, [variables]);

  const hasErrors: boolean = Object.keys(nameErrors).length > 0;

  const addVariable: () => void = () => {
    const newVar: DashboardVariable = {
      id: ObjectID.generate().toString(),
      name: "",
      type: DashboardVariableType.TelemetryAttribute,
    };
    setVariables([...variables, newVar]);
  };

  const updateVariable: (next: DashboardVariable) => void = (
    next: DashboardVariable,
  ) => {
    setVariables(
      variables.map((v: DashboardVariable) => {
        return v.id === next.id ? next : v;
      }),
    );
  };

  const deleteVariable: (id: string) => void = (id: string) => {
    setVariables(
      variables.filter((v: DashboardVariable) => {
        return v.id !== id;
      }),
    );
  };

  return (
    <Modal
      title="Dashboard Variables"
      description="Add variables to filter every widget on this dashboard by an attribute (for example, cluster or namespace). Selectors appear on the toolbar in view mode."
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      onSubmit={() => {
        const normalized: Array<DashboardVariable> = variables.map(
          (v: DashboardVariable) => {
            return { ...v, name: (v.name || "").trim() };
          },
        );
        props.onSave(normalized);
      }}
      submitButtonText="Save Variables"
      disableSubmitButton={hasErrors}
      closeButtonText="Cancel"
    >
      <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1">
        {variables.length === 0 ? (
          <div className="border border-dashed border-gray-200 rounded-lg p-6 text-center">
            <Icon
              icon={IconProp.Variable}
              className="w-6 h-6 text-gray-300 mx-auto mb-2"
            />
            <p className="text-sm text-gray-500 mb-1">No variables yet</p>
            <p className="text-xs text-gray-400">
              Add a variable to filter all widgets by a shared attribute.
            </p>
          </div>
        ) : (
          variables.map((variable: DashboardVariable) => {
            return (
              <VariableRow
                key={variable.id}
                variable={variable}
                telemetryAttributeOptions={props.telemetryAttributeOptions}
                metricNameOptions={props.metricNameOptions}
                onChange={updateVariable}
                onDelete={() => {
                  deleteVariable(variable.id);
                }}
                nameError={nameErrors[variable.id]}
              />
            );
          })
        )}

        <div className="mt-2">
          <Button
            icon={IconProp.Add}
            title="Add Variable"
            buttonStyle={ButtonStyleType.OUTLINE}
            buttonSize={ButtonSize.Small}
            onClick={addVariable}
          />
        </div>
      </div>
    </Modal>
  );
};

export default DashboardVariablesModal;
