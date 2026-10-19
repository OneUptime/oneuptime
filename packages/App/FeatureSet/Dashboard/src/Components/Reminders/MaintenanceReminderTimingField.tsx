import {
  MAINTENANCE_REMINDER_NEVER_REMINDS_NOTE,
  MAINTENANCE_REMINDER_TIMING_COPY,
  MAINTENANCE_REMINDER_TIMINGS,
  MaintenanceReminderTiming,
  isMaintenanceReminderTiming,
} from "./MaintenanceReminderTiming";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Radio, {
  RadioOption,
  RadioValue,
} from "Common/UI/Components/Radio/Radio";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // The answer the rule's columns make; null for the pair that never reminds.
  value: MaintenanceReminderTiming | null;
  onChange: (timing: MaintenanceReminderTiming) => void;
  error?: string | undefined;
  ariaLabelledby?: string | undefined;
}

/*
 * "Remind Owners": while the event is in progress, before it starts, or
 * both - three plain answers, each with one line saying what it means,
 * where a dropdown and a switch whose help explained two modes used to be
 * (MaintenanceReminderTiming.ts).
 */
const MaintenanceReminderTimingField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const options: Array<RadioOption> = MAINTENANCE_REMINDER_TIMINGS.map(
    (timing: MaintenanceReminderTiming): RadioOption => {
      return {
        value: timing,
        label:
          translator.translateText(
            MAINTENANCE_REMINDER_TIMING_COPY[timing].title,
          ) || MAINTENANCE_REMINDER_TIMING_COPY[timing].title,
        description:
          translator.translateText(
            MAINTENANCE_REMINDER_TIMING_COPY[timing].description,
          ) || MAINTENANCE_REMINDER_TIMING_COPY[timing].description,
      };
    },
  );

  return (
    <div data-testid="maintenance-reminder-timing">
      <Radio
        className="mt-0"
        dataTestId="maintenance-reminder-timing-options"
        ariaLabelledby={props.ariaLabelledby}
        options={options}
        value={props.value || undefined}
        error={props.error}
        onChange={(value: RadioValue | null): void => {
          if (isMaintenanceReminderTiming(value)) {
            props.onChange(value);
          }
        }}
      />
      {/*
       * The product's warning beside a form field (as on Declare Incident's
       * status page scope): an amber box with its icon, so a rule that
       * never reminds is noticed, not read past as more help text.
       */}
      {props.value === null ? (
        <div
          role="note"
          className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          data-testid="maintenance-reminder-never-reminds"
        >
          <Icon icon={IconProp.Alert} className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {translator.translateText(MAINTENANCE_REMINDER_NEVER_REMINDS_NOTE)}
          </span>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default MaintenanceReminderTimingField;
