import {
  CRITICALITY_WEIGHT_LABELS,
  ENTITY_RISK_TEST_IDS,
} from "./EntityRiskCopy";
import Color from "Common/Types/Color";
import { Gray500, Indigo500, Purple } from "Common/Types/BrandColors";
import { SecurityEntityCriticality } from "Common/Types/SecurityCase/SecurityEntityRisk";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * How much an entity matters, as Entity Criticality says it, with the
 * weight it puts on the entity's risk: "Extreme (×2)". Coloured apart from
 * the risk levels - it is about the entity, not about what was found.
 */
export function getEntityCriticalityColor(
  criticality: SecurityEntityCriticality,
): Color {
  switch (criticality) {
    case SecurityEntityCriticality.Extreme:
      return Purple;
    case SecurityEntityCriticality.High:
      return Indigo500;
    default:
      return Gray500;
  }
}

const EntityCriticalityPill: FunctionComponent<{
  criticality: SecurityEntityCriticality;
  size?: PillSize | undefined;
}> = (props: {
  criticality: SecurityEntityCriticality;
  size?: PillSize | undefined;
}): ReactElement => {
  return (
    <span data-testid={ENTITY_RISK_TEST_IDS.criticalityPill}>
      <Pill
        text={CRITICALITY_WEIGHT_LABELS[props.criticality]}
        color={getEntityCriticalityColor(props.criticality)}
        size={props.size || PillSize.Small}
      />
    </span>
  );
};

export default EntityCriticalityPill;
