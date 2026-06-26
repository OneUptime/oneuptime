import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Input from "Common/UI/Components/Input/Input";
import IconProp from "Common/Types/Icon/IconProp";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  initialValue?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
  onBlur?: (() => void) | undefined;
  placeholder?: string | undefined;
  addButtonLabel?: string | undefined;
  error?: string | undefined;
}

type ParseValuesFn = (raw?: string) => Array<string>;

const parseValues: ParseValuesFn = (raw?: string): Array<string> => {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((value: string): string => {
      return value.trim();
    })
    .filter((value: string): boolean => {
      return value.length > 0;
    });
};

const serializeValues: (values: Array<string>) => string = (
  values: Array<string>,
): string => {
  return values
    .map((v: string): string => {
      return v.trim();
    })
    .filter((v: string): boolean => {
      return v.length > 0;
    })
    .join(", ");
};

const AxisValuesInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // We keep a local working list (so users can type empty rows mid-edit).
  const [values, setValues] = useState<Array<string>>(() => {
    const parsed: Array<string> = parseValues(props.initialValue);
    return parsed.length > 0 ? parsed : [""];
  });

  // Only emit a normalized serialized value to the form on change — strips blanks.
  const emit: (next: Array<string>) => void = (next: Array<string>): void => {
    if (props.onChange) {
      props.onChange(serializeValues(next));
    }
  };

  useEffect(() => {
    /*
     * When the parent feeds us a new initial value (e.g. on edit modal opening),
     * sync local state once if our state is still the default empty row.
     */
    if (!props.initialValue) {
      return;
    }
    const parsed: Array<string> = parseValues(props.initialValue);
    if (parsed.length === 0) {
      return;
    }
    // Avoid clobbering local edits — only seed when local list is still empty/blank.
    const localNonEmpty: number = values.filter((v: string): boolean => {
      return v.trim().length > 0;
    }).length;
    if (localNonEmpty === 0) {
      setValues(parsed);
    }
    // We intentionally only depend on props.initialValue.
  }, [props.initialValue]);

  type UpdateAtFn = (index: number, newValue: string) => void;
  const updateAt: UpdateAtFn = (index: number, newValue: string): void => {
    const next: Array<string> = [...values];
    next[index] = newValue;
    setValues(next);
    emit(next);
  };

  type RemoveAtFn = (index: number) => void;
  const removeAt: RemoveAtFn = (index: number): void => {
    let next: Array<string> = values.filter(
      (_v: string, i: number): boolean => {
        return i !== index;
      },
    );
    // Always keep at least one input row visible.
    if (next.length === 0) {
      next = [""];
    }
    setValues(next);
    emit(next);
  };

  const addRow: () => void = (): void => {
    const next: Array<string> = [...values, ""];
    setValues(next);
    emit(next);
  };

  return (
    <div className="space-y-2">
      <div className="space-y-2">
        {values.map((value: string, index: number) => {
          return (
            <div
              key={`axis-row-${index}`}
              className="flex items-center gap-2 group"
            >
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-gray-100 text-[11px] font-semibold text-gray-500 select-none shrink-0">
                {index + 1}
              </span>
              <div className="flex-1">
                <Input
                  value={value}
                  placeholder={props.placeholder || "Value"}
                  onChange={(v: string) => {
                    updateAt(index, v);
                  }}
                  onBlur={() => {
                    if (props.onBlur) {
                      props.onBlur();
                    }
                  }}
                  onEnterPress={() => {
                    addRow();
                  }}
                />
              </div>
              <button
                type="button"
                aria-label="Remove value"
                onClick={() => {
                  removeAt(index);
                }}
                className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-4 h-4"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
      <div className="pt-1">
        <Button
          title={props.addButtonLabel || "Add value"}
          icon={IconProp.Add}
          buttonSize={ButtonSize.Small}
          buttonStyle={ButtonStyleType.OUTLINE}
          onClick={addRow}
        />
      </div>
      {props.error ? (
        <p
          className="text-sm text-red-600"
          data-testid="axis-values-input-error"
        >
          {props.error}
        </p>
      ) : null}
    </div>
  );
};

export default AxisValuesInput;
