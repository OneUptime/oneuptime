import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import Divider from '../Divider/Divider';
import BasicForm from '../Forms/BasicForm';
import FormFieldSchemaType from '../Forms/Types/FormFieldSchemaType';
import FormValues from '../Forms/Types/FormValues';
import SideOver from '../SideOver/SideOver';
import { NodeDataProp } from './Component';

export interface ComponentProps {
    title: string;
    description: string;
    onClose: () => void;
    onSave: (component: NodeDataProp) => void;
    component: NodeDataProp;
}

const ComponentSettingsModal: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    const [component, setComponent] = useState<NodeDataProp>(props.component)

    return (
        <SideOver title={props.title} description={props.description} onClose={props.onClose} onSubmit={() => component && props.onSave(component)}>
            <>

                <BasicForm
                    hideSubmitButton={true}
                    initialValues={{
                        id: props.component?.id
                    }}
                    onChange={(values: FormValues<JSONObject>) => {
                        setComponent({ ...component, ...values });
                    }}
                    fields={[
                        {
                            title: 'ID',
                            description: `Component ID will make it easier for you to connect to other components.`,
                            field: {
                                id: true,
                            },

                            required: true,

                            fieldType: FormFieldSchemaType.Text,
                        },

                    ]}

                />

                <Divider/>


            </>
        </SideOver>
    );
};

export default ComponentSettingsModal;
