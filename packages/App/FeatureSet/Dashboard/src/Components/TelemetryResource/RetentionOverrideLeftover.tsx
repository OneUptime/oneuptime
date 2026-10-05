import { TELEMETRY_RETENTION_REQUIRED_PLAN } from "../../Enterprise/EnterpriseEligibility";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Select from "Common/Types/BaseDatabase/Select";
import { isPlanGatedColumnOff } from "Common/Types/Billing/PlanGatedColumnDefault";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { getPlanNeededToChangeColumn } from "Common/UI/Components/ModelSwitch/ModelSwitchUtil";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import RetentionOverrideLeftoverCopy, {
  RETENTION_OVERRIDE_COLUMNS,
  RETENTION_OVERRIDE_LEFTOVER_COPY,
  RETENTION_OVERRIDE_LEFTOVER_REMOVED_TEST_ID,
  RETENTION_OVERRIDE_LEFTOVER_TEST_ID,
  RetentionOverrideLeftoverCopyForKind,
  RetentionOverrideLeftoverKind,
} from "./RetentionOverrideLeftoverCopy";

/*
 * Under the retention upsell, for a project below the plan that sells
 * retention overrides: the override a trial left on this record, and one
 * button that removes it (see RetentionOverrideLeftoverCopy for why).
 *
 * - Reads the record once, for its override columns only. Nothing set - as
 *   on nearly every record - or a read that fails draws nothing: the upsell
 *   is the page.
 * - Remove Override asks first, saying that only new telemetry is affected,
 *   then puts every override column back to its default (nothing set),
 *   which the server allows on any plan. A refusal keeps the dialog open
 *   with why; once removed, the card says so in place of the button.
 * - Someone who may not change the columns sees the button locked, with why.
 */

export interface ComponentProps<TModel extends BaseModel> {
  modelType: { new (): TModel };
  modelId: ObjectID;
  kind: RetentionOverrideLeftoverKind;
}

enum LeftoverState {
  // Not read yet, or nothing to remove: nothing is drawn.
  None = "None",
  Set = "Set",
  Removed = "Removed",
}

const RetentionOverrideLeftover: <TModel extends BaseModel>(
  props: ComponentProps<TModel>,
) => ReactElement = <TModel extends BaseModel>(
  props: ComponentProps<TModel>,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [state, setState] = useState<LeftoverState>(LeftoverState.None);
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  // Set at once: a second press before the dialog locks must not save twice.
  const isSavingRef: MutableRefObject<boolean> = useRef<boolean>(false);

  const modelIdString: string = props.modelId.toString();
  const columns: ReadonlyArray<string> = RETENTION_OVERRIDE_COLUMNS[props.kind];
  const copy: RetentionOverrideLeftoverCopyForKind =
    RETENTION_OVERRIDE_LEFTOVER_COPY[props.kind];
  const model: TModel = new props.modelType();

  useEffect(() => {
    let isCurrent: boolean = true;

    setState(LeftoverState.None);
    setIsConfirming(false);
    setError("");

    const select: Record<string, boolean> = {};

    for (const column of columns) {
      select[column] = true;
    }

    ModelAPI.getItem<TModel>({
      modelType: props.modelType,
      id: props.modelId,
      select: select as Select<TModel>,
    })
      .then((item: TModel | null): void => {
        if (!isCurrent || !item) {
          return;
        }

        const isSet: boolean = columns.some((column: string): boolean => {
          return !isPlanGatedColumnOff(
            item.getTableColumnMetadata(column),
            (item as unknown as Record<string, unknown>)[column],
          );
        });

        if (isSet) {
          setState(LeftoverState.Set);
        }
      })
      .catch((): void => {
        // Nothing is drawn: the upsell is the page.
      });

    return () => {
      isCurrent = false;
    };
  }, [modelIdString, props.kind]);

  if (state === LeftoverState.None) {
    return <></>;
  }

  // Locked for someone who may not change every override column.
  let gate: PermissionGateResult = { isAllowed: true };

  for (const column of columns) {
    gate = PermissionGate.checkColumnUpdate(model, column);

    if (!gate.isAllowed) {
      break;
    }
  }

  const planNeeded: PlanType =
    getPlanNeededToChangeColumn(model, columns[0] as string) ||
    TELEMETRY_RETENTION_REQUIRED_PLAN;

  const remove: () => Promise<void> = async (): Promise<void> => {
    if (isSavingRef.current) {
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    setError("");

    const data: JSONObject = {};

    for (const column of columns) {
      data[column] = null;
    }

    try {
      await ModelAPI.updateById<TModel>({
        modelType: props.modelType,
        id: props.modelId,
        data: data,
      });

      setIsConfirming(false);
      setState(LeftoverState.Removed);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    isSavingRef.current = false;
    setIsSaving(false);
  };

  return (
    <>
      <Card
        title={copy.title}
        description={
          state === LeftoverState.Set
            ? translator.translateTemplate(copy.description, {
                planName: planNeeded,
              })
            : undefined
        }
        buttons={
          state === LeftoverState.Set
            ? [
                {
                  title: RetentionOverrideLeftoverCopy.removeButton,
                  buttonStyle: ButtonStyleType.NORMAL,
                  icon: IconProp.Close,
                  disabled: !gate.isAllowed,
                  tooltip: gate.disabledReason,
                  onClick: () => {
                    if (!gate.isAllowed) {
                      return;
                    }

                    setError("");
                    setIsConfirming(true);
                  },
                },
              ]
            : []
        }
      >
        <div data-testid={RETENTION_OVERRIDE_LEFTOVER_TEST_ID}>
          {state === LeftoverState.Removed ? (
            <p
              className="text-sm text-gray-600"
              role="status"
              data-testid={RETENTION_OVERRIDE_LEFTOVER_REMOVED_TEST_ID}
            >
              {translator.translateText(copy.removed)}
            </p>
          ) : (
            <></>
          )}
        </div>
      </Card>
      {isConfirming ? (
        <ConfirmModal
          title={RetentionOverrideLeftoverCopy.confirmTitle}
          description={copy.confirmDescription}
          submitButtonText={RetentionOverrideLeftoverCopy.removeButton}
          submitButtonType={ButtonStyleType.PRIMARY}
          isLoading={isSaving}
          error={error || undefined}
          onClose={() => {
            if (isSavingRef.current) {
              return;
            }

            setIsConfirming(false);
            setError("");
          }}
          onSubmit={() => {
            void remove();
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default RetentionOverrideLeftover;
