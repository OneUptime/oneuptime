import React, { ReactElement, useState } from "react";

import BaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
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
import Field, {
  FormFieldSideLink,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { PluralTemplate, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * "Set X" / "Clear X" over a selection, for a relation a record holds one
 * of: a device's site and role, a site's parent and default probe. One
 * dialog with one question - which one - and one save for the whole
 * selection; clearing is a confirm.
 *
 * The write is the relation's id column, and what the dialog's other
 * fields say for the record, through the ordinary update, so permissions,
 * label and owner scopes, and every server-side consequence (a site's
 * health rollup, its subtree's paths, the alert policies a role or site
 * scopes) apply exactly as when one record is edited on its Settings page.
 *
 * ONE RECORD AT A TIME. Each of these writes does server-side work that
 * reads shared state: moving a device re-rolls the health of the site it
 * left and the site it joined, a site's new parent takes its whole subtree
 * under the hierarchy's lock and re-rolls both parents' health, and a site
 * or role is an alert-policy scope, so the write reconciles the device's
 * policy monitors against the project's plan. Two writes in flight would
 * each read the other's half-done state. The server's own bulk moves (an
 * assignment rule's Run Now) go one record at a time for the same reason.
 */

export interface BulkRelationActionsResult<T extends BaseModel> {
  bulkActions: Array<BulkActionButtonSchema<T>>;
  modals: ReactElement;
}

/*
 * What the Set dialog was filled in with: the relation picked, and the
 * answers to any other fields the dialog asks (getMoreFields).
 */
export type SetRelationFormData = {
  relationId: string;
} & JSONObject;

export interface BulkRelationConfig<T extends BaseModel> {
  modelType: { new (): T };
  // The relation's id column, written with the id picked or null.
  column: string;
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
        sort?: { [columnName: string]: SortOrder } | undefined;
      };
      sideLink?: FormFieldSideLink | undefined;
    };
    // Drawn under the picker: where the same thing happens automatically.
    footer?: ReactElement | undefined;
    /*
     * More the dialog asks, for the selection it was opened on: the type a
     * site with none takes as it moves under another. None by default.
     */
    getMoreFields?:
      | ((items: Array<T>) => Array<Field<SetRelationFormData>>)
      | undefined;
  };
  clear: {
    title: string;
    icon: IconProp;
    confirmTitle: PluralTemplate;
    confirmMessage: PluralTemplate;
  };
  /*
   * The id of the relation a record holds, from its row, or null. "Clear"
   * is only offered to a selection where it would clear something, and a
   * record already in the state asked for is not written again.
   */
  readRelationId: (item: T) => string | null;
  // Why a record "Set" leaves alone: it already holds what was picked.
  alreadySetReason: string;
  // Why a record "Clear" leaves alone: it holds nothing to clear.
  notSetReason: string;
  /*
   * Why else "Set" leaves a record alone for the id picked, or null: a site
   * picked as the parent of the selection it is in is not put under itself.
   */
  getUnchangedReason?:
    | ((item: T, relationId: ObjectID) => string | null)
    | undefined;
  /*
   * What else "Set" writes for a record, from the dialog's other fields: a
   * site with no type takes the one picked. Nothing by default.
   */
  getMoreWriteData?:
    | ((item: T, formData: SetRelationFormData) => JSONObject)
    | undefined;
  /*
   * The menu item as the reader may use it: locked, with the reason on
   * hover, for one who may not update the records (BulkDeviceActionGate).
   */
  gate: (action: BulkActionButtonSchema<T>) => BulkActionButtonSchema<T>;
}

/*
 * The selected records that hold the relation - what "Clear" counts and
 * changes.
 */
function countHolding<T extends BaseModel>(
  items: Array<T>,
  config: BulkRelationConfig<T>,
): number {
  return items.filter((item: T): boolean => {
    return Boolean(config.readRelationId(item));
  }).length;
}

function useBulkRelationActions<T extends BaseModel>(
  config: BulkRelationConfig<T>,
): BulkRelationActionsResult<T> {
  const translator: Translator = useTranslator();
  const [bulkActionProps, setBulkActionProps] =
    useState<BulkActionOnClickProps<T> | null>(null);

  const say: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  type WriteRelationFunction = (
    actionProps: BulkActionOnClickProps<T>,
    relationId: ObjectID | null,
    formData: SetRelationFormData | null,
  ) => Promise<void>;

  /*
   * Takes the action props explicitly rather than reading them off state:
   * "Clear" runs straight out of its confirm dialog, in the same tick as its
   * own onClick.
   */
  const writeRelation: WriteRelationFunction = async (
    actionProps: BulkActionOnClickProps<T>,
    relationId: ObjectID | null,
    formData: SetRelationFormData | null,
  ): Promise<void> => {
    await runBulkAction<T>({
      actionProps: actionProps,
      concurrency: 1,
      step: async (item: T): Promise<BulkItemOutcome> => {
        if (!item.id) {
          throw new BadDataException(
            "This row has no ID, so it could not be changed. Reload the page and try again.",
          );
        }

        /*
         * A record already in the state asked for is not written again: a
         * move into the site a device is in would still re-roll that site's
         * health and re-reconcile its alert-policy monitors, for nothing.
         * Judged from the row, which the table re-reads after every bulk
         * action.
         */
        const current: string | null = config.readRelationId(item);

        if (relationId === null && !current) {
          return bulkItemUnchanged(say(config.notSetReason));
        }

        if (relationId !== null) {
          if (current === relationId.toString()) {
            return bulkItemUnchanged(say(config.alreadySetReason));
          }

          const reason: string | null =
            config.getUnchangedReason?.(item, relationId) || null;

          if (reason) {
            return bulkItemUnchanged(say(reason));
          }
        }

        /*
         * Nothing else is read first: the relation is one column the
         * operator is replacing outright, and the server decides everything
         * that follows from it.
         */
        const data: JSONObject = {
          ...(relationId !== null && formData && config.getMoreWriteData
            ? config.getMoreWriteData(item, formData)
            : {}),
          [config.column]: relationId,
        };

        await ModelAPI.updateById<T>({
          id: item.id,
          modelType: config.modelType,
          data: data,
        });

        return BULK_ITEM_CHANGED;
      },
    });

    setBulkActionProps(null);
  };

  const setAction: BulkActionButtonSchema<T> = {
    title: config.set.title,
    buttonStyleType: ButtonStyleType.NORMAL,
    icon: config.set.icon,
    onClick: async (actionProps: BulkActionOnClickProps<T>): Promise<void> => {
      setBulkActionProps(actionProps);
    },
  };

  const clearAction: BulkActionButtonSchema<T> = {
    title: config.clear.title,
    buttonStyleType: ButtonStyleType.NORMAL,
    icon: config.clear.icon,
    isVisible: (items: Array<T>): boolean => {
      // The convention every bulk action here follows for an empty selection.
      if (items.length === 0) {
        return true;
      }

      return countHolding(items, config) > 0;
    },
    /*
     * Counted by the records it changes: of nine selected devices, the one
     * in a site is the one "Remove 1 device from its site?" is about. The
     * others are listed as not changed when it is done.
     */
    confirmTitle: (items: Array<T>): string => {
      return translator.translatePlural(
        config.clear.confirmTitle,
        countHolding(items, config),
      );
    },
    confirmMessage: (items: Array<T>): string => {
      return translator.translatePlural(
        config.clear.confirmMessage,
        countHolding(items, config),
      );
    },
    onClick: async (actionProps: BulkActionOnClickProps<T>): Promise<void> => {
      await writeRelation(actionProps, null, null);
    },
  };

  const closeModal: () => void = (): void => {
    setBulkActionProps(null);
  };

  const moreFields: Array<Field<SetRelationFormData>> =
    bulkActionProps && config.set.getMoreFields
      ? config.set.getMoreFields(bulkActionProps.items)
      : [];

  const modals: ReactElement = (
    <>
      {bulkActionProps && (
        <BasicFormModal<SetRelationFormData>
          title={config.set.title}
          description={config.set.description}
          onClose={closeModal}
          submitButtonText={config.set.submitButtonText}
          onSubmit={async (formData: SetRelationFormData) => {
            const actionProps: BulkActionOnClickProps<T> | null =
              bulkActionProps;

            setBulkActionProps(null);

            /*
             * The field is required, so an empty id means the option itself
             * came back without one. Writing "" would fail every record over
             * one unusable option, so nothing starts.
             */
            const relationId: string = String(formData.relationId || "").trim();

            if (!actionProps || !relationId) {
              return;
            }

            await writeRelation(
              actionProps,
              new ObjectID(relationId),
              formData,
            );
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
              ...moreFields,
            ],
          }}
        />
      )}
    </>
  );

  return {
    bulkActions: [config.gate(setAction), config.gate(clearAction)],
    modals: modals,
  };
}

export default useBulkRelationActions;
