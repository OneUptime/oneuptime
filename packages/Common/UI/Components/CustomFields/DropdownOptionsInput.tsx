import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import ColorPicker from "../Forms/Fields/ColorPicker";
import Input, { InputType } from "../Input/Input";
import Color from "../../../Types/Color";
import {
  CustomFieldDropdownOption,
  parseCustomFieldDropdownOptions,
  serializeCustomFieldDropdownOptions,
} from "../../../Types/CustomField/CustomFieldDropdownOption";
import IconProp from "../../../Types/Icon/IconProp";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";

export interface ComponentProps {
  initialValue?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
  placeholder?: string | undefined;
  error?: string | undefined;
  onBlur?: (() => void) | undefined;
}

interface EditableDropdownOption extends CustomFieldDropdownOption {
  id: number;
}

const DropdownOptionsInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const nextIdRef: MutableRefObject<number> = useRef<number>(0);

  const createEditableOption: (
    option?: CustomFieldDropdownOption,
  ) => EditableDropdownOption = (
    option?: CustomFieldDropdownOption,
  ): EditableDropdownOption => {
    const editableOption: EditableDropdownOption = {
      id: nextIdRef.current,
      value: option?.value || "",
    };
    nextIdRef.current += 1;

    if (option?.color) {
      editableOption.color = option.color;
    }

    return editableOption;
  };

  const [options, setOptions] = useState<Array<EditableDropdownOption>>(() => {
    const parsed: Array<CustomFieldDropdownOption> =
      parseCustomFieldDropdownOptions(props.initialValue);
    return parsed.length > 0
      ? parsed.map((option: CustomFieldDropdownOption) => {
          return createEditableOption(option);
        })
      : [createEditableOption()];
  });

  const lastEmittedRef: MutableRefObject<string> = useRef<string>(
    serializeCustomFieldDropdownOptions(
      parseCustomFieldDropdownOptions(props.initialValue),
    ),
  );

  useEffect(() => {
    const serialized: string = serializeCustomFieldDropdownOptions(options);
    if (serialized !== lastEmittedRef.current) {
      lastEmittedRef.current = serialized;
      if (props.onChange) {
        props.onChange(serialized);
      }
    }
  }, [options]);

  type UpdateAtFunction = (
    id: number,
    update: Partial<CustomFieldDropdownOption>,
  ) => void;
  const updateAt: UpdateAtFunction = (
    id: number,
    update: Partial<CustomFieldDropdownOption>,
  ): void => {
    setOptions((previousOptions: Array<EditableDropdownOption>) => {
      return previousOptions.map((option: EditableDropdownOption) => {
        if (option.id !== id) {
          return option;
        }

        return {
          ...option,
          ...update,
        };
      });
    });
  };

  type UpdateColorAtFunction = (id: number, color: Color | null) => void;
  const updateColorAt: UpdateColorAtFunction = (
    id: number,
    color: Color | null,
  ): void => {
    setOptions((previousOptions: Array<EditableDropdownOption>) => {
      const next: Array<EditableDropdownOption> = previousOptions.map(
        (option: EditableDropdownOption) => {
          if (option.id !== id) {
            return option;
          }

          const updatedOption: EditableDropdownOption = {
            id: option.id,
            value: option.value,
          };

          if (color) {
            updatedOption.color = color.toString();
          }

          return updatedOption;
        },
      );

      return next;
    });
  };

  type RemoveAtFn = (id: number) => void;
  const removeAt: RemoveAtFn = (id: number): void => {
    setOptions((previousOptions: Array<EditableDropdownOption>) => {
      const next: Array<EditableDropdownOption> = previousOptions.filter(
        (option: EditableDropdownOption) => {
          return option.id !== id;
        },
      );
      return next.length > 0 ? next : [createEditableOption()];
    });
  };

  type AddOptionFn = () => void;
  const addOption: AddOptionFn = (): void => {
    setOptions((previousOptions: Array<EditableDropdownOption>) => {
      return [...previousOptions, createEditableOption()];
    });
  };

  return (
    <div>
      <div className="space-y-3">
        {options.map((option: EditableDropdownOption, index: number) => {
          return (
            <div
              key={option.id}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[auto_minmax(0,1fr)_minmax(9rem,12rem)_auto]"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-100 text-xs font-medium text-gray-500">
                {index + 1}
              </div>
              <div className="min-w-0">
                <span
                  id={`dropdown-option-value-${option.id}-label`}
                  className="sr-only"
                >
                  {translator.translateTemplate("Dropdown option {{number}}", {
                    number: index + 1,
                  })}
                </span>
                <Input
                  value={option.value}
                  dataTestId={`dropdown-option-value-${index}`}
                  ariaLabelledby={`dropdown-option-value-${option.id}-label`}
                  placeholder={
                    translator.translateText(props.placeholder) ||
                    translator.translateTemplate("Option {{number}}", {
                      number: index + 1,
                    })
                  }
                  onChange={(newValue: string) => {
                    updateAt(option.id, { value: newValue });
                  }}
                  onBlur={() => {
                    if (props.onBlur) {
                      props.onBlur();
                    }
                  }}
                  type={InputType.TEXT}
                />
              </div>
              <div className="col-span-2 col-start-2 row-start-2 sm:col-span-1 sm:col-start-3 sm:row-start-1">
                <span
                  id={`dropdown-option-color-${option.id}-label`}
                  className="sr-only"
                >
                  {option.value
                    ? translator.translateTemplate("Color for {{option}}", {
                        option: option.value,
                      })
                    : translator.translateTemplate(
                        "Color for option {{number}}",
                        {
                          number: index + 1,
                        },
                      )}
                </span>
                {/*
                 * One line per option: the color as a small button with its
                 * name, the swatches in a popover.
                 */}
                <ColorPicker
                  layout="compact"
                  dataTestId={`dropdown-option-color-${index}`}
                  ariaLabelledby={`dropdown-option-color-${option.id}-label`}
                  placeholder="No color"
                  value={option.color || ""}
                  onChange={(color: Color | null) => {
                    updateColorAt(option.id, color);
                  }}
                  onBlur={() => {
                    if (props.onBlur) {
                      props.onBlur();
                    }
                  }}
                />
              </div>
              <Button
                title="Remove"
                className="col-start-3 row-start-1 sm:col-start-4"
                buttonStyle={ButtonStyleType.ICON}
                icon={IconProp.Trash}
                onClick={() => {
                  removeAt(option.id);
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-3">
        <Button
          title="Add Option"
          icon={IconProp.Add}
          buttonSize={ButtonSize.Small}
          buttonStyle={ButtonStyleType.NORMAL}
          onClick={addOption}
        />
      </div>
      {props.error ? (
        <p className="mt-2 text-sm text-red-500">{props.error}</p>
      ) : null}
    </div>
  );
};

export default DropdownOptionsInput;
