import {
    PermissionHelper,
    UserPermission,
    UserTenantAccessPermission,
} from 'Common/Types/Permission';
import React, { ReactElement, useEffect, useState } from 'react';
import PermissionUtil from '../../Utils/Permission';
import Card, {
    CardButtonSchema,
    ComponentProps as CardProps,
} from '../Card/Card';
import ModelDetail, { ComponentProps as ModeDetailProps } from './ModelDetail';
import BaseModel from 'Common/Models/BaseModel';
import { ButtonStyleType } from '../Button/Button';

import IconProp from 'Common/Types/Icon/IconProp';
import ModelFormModal from '../ModelFormModal/ModelFormModal';
import { FormType } from '../Forms/ModelForm';
import Fields from '../Forms/Types/Fields';
import { FormStep } from '../Forms/Types/FormStep';
import { ModalWidth } from '../Modal/Modal';

export interface ComponentProps<TBaseModel extends BaseModel> {
    cardProps: CardProps;
    modelDetailProps: ModeDetailProps<TBaseModel>;
    isEditable?: undefined | boolean;
    onSaveSuccess?: undefined | ((item: TBaseModel) => void);
    editButtonText?: undefined | string;
    formSteps?: undefined | Array<FormStep<TBaseModel>>;
    formFields?: undefined | Fields<TBaseModel>;
    className?: string | undefined;
    name: string;
    createEditModalWidth?: ModalWidth | undefined;
}

const CardModelDetail: Function = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {
    const [cardButtons, setCardButtons] = useState<Array<CardButtonSchema>>([]);
    const [showModel, setShowModal] = useState<boolean>(false);
    const [item, setItem] = useState<TBaseModel | null>(null);
    const [refresher, setRefresher] = useState<boolean>(false);
    const model: TBaseModel = new props.modelDetailProps.modelType();

    useEffect(() => {
        const userProjectPermissions: UserTenantAccessPermission | null =
            PermissionUtil.getProjectPermissions();

        const hasPermissionToEdit: boolean = Boolean(
            userProjectPermissions &&
                userProjectPermissions.permissions &&
                PermissionHelper.doesPermissionsIntersect(
                    model.updateRecordPermissions,
                    userProjectPermissions.permissions.map(
                        (item: UserPermission) => {
                            return item.permission;
                        }
                    )
                )
        );

        let cardButtons: Array<CardButtonSchema> = [];

        if (props.isEditable && hasPermissionToEdit) {
            cardButtons.push({
                title: props.editButtonText || `Edit ${model.singularName}`,
                buttonStyle: ButtonStyleType.NORMAL,
                onClick: () => {
                    setShowModal(true);
                },
                icon: IconProp.Edit,
            });
        }

        if (props.cardProps.buttons) {
            cardButtons = cardButtons.concat(...props.cardProps.buttons);
        }

        setCardButtons(cardButtons);
    }, []);

    return (
        <>
            <Card {...props.cardProps} buttons={cardButtons}>
                <div className="border-t border-gray-200 px-4 py-5 sm:px-6 -m-6 -mt-2">
                    <ModelDetail
                        refresher={refresher}
                        {...props.modelDetailProps}
                        onItemLoaded={(item: TBaseModel) => {
                            setItem(item);
                        }}
                    />
                </div>
            </Card>

            {showModel ? (
                <ModelFormModal<TBaseModel>
                    title={`Edit ${model.singularName}`}
                    modalWidth={props.createEditModalWidth}
                    onClose={() => {
                        setShowModal(false);
                    }}
                    submitButtonText={`Save Changes`}
                    onSuccess={(item: TBaseModel) => {
                        setShowModal(false);
                        setRefresher(!refresher);
                        if (props.onSaveSuccess) {
                            props.onSaveSuccess(item);
                        }
                    }}
                    name={props.name}
                    modelType={props.modelDetailProps.modelType}
                    formProps={{
                        id: `edit-${model.singularName?.toLowerCase()}-from`,
                        fields: props.formFields || [],
                        name: props.name,
                        formType: FormType.Update,
                        modelType: props.modelDetailProps.modelType,
                        steps: props.formSteps || [],
                    }}
                    modelIdToEdit={item?._id}
                />
            ) : (
                <></>
            )}
        </>
    );
};

export default CardModelDetail;
