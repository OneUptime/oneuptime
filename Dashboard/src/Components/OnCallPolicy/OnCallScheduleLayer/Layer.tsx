import React, { FunctionComponent, ReactElement } from 'react';
import OnCallDutyPolicyScheduleLayer from 'Model/Models/OnCallDutyPolicyScheduleLayer';
import Card from 'CommonUI/src/Components/Card/Card';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import IconProp from 'Common/Types/Icon/IconProp';
import LayerBasicInfo from './LayerBasicInfo';
import HorizontalRule from 'CommonUI/src/Components/HorizontalRule/HorizontalRule';
import LayerStartsAt from './LayerStartTime';
import LayerReestrictionTimes from './LayerRestrictionTimes';
import LayerUser from './LayerUser';

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
        <div className='mb-10 '>
            <Card
                title={`Layer ${props.layer.order?.toString() || ''}`}
                description={'On Call Schedule Layer. Layers on top have priority.'}
                buttons={[
                    {
                        title: 'Delete Layer',
                        onClick: props.onDeleteLayer,
                        icon: IconProp.Trash,
                        buttonStyle: ButtonStyleType.NORMAL,
                        isLoading: props.isDeleteButtonLoading,
                    },
                ]}
            >
                <div className='bg-gray-50 -ml-6 -mr-6 pl-6 pr-6 pt-6 -mb-6 pb-6'>
                    <LayerBasicInfo
                        layer={props.layer}
                        onLayerChange={(layer: OnCallDutyPolicyScheduleLayer) => {
                            props.onLayerChange(layer);
                        }}
                    />

                    <HorizontalRule />

                    <LayerUser layer={props.layer} />

                    <HorizontalRule />

                    <LayerStartsAt
                        layer={props.layer}
                        onLayerChange={(layer: OnCallDutyPolicyScheduleLayer) => {
                            props.onLayerChange(layer);
                        }}
                    />

                    <HorizontalRule />

                    <LayerReestrictionTimes
                        layer={props.layer}
                        onLayerChange={(layer: OnCallDutyPolicyScheduleLayer) => {
                            props.onLayerChange(layer);
                        }}
                    />
                </div>
                <div>
                    {/** Layer Preview */}
                </div>
            </Card>
        </div>
    );
};

export default Layer;
