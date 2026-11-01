import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";
import "react-toggle/style.css";

export interface RadioButton {
  title: string;
  description?: string | undefined;
  value: string;
  sideTitle?: string | undefined;
  sideDescription?: string | undefined;
}

export interface ComponentProps {
  onChange: (value: string) => void;
  initialValue?: string | undefined;
  options: Array<RadioButton>;
  error?: string | undefined;
  dataTestId?: string | undefined;
  ariaLabelledby?: string | undefined;
  // What describes the choice: its field's help.
  ariaDescribedby?: string | undefined;
}

/*
 * Choices drawn as cards, one picked: a real radio group. Every element id
 * is this group's own (useId), so two groups on one page - a form and a
 * dialog over it, two of them in one form - never share one: the ids were
 * "server-size-0-label" in every group, and a screen reader on the second
 * group read the first one's titles. The radios share a name, so the arrow
 * keys move between them, and each card shows where the keyboard is.
 */
const RadioButtons: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [value, setValue] = useState<string>("");
  const groupId: string = useId();

  useEffect(() => {
    if (props.initialValue) {
      setValue(props.initialValue);
      props.onChange(props.initialValue);
    } else {
      setValue("");
      props.onChange("");
    }
  }, [props.initialValue]);

  type HandleChangeFunction = (content: string) => void;

  const handleChange: HandleChangeFunction = (content: string): void => {
    setValue(content);
    props.onChange(content);
  };

  return (
    <div>
      <fieldset
        role="radiogroup"
        aria-labelledby={props.ariaLabelledby}
        aria-describedby={props.ariaDescribedby}
        data-testid={props.dataTestId}
      >
        <div className="space-y-2 mt-2">
          {props.options &&
            props.options.map((radioButton: RadioButton, i: number) => {
              const optionId: string = `${groupId}-option-${i}`;
              const labelId: string = `${optionId}-label`;
              const descriptionId: string = `${optionId}-description`;
              const sideId: string = `${optionId}-side`;
              const hasSide: boolean = Boolean(
                radioButton.sideTitle || radioButton.sideDescription,
              );
              const isPicked: boolean = value === radioButton.value;

              /*
               * The keyboard's place is drawn round the card it is on, as
               * a picked card's ring: the radio itself is out of sight.
               */
              let className: string =
                "relative block cursor-pointer rounded-lg border bg-white px-6 py-4 shadow-sm focus:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-500 has-[:focus-visible]:ring-offset-2 sm:flex sm:justify-between";

              if (isPicked) {
                className =
                  "relative block cursor-pointer rounded-lg border bg-white px-6 py-4 shadow-sm focus:outline-none has-[:focus-visible]:ring-offset-2 sm:flex sm:justify-between border-indigo-500 ring-2 ring-indigo-500";
              }

              return (
                <label
                  key={i}
                  className={className}
                  data-testid={`card-select-option-${radioButton.value}`}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    name={`${groupId}-choice`}
                    value={radioButton.value}
                    checked={isPicked}
                    aria-labelledby={labelId}
                    aria-describedby={
                      [
                        radioButton.description ? descriptionId : "",
                        hasSide ? sideId : "",
                      ]
                        .filter((id: string): boolean => {
                          return id.length > 0;
                        })
                        .join(" ") || undefined
                    }
                    onChange={() => {
                      handleChange(radioButton.value);
                    }}
                  />
                  <span className="flex items-center">
                    <span className="flex flex-col text-sm">
                      <span id={labelId} className="font-medium text-gray-900">
                        {radioButton.title}
                      </span>
                      <span id={descriptionId} className="text-gray-500">
                        <span className="block sm:inline">
                          {" "}
                          {radioButton.description}
                        </span>
                      </span>
                    </span>
                  </span>
                  <span
                    id={sideId}
                    className="mt-2 flex text-sm sm:mt-0 sm:ml-4 sm:flex-col sm:text-right"
                  >
                    <span className="font-medium text-gray-900">
                      {radioButton.sideTitle}
                    </span>
                    <span className="ml-1 text-gray-500 sm:ml-0">
                      {radioButton.sideDescription}
                    </span>
                  </span>

                  <span
                    className="pointer-events-none absolute -inset-px rounded-lg border-2"
                    aria-hidden="true"
                  ></span>
                </label>
              );
            })}
        </div>
      </fieldset>
      {props.error && (
        <p data-testid="error-message" className="mt-1 text-sm text-red-400">
          {props.error}
        </p>
      )}
    </div>
  );
};

export default RadioButtons;
