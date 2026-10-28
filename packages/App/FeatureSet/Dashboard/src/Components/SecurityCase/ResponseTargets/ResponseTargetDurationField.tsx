import {
  RESPONSE_TARGET_UNITS,
  RESPONSE_TARGET_UNIT_LABELS,
  ResponseTargetEntry,
  ResponseTargetUnit,
  getTargetFieldValue,
  splitTargetMinutes,
} from "./ResponseTargetDuration";
import {
  RESPONSE_TARGETS_COPY,
  RESPONSE_TARGETS_TEST_IDS,
  RESPONSE_TARGET_DURATION_COPY,
} from "./ResponseTargetsCopy";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  // The target as the priority holds it, in minutes; empty for none.
  initialMinutes?: number | null | undefined;
  /*
   * The unit an empty field starts in: minutes for how fast a case is taken
   * on, hours for how fast it is contained.
   */
  emptyUnit?: ResponseTargetUnit | undefined;
  // Minutes, null for no target, or the entry the form's check refuses.
  onChange: (value: number | null | ResponseTargetEntry) => void;
  error?: string | undefined;
  ariaLabelledby?: string | undefined;
  ariaDescribedby?: string | undefined;
  tabIndex?: number | undefined;
}

/*
 * A response target as a person writes it: a whole number, and its unit -
 * "15" "Minutes", "4" "Hours", "3" "Days" - kept as minutes. Empty is no
 * target, which the empty field says. A saved target opens in the largest
 * unit it fills whole (ResponseTargetDuration).
 */
const ResponseTargetDurationField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [entry, setEntry] = useState<ResponseTargetEntry>(() => {
    const split: ResponseTargetEntry = splitTargetMinutes(props.initialMinutes);

    return split.amount
      ? split
      : { amount: "", unit: props.emptyUnit || split.unit };
  });

  const change: (next: ResponseTargetEntry) => void = (
    next: ResponseTargetEntry,
  ): void => {
    setEntry(next);
    props.onChange(getTargetFieldValue(next));
  };

  const unitOptions: Array<DropdownOption> = RESPONSE_TARGET_UNITS.map(
    (unit: ResponseTargetUnit): DropdownOption => {
      return {
        value: unit,
        label: translator.translateText(RESPONSE_TARGET_UNIT_LABELS[unit])!,
      };
    },
  );

  return (
    <div
      className="flex w-full max-w-sm items-start gap-2"
      data-testid={RESPONSE_TARGETS_TEST_IDS.durationField}
    >
      <div className="min-w-0 flex-1">
        <Input
          type={InputType.NUMBER}
          value={entry.amount}
          placeholder={translator.translateText(RESPONSE_TARGETS_COPY.noTarget)}
          // Named by the field's own label; on its own, as an amount.
          {...(props.ariaLabelledby
            ? { ariaLabelledby: props.ariaLabelledby }
            : {
                ariaLabel: translator.translateText(
                  RESPONSE_TARGET_DURATION_COPY.amountLabel,
                ),
              })}
          ariaDescribedby={props.ariaDescribedby}
          ariaInvalid={Boolean(props.error)}
          error={props.error}
          tabIndex={props.tabIndex}
          dataTestId={RESPONSE_TARGETS_TEST_IDS.durationAmount}
          onChange={(value: string) => {
            change({ ...entry, amount: value });
          }}
        />
      </div>
      <div className="w-36 shrink-0">
        {/*
         * A unit is always picked - there is no "no unit" to clear to; an
         * empty amount is what says no target.
         */}
        <Dropdown
          options={unitOptions}
          isClearable={false}
          value={unitOptions.find((option: DropdownOption): boolean => {
            return option.value === entry.unit;
          })}
          ariaLabel={translator.translateText(
            RESPONSE_TARGET_DURATION_COPY.unitLabel,
          )}
          dataTestId={RESPONSE_TARGETS_TEST_IDS.durationUnit}
          onChange={(
            value: DropdownValue | Array<DropdownValue> | null,
          ): void => {
            if (
              value === ResponseTargetUnit.Minutes ||
              value === ResponseTargetUnit.Hours ||
              value === ResponseTargetUnit.Days
            ) {
              change({ ...entry, unit: value });
            }
          }}
        />
      </div>
    </div>
  );
};

export default ResponseTargetDurationField;
