import React, { FunctionComponent, ReactElement, useEffect, useState } from 'react';
import OnCallDutyPolicyScheduleLayer from 'Model/Models/OnCallDutyPolicyScheduleLayer';
import Card from 'CommonUI/src/Components/Card/Card';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import IconProp from 'Common/Types/Icon/IconProp';
import LayerBasicInfo from './LayerBasicInfo';
import HorizontalRule from 'CommonUI/src/Components/HorizontalRule/HorizontalRule';
import LayerStartsAt from './LayerStartTime';
import LayerReestrictionTimes from './LayerRestrictionTimes';
import LayerUser from './LayerUser';
import LayerRotation from './LayerRotation';
import OnCallDutyPolicyScheduleLayerUser from 'Model/Models/OnCallDutyPolicyScheduleLayerUser';
import LayerPreview from './LayerPreview';
import BaseModel from 'Common/Models/BaseModel';

export interface ComponentProps {
    layer: OnCallDutyPolicyScheduleLayer;
    onDeleteLayer: () => void;
    onLayerChange: (layer: OnCallDutyPolicyScheduleLayer) => void;
    isDeleteButtonLoading: boolean;
    onLayerUsersUpdateOrLoaded: (layerUsers: Array<OnCallDutyPolicyScheduleLayerUser>) => void;
}

const Layer: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [layerUsers, setLayerUsers] = useState<
        Array<OnCallDutyPolicyScheduleLayerUser>
    >([]);


    useEffect(() => {
        props.onLayerUsersUpdateOrLoaded(layerUsers);
    }, [layerUsers]);    

    const [layer, setLayer] = useState<OnCallDutyPolicyScheduleLayer>(
        props.layer
    );

    const updateLayer: Function = (
        updatedLayer: OnCallDutyPolicyScheduleLayer
    ): void => {
        updatedLayer = BaseModel.fromJSON(
            BaseModel.toJSON(updatedLayer, OnCallDutyPolicyScheduleLayer),
            OnCallDutyPolicyScheduleLayer
        ) as OnCallDutyPolicyScheduleLayer;

        setLayer(updatedLayer);
        props.onLayerChange(updatedLayer);
    };

    return (
        <div className="mb-10 ">
            <Card
                title={`Layer ${props.layer.order?.toString() || ''}`}
                description={
                    'On Call Schedule Layer. Layers on top have priority.'
                }
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
                <div className="bg-gray-50 -ml-6 -mr-6 pl-6 pr-6 pt-6 -mb-6 pb-6">
                    <LayerBasicInfo
                        layer={layer}
                        onLayerChange={(
                            updatedLayer: OnCallDutyPolicyScheduleLayer
                        ) => {
                            layer.name = updatedLayer.name!;
                            layer.description = updatedLayer.description!;

                            updateLayer(layer);
                        }}
                    />

                    <HorizontalRule />

                    <LayerUser
                        onUpdateUsers={(
                            list: Array<OnCallDutyPolicyScheduleLayerUser>
                        ) => {
                            setLayerUsers(list);
                        }}
                        layer={layer}
                    />

                    <HorizontalRule />

                    <LayerStartsAt
                        layer={layer}
                        onLayerChange={(
                            updatedLayer: OnCallDutyPolicyScheduleLayer
                        ) => {
                            layer.startsAt = updatedLayer.startsAt!;

                            updateLayer(layer);
                        }}
                    />

                    <HorizontalRule />

                    <LayerRotation
                        layer={layer}
                        onLayerChange={(
                            updatedLayer: OnCallDutyPolicyScheduleLayer
                        ) => {
                            layer.rotation = updatedLayer.rotation!;
                            layer.handOffTime = updatedLayer.handOffTime!;

                            updateLayer(layer);
                        }}
                    />

                    <HorizontalRule />

                    <LayerReestrictionTimes
                        layer={layer}
                        onLayerChange={(
                            updatedLayer: OnCallDutyPolicyScheduleLayer
                        ) => {
                            layer.restrictionTimes =
                                updatedLayer.restrictionTimes!;

                            updateLayer(layer);
                        }}
                    />

                    <HorizontalRule />

                    <LayerPreview layer={layer} layerUsers={layerUsers} />
                </div>
            </Card>
        </div>
    );
};

export default Layer;
