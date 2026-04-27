import React, { ReactElement, useEffect, useState } from "react";

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import BadDataException from "../../../Types/Exception/BadDataException";
import IconProp from "../../../Types/Icon/IconProp";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../Utils/Project";
import { ButtonStyleType } from "../Button/Button";
import BasicFormModal from "../FormModal/BasicFormModal";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
} from "./BulkUpdateForm";

export interface BulkLabelActionsConfig<T extends BaseModel> {
  modelType: { new (): T };
}

export interface BulkLabelActionsResult<T extends BaseModel> {
  bulkActions: Array<BulkActionButtonSchema<T>>;
  modals: ReactElement;
}

type BulkLabelMode = "add" | "remove";

/**
 * Reusable hook that provides "Add Labels" and "Remove Labels" bulk actions
 * for any ModelTable whose model has a `labels` many-to-many relationship
 * to the Label entity.
 *
 * Usage:
 *   const { bulkActions, modals } = useBulkLabelActions({ modelType: Monitor });
 *   <ModelTable bulkActions={{ buttons: [...bulkActions, ...] }} />
 *   {modals}
 */
function useBulkLabelActions<T extends BaseModel>(
  config: BulkLabelActionsConfig<T>,
): BulkLabelActionsResult<T> {
  const [labels, setLabels] = useState<Array<Label>>([]);
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [showRemoveModal, setShowRemoveModal] = useState<boolean>(false);
  const [bulkActionProps, setBulkActionProps] =
    useState<BulkActionOnClickProps<T> | null>(null);

  useEffect(() => {
    const fetchLabels: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<Label> = await ModelAPI.getList<Label>({
          modelType: Label,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
            color: true,
          },
          sort: {
            name: SortOrder.Ascending,
          },
        });
        setLabels(result.data);
      } catch {
        // labels will remain empty; modal will show no options
      }
    };

    fetchLabels();
  }, []);

  const applyLabels: (
    labelIds: Array<string>,
    mode: BulkLabelMode,
  ) => Promise<void> = async (
    labelIds: Array<string>,
    mode: BulkLabelMode,
  ): Promise<void> => {
    if (!bulkActionProps) {
      return;
    }

    const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } =
      bulkActionProps;

    // Close the form modal first so the progress modal is visible
    setShowAddModal(false);
    setShowRemoveModal(false);

    onBulkActionStart();

    const totalItems: Array<T> = [...items];
    const inProgressItems: Array<T> = [...items];
    const successItems: Array<T> = [];
    const failedItems: Array<BulkActionFailed<T>> = [];

    for (const item of totalItems) {
      inProgressItems.splice(inProgressItems.indexOf(item), 1);

      try {
        if (!item.id) {
          throw new BadDataException("Item ID not found");
        }

        /*
         * Fetch current labels for this item so we can merge/subtract
         * the selected label ids and avoid clobbering existing ones.
         */
        const currentItem: T | null = await ModelAPI.getItem<T>({
          modelType: config.modelType,
          id: item.id,
          select: {
            labels: {
              _id: true,
            },
          } as any,
        });

        const existingLabelIds: Array<string> = (
          ((currentItem as any)?.labels as Array<Label> | undefined) || []
        )
          .map((label: Label) => {
            return label._id?.toString() || "";
          })
          .filter((id: string) => {
            return id.length > 0;
          });

        let newLabelIds: Array<string>;

        if (mode === "add") {
          newLabelIds = Array.from(
            new Set<string>([...existingLabelIds, ...labelIds]),
          );
        } else {
          newLabelIds = existingLabelIds.filter((id: string) => {
            return !labelIds.includes(id);
          });
        }

        /*
         * No-op short-circuit: if nothing changed, still report as success
         * so the user sees the item as processed.
         */
        if (
          newLabelIds.length === existingLabelIds.length &&
          newLabelIds.every((id: string) => {
            return existingLabelIds.includes(id);
          })
        ) {
          successItems.push(item);
        } else {
          await ModelAPI.updateById<T>({
            id: item.id as ObjectID,
            modelType: config.modelType,
            data: {
              labels: newLabelIds,
            } as any,
          });
          successItems.push(item);
        }
      } catch (err) {
        failedItems.push({
          item: item,
          failedMessage: API.getFriendlyMessage(err),
        });
      }

      onProgressInfo({
        totalItems: totalItems,
        failed: failedItems,
        successItems: successItems,
        inProgressItems: inProgressItems,
      });
    }

    onBulkActionEnd();
    setBulkActionProps(null);
  };

  const labelDropdownOptions: Array<{ label: string; value: string }> =
    labels.map((label: Label) => {
      return {
        label: label.name || "",
        value: label._id?.toString() || "",
      };
    });

  const addLabelsAction: BulkActionButtonSchema<T> = {
    title: "Add Labels",
    buttonStyleType: ButtonStyleType.NORMAL,
    icon: IconProp.Label,
    onClick: async (actionProps: BulkActionOnClickProps<T>): Promise<void> => {
      setBulkActionProps(actionProps);
      setShowAddModal(true);
    },
  };

  const removeLabelsAction: BulkActionButtonSchema<T> = {
    title: "Remove Labels",
    buttonStyleType: ButtonStyleType.NORMAL,
    icon: IconProp.Close,
    onClick: async (actionProps: BulkActionOnClickProps<T>): Promise<void> => {
      setBulkActionProps(actionProps);
      setShowRemoveModal(true);
    },
  };

  const modals: ReactElement = (
    <>
      {showAddModal && (
        <BasicFormModal
          title="Add Labels"
          description="Select labels to add to the selected items. Labels already attached to an item will be preserved."
          onClose={() => {
            setShowAddModal(false);
            setBulkActionProps(null);
          }}
          submitButtonText="Add Labels"
          onSubmit={async (formData: { labelIds: Array<string> }) => {
            await applyLabels(formData.labelIds || [], "add");
          }}
          formProps={{
            fields: [
              {
                field: {
                  labelIds: true,
                },
                title: "Select Labels",
                description:
                  "These labels will be added to each selected item.",
                fieldType: FormFieldSchemaType.MultiSelectDropdown,
                required: true,
                dropdownOptions: labelDropdownOptions,
              },
            ],
          }}
        />
      )}

      {showRemoveModal && (
        <BasicFormModal
          title="Remove Labels"
          description="Select labels to remove from the selected items. Items that do not have any of these labels will be skipped."
          onClose={() => {
            setShowRemoveModal(false);
            setBulkActionProps(null);
          }}
          submitButtonText="Remove Labels"
          onSubmit={async (formData: { labelIds: Array<string> }) => {
            await applyLabels(formData.labelIds || [], "remove");
          }}
          formProps={{
            fields: [
              {
                field: {
                  labelIds: true,
                },
                title: "Select Labels",
                description:
                  "These labels will be removed from each selected item.",
                fieldType: FormFieldSchemaType.MultiSelectDropdown,
                required: true,
                dropdownOptions: labelDropdownOptions,
              },
            ],
          }}
        />
      )}
    </>
  );

  return {
    bulkActions: [addLabelsAction, removeLabelsAction],
    modals: modals,
  };
}

export default useBulkLabelActions;
