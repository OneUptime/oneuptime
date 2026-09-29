import Color from "Common/Types/Color";
import SloStatus from "Common/Types/ServiceLevelObjective/SloStatus";
import {
  getSloStatusColor,
  getSloStatusText,
} from "Common/Utils/Slo/SloStatusColor";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  status: SloStatus | undefined | null;
  size?: PillSize | undefined;
}

/**
 * The SLO status pill, shared by the SLOs list and the SLO overview.
 *
 * Both pages previously carried their own copy of the colour switch, and
 * both defaulted a missing status to "Healthy" — so an SLO the evaluation
 * worker had not touched yet rendered a green "Healthy" pill asserting a
 * reliability claim nothing backed. The shared helpers in
 * Common/Utils/Slo/SloStatusColor deliberately render that case as a grey
 * "Unknown"; this component is the single place that decision is applied.
 */
const SloStatusPill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const color: Color = getSloStatusColor(props.status);

  return (
    <Pill
      text={getSloStatusText(props.status)}
      color={color}
      size={props.size || PillSize.Small}
    />
  );
};

export default SloStatusPill;
