import React, { ReactElement, useState } from "react";

import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import {
  BULK_ITEM_CHANGED,
  BulkItemOutcome,
  bulkItemUnchanged,
  runBulkAction,
} from "Common/UI/Components/BulkUpdate/BulkActionRunner";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import { FormFieldSideLink } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { PluralTemplate, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { gateDeviceBulkAction } from "./BulkDeviceActionGate";

/*
 * "Set X" / "Clear X" over a selection, for a relation a device holds one
 * of: its site, its role. One dialog with one question - which one - and
 * one save for the whole selection; clearing is a confirm.
 *
 * The write is the relation's id column and nothing else, through the
 * ordinary device update, so permissions, label and owner scopes, and every
 * server-side consequence (the site rollup, the site's default probe, the
 * alert policies a role or site scopes) apply exactly as when one device is
 * edited on its Settings page.
 *
 * ONE DEVICE AT A TIME. Each of these writes does server-side work that
 * reads shared state: moving a device re-rolls the health of the site it
 * left and the site it joined (and may raise or resolve that site's alert),
 * and a site or role is an alert-policy scope, so the write reconciles the
 * device's policy monitors against the project's plan. Two writes in flight
 * would each read the other's half-done state. The server's own bulk moves
 * (an assignment rule's Run Now) go one device at a time for the same
 * reason.
 */

export interface BulkDeviceRelationActionsResult {
  bulkActions: Array<BulkActionButtonSchema<NetworkDevice>>;
  modals: ReactElement;
}

// The relation id columns these actions write.
export type DeviceRelationColumn = "siteId" | "networkDeviceRoleId";

export interface BulkDeviceRelationConfig {
  column: DeviceRelationColumn;
  set: {
    // The menu item and the dialog's title.
    title: string;
    icon: IconProp;
    description: string;
    submitButtonText: string;
    field: {
      title: string;
      description?: string | undefined;
      placeholder: string;
      dropdownModal: {
        type: DatabaseBaseModelType;
        labelField: string;
        valueField: string;
      };
      sideLink?: FormFieldSideLink | undefined;
    };
    // Drawn under the picker: where the same thing happens automatically.
    footer?: ReactElement | undefined;
  };
  clear: {
    title: string;
    icon: IconProp;
    confirmTitle: PluralTemplate;
    confirmMessage: PluralTemplate;
  };
  /*
   * The id of the relation a device holds, from its row, or null. "Clear" is
   * only offered to a selection where it would clear something, and a device
   * already in the state asked for is not written again.
   */
  readRelationId: (device: NetworkDevice) => string | null;
  // Why a device "Set" leaves alone: it already holds what was picked.
  alreadySetReason: string;
  // Why a device "Clear" leaves alone: it holds nothing to clear.
  notSetReason: string;
}

/*
 * The selected devices that hold the relation - what "Clear" counts and
 * changes.
 */
function countHolding(
  items: Array<NetworkDevice>,
  config: BulkDeviceRelationConfig,
): number {
  return items.filter((item: NetworkDevice): boolean => {
    return Boolean(config.readRelationId(item));
  }).length;
}

/*
 * The one field the dialog asks. A type alias rather than an interface so it
 * satisfies BasicFormModal's GenericObject constraint.
 */
type SetRelationFormData = {
  relationId: string;
};

function useBulkDeviceRelationActions(
  config: BulkDeviceRelationConfig,
): BulkDeviceRelationActionsResult {
  const translator: Translator = useTranslator();
  const [bulkActionProps, setBulkActionProps] =
    useState<BulkActionOnClickProps<NetworkDevice> | null>(null);

  type WriteRelationFunction = (
    actionProps: BulkActionOnClickProps<NetworkDevice>,
    relationId: ObjectID | null,
  ) => Promise<void>;

  /*
   * Takes the action props explicitly rather than reading them off state:
   * "Clear" runs straight out of its confirm dialog, in the same tick as its
   * own onClick.
   */
  const writeRelation: WriteRelationFunction = async (
    actionProps: BulkActionOnClickProps<NetworkDevice>,
    relationId: ObjectID | null,
  ): Promise<void> => {
    await runBulkAction<NetworkDevice>({
      actionProps: actionProps,
      concurrency: 1,
      step: async (item: NetworkDevice): Promise<BulkItemOutcome> => {
        if (!item.id) {
          throw new BadDataException("Item ID not found");
        }

        /*
         * A device already in the state asked for is not written again: a
         * move into the site it is in would still re-roll that site's health
         * and re-reconcile its alert-policy monitors, for nothing. Judged from
         * the row, which the table re-reads after every bulk action.
         */
        const current: string | null = config.readRelationId(item);

        if (relationId === null && !current) {
          return bulkItemUnchanged(
            translator.translateText(config.notSetReason) ||
              config.notSetReason,
          );
        }

        if (relationId !== null && current === relationId.toString()) {
          return bulkItemUnchanged(
            translator.translateText(config.alreadySetReason) ||
              config.alreadySetReason,
          );
        }

        /*
         * Nothing else is read first: the relation is one column the operator
         * is replacing outright, and the server decides everything that
         * follows from it.
         */
        const data: JSONObject = {
          [config.column]: relationId,
        };

        await ModelAPI.updateById<NetworkDevice>({
          id: item.id,
          modelType: NetworkDevice,
          data: data,
        });

        return BULK_ITEM_CHANGED;
      },
    });

    setBulkActionProps(null);
  };

  const setAction: BulkActionButtonSchema<NetworkDevice> = {
    title: config.set.title,
    buttonStyleType: ButtonStyleType.NORMAL,
    icon: config.set.icon,
    onClick: async (
      actionProps: BulkActionOnClickProps<NetworkDevice>,
    ): Promise<void> => {
      setBulkActionProps(actionProps);
    },
  };

  const clearAction: BulkActionButtonSchema<NetworkDevice> = {
    title: config.clear.title,
    buttonStyleType: ButtonStyleType.NORMAL,
    icon: config.clear.icon,
    isVisible: (items: Array<NetworkDevice>): boolean => {
      // The convention every bulk action here follows for an empty selection.
      if (items.length === 0) {
        return true;
      }

      return countHolding(items, config) > 0;
    },
    /*
     * Counted by the devices it changes: of nine selected devices, the one
     * in a site is the one "Remove 1 device from its site?" is about. The
     * others are listed as not changed when it is done.
     */
    confirmTitle: (items: Array<NetworkDevice>): string => {
      return translator.translatePlural(
        config.clear.confirmTitle,
        countHolding(items, config),
      );
    },
    confirmMessage: (items: Array<NetworkDevice>): string => {
      return translator.translatePlural(
        config.clear.confirmMessage,
        countHolding(items, config),
      );
    },
    onClick: async (
      actionProps: BulkActionOnClickProps<NetworkDevice>,
    ): Promise<void> => {
      await writeRelation(actionProps, null);
    },
  };

  const closeModal: () => void = (): void => {
    setBulkActionProps(null);
  };

  const modals: ReactElement = (
    <>
      {bulkActionProps && (
        <BasicFormModal<SetRelationFormData>
          title={config.set.title}
          description={config.set.description}
          onClose={closeModal}
          submitButtonText={config.set.submitButtonText}
          onSubmit={async (formData: SetRelationFormData) => {
            const actionProps: BulkActionOnClickProps<NetworkDevice> | null =
              bulkActionProps;

            setBulkActionProps(null);

            /*
             * The field is required, so an empty id means the option itself
             * came back without one. Writing "" would fail every device over
             * one unusable option, so nothing starts.
             */
            const relationId: string = String(formData.relationId || "").trim();

            if (!actionProps || !relationId) {
              return;
            }

            await writeRelation(actionProps, new ObjectID(relationId));
          }}
          formProps={{
            fields: [
              {
                field: {
                  relationId: true,
                },
                title: config.set.field.title,
                ...(config.set.field.description
                  ? { description: config.set.field.description }
                  : {}),
                fieldType: FormFieldSchemaType.Dropdown,
                required: true,
                dropdownModal: config.set.field.dropdownModal,
                ...(config.set.field.sideLink
                  ? { sideLink: config.set.field.sideLink }
                  : {}),
                placeholder: config.set.field.placeholder,
                ...(config.set.footer
                  ? { footerElement: config.set.footer }
                  : {}),
              },
            ],
          }}
        />
      )}
    </>
  );

  return {
    bulkActions: [
      gateDeviceBulkAction(setAction),
      gateDeviceBulkAction(clearAction),
    ],
    modals: modals,
  };
}

export default useBulkDeviceRelationActions;
