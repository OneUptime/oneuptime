import useTranslateValue from "../../Utils/Translation";
import FieldLabelElement from "../Forms/Fields/FieldLabel";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useId,
} from "react";

/*
 * WHAT A RULE APPLIES TO, ASKED AS A CHOICE.
 *
 *   Applies to
 *   (o) All incidents
 *   ( ) Only incidents that match conditions
 *         If [Incident Title] [Contains] [database]
 *         + Add condition
 *
 * A rule with no conditions applies to every record it sees, and a
 * conditions list that starts empty read to some people as a form they had
 * to fill in: they added a condition they did not want, and the form
 * stopped them for leaving it blank. Asked this way, the answer most rules
 * need is the one already picked, and the conditions appear - under the
 * answer that asks for them - only once someone picks it.
 *
 * Only the two answers are radios; the conditions (children) are drawn after
 * the group, under the second answer, while it is picked. The caller keeps
 * what is stored: picking an answer calls onChooseAll / onChooseMatching,
 * and isMatching says which one is picked. Every text prop is English,
 * looked up here, as every shared component's text props are.
 */
export interface ComponentProps {
  // "All incidents".
  allLabel: string;
  // "Only incidents that match conditions".
  matchingLabel: string;
  // Whether the rule applies to what its conditions match.
  isMatching: boolean;
  onChooseAll: () => void;
  onChooseMatching: () => void;
  // The conditions, drawn under the second answer while it is picked.
  children?: ReactNode | undefined;
  disabled?: boolean | undefined;
  // Nothing the conditions could be about: the second answer is off.
  isMatchingUnavailable?: boolean | undefined;
  /*
   * The label over the choice ("Applies to"), drawn as a form field's label
   * is. Leave it out where a heading above names the choice already, and
   * name it for a screen reader with ariaLabel instead.
   */
  label?: string | undefined;
  ariaLabel?: string | undefined;
  // Prefix of the test ids: <id>, <id>-all, <id>-matching, <id>-conditions.
  dataTestId?: string | undefined;
}

const RuleAppliesToChoice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const tx: (text: string) => string = (text: string): string => {
    return translateString(text) ?? text;
  };

  const id: string = useId();
  const groupName: string = `rule-applies-to-${id}`;
  const labelId: string = `rule-applies-to-label-${id}`;
  const testId: string = props.dataTestId || "rule-applies-to";

  const renderAnswer: (data: {
    label: string;
    checked: boolean;
    disabled: boolean;
    testIdSuffix: string;
    onChoose: () => void;
  }) => ReactElement = (data: {
    label: string;
    checked: boolean;
    disabled: boolean;
    testIdSuffix: string;
    onChoose: () => void;
  }): ReactElement => {
    return (
      <label
        className={`flex w-fit max-w-full items-center gap-3 ${
          data.disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
        }`}
      >
        {/*
         * The browser's own radio in the product's indigo, as ChoiceRows
         * draws one: it follows the page's light or dark colour scheme.
         */}
        <input
          type="radio"
          name={groupName}
          checked={data.checked}
          disabled={data.disabled}
          data-testid={`${testId}-${data.testIdSuffix}`}
          className={`h-4 w-4 shrink-0 accent-indigo-600 ${
            data.disabled ? "cursor-not-allowed" : "cursor-pointer"
          }`}
          onChange={(): void => {
            if (!data.checked) {
              data.onChoose();
            }
          }}
        />
        <span className="text-sm font-medium leading-6 text-gray-900">
          {tx(data.label)}
        </span>
      </label>
    );
  };

  return (
    <div data-testid={testId}>
      {props.label ? (
        <FieldLabelElement
          title={props.label}
          id={labelId}
          hideOptionalLabel={true}
        />
      ) : (
        <></>
      )}

      <div
        role="radiogroup"
        aria-labelledby={props.label ? labelId : undefined}
        aria-label={
          !props.label && props.ariaLabel ? tx(props.ariaLabel) : undefined
        }
        className={`space-y-2 ${props.label ? "mt-2" : ""}`}
      >
        {renderAnswer({
          label: props.allLabel,
          checked: !props.isMatching,
          disabled: Boolean(props.disabled),
          testIdSuffix: "all",
          onChoose: props.onChooseAll,
        })}
        {renderAnswer({
          label: props.matchingLabel,
          checked: props.isMatching,
          disabled: Boolean(props.disabled || props.isMatchingUnavailable),
          testIdSuffix: "matching",
          onChoose: props.onChooseMatching,
        })}
      </div>

      {props.isMatching && props.children ? (
        <div className="mt-3 sm:pl-7" data-testid={`${testId}-conditions`}>
          {props.children}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default RuleAppliesToChoice;
