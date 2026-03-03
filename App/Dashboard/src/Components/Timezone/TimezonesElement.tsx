import Timezone from "Common/Types/Timezone";
import React, { FunctionComponent, ReactElement } from "react";
import TimezoneElement from "./TimezoneElement";

export interface ComponentProps {
  timezones: Array<Timezone>;
}

const TimezonesElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div>
      {props.timezones.map((timezone: Timezone) => {
        return <TimezoneElement timezone={timezone} key={timezone} />;
      })}
    </div>
  );
};

export default TimezonesElement;
