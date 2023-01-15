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
import { IconProp } from '../Icon/Icon';
import ModelFormModal from '../ModelFormModal/ModelFormModal';
import { FormType } from '../Forms/ModelForm';
import Fields from '../Forms/Types/Fields';

export interface ComponentProps<TBaseModel extends BaseModel> {
    cardProps: CardProps;
    modelDetailProps: ModeDetailProps<TBaseModel>;
    isEditable?: undefined | boolean;
    editButtonText?: undefined | string;
    formFields?: undefined | Fields<TBaseModel>;
    className?: string | undefined;
    name: string;
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

        if (props.isEditable && hasPermissionToEdit) {
            setCardButtons([
                {
                    title: props.editButtonText || `Edit ${model.singularName}`,
                    buttonStyle: ButtonStyleType.NORMAL,
                    onClick: () => {
                        setShowModal(true);
                    },
                    icon: IconProp.Edit,
                },
            ]);
        }
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
                    onClose={() => {
                        setShowModal(false);
                    }}
                    submitButtonText={`Save Changes`}
                    onSuccess={(_item: TBaseModel) => {
                        setShowModal(false);
                        setRefresher(!refresher);
                    }}
                    name={props.name}
                    modelType={props.modelDetailProps.modelType}
                    formProps={{
                        id: `edit-${model.singularName?.toLowerCase()}-from`,
                        fields: props.formFields || [],
                        name: props.name,
                        formType: FormType.Update,
                        modelType: props.modelDetailProps.modelType,
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
