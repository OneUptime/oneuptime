import React, {
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

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
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../Utils/PermissionGate";
import { ButtonStyleType } from "../Button/Button";
import BasicFormModal from "../FormModal/BasicFormModal";
import Modal from "../Modal/Modal";
import { DropdownOption } from "../Dropdown/Dropdown";
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
    Array<DropdownOption>
  >([]);
  const [isLoadingRemoveLabels, setIsLoadingRemoveLabels] =
    useState<boolean>(false);
  const removeLabelsRequestRef: MutableRefObject<number> = useRef<number>(0);

  useEffect(() => {
    /*
     * Without the guard the query went out as `projectId: null`, which is
     * not "every project" — it is a filter nothing matches, so the add
     * modal silently offered an empty dropdown. Skipping the request says
     * the same thing without the round trip. Mirrors BulkOwnerActions.
     */
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    const fetchLabels: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<Label> = await ModelAPI.getList<Label>({
          modelType: Label,
          query: {
            projectId: projectId,
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

    /*
     * A label whose row came back without an `_id` would render as an
     * option with an empty value, and submitting it would put "" into the
     * labels array, failing the whole item over one unusable option.
     */
    const selectedLabelIds: Array<string> = labelIds.filter((id: string) => {
      return Boolean(id);
    });

    /*
     * Bail before starting rather than running the loop with nothing to
     * apply: every item would fall through the no-op short-circuit below
     * and be reported as a success, telling the user a bulk action landed
     * when nothing was asked for.
     */
    if (selectedLabelIds.length === 0) {
      setBulkActionProps(null);
      return;
    }

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
            _id: true,
            labels: {
              _id: true,
            },
          } as any,
        });

        /*
         * A row that was deleted or filtered out between the table load
         * and this action comes back as HTTP 200 with an empty body, which
         * hydrates into a truthy but empty model — so "no labels" and
         * "could not read it" are the same value here unless we look at
         * `_id`, which a real read always carries. Without the check, add
         * mode would treat the item as unlabelled and replace its entire
         * label set with the selection: exactly the clobber the merge
         * below exists to prevent. Fail the item instead; the user sees it
         * in the failed list and nothing is lost.
         */
        if (!currentItem || !currentItem._id) {
          throw new BadDataException(
            "Could not read the current labels for this item.",
          );
        }

        const existingLabelIds: Array<string> = (
          ((currentItem as any).labels as Array<Label> | undefined) || []
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
            new Set<string>([...existingLabelIds, ...selectedLabelIds]),
          );
        } else {
          newLabelIds = existingLabelIds.filter((id: string) => {
            return !selectedLabelIds.includes(id);
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
  const loadLabelsForSelectedItems: (items: Array<T>) => Promise<void> = async (
    items: Array<T>,
  ): Promise<void> => {
    /*
     * Close the modal and reopen it on a different selection and there are
     * two fetches in flight; the slower one settles last and wins, so the
     * modal ends up offering the previous selection's labels. Stamp each
     * run and let only the newest one write state.
     */
    const requestId: number = ++removeLabelsRequestRef.current;

    type IsCurrentRequestFunction = () => boolean;

    const isCurrentRequest: IsCurrentRequestFunction = (): boolean => {
      return requestId === removeLabelsRequestRef.current;
    };

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
        if (isCurrentRequest()) {
          setRemoveLabelDropdownOptions([]);
        }
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
            color: true,
          },
        } as any,
        sort: {},
      });

      // Union of labels across all selected items, de-duplicated by id.
      const labelById: Map<string, Label> = new Map<string, Label>();

      for (const item of result.data) {
        const itemLabels: Array<Label> =
          ((item as any).labels as Array<Label> | undefined) || [];

        for (const label of itemLabels) {
          const id: string = label._id?.toString() || "";
          if (id.length > 0) {
            labelById.set(id, label);
          }
        }
      }

      const options: Array<DropdownOption> = Array.from(labelById.values()).map(
        (label: Label) => {
          const option: DropdownOption = {
            label: label.name || "",
            value: label._id?.toString() || "",
          };

          if (label.color) {
            option.color = label.color;
          }

          return option;
        },
      );

      options.sort((a: DropdownOption, b: DropdownOption) => {
        return a.label.localeCompare(b.label);
      });

      if (isCurrentRequest()) {
        setRemoveLabelDropdownOptions(options);
      }
    } catch {
      // on error, show no options rather than every label in the project
      if (isCurrentRequest()) {
        setRemoveLabelDropdownOptions([]);
      }
    } finally {
      if (isCurrentRequest()) {
        setIsLoadingRemoveLabels(false);
      }
    }
  };

  const labelDropdownOptions: Array<DropdownOption> = labels.map(
    (label: Label) => {
      const option: DropdownOption = {
        label: label.name || "",
        value: label._id?.toString() || "",
      };

      if (label.color) {
        option.color = label.color;
      }

      return option;
    },
  );

  /*
   * Bulk actions are handed straight to the table's action bar, which never
   * looks at permissions - so a viewer on an otherwise gated table could still
   * relabel, reassign or archive every row they had selected. Each of these
   * actions is an update of the records it touches.
   */
  const updateGate: PermissionGateResult = PermissionGate.check(
    new config.modelType(),
    ModelAction.Update,
  );

  type GateActionFunction = (
    action: BulkActionButtonSchema<T>,
  ) => BulkActionButtonSchema<T>;

  const gateAction: GateActionFunction = (
    action: BulkActionButtonSchema<T>,
  ): BulkActionButtonSchema<T> => {
    if (updateGate.isAllowed || !updateGate.disabledReason) {
      return action;
    }

    return {
      ...action,
      disabled: true,
      tooltip: updateGate.disabledReason,
    };
  };

  const addLabelsAction: BulkActionButtonSchema<T> = {
    title: "Add Labels",
    buttonStyleType: ButtonStyleType.NORMAL,
    icon: IconProp.Label,
    /*
     * The two modals are independent booleans rendered as sibling
     * branches, so nothing in the hook keeps them mutually exclusive —
     * only the modal backdrop covering the action bar does, which is a
     * property of a different component. Resetting the sibling here makes
     * the invariant local: two stacked dialogs would share one
     * bulkActionProps, and whichever submitted first would null it and
     * leave the other silently inert.
     */
    onClick: async (actionProps: BulkActionOnClickProps<T>): Promise<void> => {
      setBulkActionProps(actionProps);
      setShowRemoveModal(false);
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
      setShowAddModal(false);
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
    bulkActions: [gateAction(addLabelsAction), gateAction(removeLabelsAction)],
    modals: modals,
  };
}

export default useBulkLabelActions;
