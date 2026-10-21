import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import { PluralTemplate, Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  value?: Recurring | undefined;
  postfix?: string | undefined;
}

// "Every 2 days" reads "2 Days": the count picks the language's plural form.
export const RECURRING_INTERVAL_TEMPLATES: Record<
  EventInterval,
  PluralTemplate
> = {
  [EventInterval.Hour]: { one: "{{count}} Hour", other: "{{count}} Hours" },
  [EventInterval.Day]: { one: "{{count}} Day", other: "{{count}} Days" },
  [EventInterval.Week]: { one: "{{count}} Week", other: "{{count}} Weeks" },
  [EventInterval.Month]: { one: "{{count}} Month", other: "{{count}} Months" },
  [EventInterval.Year]: { one: "{{count}} Year", other: "{{count}} Years" },
};

const RecurringViewElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.value) {
    return <p>-</p>;
  }

  const value: Recurring = Recurring.fromJSON(props.value);
  const template: PluralTemplate | undefined =
    RECURRING_INTERVAL_TEMPLATES[value.intervalType];
  const count: number | undefined = value.intervalCount?.toNumber();

  return (
    <p>
      {template && count !== undefined
        ? translator.translatePlural(template, count)
        : translator.translateText(
            EventInterval[value.intervalType]?.toString(),
          )}
      {props.postfix || ""}
    </p>
  );
};

export default RecurringViewElement;
