import React, { ReactElement } from "react";

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "../../../Types/Exception/BadDataException";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import { getRecordDisplayName } from "../../Utils/ModelDisplayName";
import PermissionGate, {
  PermissionGateResult,
} from "../../Utils/PermissionGate";
import {
  PluralTemplate,
  translatableTerm,
  TranslatableTerm,
  translationKey,
  Translator,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import { ButtonStyleType } from "../Button/Button";
import DeleteItemNames from "../DeleteConfirmation/DeleteItemNames";
import {
  BULK_ITEM_CHANGED,
  BulkItemOutcome,
  bulkItemUnchanged,
  runBulkAction,
} from "./BulkActionRunner";
import { getBulkSwitchConsequence } from "./BulkSwitchConsequences";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "./BulkUpdateForm";

/*
 * ONE WAY TO TURN A SWITCH ON MANY RECORDS AT ONCE.
 *
 * Enable and Disable on a list of workflows, rules or runbooks, Unsubscribe
 * on a list of subscribers: each is one boolean column written on every
 * selected row. Before this, each list that had one wrote its own loop (or
 * had none, and its records were turned one page at a time). This is the
 * shared one, and every bulk switch reads the same way:
 *
 *   - the menu item is gated on the column's own update permission
 *     (PermissionGate.checkColumnUpdate): someone who may not change it sees
 *     the item locked, with the permission it takes;
 *   - an action whose state every selected row is in already is not offered
 *     (nothing to disable among disabled workflows);
 *   - the confirmation counts the rows it will change - "Disable 3
 *     workflows?" when two of the five selected are off already - names
 *     them, and says what the change does to them (BulkSwitchConsequences);
 *   - each row is written with its own update through the API, so the server
 *     checks the permission on that row (labels, owners, a team's blocks)
 *     and runs everything a change of that switch runs, exactly as the
 *     record's own switch would;
 *   - the result says how many changed, which were left alone and why
 *     ("Already disabled."), and which the server refused, in its words.
 *
 * Rows are written one at a time: a switch's server-side work can read
 * shared state (a plan's limits, the next run's schedule), and each write
 * must see the one before it finished.
 */

export interface BulkSwitchAction {
  // The value the action writes to the column.
  value: boolean;
  // The Bulk Actions item and the confirmation's button, in English.
  title: string;
  icon: IconProp;
  // The confirmation's title, counted: "Disable {{count}} {{itemsName}}".
  confirmTitle: PluralTemplate;
  // Its question, counted: "Are you sure you want to disable ...?".
  confirmQuestion: PluralTemplate;
  // Why a row already in that state is left alone: "Already disabled."
  alreadyReason: string;
  /*
   * Under the names, when some of the selection is in that state already:
   * "1 selected workflow is already disabled." The question counts only the
   * rows it changes, so without it "Disable 2 Workflows" over three selected
   * rows read as if one had been lost.
   */
  alreadyNote: PluralTemplate;
  // The result's counts: "3 Workflows disabled", "1 Workflow not disabled".
  resultLabels: {
    succeeded: PluralTemplate;
    failed: PluralTemplate;
  };
  // A danger style puts the item below the divider in Bulk Actions.
  buttonStyleType?: ButtonStyleType | undefined;
}

export const ENABLE_SWITCH_ACTION: BulkSwitchAction = {
  value: true,
  title: "Enable",
  icon: IconProp.Play,
  confirmTitle: {
    one: "Enable {{count}} {{itemName}}",
    other: "Enable {{count}} {{itemsName}}",
  },
  confirmQuestion: {
    one: "Are you sure you want to enable {{count}} {{itemName}}?",
    other: "Are you sure you want to enable {{count}} {{itemsName}}?",
  },
  alreadyReason: translationKey("Already enabled."),
  alreadyNote: {
    one: "{{count}} selected {{itemName}} is already enabled.",
    other: "{{count}} selected {{itemsName}} are already enabled.",
  },
  resultLabels: {
    succeeded: {
      one: "{{count}} {{itemName}} enabled",
      other: "{{count}} {{itemsName}} enabled",
    },
    failed: {
      one: "{{count}} {{itemName}} not enabled",
      other: "{{count}} {{itemsName}} not enabled",
    },
  },
};

export const DISABLE_SWITCH_ACTION: BulkSwitchAction = {
  value: false,
  title: "Disable",
  icon: IconProp.Stop,
  confirmTitle: {
    one: "Disable {{count}} {{itemName}}",
    other: "Disable {{count}} {{itemsName}}",
  },
  confirmQuestion: {
    one: "Are you sure you want to disable {{count}} {{itemName}}?",
    other: "Are you sure you want to disable {{count}} {{itemsName}}?",
  },
  alreadyReason: translationKey("Already disabled."),
  alreadyNote: {
    one: "{{count}} selected {{itemName}} is already disabled.",
    other: "{{count}} selected {{itemsName}} are already disabled.",
  },
  resultLabels: {
    succeeded: {
      one: "{{count}} {{itemName}} disabled",
      other: "{{count}} {{itemsName}} disabled",
    },
    failed: {
      one: "{{count}} {{itemName}} not disabled",
      other: "{{count}} {{itemsName}} not disabled",
    },
  },
};

/*
 * A subscriber turned off without being deleted: it stays in the list, and
 * nothing more is sent to it. Subscribing people again is left to each
 * subscriber's Edit form - one at a time, with the person in front of whoever
 * does it - because many unsubscribed themselves, and a bulk "subscribe
 * again" would send updates to people who asked to stop.
 */
export const UNSUBSCRIBE_SWITCH_ACTION: BulkSwitchAction = {
  value: true,
  title: "Unsubscribe",
  icon: IconProp.BellSlash,
  confirmTitle: {
    one: "Unsubscribe {{count}} {{itemName}}",
    other: "Unsubscribe {{count}} {{itemsName}}",
  },
  confirmQuestion: {
    one: "Are you sure you want to unsubscribe {{count}} {{itemName}}?",
    other: "Are you sure you want to unsubscribe {{count}} {{itemsName}}?",
  },
  alreadyReason: translationKey("Already unsubscribed."),
  alreadyNote: {
    one: "{{count}} selected {{itemName}} is already unsubscribed.",
    other: "{{count}} selected {{itemsName}} are already unsubscribed.",
  },
  resultLabels: {
    succeeded: {
      one: "{{count}} {{itemName}} unsubscribed",
      other: "{{count}} {{itemsName}} unsubscribed",
    },
    failed: {
      one: "{{count}} {{itemName}} not unsubscribed",
      other: "{{count}} {{itemsName}} not unsubscribed",
    },
  },
};

export interface BulkSwitchActionsConfig<T extends BaseModel> {
  modelType: { new (): T };
  /*
   * The boolean column the actions write. The list must read it (a column
   * or selectMoreFields) for a row already in the state asked for to be
   * left alone; a row that does not carry it is written.
   */
  column: keyof T & string;
  // Enable and Disable unless told otherwise.
  actions?: Array<BulkSwitchAction> | undefined;
  /*
   * What one row and several are called in the sentences, when the list
   * calls them something other than the model does ("Subscriber").
   */
  singularName?: string | undefined;
  pluralName?: string | undefined;
  // How the confirmation names a row; the row's name column otherwise.
  getItemName?: ((item: T) => string) | undefined;
  // The API the writes go through: the Admin Dashboard's has no project.
  modelAPI?: typeof ModelAPI | undefined;
}

// The rows whose column does not hold `value` (a row that does not say is one).
export const getRowsToChange: <T extends BaseModel>(
  items: Array<T>,
  column: string,
  value: boolean,
) => Array<T> = <T extends BaseModel>(
  items: Array<T>,
  column: string,
  value: boolean,
): Array<T> => {
  return items.filter((item: T): boolean => {
    const current: unknown = (item as unknown as JSONObject)[column];

    return typeof current !== "boolean" || current !== value;
  });
};

function useBulkSwitchActions<T extends BaseModel>(
  config: BulkSwitchActionsConfig<T>,
): Array<BulkActionButtonSchema<T>> {
  const translator: Translator = useTranslator();
  const model: T = new config.modelType();
  const modelAPI: typeof ModelAPI = config.modelAPI || ModelAPI;

  const nounValues: (
    inSentence: boolean,
  ) => Record<string, TranslatableTerm> = (
    inSentence: boolean,
  ): Record<string, TranslatableTerm> => {
    return {
      itemName: translatableTerm(
        config.singularName || model.singularName || "item",
        { inSentence: inSentence },
      ),
      itemsName: translatableTerm(
        config.pluralName || model.pluralName || "items",
        { inSentence: inSentence },
      ),
    };
  };

  const nameOf: (item: T) => string = (item: T): string => {
    const given: string = config.getItemName
      ? config.getItemName(item).trim()
      : "";

    return given || getRecordDisplayName(item, { model: model });
  };

  /*
   * Changing the switch is an update of that one column, which can be
   * narrower than its table (ColumnPermission refuses it either way).
   */
  const gate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    model,
    config.column,
  );

  const buildAction: (action: BulkSwitchAction) => BulkActionButtonSchema<T> = (
    action: BulkSwitchAction,
  ): BulkActionButtonSchema<T> => {
    const consequence: string = getBulkSwitchConsequence({
      tableName: model.tableName,
      column: config.column,
      value: action.value,
    });

    const schema: BulkActionButtonSchema<T> = {
      title: action.title,
      icon: action.icon,
      buttonStyleType: action.buttonStyleType || ButtonStyleType.NORMAL,
      // Nothing to do when every selected row is in that state already.
      isVisible: (items: Array<T>): boolean => {
        if (items.length === 0) {
          return true;
        }

        return getRowsToChange(items, config.column, action.value).length > 0;
      },
      confirmTitle: (items: Array<T>): string => {
        const count: number = getRowsToChange(
          items,
          config.column,
          action.value,
        ).length;

        return translator.translatePlural(action.confirmTitle, count, {
          ...nounValues(false),
        });
      },
      confirmMessage: (items: Array<T>): string => {
        const count: number = getRowsToChange(
          items,
          config.column,
          action.value,
        ).length;

        return translator.translatePlural(action.confirmQuestion, count, {
          ...nounValues(true),
        });
      },
      /*
       * Which rows change, how many of the selection are in that state
       * already, then what the change does to them.
       */
      confirmDetails: (items: Array<T>): ReactElement => {
        const rows: Array<T> = getRowsToChange(
          items,
          config.column,
          action.value,
        );
        const alreadyCount: number = items.length - rows.length;

        return (
          <div className="space-y-3">
            <DeleteItemNames
              names={rows.map((item: T): string => {
                return nameOf(item);
              })}
              totalCount={rows.length}
            />
            {alreadyCount > 0 ? (
              <p
                data-testid="bulk-switch-already"
                className="text-sm text-gray-500"
              >
                {translator.translatePlural(action.alreadyNote, alreadyCount, {
                  ...nounValues(true),
                })}
              </p>
            ) : (
              <></>
            )}
            {consequence ? (
              <p
                data-testid="bulk-switch-consequence"
                className="text-sm leading-6 text-gray-600"
              >
                {translator.translateText(consequence) || consequence}
              </p>
            ) : (
              <></>
            )}
          </div>
        );
      },
      resultLabels: action.resultLabels,
      onClick: async (props: BulkActionOnClickProps<T>): Promise<void> => {
        await runBulkAction<T>({
          actionProps: props,
          concurrency: 1,
          step: async (item: T): Promise<BulkItemOutcome> => {
            if (!item.id) {
              throw new BadDataException("Item ID not found");
            }

            if (
              getRowsToChange([item], config.column, action.value).length === 0
            ) {
              return bulkItemUnchanged(
                translator.translateText(action.alreadyReason) ||
                  action.alreadyReason,
              );
            }

            await modelAPI.updateById<T>({
              modelType: config.modelType,
              id: item.id as ObjectID,
              data: {
                [config.column]: action.value,
              },
            });

            return BULK_ITEM_CHANGED;
          },
        });
      },
    };

    if (!gate.isAllowed && gate.disabledReason) {
      return {
        ...schema,
        disabled: true,
        tooltip: gate.disabledReason,
      };
    }

    return schema;
  };

  return (config.actions || [ENABLE_SWITCH_ACTION, DISABLE_SWITCH_ACTION]).map(
    (action: BulkSwitchAction): BulkActionButtonSchema<T> => {
      return buildAction(action);
    },
  );
}

export default useBulkSwitchActions;
