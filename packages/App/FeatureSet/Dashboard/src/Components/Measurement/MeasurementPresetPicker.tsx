import CardSelect, {
  CardSelectOption,
} from "Common/UI/Components/CardSelect/CardSelect";
import useTranslateValue from "Common/UI/Utils/Translation";
import {
  MeasurementDomain,
  MeasurementPreset,
  getMeasurementPresets,
} from "Common/Utils/Measurement/MeasurementMoments";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  domain: MeasurementDomain;
  // The picked preset's id, or "" while none is.
  value: string;
  onChange: (presetId: string) => void;
  error?: string | undefined;
  ariaLabelledby?: string | undefined;
}

/*
 * "What do you want to measure?": the common measurements as cards, each
 * saying in a line what it measures, and "Something else". The cards are
 * the explanation as much as the shortcut - "From when an incident is
 * declared until someone acknowledges it" says what a measurement is better
 * than any paragraph. CardSelect draws its cards as it is handed them, so
 * they are put in the reader's language here.
 */
const MeasurementPresetPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const translate: (text: string) => string = (text: string): string => {
    return translateString(text) ?? text;
  };

  const options: Array<CardSelectOption> = getMeasurementPresets(
    props.domain,
  ).map((preset: MeasurementPreset): CardSelectOption => {
    return {
      value: preset.id,
      title: translate(preset.name),
      description: translate(preset.description),
      icon: preset.icon,
    };
  });

  return (
    <CardSelect
      dataTestId="measurement-preset-picker"
      ariaLabelledby={props.ariaLabelledby}
      options={options}
      value={props.value}
      maxColumns={2}
      error={props.error ? translate(props.error) : undefined}
      onChange={(value: string): void => {
        props.onChange(value);
      }}
    />
  );
};

export default MeasurementPresetPicker;
