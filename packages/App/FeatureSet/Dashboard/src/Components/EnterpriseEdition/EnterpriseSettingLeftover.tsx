import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Select from "Common/Types/BaseDatabase/Select";
import { isPlanGatedColumnOff } from "Common/Types/Billing/PlanGatedColumnDefault";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import TableColumnType from "Common/Types/Database/TableColumnType";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
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

/*
 * Under an Enterprise setting's upsell: what the record still has of the
 * setting, and one button that removes it.
 *
 * Drawn on the Community Edition (EnterprisePluginPage's communityLeftover)
 * and for a OneUptime Cloud project below the plan (belowPlan), for settings
 * that keep applying there - an IP allowlist, a reader session limit, the
 * subscriber restrictions, a hidden Powered by OneUptime on the Cloud. The
 * server lets every edition and plan put them back to their default, and
 * nothing else (EditionPermissions.checkEnterpriseColumnPermissions,
 * ColumnPermissions and Types/Billing/PlanGatedColumnDefault).
 *
 * - Reads the record once, for the setting's columns only. Nothing set - as
 *   on nearly every record - or a read that fails draws nothing: the upsell
 *   is the page.
 * - Otherwise a card that says the setting still applies, shows it, and has
 *   Remove: it asks first, then writes every column's default in one update.
 *   A refusal keeps the dialog open with why; once removed, the card says so
 *   in place of the setting.
 * - Someone who may not change every column sees Remove locked, with why.
 *
 * The words are the caller's, in English: each setting says in its own
 * words what removing it changes.
 */

export interface EnterpriseSettingLeftoverCopy {
  title: string;
  description: string;
  removeButton: string;
  confirmTitle: string;
  confirmDescription: string;
  removed: string;
}

export interface ComponentProps<TModel extends BaseModel> {
  modelType: { new (): TModel };
  modelId: ObjectID;
  // The columns that hold the setting. Remove puts every one back to its default.
  columns: ReadonlyArray<string>;
  copy: EnterpriseSettingLeftoverCopy;
  // What the record holds, drawn in the card while it is set.
  renderValue: (item: TModel) => ReactElement;
  dataTestId: string;
  // Told what was read (null when the read failed) and when it was removed.
  onLoaded?: ((item: TModel | null) => void) | undefined;
  onRemoved?: (() => void) | undefined;
}

enum LeftoverState {
  // Not read yet, or nothing to remove: nothing is drawn.
  None = "None",
  Set = "Set",
  Removed = "Removed",
}

/*
 * The value that puts a column back to its default: the default the column
 * declares, false for a switch that declares none, and nothing (null) for
 * the rest - what PlanGatedColumnDefault takes for the setting off.
 */
export const getEnterpriseSettingDefault: (
  metadata: TableColumnMetadata | null | undefined,
) => unknown = (metadata: TableColumnMetadata | null | undefined): unknown => {
  if (
    metadata &&
    metadata.defaultValue !== undefined &&
    metadata.defaultValue !== null
  ) {
    return metadata.defaultValue;
  }

  if (metadata && metadata.type === TableColumnType.Boolean) {
    return false;
  }

  return null;
};

// Whether the record holds the setting: any of its columns is not off.
export const isEnterpriseSettingSet: (
  item: BaseModel,
  columns: ReadonlyArray<string>,
) => boolean = (item: BaseModel, columns: ReadonlyArray<string>): boolean => {
  return columns.some((column: string): boolean => {
    return !isPlanGatedColumnOff(
      item.getTableColumnMetadata(column),
      (item as unknown as Record<string, unknown>)[column],
    );
  });
};

const EnterpriseSettingLeftover: <TModel extends BaseModel>(
  props: ComponentProps<TModel>,
) => ReactElement = <TModel extends BaseModel>(
  props: ComponentProps<TModel>,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [state, setState] = useState<LeftoverState>(LeftoverState.None);
  const [item, setItem] = useState<TModel | null>(null);
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  // Set at once: a second press before the dialog locks must not save twice.
  const isSavingRef: MutableRefObject<boolean> = useRef<boolean>(false);

  const modelIdString: string = props.modelId.toString();
  const model: TModel = new props.modelType();

  useEffect(() => {
    let isCurrent: boolean = true;

    setState(LeftoverState.None);
    setItem(null);
    setIsConfirming(false);
    setError("");

    const select: Record<string, boolean> = {};

    for (const column of props.columns) {
      select[column] = true;
    }

    ModelAPI.getItem<TModel>({
      modelType: props.modelType,
      id: props.modelId,
      select: select as Select<TModel>,
    })
      .then((loaded: TModel | null): void => {
        if (!isCurrent) {
          return;
        }

        props.onLoaded?.(loaded);

        if (loaded && isEnterpriseSettingSet(loaded, props.columns)) {
          setItem(loaded);
          setState(LeftoverState.Set);
        }
      })
      .catch((): void => {
        // Nothing is drawn: the upsell is the page.
        if (isCurrent) {
          props.onLoaded?.(null);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [modelIdString, props.columns.join(",")]);

  if (state === LeftoverState.None) {
    return <></>;
  }

  // Locked for someone who may not change every column of the setting.
  let gate: PermissionGateResult = { isAllowed: true };

  for (const column of props.columns) {
    gate = PermissionGate.checkColumnUpdate(model, column);

    if (!gate.isAllowed) {
      break;
    }
  }

  const remove: () => Promise<void> = async (): Promise<void> => {
    if (isSavingRef.current) {
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    setError("");

    const data: JSONObject = {};

    for (const column of props.columns) {
      data[column] = getEnterpriseSettingDefault(
        model.getTableColumnMetadata(column),
      ) as JSONObject[string];
    }

    try {
      await ModelAPI.updateById<TModel>({
        modelType: props.modelType,
        id: props.modelId,
        data: data,
      });

      setIsConfirming(false);
      setState(LeftoverState.Removed);
      props.onRemoved?.();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    isSavingRef.current = false;
    setIsSaving(false);
  };

  return (
    <>
      <Card
        title={props.copy.title}
        description={
          state === LeftoverState.Set ? props.copy.description : undefined
        }
        buttons={
          state === LeftoverState.Set
            ? [
                {
                  title: props.copy.removeButton,
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
        <div data-testid={props.dataTestId}>
          {state === LeftoverState.Set && item ? (
            props.renderValue(item)
          ) : (
            <></>
          )}
          {state === LeftoverState.Removed ? (
            <p
              className="text-sm text-gray-600"
              role="status"
              data-testid={`${props.dataTestId}-removed`}
            >
              {translator.translateText(props.copy.removed)}
            </p>
          ) : (
            <></>
          )}
        </div>
      </Card>
      {isConfirming ? (
        <ConfirmModal
          title={props.copy.confirmTitle}
          description={props.copy.confirmDescription}
          submitButtonText={props.copy.removeButton}
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

export default EnterpriseSettingLeftover;
