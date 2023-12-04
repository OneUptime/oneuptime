import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import OnCallDutyPolicyScheduleLayer from 'Model/Models/OnCallDutyPolicyScheduleLayer';
import Layer from './Layer';
import Button, { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import IconProp from 'Common/Types/Icon/IconProp';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import API from 'CommonUI/src/Utils/API/API';
import ObjectID from 'Common/Types/ObjectID';
import RestrictionTimes from 'Common/Types/OnCallDutyPolicy/RestrictionTimes';
import OneUptimeDate from 'Common/Types/Date';
import ComponentLoader from 'CommonUI/src/Components/ComponentLoader/ComponentLoader';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import EmptyState from 'CommonUI/src/Components/EmptyState/EmptyState';
import Recurring from 'Common/Types/Events/Recurring';
import HorizontalRule from 'CommonUI/src/Components/HorizontalRule/HorizontalRule';
import Dictionary from 'Common/Types/Dictionary';
import OnCallDutyPolicyScheduleLayerUser from 'Model/Models/OnCallDutyPolicyScheduleLayerUser';

export interface ComponentProps {
    onCallDutyPolicyScheduleId: ObjectID;
    projectId: ObjectID;
}

const Layers: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [isLoading, setIsLoading] = React.useState<boolean>(false);

    const [layers, setLayers] = React.useState<
        Array<OnCallDutyPolicyScheduleLayer>
    >([]);

    const [layerUsers, setLayerUsers] = React.useState<Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>>>({});

    const [isAddbuttonLoading, setIsAddButtonLoading] =
        React.useState<boolean>(false);

    const [error, setError] = React.useState<string>('');

    const [isDeletetingLayerId, setIsDeletingLayerId] = React.useState<
        Array<ObjectID>
    >([]);

    const [showCannotDeleteOnlyLayerError, setShowCannotDeleteOnlyLayerError] =
        React.useState<boolean>(false);

    useEffect(() => {
        //fetch layers.
        fetchLayers().catch((err: Error) => {
            setError(err.message);
        });
    }, []);

    const addLayer: Function = async () => {
        setIsAddButtonLoading(true);

        try {
            const onCallPolicyScheduleLayer: OnCallDutyPolicyScheduleLayer =
                new OnCallDutyPolicyScheduleLayer();
            onCallPolicyScheduleLayer.onCallDutyPolicyScheduleId =
                props.onCallDutyPolicyScheduleId;
            onCallPolicyScheduleLayer.projectId = props.projectId;

            // count the layers and generate a unique name for this layer.
            const newLayerName: string = `Layer ${layers.length + 1}`;
            onCallPolicyScheduleLayer.name = newLayerName;

            onCallPolicyScheduleLayer.handOffTime = OneUptimeDate.addRemoveDays(
                OneUptimeDate.getCurrentDate(),
                1
            );

            // count the description and generate a unique description for this layer.
            const newLayerDescription: string = `Layer ${
                layers.length + 1
            } description.`;
            onCallPolicyScheduleLayer.description = newLayerDescription;
            onCallPolicyScheduleLayer.order = layers.length + 1;
            onCallPolicyScheduleLayer.restrictionTimes =
                RestrictionTimes.getDefault();
            onCallPolicyScheduleLayer.rotation = Recurring.getDefault();
            onCallPolicyScheduleLayer.startsAt = OneUptimeDate.getCurrentDate();

            const newLayer: HTTPResponse<
                | OnCallDutyPolicyScheduleLayer
                | OnCallDutyPolicyScheduleLayer[]
                | JSONObject
                | JSONArray
            > = await ModelAPI.create<OnCallDutyPolicyScheduleLayer>(
                onCallPolicyScheduleLayer,
                OnCallDutyPolicyScheduleLayer,
                {}
            );

            // add this layer to layers array and set it.
            setLayers([
                ...layers,
                newLayer.data as OnCallDutyPolicyScheduleLayer,
            ]);
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }

        setIsAddButtonLoading(false);
    };

    const deleteLayer: Function = async (
        item: OnCallDutyPolicyScheduleLayer
    ) => {
        if (!item.id) {
            throw new BadDataException('item.id cannot be null');
        }

        if (layers.length === 1) {
            setShowCannotDeleteOnlyLayerError(true);
            return;
        }

        // push this layer id to isDeletetingLayerId array.
        setIsDeletingLayerId([...isDeletetingLayerId, item.id]);

        try {
            await ModelAPI.deleteItem<OnCallDutyPolicyScheduleLayer>(
                OnCallDutyPolicyScheduleLayer,
                item.id,
                {}
            );

            // remove this layer from layers array and set it.

            const newLayers: Array<OnCallDutyPolicyScheduleLayer> =
                layers.filter((layer: OnCallDutyPolicyScheduleLayer) => {
                    return layer.id?.toString() !== item.id?.toString();
                });

            setLayers(newLayers);
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }

        // remove this layer id from isDeletetingLayerId array.
        setIsDeletingLayerId(
            isDeletetingLayerId.filter((id: ObjectID) => {
                return id?.toString() !== item.id?.toString();
            })
        );
    };

    const addLayerButton: Function = (): ReactElement => {
        return (
            <div className="-ml-3 mt-5">
                <Button
                    title="Add New Layer"
                    isLoading={isAddbuttonLoading}
                    onClick={() => {
                        addLayer();
                    }}
                    icon={IconProp.Add}
                />
            </div>
        );
    };

    const fetchLayers: Function = async () => {
        setIsLoading(true);

        try {
            const layers: ListResult<OnCallDutyPolicyScheduleLayer> =
                await ModelAPI.getList<OnCallDutyPolicyScheduleLayer>(
                    OnCallDutyPolicyScheduleLayer,
                    {
                        onCallDutyPolicyScheduleId:
                            props.onCallDutyPolicyScheduleId,
                        projectId: props.projectId,
                    },
                    LIMIT_PER_PROJECT,
                    0,
                    {
                        order: true,
                        name: true,
                        description: true,
                        startsAt: true,
                        restrictionTimes: true,
                        rotation: true,
                        onCallDutyPolicyScheduleId: true,
                        projectId: true,
                        handOffTime: true,
                    },
                    {
                        order: SortOrder.Ascending,
                    }
                );

            setLayers(layers.data);
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }

        setIsLoading(false);
    };

    if (isLoading) {
        return <ComponentLoader />;
    }

    if (error) {
        return <ErrorMessage error={error} />;
    }

    return (
        <div>
            <div>
                {layers.map(
                    (layer: OnCallDutyPolicyScheduleLayer, i: number) => {
                        return (
                            <Layer
                                key={i}
                                isDeleteButtonLoading={Boolean(
                                    isDeletetingLayerId.find((id: ObjectID) => {
                                        return (
                                            id.toString() ===
                                            layer.id?.toString()
                                        );
                                    })
                                )}
                                layer={layer}
                                onDeleteLayer={() => {
                                    deleteLayer(layer);
                                }}
                                onLayerUsersUpdateOrLoaded={(users: Array<OnCallDutyPolicyScheduleLayerUser>) => {
                                    setLayerUsers({
                                        ...layerUsers,
                                        [layer.id?.toString() || '']: users
                                    });
                                }}
                                onLayerChange={(
                                    layer: OnCallDutyPolicyScheduleLayer
                                ) => {
                                    // update this layer in layers array and set it.
                                    const newLayers: Array<OnCallDutyPolicyScheduleLayer> =
                                        layers.map(
                                            (
                                                item: OnCallDutyPolicyScheduleLayer
                                            ) => {
                                                if (item.id === layer.id) {
                                                    return layer;
                                                }
                                                return item;
                                            }
                                        );

                                    setLayers(newLayers);
                                }}
                            />
                        );
                    }
                )}
            </div>

            {layers.length === 0 && (
                <EmptyState
                    footer={addLayerButton()}
                    showSolidBackground={false}
                    id="no-layers"
                    title={'No Layers in this On Call Schedule'}
                    description={
                        'No layers in this on-call schedule. Please add one.'
                    }
                    icon={IconProp.SquareStack}
                />
            )}

            {layers.length > 0 && addLayerButton()}

            {showCannotDeleteOnlyLayerError ? (
                <ConfirmModal
                    title={`Cannot delete layer`}
                    description={
                        <div>Schedule must have at least one layer.</div>
                    }
                    isLoading={false}
                    submitButtonText={'Close'}
                    submitButtonType={ButtonStyleType.NORMAL}
                    onSubmit={() => {
                        return setShowCannotDeleteOnlyLayerError(false);
                    }}
                />
            ) : (
                <></>
            )}

            <HorizontalRule />


        </div>
    );
};

export default Layers;
