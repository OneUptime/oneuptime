import LayersPreview from "./LayersPreview";
import OnCallDutyPolicyScheduleLayer from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  layer: OnCallDutyPolicyScheduleLayer;
  layerUsers: Array<OnCallDutyPolicyScheduleLayerUser>;
  id?: string | undefined;
}

const LayerPreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <LayersPreview
      layers={[props.layer]}
      showFieldLabel={true}
      allLayerUsers={{
        [props.layer.id?.toString() || ""]: props.layerUsers,
      }}
    />
  );
};

export default LayerPreview;
