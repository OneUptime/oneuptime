import Timezone from "Common/Types/Timezone";
import TimezoneAlias from "Common/Types/TimezoneAlias";
import React, { FunctionComponent, ReactElement } from "react";
import TimezoneElement from "./TimezoneElement";

export interface ComponentProps {
  timezones: Array<Timezone>;
}

const TimezonesElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * In current names, each once: a list saved with both "Singapore" and
   * "Asia/Singapore" is one timezone, and would otherwise show the same line
   * twice under the same React key.
   */
  return (
    <div>
      {TimezoneAlias.getCanonicalTimezones(props.timezones).map(
        (timezone: Timezone) => {
          return <TimezoneElement timezone={timezone} key={timezone} />;
        },
      )}
    </div>
  );
};

export default TimezonesElement;
