import {
  storedInstantToWallClockInput,
  wallClockInputToStoredInstant,
} from "./LayerDateTimeAnchorUtil";
import OneUptimeDate from "Common/Types/Date";
import TimezoneAlias from "Common/Types/TimezoneAlias";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import joinAriaIds from "Common/UI/Utils/AriaIds";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId } from "react";

/*
 * The line under a schedule's times that names their zone - under each of
 * these fields, and under a layer's restriction hours. Gray-500, as the
 * field's own help over it: the gray-400 it was drawn in read at 2.5:1 on
 * white, too faint for the one line that says which zone the minute you
 * pick is in (WCAG asks 4.5:1).
 */
export const TIME_ZONE_NOTE_CLASS_NAME: string = "mt-2 text-xs text-gray-500";

export interface ComponentProps {
  error?: string | undefined;
  onChange?: ((value: Date) => void) | undefined;
  value?: Date | string | undefined;
  initialValue?: Date | string | undefined;
  dataTestId?: string | undefined;
  // The form's label for the field ("Rotation starts at"), which names the input.
  ariaLabelledby?: string | undefined;
  /*
   * The form's help for the field ("When the first person in the layer goes
   * on call."). The input is described by it and then by the zone note under
   * it, so a screen reader hears both, as a sighted person reads them.
   */
  ariaDescribedby?: string | undefined;
  /*
   * The schedule's IANA timezone. The rotation-start / hand-off instant is
   * ENFORCED by the engine as wall-clock in this zone (Layer.addRotationUnits
   * steps day/week/month rotations with the schedule zone), but the
   * datetime-local input captures/displays in the viewer's own zone (their
   * User Settings zone, else the browser's).
   * Without reconciling the two, an admin in a different zone silently
   * configured a hand-off at a different wall-clock than they typed — the same
   * root cause as the restriction times (audit F1), and inconsistent with them
   * (restrictions were already re-anchored while these two fields were not).
   * When set, the value is entered, displayed and stored as wall-clock in this
   * zone; when omitted, the legacy browser-local behavior is preserved.
   */
  timezone?: string | undefined;
}

/*
 * A datetime-local field that anchors the entered wall-clock to the schedule's
 * timezone, mirroring RestrictionTimesFieldElement. Used for "Rotation starts
 * at" and "First hand-off time" so all three time inputs in the layer form
 * share one mental model: everything you type is schedule-zone wall-clock.
 */
const LayerDateTimeFieldElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const zoneNoteId: string = `layer-time-zone-note-${useId()}`;
  /*
   * Display the stored instant in the input as its wall-clock IN THE SCHEDULE
   * TIMEZONE. The Input renders a Date at its current-timezone wall clock, to
   * the minute (OneUptimeDate.toDateTimeLocalMinuteString), so we hand it a
   * Date whose current-timezone wall clock is the schedule-zone wall-clock.
   * A time saved with seconds (08:00:17) reads 08:00, and is saved as it was
   * unless the person picks another (#7593).
   */
  const displayValue: Date | undefined = storedInstantToWallClockInput(
    props.value !== undefined && props.value !== null
      ? props.value
      : props.initialValue,
    props.timezone,
  );

  return (
    <div>
      <Input
        dataTestId={props.dataTestId}
        ariaLabelledby={props.ariaLabelledby}
        ariaDescribedby={joinAriaIds(props.ariaDescribedby, zoneNoteId)}
        type={InputType.DATETIME_LOCAL}
        value={displayValue}
        error={props.error}
        onChange={(value: string) => {
          if (props.onChange) {
            props.onChange(
              wallClockInputToStoredInstant(value, props.timezone),
            );
          }
        }}
      />

      <p id={zoneNoteId} className={TIME_ZONE_NOTE_CLASS_NAME}>
        {props.timezone
          ? translator.translateTemplate(
              "This time is in the schedule's timezone: {{timezone}}.",
              { timezone: TimezoneAlias.getCanonicalTimezone(props.timezone) },
            )
          : translator.translateTemplate(
              "This time is in your local timezone: {{timezone}}.",
              { timezone: OneUptimeDate.getCurrentTimezoneString() },
            )}
      </p>
    </div>
  );
};

export default LayerDateTimeFieldElement;
