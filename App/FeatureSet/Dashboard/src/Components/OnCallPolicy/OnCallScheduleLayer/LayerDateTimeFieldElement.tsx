import {
  storedInstantToWallClockInput,
  wallClockInputToStoredInstant,
} from "./LayerDateTimeAnchorUtil";
import OneUptimeDate from "Common/Types/Date";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  error?: string | undefined;
  onChange?: ((value: Date) => void) | undefined;
  value?: Date | string | undefined;
  initialValue?: Date | string | undefined;
  dataTestId?: string | undefined;
  /*
   * The schedule's IANA timezone. The rotation-start / hand-off instant is
   * ENFORCED by the engine as wall-clock in this zone (Layer.addRotationUnits
   * steps day/week/month rotations with the schedule zone), but the
   * datetime-local input captures/displays in the viewer's BROWSER zone.
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
  /*
   * Display the stored instant in the input as its wall-clock IN THE SCHEDULE
   * TIMEZONE (the datetime-local input renders in browser-local time, so we
   * hand it a local Date carrying the schedule-zone wall-clock).
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

      <p className="mt-2 text-xs text-gray-400">
        {props.timezone
          ? `This time is in the schedule's timezone: ${props.timezone}.`
          : `This time is in your local timezone: ${OneUptimeDate.getCurrentTimezoneString()}.`}
      </p>
    </div>
  );
};

export default LayerDateTimeFieldElement;
