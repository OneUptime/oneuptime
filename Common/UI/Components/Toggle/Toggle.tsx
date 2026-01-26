import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";
import Tooltip from "../Tooltip/Tooltip";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";

export interface ComponentProps {
  onChange: (value: boolean) => void;
  initialValue?: boolean | undefined;
  value?: boolean | undefined;
  onFocus?: () => void;
  onBlur?: () => void;
  tabIndex?: number | undefined;
  title?: string | undefined;
  description?: string | undefined;
  error?: string | undefined;
  dataTestId?: string | undefined;
  tooltip?: string | undefined;
}

const Toggle: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const uniqueId: string = useId();
  const labelId: string = `toggle-label-${uniqueId}`;
  const errorId: string = `toggle-error-${uniqueId}`;
  const [isChecked, setIsChecked] = useState<boolean>(
    props.initialValue || false,
  );

  useEffect(() => {
    if (props.value !== undefined) {
      if (props.value) {
        setIsChecked(true);
      } else {
        setIsChecked(false);
      }
    }
  }, [props.value]);

  type HandleChangeFunction = (content: boolean) => void;

  const handleChange: HandleChangeFunction = (content: boolean): void => {
    setIsChecked(content);
    props.onChange(content);
  };

  let buttonClassName: string =
    "bg-gray-200 relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2";

  if (isChecked) {
    buttonClassName =
      "bg-indigo-600 relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2";
  }

  let toggleClassName: string =
    "translate-x-0 pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out";

  if (isChecked) {
    toggleClassName =
      "translate-x-5 pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out";
  }

  return (
    <div>
      <div className="flex items-center">
        <button
          onClick={() => {
            if (props.onFocus) {
              props.onFocus();
            }
            if (props.onBlur) {
              props.onBlur();
            }
            handleChange(!isChecked);
            props.onChange(!isChecked);
          }}
          onFocus={() => {
            if (props.onFocus) {
              props.onFocus();
            }
          }}
          data-testid={props.dataTestId}
          onBlur={() => {
            if (props.onBlur) {
              props.onBlur();
            }
          }}
          tabIndex={props.tabIndex}
          type="button"
          className={buttonClassName}
          role="switch"
          aria-checked={isChecked ? "true" : "false"}
          aria-labelledby={labelId}
          aria-describedby={props.error ? errorId : undefined}
          aria-invalid={props.error ? "true" : undefined}
        >
          <span aria-hidden="true" className={toggleClassName}></span>
        </button>
        <span className="ml-3" id={labelId}>
          <span className="text-sm font-medium text-gray-900">
            {props.title}
          </span>
          <span className="text-sm text-gray-500 ml-1">
            {props.description}
          </span>
        </span>
        {props.tooltip && (
          <Tooltip key={1} text={props.tooltip || "Not available"}>
            <div className="ml-1">
              <Icon
                className="cursor-pointer w-4 h-4 mt-1 text-gray-400"
                icon={IconProp.Help}
              />
            </div>
          </Tooltip>
        )}
      </div>
      {props.error && (
        <p id={errorId} data-testid="error-message" className="mt-1 text-sm text-red-400" role="alert">
          {props.error}
        </p>
      )}
    </div>
  );
};

export default Toggle;
