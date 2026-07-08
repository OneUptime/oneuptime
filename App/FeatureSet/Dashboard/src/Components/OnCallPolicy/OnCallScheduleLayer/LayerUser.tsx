import ProjectUser from "../../../Utils/ProjectUser";
import UserElement from "../../User/User";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import ModelList from "Common/UI/Components/ModelList/ModelList";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import OnCallDutyPolicyScheduleLayer from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import React, { FunctionComponent, ReactElement, useState } from "react";
import OneUptimeDate from "Common/Types/Date";
import ProjectUtil from "Common/UI/Utils/Project";

export interface ComponentProps {
  layer: OnCallDutyPolicyScheduleLayer;
  onUpdateUsers: (layerUsers: Array<OnCallDutyPolicyScheduleLayerUser>) => void;
}

const LayerUser: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showAddUserModal, setShowAddUserModal] = useState<boolean>(false);
  const [reloadList, setReloadList] = useState<string>(
    OneUptimeDate.getCurrentDate().toString(),
  );

  const getAddUserButton: GetReactElementFunction = (): ReactElement => {
    return (
      <div className="mt-4">
        <Button
          title="Add User"
          icon={IconProp.Add}
          buttonSize={ButtonSize.Small}
          buttonStyle={ButtonStyleType.OUTLINE}
          onClick={() => {
            setShowAddUserModal(true);
          }}
        />
      </div>
    );
  };

  return (
    <div>
      <div className="rounded-lg border border-gray-200 bg-white">
        <ModelList<OnCallDutyPolicyScheduleLayerUser>
          id="user-list"
          modelType={OnCallDutyPolicyScheduleLayerUser}
          titleField=""
          query={{
            onCallDutyPolicyScheduleId: props.layer.onCallDutyPolicyScheduleId,
            projectId: props.layer.projectId,
            onCallDutyPolicyScheduleLayerId: props.layer.id!,
          }}
          sortBy="order"
          sortOrder={SortOrder.Ascending}
          customElement={(item: OnCallDutyPolicyScheduleLayerUser) => {
            return (
              <div className="py-1">
                <UserElement user={item.user} />
              </div>
            );
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
          noItemsMessage="No users in this layer yet. Add users and drag to set the rotation order."
          dragDropIdField="_id"
          dragDropIndexField="order"
        />
      </div>

      {getAddUserButton()}

      {showAddUserModal && (
        <ModelFormModal
          modelType={OnCallDutyPolicyScheduleLayerUser}
          name="Add user to layer"
          title="Add User"
          onClose={() => {
            setShowAddUserModal(false);
          }}
          submitButtonText="Add User to Layer"
          onBeforeCreate={async (model: OnCallDutyPolicyScheduleLayerUser) => {
            model.onCallDutyPolicyScheduleId =
              props.layer.onCallDutyPolicyScheduleId!;
            model.projectId = props.layer.projectId!;
            model.onCallDutyPolicyScheduleLayerId = props.layer.id!;

            return model; // return the model
          }}
          onSuccess={() => {
            setShowAddUserModal(false);
            // reload the list
            setReloadList(OneUptimeDate.getCurrentDate().toString());
          }}
          formProps={{
            name: "Add user to layer",
            modelType: OnCallDutyPolicyScheduleLayerUser,
            id: "add-user-to-layer",
            fields: [
              {
                field: {
                  user: true,
                },
                title: "User",
                description:
                  "Select a team member to add to this layer's rotation.",
                fieldType: FormFieldSchemaType.Dropdown,
                fetchDropdownOptions: async () => {
                  return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                    ProjectUtil.getCurrentProjectId()!,
                  );
                },
                required: true,
                placeholder: "Select User",
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
