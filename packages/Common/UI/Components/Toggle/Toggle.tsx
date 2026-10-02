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
import useTranslateValue, { TranslatableValue } from "../../Utils/Translation";

export interface ComponentProps {
  onChange: (value: boolean) => void;
  initialValue?: boolean | undefined;
  value?: boolean | undefined;
  onFocus?: () => void;
  onBlur?: () => void;
  tabIndex?: number | undefined;
  /*
   * The label, drawn beside the switch. It is a real <label> for the switch:
   * it names it, and pressing it flips the switch, the way a checkbox's label
   * ticks the box.
   */
  title?: string | ReactElement | undefined;
  /*
   * Help under the title. It describes the switch (aria-describedby) rather
   * than naming it, so a screen reader says "Secret, switch, off" and then
   * the sentence, instead of reading the whole sentence out as the name.
   */
  description?: string | ReactElement | undefined;
  error?: string | undefined;
  dataTestId?: string | undefined;
  tooltip?: string | undefined;
  ariaLabelledby?: string | undefined;
  /*
   * The name of a switch with no title beside it - in a table row, or as the
   * value of a filter - where what it is for is written somewhere else.
   * Ignored when there is a title or `ariaLabelledby`.
   */
  ariaLabel?: string | undefined;
  /*
   * The switch's id, for a <label htmlFor> the page draws itself. One is
   * generated otherwise.
   */
  id?: string | undefined;
  /*
   * Presses are ignored and the switch says so (aria-disabled) - while the
   * value it shows is being saved, say. Deliberately not the native
   * `disabled` attribute: that would throw keyboard focus off a switch the
   * user just pressed, and it is still the element they are on.
   */
  disabled?: boolean | undefined;
}

/*
 * The switch is drawn the way the rest of OneUptime draws its controls: a
 * filled pill with a white knob that slides across it, no outline.
 *
 *   Off - a gray-300 track, the grey every input, dropdown and checkbox in
 *         the product has for its edge, with the white knob on the left.
 *   On  - the brand indigo-600 of every primary button, the knob on the
 *         right.
 *
 * The knob is the same white disc in both states, with the small shadow
 * that sets it off the track; only its side changes. Which side it is on,
 * and a track that goes from light grey to dark indigo (4.3:1 between the
 * two), tell the states apart without telling them by hue alone.
 *
 * The outlined design before this one (a white track with a gray-500
 * outline and a gray-500 dot that grew into a disc with a tick) did not
 * look like anything else in the product. The pale gray-200 track before
 * that one all but disappeared on a white form; gray-300 is the one step
 * darker that keeps the classic look.
 *
 * The dark theme recolours these through the [data-ou-toggle-*] rules in
 * Common/UI/Styles/Theme.css: indigo-600 is under 3:1 on a dark card, and
 * the theme's own gray-300 would be as light as the "on" indigo there. Keep
 * every colour class here a literal string, so that sheet and the suites
 * holding it to these classes can see it.
 */
export const TOGGLE_TRACK_BASE_CLASS: string =
  "relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

export const TOGGLE_TRACK_OFF_CLASS: string = "bg-gray-300";

export const TOGGLE_TRACK_ON_CLASS: string = "bg-indigo-600";

/*
 * Hover only where a press would do something, one shade deeper in each
 * state - on, the same indigo-700 a primary button deepens to.
 */
export const TOGGLE_TRACK_OFF_HOVER_CLASS: string = "hover:bg-gray-400";

export const TOGGLE_TRACK_ON_HOVER_CLASS: string = "hover:bg-indigo-700";

export const TOGGLE_TRACK_ENABLED_CLASS: string = "cursor-pointer";

/*
 * Disabled controls are exempt from the contrast rule; dimming the whole
 * switch is what tells one apart from a switch that can be pressed.
 */
export const TOGGLE_TRACK_DISABLED_CLASS: string =
  "cursor-not-allowed opacity-50";

// 20px, filling the track's height inside its 2px clear border.
export const TOGGLE_KNOB_BASE_CLASS: string =
  "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition duration-200 ease-in-out motion-reduce:transition-none";

export const TOGGLE_KNOB_OFF_CLASS: string = "translate-x-0";

export const TOGGLE_KNOB_ON_CLASS: string = "translate-x-5";

export interface ToggleClassNames {
  track: string;
  knob: string;
}

export interface ToggleVisualState {
  isChecked: boolean;
  isDisabled: boolean;
}

export const getToggleClassNames: (
  state: ToggleVisualState,
) => ToggleClassNames = (state: ToggleVisualState): ToggleClassNames => {
  const trackParts: Array<string> = [
    TOGGLE_TRACK_BASE_CLASS,
    state.isChecked ? TOGGLE_TRACK_ON_CLASS : TOGGLE_TRACK_OFF_CLASS,
  ];

  if (state.isDisabled) {
    trackParts.push(TOGGLE_TRACK_DISABLED_CLASS);
  } else {
    trackParts.push(
      TOGGLE_TRACK_ENABLED_CLASS,
      state.isChecked
        ? TOGGLE_TRACK_ON_HOVER_CLASS
        : TOGGLE_TRACK_OFF_HOVER_CLASS,
    );
  }

  return {
    track: trackParts.join(" "),
    knob: `${TOGGLE_KNOB_BASE_CLASS} ${
      state.isChecked ? TOGGLE_KNOB_ON_CLASS : TOGGLE_KNOB_OFF_CLASS
    }`,
  };
};

const Toggle: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString, translateValue } = useTranslateValue();
  const uniqueId: string = useId();
  const switchId: string = props.id || `toggle-${uniqueId}`;
  const labelId: string = `toggle-label-${uniqueId}`;
  const descriptionId: string = `toggle-description-${uniqueId}`;
  const tooltipId: string = `toggle-tooltip-${uniqueId}`;
  const errorId: string = `toggle-error-${uniqueId}`;
  /*
   * From `value` when there is one, as the effect below would set it. Read
   * from initialValue alone, a switch whose value starts on painted "off"
   * for its first frame and then slid across - on every form that opened
   * with one switched on.
   */
  const [isChecked, setIsChecked] = useState<boolean>(
    props.value !== undefined
      ? Boolean(props.value)
      : Boolean(props.initialValue),
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

  /*
   * Looked up like every other Common control's copy. A form field hands
   * these over already translated; a translated sentence is not a key, so
   * the second lookup gives it back unchanged.
   */
  const title: TranslatableValue = translateValue(props.title);
  const description: TranslatableValue = translateValue(props.description);
  const tooltip: string | undefined = translateString(props.tooltip);
  const ariaLabel: string | undefined = translateString(props.ariaLabel);

  const hasTitle: boolean = Boolean(title);
  const hasDescription: boolean = Boolean(description);
  const isDisabled: boolean = Boolean(props.disabled);

  const classNames: ToggleClassNames = getToggleClassNames({
    isChecked: isChecked,
    isDisabled: isDisabled,
  });

  const describedBy: Array<string> = [];

  if (hasDescription) {
    describedBy.push(descriptionId);
  }

  // The help icon cannot be reached from the keyboard; its text can.
  if (tooltip) {
    describedBy.push(tooltipId);
  }

  if (props.error) {
    describedBy.push(errorId);
  }

  const ariaLabelledby: string | undefined =
    props.ariaLabelledby || (hasTitle ? labelId : undefined);

  return (
    <div>
      <div className="flex items-start gap-3">
        <button
          id={switchId}
          onClick={() => {
            /*
             * Before handleChange, which flips the switch's own copy of its
             * value: flipped and then refused by the caller, that copy would
             * no longer match `value`, and nothing re-syncs it until `value`
             * itself changes - a disabled switch pressed from the keyboard
             * would go on showing the state it was refused.
             */
            if (props.disabled) {
              return;
            }

            if (props.onFocus) {
              props.onFocus();
            }
            if (props.onBlur) {
              props.onBlur();
            }
            /*
             * handleChange already calls props.onChange. Calling it a second
             * time here ran every consumer's handler twice per click, which an
             * idempotent handler never notices and a non-idempotent one cannot
             * survive. The monitor criteria switches are one click away from
             * that: they seed a blank incident / alert row on the way on, and
             * only the "is the array still empty" guard around that seed kept
             * the second pass from adding a second row.
             */
            handleChange(!isChecked);
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
          className={classNames.track}
          data-ou-toggle-track=""
          role="switch"
          aria-checked={isChecked ? "true" : "false"}
          aria-disabled={props.disabled ? "true" : undefined}
          aria-labelledby={ariaLabelledby}
          aria-label={!ariaLabelledby && ariaLabel ? ariaLabel : undefined}
          aria-describedby={
            describedBy.length > 0 ? describedBy.join(" ") : undefined
          }
          aria-invalid={props.error ? "true" : undefined}
        >
          <span
            aria-hidden="true"
            className={classNames.knob}
            data-ou-toggle-knob=""
          />
        </button>
        {hasTitle || hasDescription || tooltip ? (
          <div className="min-w-0 flex-1">
            {hasTitle || tooltip ? (
              /*
               * Inline, not a flex row: a title that wraps keeps the help
               * icon after its last word rather than out at the far edge.
               */
              <div className="text-sm leading-6">
                {hasTitle ? (
                  <label
                    id={labelId}
                    htmlFor={switchId}
                    className={`font-medium text-gray-900 ${
                      isDisabled ? "cursor-not-allowed" : "cursor-pointer"
                    }`}
                  >
                    {/* The text in a span of its own, as FieldLabel has it. */}
                    <span>{title}</span>
                  </label>
                ) : (
                  <></>
                )}
                {tooltip ? (
                  <Tooltip text={tooltip}>
                    <div className="ml-1 inline-flex h-6 items-center align-top">
                      <Icon
                        className="h-4 w-4 cursor-pointer text-gray-400"
                        icon={IconProp.Help}
                      />
                    </div>
                  </Tooltip>
                ) : (
                  <></>
                )}
              </div>
            ) : (
              <></>
            )}
            {hasDescription ? (
              <div
                id={descriptionId}
                className={`text-sm text-gray-500 ${
                  hasTitle ? "" : "leading-6"
                }`}
              >
                {description}
              </div>
            ) : (
              <></>
            )}
            {tooltip ? (
              <span id={tooltipId} className="sr-only">
                {tooltip}
              </span>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}
      </div>
      {props.error ? (
        <p
          id={errorId}
          data-testid="error-message"
          className={`mt-1 text-sm text-red-400 ${
            hasTitle || hasDescription ? "pl-14" : ""
          }`}
          role="alert"
        >
          {props.error}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default Toggle;
