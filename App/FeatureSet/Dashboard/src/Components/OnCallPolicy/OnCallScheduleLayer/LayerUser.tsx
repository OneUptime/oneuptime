import ProjectUser from "../../../Utils/ProjectUser";
import { getColorForUserId, getUserInitials } from "./LayerUserColors";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Icon from "Common/UI/Components/Icon/Icon";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import OnCallDutyPolicyScheduleLayer from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import User from "Common/Models/DatabaseModels/User";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  layer: OnCallDutyPolicyScheduleLayer;
  onUpdateUsers: (layerUsers: Array<OnCallDutyPolicyScheduleLayerUser>) => void;
}

const LayerUser: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [users, setUsers] = useState<Array<OnCallDutyPolicyScheduleLayerUser>>(
    [],
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [deletingUserIds, setDeletingUserIds] = useState<Set<string>>(
    new Set<string>(),
  );
  const [isReordering, setIsReordering] = useState<boolean>(false);
  const [showAddUserModal, setShowAddUserModal] = useState<boolean>(false);

  useEffect(() => {
    fetchUsers().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  type FetchUsersFunction = (silent?: boolean) => Promise<void>;

  const fetchUsers: FetchUsersFunction = async (
    silent: boolean = false,
  ): Promise<void> => {
    if (!silent) {
      setIsLoading(true);
    }

    try {
      const result: ListResult<OnCallDutyPolicyScheduleLayerUser> =
        await ModelAPI.getList<OnCallDutyPolicyScheduleLayerUser>({
          modelType: OnCallDutyPolicyScheduleLayerUser,
          query: {
            onCallDutyPolicyScheduleId: props.layer.onCallDutyPolicyScheduleId,
            projectId: props.layer.projectId,
            onCallDutyPolicyScheduleLayerId: props.layer.id!,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            order: true,
            user: {
              name: true,
              email: true,
              _id: true,
              profilePictureId: true,
            },
          },
          sort: {
            order: SortOrder.Ascending,
          },
        });

      setUsers(result.data);
      props.onUpdateUsers(result.data);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    if (!silent) {
      setIsLoading(false);
    }
  };

  const deleteUser: (
    layerUser: OnCallDutyPolicyScheduleLayerUser,
  ) => Promise<void> = async (
    layerUser: OnCallDutyPolicyScheduleLayerUser,
  ): Promise<void> => {
    if (!layerUser.id) {
      return;
    }

    const rowId: string = layerUser.id.toString();
    setDeletingUserIds((prev: Set<string>) => {
      const next: Set<string> = new Set<string>(prev);
      next.add(rowId);
      return next;
    });

    try {
      await ModelAPI.deleteItem<OnCallDutyPolicyScheduleLayerUser>({
        modelType: OnCallDutyPolicyScheduleLayerUser,
        id: layerUser.id,
      });
      await fetchUsers(true);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setDeletingUserIds((prev: Set<string>) => {
      const next: Set<string> = new Set<string>(prev);
      next.delete(rowId);
      return next;
    });
  };

  type MoveUserFunction = (index: number, direction: "up" | "down") => void;

  const moveUser: MoveUserFunction = async (
    index: number,
    direction: "up" | "down",
  ): Promise<void> => {
    const targetIndex: number = direction === "up" ? index - 1 : index + 1;

    if (targetIndex < 0 || targetIndex >= users.length) {
      return;
    }

    const current: OnCallDutyPolicyScheduleLayerUser | undefined = users[index];
    const target: OnCallDutyPolicyScheduleLayerUser | undefined =
      users[targetIndex];

    if (!current?.id || target?.order === undefined) {
      return;
    }

    setIsReordering(true);
    setError("");

    try {
      /*
       * The server re-sequences the other users when one user's order changes,
       * so a single write to the neighbour's order performs the swap.
       */
      await ModelAPI.updateById({
        modelType: OnCallDutyPolicyScheduleLayerUser,
        id: current.id,
        data: { order: target.order },
      });
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    await fetchUsers(true);
    setIsReordering(false);
  };

  const isBusy: boolean = isReordering || deletingUserIds.size > 0;

  const getReorderButton: (params: {
    icon: IconProp;
    label: string;
    disabled: boolean;
    onClick: () => void;
  }) => ReactElement = (params: {
    icon: IconProp;
    label: string;
    disabled: boolean;
    onClick: () => void;
  }): ReactElement => {
    return (
      <button
        type="button"
        aria-label={params.label}
        disabled={params.disabled || isBusy}
        onClick={params.onClick}
        className={`flex h-4 w-5 items-center justify-center rounded transition-colors ${
          params.disabled || isBusy
            ? "cursor-not-allowed text-gray-300"
            : "text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        }`}
      >
        <Icon icon={params.icon} className="h-3.5 w-3.5" />
      </button>
    );
  };

  const getUserRow: (
    layerUser: OnCallDutyPolicyScheduleLayerUser,
    index: number,
  ) => ReactElement = (
    layerUser: OnCallDutyPolicyScheduleLayerUser,
    index: number,
  ): ReactElement => {
    const user: User | undefined = layerUser.user;
    const userId: string = user?.id?.toString() || `unknown-${index}`;
    const name: string = user?.name?.toString() || "";
    const email: string = user?.email?.toString() || "";
    const rowId: string = layerUser.id?.toString() || `${userId}-${index}`;
    const isDeleting: boolean = deletingUserIds.has(rowId);

    return (
      <div
        key={rowId}
        className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-gray-50"
      >
        {users.length > 1 && (
          <div className="flex flex-col">
            {getReorderButton({
              icon: IconProp.ChevronUp,
              label: "Move user earlier in the rotation",
              disabled: index === 0,
              onClick: () => {
                moveUser(index, "up");
              },
            })}
            {getReorderButton({
              icon: IconProp.ChevronDown,
              label: "Move user later in the rotation",
              disabled: index === users.length - 1,
              onClick: () => {
                moveUser(index, "down");
              },
            })}
          </div>
        )}

        <span
          className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
          style={{ backgroundColor: getColorForUserId(userId) }}
        >
          {getUserInitials(name, email)}
        </span>

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-gray-900">
            {name || email || "Unknown user"}
          </div>
          {name && email ? (
            <div className="truncate text-xs text-gray-500">{email}</div>
          ) : null}
        </div>

        <button
          type="button"
          aria-label="Remove user from layer"
          disabled={isBusy}
          onClick={() => {
            deleteUser(layerUser);
          }}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon
            icon={isDeleting ? IconProp.Spinner : IconProp.Trash}
            className="h-4 w-4"
          />
        </button>
      </div>
    );
  };

  const getAddUserButton: () => ReactElement = (): ReactElement => {
    return (
      <div className="mt-3">
        <Button
          title="Add User"
          icon={IconProp.Add}
          buttonSize={ButtonSize.Small}
          buttonStyle={ButtonStyleType.OUTLINE}
          disabled={isBusy}
          onClick={() => {
            setShowAddUserModal(true);
          }}
        />
      </div>
    );
  };

  const getContent: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return (
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-6 text-center text-sm text-gray-400">
          Loading users…
        </div>
      );
    }

    if (error) {
      return <ErrorMessage message={error} />;
    }

    if (users.length === 0) {
      return (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/50 px-4 py-6 text-center">
          <p className="text-sm font-medium text-gray-900">No users yet</p>
          <p className="mt-0.5 text-sm text-gray-500">
            Add users to put them into this layer&apos;s on-call rotation.
          </p>
        </div>
      );
    }

    return (
      <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
        {users.map(
          (layerUser: OnCallDutyPolicyScheduleLayerUser, i: number) => {
            return getUserRow(layerUser, i);
          },
        )}
      </div>
    );
  };

  const onCloseModal: PromiseVoidFunction = async (): Promise<void> => {
    setShowAddUserModal(false);
  };

  return (
    <div>
      {getContent()}
      {getAddUserButton()}

      {showAddUserModal && (
        <ModelFormModal
          modelType={OnCallDutyPolicyScheduleLayerUser}
          name="Add user to layer"
          title="Add User"
          onClose={() => {
            onCloseModal().catch(() => {});
          }}
          submitButtonText="Add User to Layer"
          onBeforeCreate={async (model: OnCallDutyPolicyScheduleLayerUser) => {
            model.onCallDutyPolicyScheduleId =
              props.layer.onCallDutyPolicyScheduleId!;
            model.projectId = props.layer.projectId!;
            model.onCallDutyPolicyScheduleLayerId = props.layer.id!;

            return model;
          }}
          onSuccess={() => {
            setShowAddUserModal(false);
            fetchUsers(true).catch((err: Error) => {
              setError(API.getFriendlyMessage(err));
            });
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
