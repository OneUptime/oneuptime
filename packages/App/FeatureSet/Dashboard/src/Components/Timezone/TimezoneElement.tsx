import OneUptimeDate from "Common/Types/Date";
import Timezone from "Common/Types/Timezone";
import TimezoneAlias from "Common/Types/TimezoneAlias";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  timezone: Timezone;
}

const TimezoneElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * Shown under its current name, the one the edit form selects: a profile
   * saved as "Singapore" reads "GMT+8 Asia/Singapore" in both places.
   */
  return (
    <p>
      {OneUptimeDate.getGmtOffsetFriendlyStringByTimezone(
        TimezoneAlias.getCanonicalTimezone(props.timezone),
      )}
    </p>
  );
};

export default TimezoneElement;
