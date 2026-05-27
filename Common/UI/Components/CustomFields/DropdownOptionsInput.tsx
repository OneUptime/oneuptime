import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import Input, { InputType } from "../Input/Input";
import IconProp from "../../../Types/Icon/IconProp";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  initialValue?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
  placeholder?: string | undefined;
  error?: string | undefined;
  onBlur?: (() => void) | undefined;
}

const parseValue: (value: string | undefined) => Array<string> = (
  value: string | undefined,
): Array<string> => {
  if (!value) {
    return [];
  }
  return value
    .split("\n")
    .map((line: string) => {
      return line.trim();
    })
    .filter((line: string) => {
      return line.length > 0;
    });
};

const serializeValue: (options: Array<string>) => string = (
  options: Array<string>,
): string => {
  return options
    .map((option: string) => {
      return option.trim();
    })
    .filter((option: string) => {
      return option.length > 0;
    })
    .join("\n");
};

const DropdownOptionsInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [options, setOptions] = useState<Array<string>>(() => {
    const parsed: Array<string> = parseValue(props.initialValue);
    return parsed.length > 0 ? parsed : [""];
  });

  const lastEmittedRef: MutableRefObject<string> = useRef<string>(
    serializeValue(parseValue(props.initialValue)),
  );

  useEffect(() => {
    const serialized: string = serializeValue(options);
    if (serialized !== lastEmittedRef.current) {
      lastEmittedRef.current = serialized;
      if (props.onChange) {
        props.onChange(serialized);
      }
    }
  }, [options]);

  type UpdateAtFn = (index: number, value: string) => void;
  const updateAt: UpdateAtFn = (index: number, value: string): void => {
    setOptions((prev: Array<string>) => {
      const next: Array<string> = [...prev];
      next[index] = value;
      return next;
    });
  };

  type RemoveAtFn = (index: number) => void;
  const removeAt: RemoveAtFn = (index: number): void => {
    setOptions((prev: Array<string>) => {
      const next: Array<string> = prev.filter((_: string, i: number) => {
        return i !== index;
      });
      return next.length > 0 ? next : [""];
    });
  };

  type AddOptionFn = () => void;
  const addOption: AddOptionFn = (): void => {
    setOptions((prev: Array<string>) => {
      return [...prev, ""];
    });
  };

  return (
    <div>
      <div className="space-y-2">
        {options.map((value: string, index: number) => {
          return (
            <div key={index} className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-100 text-xs font-medium text-gray-500">
                {index + 1}
              </div>
              <div className="flex-1">
                <Input
                  value={value}
                  placeholder={props.placeholder || `Option ${index + 1}`}
                  onChange={(newValue: string) => {
                    updateAt(index, newValue);
                  }}
                  onBlur={() => {
                    if (props.onBlur) {
                      props.onBlur();
                    }
                  }}
                  type={InputType.TEXT}
                />
              </div>
              <Button
                title="Remove"
                buttonStyle={ButtonStyleType.ICON}
                icon={IconProp.Trash}
                onClick={() => {
                  removeAt(index);
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
