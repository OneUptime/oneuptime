import ObjectID from "../../../Types/ObjectID";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface BasicRadioButtonOption {
  title: string;
  description?: string | undefined;
  value: string;
  children?: ReactElement | undefined;
}

export interface ComponentProps {
  onChange: (value: string) => void;
  initialValue?: string | undefined;
  options: Array<BasicRadioButtonOption>;
  error?: string | undefined;
  id?: string | undefined;
}

const BasicRadioButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [id] = useState<string>(props.id || ObjectID.generate().toString());

  const [value, setValue] = useState<string>("");

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
      <fieldset id={id} className="mt-4">
        <div className="space-y-4">
          {props.options.map(
            (radioButton: BasicRadioButtonOption, i: number) => {
              const checked: boolean = value === radioButton.value;

              return (
                <div key={i}>
                  {/*
                   * items-start, and the description on its own line.
                   *
                   * Both spans used to sit inline inside one label, separated
                   * by `ml-1 sm:ml-0` — which cancels the only gap between
                   * them at every breakpoint from `sm` up, i.e. on every
                   * desktop. The result rendered as "Create an alertNotifies
                   * the team and runs the on-call policy." Stacking them also
                   * lets a long description wrap under the title instead of
                   * under the radio.
                   */}
                  <div className="flex items-start">
                    {/*
                     * htmlFor, and an id to point it at.
                     *
                     * The label was a bare sibling of the input, so nothing
                     * tied them together: the radio had no accessible name at
                     * all (a screen reader announced "radio button, not
                     * checked" and never read "Create an alert"), and the only
                     * hit target was the 16px dot — clicking the words did
                     * nothing. GroupRadioButtons next door gets this right by
                     * wrapping the input; this shape needs the explicit link.
                     */}
                    <input
                      id={`${id}-${i}`}
                      type="radio"
                      name={id}
                      checked={checked}
                      onChange={() => {
                        handleChange(radioButton.value);
                      }}
                      className="mt-1 h-4 w-4 flex-shrink-0 border-gray-300 text-indigo-600 focus:ring-indigo-600"
                    />
                    <label
                      htmlFor={`${id}-${i}`}
                      className="ml-3 block cursor-pointer text-sm leading-6 text-gray-900"
                    >
                      <span className="block font-medium text-gray-900">
                        {radioButton.title}
                      </span>
                      {radioButton.description ? (
                        <span className="mt-0.5 block text-sm leading-5 text-gray-500">
                          {radioButton.description}
                        </span>
                      ) : (
                        <></>
                      )}
                    </label>
                  </div>
                  {checked && radioButton.children}
                </div>
              );
            },
          )}
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

export default BasicRadioButton;
