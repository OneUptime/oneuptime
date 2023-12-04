import OnCallDutyPolicyScheduleLayer from 'Model/Models/OnCallDutyPolicyScheduleLayer';
import OnCallDutyPolicyScheduleLayerUser from 'Model/Models/OnCallDutyPolicyScheduleLayerUser';
import React, {
    FunctionComponent,
    ReactElement,
} from 'react';
import LayersPreview from './LayersPreview';

export interface ComponentProps {
    layer: OnCallDutyPolicyScheduleLayer;
    layerUsers: Array<OnCallDutyPolicyScheduleLayerUser>;
    id?: string | undefined;
}

const LayerPreview: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return <LayersPreview layers={[props.layer]} allLayerUsers={{[props.layer.id?.toString() || '']: props.layerUsers}} />;
};

export default LayerPreview;
