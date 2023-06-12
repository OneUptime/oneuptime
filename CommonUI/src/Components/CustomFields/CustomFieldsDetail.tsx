import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import ObjectID from 'Common/Types/ObjectID';
import BaseModel from 'Common/Models/BaseModel';
import Card from '../Card/Card';
import ModelAPI, { ListResult } from '../../Utils/ModelAPI/ModelAPI';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import ComponentLoader from '../ComponentLoader/ComponentLoader';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import Detail from '../Detail/Detail';
import BasicFormModal from '../FormModal/BasicFormModal';
import { JSONObject } from 'Common/Types/JSON';
import { ButtonStyleType } from '../Button/Button';
import IconProp from 'Common/Types/Icon/IconProp';
import API from '../../Utils/API/API';

export interface ComponentProps {
    title: string;
    description: string;
    modelId: ObjectID;
    modelType: { new (): BaseModel };
    customFieldType: { new (): BaseModel };
    projectId: ObjectID;
    name: string;
}

const CustomFieldsDetail: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [schemaList, setSchemaList] = useState<Array<BaseModel>>([]);
    const [error, setError] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [model, setModel] = useState<BaseModel | null>(null);
    const [showModelForm, setShowModelForm] = useState<boolean>(false);

    const onLoad: Function = async (): Promise<void> => {
        try {
            // load schema.
            setIsLoading(true);

            const schemaList: ListResult<BaseModel> =
                await ModelAPI.getList<BaseModel>(
                    props.customFieldType,
                    {
                        projectId: props.projectId,
                    } as any,
                    LIMIT_PER_PROJECT,
                    0,
                    {
                        name: true,
                        type: true,
                        description: true,
                    } as any,
                    {}
                );

            const item: BaseModel | null = await ModelAPI.getItem<BaseModel>(
                props.modelType,
                props.modelId,
                {
                    customFields: true,
                } as any
            );

            setSchemaList(schemaList.data);
            setModel(item);

            setIsLoading(false);
        } catch (err) {
            setIsLoading(false);
            setError(API.getFriendlyMessage(err));
        }
    };

    const onSave: Function = async (data: JSONObject): Promise<void> => {
        try {
            // load schema.
            setIsLoading(true);
            setShowModelForm(false);

            await ModelAPI.updateById(props.modelType, props.modelId, {
                customFields: data,
            });

            await onLoad();
        } catch (err) {
            setIsLoading(false);
            setError(API.getFriendlyMessage(err));
        }
    };

    useEffect(() => {
        onLoad().catch();
    }, []);

    return (
        <Card
            title={props.title}
            description={props.description}
            buttons={[
                {
                    title: 'Edit Fields',
                    buttonStyle: ButtonStyleType.NORMAL,
                    onClick: () => {
                        setShowModelForm(true);
                    },
                    icon: IconProp.Edit,
                },
            ]}
        >
            <div className="border-t border-gray-200 px-4 py-5 sm:px-6 -m-6 -mt-2">
                {isLoading && !error && <ComponentLoader />}
                {!isLoading && !error && schemaList.length === 0 && (
                    <ErrorMessage error="No custom fields are added for this resource. Please add customm fields for this resource in project settings." />
                )}
                {error && <ErrorMessage error={error} />}
                {!model && <ErrorMessage error={'Item not found'} />}

                {!isLoading && !error && model && (
                    <Detail
                        id={props.name}
                        item={(model as any)['customFields'] || {}}
                        fields={schemaList.map((schemaItem: BaseModel) => {
                            return {
                                key: [(schemaItem as any).name],
                                title: (schemaItem as any).name,
                                description: (schemaItem as any).description,
                                fieldType: (schemaItem as any).type,
                                placeholder: 'No data entered',
                            };
                        })}
                        showDetailsInNumberOfColumns={1}
                    />
                )}

                {showModelForm && (
                    <BasicFormModal
                        title={'Edit ' + new props.modelType().singularName}
                        onClose={() => {
                            return setShowModelForm(false);
                        }}
                        onSubmit={(data: JSONObject) => {
                            onSave(data).catch();
                        }}
                        formProps={{
                            initialValues: (model as any)['customFields'] || {},
                            fields: schemaList.map((schemaItem: BaseModel) => {
                                return {
                                    field: {
                                        [(schemaItem as any).name]: true,
                                    },
                                    title: (schemaItem as any).name,
                                    description: (schemaItem as any)
                                        .description,
                                    fieldType: (schemaItem as any).type,
                                    required: false,
                                    placeholder: '',
                                };
                            }),
                        }}
                    />
                )}
            </div>
        </Card>
    );
};

export default CustomFieldsDetail;
