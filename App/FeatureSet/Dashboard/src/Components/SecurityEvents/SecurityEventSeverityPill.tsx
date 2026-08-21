import React, { FunctionComponent, ReactElement } from "react";
import Pill from "Common/UI/Components/Pill/Pill";
import Color from "Common/Types/Color";
import { Blue, Gray500, Orange, Red, Yellow } from "Common/Types/BrandColors";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";

export interface ComponentProps {
  severityName?: string | undefined;
}

export function getSeverityColor(severityName: string | undefined): Color {
  switch (severityName) {
    case OcsfSeverity.Critical:
    case OcsfSeverity.Fatal:
      return Red;
    case OcsfSeverity.High:
      return Orange;
    case OcsfSeverity.Medium:
      return Yellow;
    case OcsfSeverity.Low:
      return Blue;
    case OcsfSeverity.Unknown:
    case OcsfSeverity.Informational:
    default:
      return Gray500;
  }
}

const SecurityEventSeverityPill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Pill
      color={getSeverityColor(props.severityName)}
      text={props.severityName || OcsfSeverity.Unknown}
    />
  );
};

export default SecurityEventSeverityPill;
