import {
  MerakiTemplate,
  drawMerakiTemplate,
  getMerakiIntervalOptions,
  getMerakiIntervalWords,
} from "./MerakiWords";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import {
  findDropdownOption,
  getTranslatedDropdownOption,
  readPickedDropdownValue,
} from "Common/UI/Components/Dropdown/DropdownChoices";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * How often a Meraki connection reads its uplinks: "Read uplink usage" in
 * the connect dialog and in the edit dialog. The shared Dropdown, named by
 * the field's <label htmlFor={inputId}>, and never empty: a connection
 * always reads on some interval.
 */
export interface ComponentProps {
  inputId: string;
  dataTestId: string;
  // In minutes.
  value: number;
  onChange: (minutes: number) => void;
}

const MerakiReadIntervalPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const choices: Array<{ value: number; words: MerakiTemplate }> =
    getMerakiIntervalOptions();

  /*
   * An interval saved before the list was what it is now is still shown, in
   * its own words, rather than as an empty picker.
   */
  if (
    !choices.some((choice: { value: number }): boolean => {
      return choice.value === props.value;
    })
  ) {
    choices.push({
      value: props.value,
      words: getMerakiIntervalWords(props.value),
    });
  }

  const options: Array<DropdownOption> = choices.map(
    (option: { value: number; words: MerakiTemplate }): DropdownOption => {
      return getTranslatedDropdownOption(
        option.value,
        drawMerakiTemplate(translator, option.words),
      );
    },
  );

  return (
    <div className="mt-1" data-testid={props.dataTestId}>
      <Dropdown
        inputId={props.inputId}
        className="relative w-full overflow-visible"
        options={options}
        value={findDropdownOption(options, props.value)}
        isClearable={false}
        onChange={(next: DropdownValue | Array<DropdownValue> | null): void => {
          const picked: string | null = readPickedDropdownValue(next);

          if (picked !== null && Number(picked) !== props.value) {
            props.onChange(Number(picked));
          }
        }}
      />
    </div>
  );
};

export default MerakiReadIntervalPicker;
