import BaseModel from 'Common/Models/BaseModel';
import ObjectID from 'Common/Types/ObjectID';
import React, { ReactElement, useState } from 'react';
import ModelAPI from '../../Utils/ModelAPI/ModelAPI';
import { ButtonStyleType } from '../Button/Button';
import Card from '../Card/Card';
import API from '../../Utils/API/API';
import IconProp from 'Common/Types/Icon/IconProp';
import ConfirmModal from '../Modal/ConfirmModal';
import Select from '../../Utils/ModelAPI/Select';
import { ModelField } from '../Forms/ModelForm';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import Route from 'Common/Types/API/Route';
import Navigation from '../../Utils/Navigation';
import BasicFormModal from '../FormModal/BasicFormModal';
import JSONFunctions from 'Common/Types/JSONFunctions';

export interface ComponentProps<TBaseModel extends BaseModel> {
    modelType: { new (): TBaseModel };
    modelId: ObjectID;
    onDuplicateSuccess?: (item: TBaseModel) => void | undefined;
    fieldsToDuplicate: Select<TBaseModel>;
    fieldsToChange: Array<ModelField<TBaseModel>>;
    navigateToOnSuccess?: Route | undefined;
}

const DuplicateModel: <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
) => ReactElement = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {
    const model: TBaseModel = new props.modelType();
    const [showModal, setShowModal] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string>('');
    const [showErrorModal, setShowErrorModal] = useState<boolean>(false);

    const duplicateItem: Function = async (partialModel: TBaseModel) => {
        setIsLoading(true);
        try {
            const item: TBaseModel | null = await ModelAPI.getItem<TBaseModel>(
                props.modelType,
                props.modelId,
                props.fieldsToDuplicate
            );

            if (!item) {
                throw new Error(
                    `Could not find ${model.singularName} with id ${props.modelId}`
                );
            }

            for (const field of props.fieldsToChange) {
                const key: string | undefined = Object.keys(
                    field.field || {}
                )[0];

                if (!key) {
                    continue;
                }

                const value: string = partialModel.getValue(key);
                item.setValue(key, value);
            }

            item.removeValue('_id');

            // now we have the item, we need to remove the id and then save it

            const newItem: HTTPResponse<TBaseModel> =
                (await ModelAPI.create<TBaseModel>(
                    item,
                    props.modelType
                )) as HTTPResponse<TBaseModel>;

            if (!newItem) {
                throw new Error(`Could not create ${model.singularName}`);
            }

            props.onDuplicateSuccess && props.onDuplicateSuccess(newItem.data);

            if (props.navigateToOnSuccess) {
                Navigation.navigate(
                    new Route(props.navigateToOnSuccess.toString()).addRoute(
                        `/${newItem.data.id!.toString()}`
                    )
                );
            }
        } catch (err) {
            setError(API.getFriendlyMessage(err));
            setShowErrorModal(true);
        }

        setIsLoading(false);
    };

    return (
        <>
            <Card
                title={`Duplicate ${model.singularName}`}
                description={`Duplicating this ${model.singularName?.toLowerCase()} will create another ${model.singularName?.toLowerCase()} exactly like this one.`}
                buttons={[
                    {
                        title: `Duplicate ${model.singularName}`,
                        buttonStyle: ButtonStyleType.NORMAL,
                        onClick: () => {
                            setShowModal(true);
                        },
                        isLoading: isLoading,
                        icon: IconProp.Copy,
                    },
                ]}
            />

            {showModal ? (
                <BasicFormModal<TBaseModel>
                    description={`Are you sure you want to duplicate this ${model.singularName?.toLowerCase()}?`}
                    title={`Duplicate ${model.singularName}`}
                    onSubmit={(item: TBaseModel) => {
                        setShowModal(false);
                        duplicateItem(
                            JSONFunctions.fromJSONObject(
                                item,
                                props.modelType
                            ) as TBaseModel
                        );
                    }}
                    onClose={() => {
                        setShowModal(false);
                    }}
                    submitButtonText={`Duplicate ${model.singularName}`}
                    formProps={{
                        fields: props.fieldsToChange,
                    }}
                />
            ) : (
                <></>
            )}

            {showErrorModal ? (
                <ConfirmModal
                    description={error}
                    title={`Duplicate Error`}
                    onSubmit={() => {
                        setShowErrorModal(false);
                        setError('');
                    }}
                    submitButtonText={`Close`}
                    submitButtonType={ButtonStyleType.NORMAL}
                />
            ) : (
                <></>
            )}
        </>
    );
};

export default DuplicateModel;
