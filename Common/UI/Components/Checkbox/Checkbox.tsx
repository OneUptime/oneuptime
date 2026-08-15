import React, { FunctionComponent, ReactElement } from "react";

export type CategoryCheckboxValue = string | number | boolean;

export interface CategoryProps {
  title?: string | ReactElement | undefined;
  description?: string | ReactElement | undefined;
  initialValue?: undefined | boolean;
  onChange?: undefined | ((value: boolean, interminate?: boolean) => void);
  value?: boolean | undefined;
  readOnly?: boolean | undefined;
  disabled?: boolean | undefined;
  onFocus?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
  dataTestId?: string | undefined;
  tabIndex?: number | undefined;
  error?: string | undefined;
  outerDivClassName?: string | undefined;
  autoFocus?: boolean | undefined;
  className?: string | undefined;
  isIndeterminate?: boolean | undefined;
  /*
   * The accessible name, for a checkbox that has no visible `title` next to it.
   * A bare box in a table cell is announced as "checkbox" and nothing else, so a
   * screen reader user hears the same word once per row with no way to tell which
   * row they are on - and a test cannot address one row's box either.
   */
  ariaLabel?: string | undefined;
  /*
   * The hover text on the input itself - NOT `title` above, which is the visible
   * label rendered beside the box. Its most useful job is on a DISABLED box,
   * where it is the only place the reason can live: a box that cannot be ticked
   * and does not say why reads as broken rather than as deliberate.
   */
  hoverText?: string | undefined;
}

const CheckboxElement: FunctionComponent<CategoryProps> = (
  props: CategoryProps,
): ReactElement => {
  const [value, setValue] = React.useState<boolean>(
    props.initialValue || false,
  );

  // ref this checkbox.
  const checkboxRef: React.RefObject<HTMLInputElement> =
    React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    checkboxRef.current!.indeterminate = props.isIndeterminate || false;
  }, [props.isIndeterminate]);

  React.useEffect(() => {
    if (props.value === undefined) {
      return;
    }

    setValue(props.value || false);
  }, [props.value]);

  return (
    <div>
      <div
        className={`relative flex items-start ${props.outerDivClassName || ""}`}
      >
        <div className="flex h-6 items-center">
          <input
            checked={value}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              setValue(event.target.checked);

              if (props.onChange) {
                props.onChange(event.target.checked, props.isIndeterminate);
              }
            }}
            ref={checkboxRef}
            autoFocus={props.autoFocus}
            tabIndex={props.tabIndex}
            readOnly={props.readOnly}
            disabled={props.disabled}
            onFocus={props.onFocus}
            onBlur={props.onBlur}
            data-testid={props.dataTestId}
            aria-label={props.ariaLabel}
            title={props.hoverText}
            aria-describedby={
              props.description ? "checkbox-description" : undefined
            }
            aria-invalid={props.error ? "true" : undefined}
            type="checkbox"
            className={`accent-indigo-600 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 ${
              props.className || ""
            }`}
          />
        </div>
        <div className="ml-3 text-sm leading-6">
          <label className="font-medium text-gray-900">{props.title}</label>
          {props.description && (
            <div id="checkbox-description" className="text-gray-500">
              {props.description}
            </div>
          )}
        </div>
      </div>
      {props.error && (
        <p data-testid="error-message" className="mt-1 text-sm text-red-400">
          {props.error}
        </p>
      )}
    </div>
  );
};

export default CheckboxElement;
