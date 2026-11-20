import {
  BLOCK_ADMIN_PERMISSIONS,
  getBlockDurationOptions,
} from "./BlockAddressModal";
import {
  ENDED_BLOCK_REASON,
  EXTENDED_TOAST,
  EXTEND_ACTION,
  EXTEND_DESCRIPTION,
  EXTEND_FIELD_TITLE,
  EXTEND_TITLE,
  LIFTED_TOAST,
  LIFT_ACTION,
  LIFT_DESCRIPTION,
  LIFT_REASON_FIELD_DESCRIPTION,
  LIFT_SELECTED_DESCRIPTION,
  LIFT_SELECTED_TITLE,
  LIFT_TITLE,
  MADE_PERMANENT_TOAST,
  MAKE_PERMANENT_ACTION,
  MAKE_PERMANENT_DESCRIPTION,
  MAKE_PERMANENT_TITLE,
  REASON_FIELD_TITLE,
  UNTIL_LIFTED_REFUSED,
} from "./BlocklistCopy";
import SecurityBlock from "Common/Models/DatabaseModels/SecurityBlock";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import {
  SECURITY_BLOCK_DEFAULT_DURATION,
  SecurityBlockDuration,
  SecurityBlockState,
  getSecurityBlockExpiry,
} from "Common/Types/SecurityBlocklist/SecurityBlock";
import ActionButtonSchema, {
  RowActionConfirmation,
  RowActionContext,
} from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import {
  BULK_ACTION_CONCURRENCY,
  BulkItemOutcome,
  bulkItemUnchanged,
  runBulkAction,
} from "Common/UI/Components/BulkUpdate/BulkActionRunner";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import Toast from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { ReactElement, useState } from "react";

/*
 * What a block's row offers (#10338): Lift, with why; Extend, by a length
 * from now; and Make Permanent, which only a Security Admin may do - locked,
 * with why, for anyone else. Lift works on several rows at once, one update
 * per block, through the bulk runner (its progress shown, and stoppable).
 * Each is an update of the block, which the server checks and records on
 * its case's timeline and in the audit log; an ended block offers nothing.
 */

const REASON_FIELD: string = "reason";
const DURATION_FIELD: string = "duration";

type DialogState =
  | { kind: "lift"; block: SecurityBlock; context?: RowActionContext }
  | { kind: "extend"; block: SecurityBlock; context?: RowActionContext }
  | { kind: "bulkLift"; actionProps: BulkActionOnClickProps<SecurityBlock> };

export interface BlocklistActions {
  actionButtons: Array<ActionButtonSchema<SecurityBlock>>;
  bulkLift: BulkActionButtonSchema<SecurityBlock>;
  modal: ReactElement;
}

function isActive(block: SecurityBlock): boolean {
  return block.state === SecurityBlockState.Active;
}

export default function useBlocklistActions(data: {
  // Told once a change is saved, so the list reads it again.
  onChanged: () => void;
}): BlocklistActions {
  const translator: Translator = useTranslator();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const updateGate: PermissionGateResult = PermissionGate.check(
    new SecurityBlock(),
    ModelAction.Update,
  );
  const isAdmin: boolean = PermissionGate.holdsAnyOf(BLOCK_ADMIN_PERMISSIONS);

  const close: VoidFunction = (): void => {
    setDialog(null);
    setError(undefined);
    setIsSubmitting(false);
  };

  const update: (
    block: SecurityBlock,
    values: JSONObject,
  ) => Promise<void> = async (
    block: SecurityBlock,
    values: JSONObject,
  ): Promise<void> => {
    if (!block.id) {
      throw new BadDataException(
        "This block could not be read. Reload the page and try again.",
      );
    }

    await ModelAPI.updateById<SecurityBlock>({
      modelType: SecurityBlock,
      id: block.id,
      data: values,
    });
  };

  const runDialog: (
    work: () => Promise<void>,
    context?: RowActionContext,
  ) => Promise<void> = async (
    work: () => Promise<void>,
    context?: RowActionContext,
  ): Promise<void> => {
    setIsSubmitting(true);
    setError(undefined);

    try {
      await work();
      close();
      context?.refresh();
      data.onChanged();
    } catch (caught) {
      setError(API.getFriendlyMessage(caught));
      setIsSubmitting(false);
    }
  };

  const actionButtons: Array<ActionButtonSchema<SecurityBlock>> = [
    {
      title: LIFT_ACTION,
      icon: IconProp.LockOpen,
      buttonStyleType: ButtonStyleType.NORMAL,
      disabled: !updateGate.isAllowed && Boolean(updateGate.disabledReason),
      tooltip: updateGate.isAllowed ? undefined : updateGate.disabledReason,
      isVisible: isActive,
      onClick: (
        block: SecurityBlock,
        onCompleteAction: VoidFunction,
        _onError: ErrorFunction,
        context?: RowActionContext,
      ): void => {
        setDialog({ kind: "lift", block, ...(context ? { context } : {}) });
        onCompleteAction();
      },
    },
    {
      title: EXTEND_ACTION,
      icon: IconProp.Clock,
      buttonStyleType: ButtonStyleType.OUTLINE,
      disabled: !updateGate.isAllowed && Boolean(updateGate.disabledReason),
      tooltip: updateGate.isAllowed ? undefined : updateGate.disabledReason,
      isVisible: (block: SecurityBlock): boolean => {
        return isActive(block) && Boolean(block.expiresAt);
      },
      onClick: (
        block: SecurityBlock,
        onCompleteAction: VoidFunction,
        _onError: ErrorFunction,
        context?: RowActionContext,
      ): void => {
        setDialog({ kind: "extend", block, ...(context ? { context } : {}) });
        onCompleteAction();
      },
    },
    {
      title: MAKE_PERMANENT_ACTION,
      icon: IconProp.Lock,
      buttonStyleType: ButtonStyleType.OUTLINE,
      disabled: !isAdmin,
      tooltip: isAdmin ? undefined : UNTIL_LIFTED_REFUSED,
      isVisible: (block: SecurityBlock): boolean => {
        return isActive(block) && Boolean(block.expiresAt);
      },
      getConfirmation: (
        block: SecurityBlock,
      ): RowActionConfirmation | undefined => {
        return {
          title: MAKE_PERMANENT_TITLE,
          description: translator.translateTemplate(
            MAKE_PERMANENT_DESCRIPTION,
            { value: block.value || "" },
          ),
          submitButtonText: MAKE_PERMANENT_ACTION,
        };
      },
      onClick: async (
        block: SecurityBlock,
        onCompleteAction: VoidFunction,
        onError: ErrorFunction,
        context?: RowActionContext,
      ): Promise<void> => {
        try {
          await update(block, { expiresAt: null });
          Toast.success(
            translator.translateTemplate(MADE_PERMANENT_TOAST, {
              value: block.value || "",
            }),
          );
          onCompleteAction();
          context?.refresh();
          data.onChanged();
        } catch (caught) {
          onError(caught as Error);
        }
      },
    },
  ];

  const bulkLift: BulkActionButtonSchema<SecurityBlock> = {
    title: LIFT_SELECTED_TITLE,
    buttonStyleType: ButtonStyleType.NORMAL,
    icon: IconProp.LockOpen,
    disabled: !updateGate.isAllowed && Boolean(updateGate.disabledReason),
    tooltip: updateGate.isAllowed ? undefined : updateGate.disabledReason,
    onClick: async (
      actionProps: BulkActionOnClickProps<SecurityBlock>,
    ): Promise<void> => {
      setDialog({ kind: "bulkLift", actionProps });
    },
  };

  let modal: ReactElement = <></>;

  if (dialog?.kind === "lift" || dialog?.kind === "bulkLift") {
    const isBulk: boolean = dialog.kind === "bulkLift";

    modal = (
      <BasicFormModal<JSONObject>
        title={isBulk ? LIFT_SELECTED_TITLE : LIFT_TITLE}
        description={
          dialog.kind === "lift"
            ? translator.translateTemplate(LIFT_DESCRIPTION, {
                value: dialog.block.value || "",
              })
            : LIFT_SELECTED_DESCRIPTION
        }
        name="Security Events > Blocklist > Lift"
        submitButtonText={isBulk ? LIFT_SELECTED_TITLE : LIFT_TITLE}
        isSubmitting={isSubmitting}
        error={error}
        onClose={() => {
          if (dialog.kind === "bulkLift") {
            dialog.actionProps.onBulkActionEnd();
          }

          close();
        }}
        onSubmit={async (values: JSONObject) => {
          const reason: string = String(values[REASON_FIELD] || "").trim();
          const liftData: JSONObject = {
            state: SecurityBlockState.Lifted,
            ...(reason ? { liftReason: reason } : {}),
          };

          if (dialog.kind === "bulkLift") {
            const actionProps: BulkActionOnClickProps<SecurityBlock> =
              dialog.actionProps;

            close();

            await runBulkAction<SecurityBlock>({
              actionProps,
              concurrency: BULK_ACTION_CONCURRENCY,
              step: async (
                block: SecurityBlock,
              ): Promise<BulkItemOutcome | void> => {
                // An ended block has nothing to lift: left as it is, saying why.
                if (!isActive(block)) {
                  return bulkItemUnchanged(
                    translator.translateText(ENDED_BLOCK_REASON),
                  );
                }

                await update(block, liftData);
              },
            });

            data.onChanged();
            return;
          }

          await runDialog(async () => {
            await update(dialog.block, liftData);
            Toast.success(
              translator.translateTemplate(LIFTED_TOAST, {
                value: dialog.block.value || "",
              }),
            );
          }, dialog.context);
        }}
        formProps={{
          name: "Lift Block",
          initialValues: {},
          fields: [
            {
              field: { [REASON_FIELD]: true },
              title: REASON_FIELD_TITLE,
              description: LIFT_REASON_FIELD_DESCRIPTION,
              fieldType: FormFieldSchemaType.LongText,
              required: false,
            },
          ],
        }}
      />
    );
  }

  if (dialog?.kind === "extend") {
    modal = (
      <BasicFormModal<JSONObject>
        title={EXTEND_TITLE}
        description={translator.translateTemplate(EXTEND_DESCRIPTION, {
          value: dialog.block.value || "",
        })}
        name="Security Events > Blocklist > Extend"
        submitButtonText={EXTEND_TITLE}
        isSubmitting={isSubmitting}
        error={error}
        onClose={close}
        onSubmit={async (values: JSONObject) => {
          const duration: SecurityBlockDuration =
            (values[DURATION_FIELD] as SecurityBlockDuration) ||
            SECURITY_BLOCK_DEFAULT_DURATION;

          await runDialog(async () => {
            await update(dialog.block, {
              expiresAt: getSecurityBlockExpiry(
                duration,
                OneUptimeDate.getCurrentDate(),
              ) as unknown as JSONObject,
            });
            Toast.success(
              translator.translateTemplate(EXTENDED_TOAST, {
                value: dialog.block.value || "",
              }),
            );
          }, dialog.context);
        }}
        formProps={{
          name: "Extend Block",
          initialValues: { [DURATION_FIELD]: SECURITY_BLOCK_DEFAULT_DURATION },
          fields: [
            {
              field: { [DURATION_FIELD]: true },
              title: EXTEND_FIELD_TITLE,
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownOptions: getBlockDurationOptions(translator),
              required: true,
            },
          ],
        }}
      />
    );
  }

  return { actionButtons, bulkLift, modal };
}
