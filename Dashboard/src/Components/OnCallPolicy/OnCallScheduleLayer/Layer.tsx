import React, { FunctionComponent, ReactElement } from 'react';
import OnCallDutyPolicyScheduleLayer from 'Model/Models/OnCallDutyPolicyScheduleLayer';
import Card from 'CommonUI/src/Components/Card/Card';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import IconProp from 'Common/Types/Icon/IconProp';
import LayerBasicInfo from './LayerBasicInfo';
import HorizontalRule from 'CommonUI/src/Components/HorizontalRule/HorizontalRule';
import LayerStartsAt from './LayerStartTime';

export interface ComponentProps {
    layer: OnCallDutyPolicyScheduleLayer;
    onDeleteLayer: () => void;
    onLayerChange: (layer: OnCallDutyPolicyScheduleLayer) => void;
    isDeleteButtonLoading: boolean;
}

const Layer: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <Card title={`Layer ${props.layer.order?.toString() || ''}`} description={"On Call Schedule Layer. Layers on top have priority."} buttons={[
            {
                title: 'Delete',
                onClick: props.onDeleteLayer,
                icon: IconProp.Trash,
                buttonStyle: ButtonStyleType.NORMAL,
                isLoading: props.isDeleteButtonLoading
            }
        ]}>

            <LayerBasicInfo layer={props.layer} onLayerChange={(layer: OnCallDutyPolicyScheduleLayer) => {
                props.onLayerChange(layer);
            }} />

            <HorizontalRule />

            <LayerStartsAt layer={props.layer} onLayerChange={(layer: OnCallDutyPolicyScheduleLayer) => {
                props.onLayerChange(layer);
            }} />

            <HorizontalRule />

            

        </Card>
    );
};

export default Layer;
