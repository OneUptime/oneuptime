import React, { FunctionComponent, ReactElement } from 'react';
import OnCallDutyPolicyScheduleLayer from 'Model/Models/OnCallDutyPolicyScheduleLayer';
import Layer from './Layer';
import Button from 'CommonUI/src/Components/Button/Button';
import IconProp from 'Common/Types/Icon/IconProp';


export interface ComponentProps {
    layers: Array<OnCallDutyPolicyScheduleLayer>;
    onAddNewLayer: () => void;
    onDeleteLayer: (layer: OnCallDutyPolicyScheduleLayer) => void;
}

const Layers: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {



    return (
        <div>
            <div>
                {props.layers.map((layer: OnCallDutyPolicyScheduleLayer) => {
                    return (
                        <Layer
                            layer={layer}
                            onDeleteLayer={() => {
                                props.onDeleteLayer(layer);
                            }}
                            onLayerChange={(_layer: OnCallDutyPolicyScheduleLayer) => {

                            }}
                        />
                    );
                })}
            </div>

            <div>
                <Button title='Add New Layer' onClick={props.onAddNewLayer} icon={IconProp.Add} />
            </div>
        </div>
    );
};

export default Layers;
