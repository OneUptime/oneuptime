import {
  MEASUREMENT_FORM_COPY,
  MeasurementForm,
  MeasurementSummary,
  MeasurementValues,
  getMeasurementSummary,
} from "../../Utils/Measurement/MeasurementSetup";
import useTranslateValue from "Common/UI/Utils/Translation";
import { fillTemplate } from "Common/UI/Utils/TranslateTemplate";
import {
  MEASUREMENT_LAST_TIME_TEMPLATE,
  MeasurementEndDescription,
} from "Common/Utils/Measurement/MeasurementMoments";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  form: MeasurementForm;
  measurement: MeasurementValues;
  /*
   * The text's size and colour. The list draws it as a value; an event's
   * Measurements card as the quiet line under a measurement's name.
   */
  className?: string | undefined;
}

/*
 * What a measurement measures, in the list: "Declared → Acknowledged". The
 * columns this replaced read "Starts At: Timeline Start, Ends At: State Role
 * Entered", which did not even say which state.
 */
const MeasurementSummaryElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const translate: (text: string) => string = (text: string): string => {
    return translateString(text) ?? text;
  };

  const describe: (end: MeasurementEndDescription | null) => string = (
    end: MeasurementEndDescription | null,
  ): string => {
    if (!end) {
      return translate(MEASUREMENT_FORM_COPY.noMoment);
    }

    // A state's name is the project's own word for it, never translated.
    const label: string = end.isStateName ? end.label : translate(end.label);

    if (!end.isLastTime) {
      return label;
    }

    return fillTemplate(translate(MEASUREMENT_LAST_TIME_TEMPLATE), {
      moment: label,
    });
  };

  const summary: MeasurementSummary = getMeasurementSummary({
    form: props.form,
    measurement: props.measurement,
  });

  return (
    <span
      className={props.className || "text-sm text-gray-900"}
      data-testid="measurement-summary"
    >
      {describe(summary.start)}
      <span className="mx-1.5 text-gray-400">→</span>
      {describe(summary.end)}
    </span>
  );
};

export default MeasurementSummaryElement;
