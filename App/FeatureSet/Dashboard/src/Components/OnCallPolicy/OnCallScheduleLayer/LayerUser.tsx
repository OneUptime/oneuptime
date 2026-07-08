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
import {
  DragDropContext,
  Draggable,
  DraggableProvided,
  DropResult,
  Droppable,
  DroppableProvided,
} from "react-beautiful-dnd";

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

  const isBusy: boolean = isReordering || deletingUserIds.size > 0;

  const onDragEnd: (result: DropResult) => void = async (
    result: DropResult,
  ): Promise<void> => {
    if (!result.destination) {
      return;
    }

    const fromIndex: number = result.source.index;
    const toIndex: number = result.destination.index;

    if (fromIndex === toIndex) {
      return;
    }

    const moved: OnCallDutyPolicyScheduleLayerUser | undefined =
      users[fromIndex];
    const destination: OnCallDutyPolicyScheduleLayerUser | undefined =
      users[toIndex];

    if (!moved?.id || destination?.order === undefined) {
      return;
    }

    /*
     * Optimistically reorder so the drop feels instant; the refetch below
     * reconciles with the server's authoritative ordering.
     */
    const optimistic: Array<OnCallDutyPolicyScheduleLayerUser> = [...users];
    const [removed] = optimistic.splice(fromIndex, 1);
    optimistic.splice(toIndex, 0, removed!);
    setUsers(optimistic);
    props.onUpdateUsers(optimistic);

    setIsReordering(true);
    setError("");

    try {
      /*
       * Set the dragged user's order to the order of whoever currently sits at
       * the drop position. The server re-sequences the rest around it.
       */
      await ModelAPI.updateById({
        modelType: OnCallDutyPolicyScheduleLayerUser,
        id: moved.id,
        data: { order: destination.order },
      });
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    await fetchUsers(true);
    setIsReordering(false);
  };

  const getUserRow: (
    layerUser: OnCallDutyPolicyScheduleLayerUser,
    index: number,
    dragProvided: DraggableProvided,
    canReorder: boolean,
  ) => ReactElement = (
    layerUser: OnCallDutyPolicyScheduleLayerUser,
    index: number,
    dragProvided: DraggableProvided,
    canReorder: boolean,
  ): ReactElement => {
    const user: User | undefined = layerUser.user;
    const userId: string = user?.id?.toString() || `unknown-${index}`;
    const name: string = user?.name?.toString() || "";
    const email: string = user?.email?.toString() || "";
    const rowId: string = layerUser.id?.toString() || `${userId}-${index}`;
    const isDeleting: boolean = deletingUserIds.has(rowId);

    return (
      <div
        ref={dragProvided.innerRef}
        {...dragProvided.draggableProps}
        className="flex items-center gap-3 bg-white px-3 py-2.5 transition-colors hover:bg-gray-50"
      >
        {canReorder ? (
          <span
            {...dragProvided.dragHandleProps}
            aria-label="Drag to reorder"
            className="flex h-8 w-5 flex-shrink-0 cursor-grab items-center justify-center text-gray-300 transition-colors hover:text-gray-500 active:cursor-grabbing"
          >
            <Icon icon={IconProp.GripVertical} className="h-5 w-5" />
          </span>
        ) : (
          <span className="w-1 flex-shrink-0" />
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

    const canReorder: boolean = users.length > 1 && !isBusy;

    return (
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId={`layer-users-${props.layer.id?.toString()}`}>
            {(dropProvided: DroppableProvided) => {
              return (
                <div
                  ref={dropProvided.innerRef}
                  {...dropProvided.droppableProps}
                  className="divide-y divide-gray-100"
                >
                  {users.map(
                    (
                      layerUser: OnCallDutyPolicyScheduleLayerUser,
                      i: number,
                    ) => {
                      const rowId: string =
                        layerUser.id?.toString() ||
                        `${layerUser.user?.id?.toString()}-${i}`;
                      return (
                        <Draggable
                          key={rowId}
                          draggableId={rowId}
                          index={i}
                          isDragDisabled={!canReorder}
                        >
                          {(dragProvided: DraggableProvided) => {
                            return getUserRow(
                              layerUser,
                              i,
                              dragProvided,
                              users.length > 1,
                            );
                          }}
                        </Draggable>
                      );
                    },
                  )}
                  {dropProvided.placeholder}
                </div>
              );
            }}
          </Droppable>
        </DragDropContext>
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
