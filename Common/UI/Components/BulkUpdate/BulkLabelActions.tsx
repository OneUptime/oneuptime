import React, { ReactElement, useEffect, useState } from "react";

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import BadDataException from "../../../Types/Exception/BadDataException";
import IconProp from "../../../Types/Icon/IconProp";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../Utils/Project";
import { ButtonStyleType } from "../Button/Button";
import BasicFormModal from "../FormModal/BasicFormModal";
import Modal from "../Modal/Modal";
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

  /*
   * For "Remove Labels" we only want to offer labels that are actually
   * attached to the selected items (not every label in the project). These
   * are computed from the selected items each time the remove modal opens.
   */
  const [removeLabelDropdownOptions, setRemoveLabelDropdownOptions] = useState<
    Array<{ label: string; value: string }>
  >([]);
  const [isLoadingRemoveLabels, setIsLoadingRemoveLabels] =
    useState<boolean>(false);

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

  /*
   * Build the dropdown options for the "Remove Labels" modal from only the
   * labels actually attached to the selected items. We fetch the selected
   * items (by id) with their labels and take the de-duplicated union, so the
   * modal offers only labels that can really be removed instead of every
   * label in the project.
   */
  const loadLabelsForSelectedItems: (
    items: Array<T>,
  ) => Promise<void> = async (items: Array<T>): Promise<void> => {
    setIsLoadingRemoveLabels(true);

    try {
      const itemIds: Array<string> = items
        .map((item: T) => {
          return item.id?.toString() || "";
        })
        .filter((id: string) => {
          return id.length > 0;
        });

      if (itemIds.length === 0) {
        setRemoveLabelDropdownOptions([]);
        return;
      }

      const result: ListResult<T> = await ModelAPI.getList<T>({
        modelType: config.modelType,
        query: {
          _id: new Includes(itemIds),
        } as any,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          labels: {
            _id: true,
            name: true,
          },
        } as any,
        sort: {},
      });

      // Union of labels across all selected items, de-duplicated by id.
      const labelNameById: Map<string, string> = new Map<string, string>();

      for (const item of result.data) {
        const itemLabels: Array<Label> =
          ((item as any).labels as Array<Label> | undefined) || [];

        for (const label of itemLabels) {
          const id: string = label._id?.toString() || "";
          if (id.length > 0) {
            labelNameById.set(id, label.name || "");
          }
        }
      }

      const options: Array<{ label: string; value: string }> = Array.from(
        labelNameById.entries(),
      ).map((entry: [string, string]) => {
        return {
          label: entry[1] || "",
          value: entry[0],
        };
      });

      options.sort(
        (
          a: { label: string; value: string },
          b: { label: string; value: string },
        ) => {
          return a.label.localeCompare(b.label);
        },
      );

      setRemoveLabelDropdownOptions(options);
    } catch {
      // on error, show no options rather than every label in the project
      setRemoveLabelDropdownOptions([]);
    } finally {
      setIsLoadingRemoveLabels(false);
    }
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
      setRemoveLabelDropdownOptions([]);
      setShowRemoveModal(true);
      await loadLabelsForSelectedItems(actionProps.items);
    },
  };

  const closeRemoveModal: () => void = (): void => {
    setShowRemoveModal(false);
    setBulkActionProps(null);
    setRemoveLabelDropdownOptions([]);
  };

  const hasNoLabelsToRemove: boolean =
    !isLoadingRemoveLabels && removeLabelDropdownOptions.length === 0;

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

      {showRemoveModal &&
        (hasNoLabelsToRemove ? (
          <Modal
            title="No Labels to Remove"
            description="The selected items don't have any labels to remove."
            icon={IconProp.Label}
            onClose={closeRemoveModal}
            closeButtonText="Close"
          >
            <></>
          </Modal>
        ) : (
          <BasicFormModal
            title="Remove Labels"
            description="Select labels to remove from the selected items. Only labels currently applied to the selected items are shown."
            isLoading={isLoadingRemoveLabels}
            onClose={closeRemoveModal}
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
                  dropdownOptions: removeLabelDropdownOptions,
                },
              ],
            }}
          />
        ))}
    </>
  );

  return {
    bulkActions: [addLabelsAction, removeLabelsAction],
    modals: modals,
  };
}

export default useBulkLabelActions;
