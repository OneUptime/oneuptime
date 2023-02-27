
import React, { FunctionComponent, ReactElement, useEffect, useState } from 'react';
import ObjectID from 'Common/Types/ObjectID';
import BaseModel from 'Common/Models/BaseModel';
import Card from '../Card/Card';
import ModelAPI from '../../Utils/ModelAPI/ModelAPI';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import CardModelDetail from '../ModelDetail/CardModelDetail';
import IconProp from 'Common/Types/Icon/IconProp';
import ComponentLoader from '../ComponentLoader/ComponentLoader';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';

export interface ComponentProps {
    title: string;
    description: string;
    modelId: ObjectID;
    modelType: { new(): BaseModel };
    customFieldType: { new(): BaseModel };
    projectId: ObjectID;
    name: string;
}

const CustomFieldsDetail: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {


    const [schemaList, setSchemaList] = useState<Array<BaseModel>>([]);
    const [error, setError] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);


    const onLoad = async () => {

        try {
            // load schema.  
            setIsLoading(true);

            const schemaList = await ModelAPI.getList<BaseModel>(props.customFieldType, {
                projectId: props.projectId
            } as any, LIMIT_PER_PROJECT, 0, {
                name: true,
                type: true,
            } as any, {}, {})

            setSchemaList(schemaList.data);

            setIsLoading(false);
        } catch (err) {
            try {
                setError(
                    (err as HTTPErrorResponse).message ||
                    'Server Error. Please try again'
                );
            } catch (e) {
                setError('Server Error. Please try again');
            }
        }
    }

    useEffect(() => {
        onLoad();
    }, []);


    if (isLoading) {
        return <ComponentLoader />
    }


    if (!isLoading && schemaList.length === 0) {
        <Card title={props.title} description={props.description}>
            <ErrorMessage error="No custom fields are added for this resource. Please add customm fields for this resource in project settings." />
        </Card>
    }

    if (error) {
        <Card title={props.title} description={props.description}>
            <ErrorMessage error={error} />
        </Card>
    }


    return (<CardModelDetail
        name={props.name}
        cardProps={{
            title: props.title,
            description: props.description,
            icon: IconProp.TableCells,
        }}
        isEditable={true}
        formFields={schemaList.map((schemaItem: BaseModel) => {
            return {
                field: {
                    ['customFields.' + (schemaItem as any).name]: true,
                },
                title: 'customFields.' + (schemaItem as any).name,
                description: 'customFields.' + (schemaItem as any).description,
                fieldType: 'customFields.' + (schemaItem as any).type,
                required: false,
                placeholder: ''
            }
        })}
        modelDetailProps={{
            showDetailsInNumberOfColumns: 2,
            modelType: props.modelType,
            id: 'model-type-monitors',
            fields: schemaList.map((schemaItem: BaseModel) => {
                return {
                    field: {
                        ['customFields.' + (schemaItem as any).name]: true,
                    },
                    title: 'customFields.' + (schemaItem as any).name,
                    description: 'customFields.' + (schemaItem as any).description,
                    fieldType: 'customFields.' + (schemaItem as any).type,

                }
            }),
            modelId: props.modelId,
        }}
    />)

};

export default CustomFieldsDetail;
