import Button from 'CommonUI/src/Components/Button/Button';
import { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import ModelFormModal from 'CommonUI/src/Components/ModelFormModal/ModelFormModal';
import ModelList from 'CommonUI/src/Components/ModelList/ModelList';
import OnCallDutyPolicyScheduleLayer from 'Model/Models/OnCallDutyPolicyScheduleLayer';
import OnCallDutyPolicyScheduleLayerUser from 'Model/Models/OnCallDutyPolicyScheduleLayerUser';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import DashboardNavigation from '../../../Utils/Navigation';
import ProjectUser from '../../../Utils/ProjectUser';
import UserElement from '../../User/User';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
import { GetReactElementFunction } from 'CommonUI/src/Types/FunctionTypes';

export interface ComponentProps {
    layer: OnCallDutyPolicyScheduleLayer;
    onUpdateUsers: (
        layerUsers: Array<OnCallDutyPolicyScheduleLayerUser>
    ) => void;
}

const LayerUser: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [showAddUserModal, setShowAddUserModal] = useState<boolean>(false);
    const [reloadList, setReloadList] = useState<boolean>(false);

    const getAddUserButton: GetReactElementFunction = (): ReactElement => {
        return (
            <div className="flex w-full justify-center mt-5">
                <Button
                    title="Add User"
                    onClick={() => {
                        setShowAddUserModal(true);
                    }}
                />
            </div>
        );
    };

    return (
        <div>
            <ModelList<OnCallDutyPolicyScheduleLayerUser>
                id="user-list"
                modelType={OnCallDutyPolicyScheduleLayerUser}
                titleField=""
                query={{
                    onCallDutyPolicyScheduleId:
                        props.layer.onCallDutyPolicyScheduleId,
                    projectId: props.layer.projectId,
                    onCallDutyPolicyScheduleLayerId: props.layer.id,
                }}
                sortBy="order"
                sortOrder={SortOrder.Ascending}
                customElement={(item: OnCallDutyPolicyScheduleLayerUser) => {
                    return <UserElement user={item.user} />;
                }}
                onListLoaded={(list: OnCallDutyPolicyScheduleLayerUser[]) => {
                    props.onUpdateUsers(list);
                }}
                descriptionField=""
                select={{
                    user: {
                        name: true,
                        email: true,
                        _id: true,
                        profilePictureId: true,
                    },
                    _id: true,
                }}
                enableDragAndDrop={true}
                isDeleteable={true}
                refreshToggle={reloadList}
                noItemsMessage="No users added to this layer. Please add users to this layer."
                footer={getAddUserButton()}
                dragDropIdField="_id"
                dragDropIndexField="order"
            />

            {showAddUserModal && (
                <ModelFormModal
                    modelType={OnCallDutyPolicyScheduleLayerUser}
                    name="Add user to layer"
                    title="Add User"
                    onClose={() => {
                        setShowAddUserModal(false);
                    }}
                    submitButtonText="Add User to Layer"
                    onBeforeCreate={async (
                        model: OnCallDutyPolicyScheduleLayerUser
                    ) => {
                        model.onCallDutyPolicyScheduleId =
                            props.layer.onCallDutyPolicyScheduleId!;
                        model.projectId = props.layer.projectId!;
                        model.onCallDutyPolicyScheduleLayerId = props.layer.id!;

                        return model; // return the model
                    }}
                    onSuccess={() => {
                        setShowAddUserModal(false);
                        // reload the list
                        setReloadList(!reloadList);
                    }}
                    formProps={{
                        name: 'Add user to layer',
                        modelType: OnCallDutyPolicyScheduleLayerUser,
                        id: 'add-user-to-layer',
                        fields: [
                            {
                                field: {
                                    user: true,
                                },
                                fieldType: FormFieldSchemaType.Dropdown,
                                fetchDropdownOptions: async () => {
                                    return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                                        DashboardNavigation.getProjectId()!
                                    );
                                },
                                required: true,
                                placeholder: 'Select User',
                            },
                        ],
                        formType: FormType.Create,
                    }}
                />
            )}
        </div>
    );
};

export default LayerUser;
