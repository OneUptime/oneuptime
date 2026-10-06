import PlanLeftoverCopy, {
  getPlanLeftoverTableTestId,
} from "./PlanLeftoverCopy";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Query from "Common/Types/BaseDatabase/Query";
import { getPlanGatedTableSwitchColumn } from "Common/Types/Billing/PlanGatedTable";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Columns from "Common/UI/Components/ModelTable/Columns";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import SelectEntityField from "Common/UI/Types/SelectEntityField";
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
 * What a project below a feature's plan still has of it - its SSO
 * providers, SCIM connections, Slack and Microsoft Teams rules, API keys,
 * on-call schedules - with the moves the server allows on every plan
 * (Common/Types/Billing/PlanGatedTable): Delete, and Turn off for records
 * that have a switch (isEnabled). Nothing to add, edit or switch on: those
 * need the plan, which the description says.
 *
 * - Counts the records once, when it opens. None - as for nearly every
 *   project - or a count that fails draws nothing: the page above it (the
 *   upsell, or the plan note) is the page.
 * - Otherwise the records, in a table whose rows have Delete (the table's
 *   own, with its confirmation) and, while a record is on, Turn off.
 * - Turn off asks first, then writes the switch alone, false - the one
 *   update the server allows below the plan. A refusal keeps the dialog
 *   open with why.
 * - Someone who may not change the switch sees Turn off locked, with why;
 *   Delete follows the table's own delete permission.
 *
 * Drawn only for a project known to be below the plan: the page decides
 * (PlanGatedPage's belowPlan, PlanLeftoverPage), so a project on the plan
 * never reads anything for it.
 */

export interface ComponentProps<TBaseModel extends BaseModel> {
  modelType: { new (): TBaseModel };
  // The records of the page: the project's, narrowed as the page narrows them.
  query: Query<TBaseModel>;
  // The plan adding, changing and switching these on needs.
  requiredPlan: PlanType;
  // The table's title (PlanLeftoverTitle), an English key the table translates.
  title: string;
  // The columns that say which record is which; the switch is added after them.
  columns: Columns<TBaseModel>;
  // Unique on the page: the table's id, preferences key and test id.
  id: string;
}

const PlanLeftoverTable: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [hasRecords, setHasRecords] = useState<boolean>(false);
  const [refreshToggle, setRefreshToggle] = useState<string>("");
  const [turnOffTarget, setTurnOffTarget] = useState<TBaseModel | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  // Set at once: a second press before the dialog locks must not save twice.
  const isSavingRef: MutableRefObject<boolean> = useRef<boolean>(false);

  const model: TBaseModel = new props.modelType();
  const switchColumn: string | null = getPlanGatedTableSwitchColumn(model);
  const queryKey: string = JSON.stringify(props.query);

  useEffect(() => {
    let isCurrent: boolean = true;

    setHasRecords(false);

    ModelAPI.count<TBaseModel>({
      modelType: props.modelType,
      query: props.query,
    })
      .then((count: number): void => {
        if (isCurrent && count > 0) {
          setHasRecords(true);
        }
      })
      .catch((): void => {
        // Nothing is drawn: the page above is the page.
      });

    return () => {
      isCurrent = false;
    };
  }, [props.id, queryKey]);

  if (!hasRecords) {
    return <></>;
  }

  // Turn off is locked for someone who may not change the switch.
  const turnOffGate: PermissionGateResult = switchColumn
    ? PermissionGate.checkColumnUpdate(model, switchColumn)
    : { isAllowed: false };

  const turnOff: () => Promise<void> = async (): Promise<void> => {
    const targetId: string | undefined = turnOffTarget?._id?.toString();

    if (isSavingRef.current || !targetId || !switchColumn) {
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    setError("");

    try {
      await ModelAPI.updateById<TBaseModel>({
        modelType: props.modelType,
        id: new ObjectID(targetId),
        data: {
          [switchColumn]: false,
        },
      });

      setTurnOffTarget(null);
      setRefreshToggle(Date.now().toString());
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    isSavingRef.current = false;
    setIsSaving(false);
  };

  const columns: Columns<TBaseModel> = switchColumn
    ? [
        ...props.columns,
        {
          field: {
            [switchColumn]: true,
          } as SelectEntityField<TBaseModel>,
          title: PlanLeftoverCopy.enabledColumn,
          type: FieldType.Boolean,
        },
      ]
    : props.columns;

  return (
    <div data-testid={getPlanLeftoverTableTestId(props.id)}>
      <ModelTable<TBaseModel>
        modelType={props.modelType}
        id={getPlanLeftoverTableTestId(props.id)}
        name={`Plan leftovers > ${props.id}`}
        userPreferencesKey={getPlanLeftoverTableTestId(props.id)}
        disableUrlState={true}
        disableColumnCustomization={true}
        query={props.query}
        isCreateable={false}
        isEditable={false}
        isDeleteable={true}
        isViewable={false}
        showViewIdButton={false}
        showRefreshButton={false}
        refreshToggle={refreshToggle}
        filters={[]}
        cardProps={{
          title: props.title,
          description: translator.translateTemplate(
            switchColumn
              ? PlanLeftoverCopy.descriptionWithSwitch
              : PlanLeftoverCopy.descriptionWithoutSwitch,
            { planName: props.requiredPlan },
          ),
        }}
        noItemsMessage={PlanLeftoverCopy.noItems}
        columns={columns}
        actionButtons={
          switchColumn
            ? [
                {
                  title: PlanLeftoverCopy.turnOffButton,
                  icon: IconProp.Close,
                  buttonStyleType: ButtonStyleType.NORMAL,
                  disabled: !turnOffGate.isAllowed,
                  tooltip: turnOffGate.disabledReason,
                  isVisible: (item: TBaseModel): boolean => {
                    return (
                      (item as unknown as Record<string, unknown>)[
                        switchColumn
                      ] === true
                    );
                  },
                  onClick: (
                    item: TBaseModel,
                    onCompleteAction: () => void,
                  ): void => {
                    if (turnOffGate.isAllowed) {
                      setError("");
                      setTurnOffTarget(item);
                    }

                    onCompleteAction();
                  },
                },
              ]
            : []
        }
      />
      {turnOffTarget ? (
        <ConfirmModal
          title={PlanLeftoverCopy.confirmTurnOffTitle}
          description={translator.translateTemplate(
            PlanLeftoverCopy.confirmTurnOffDescription,
            { planName: props.requiredPlan },
          )}
          submitButtonText={PlanLeftoverCopy.turnOffButton}
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isSaving}
          error={error || undefined}
          onClose={() => {
            if (isSavingRef.current) {
              return;
            }

            setTurnOffTarget(null);
            setError("");
          }}
          onSubmit={() => {
            void turnOff();
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default PlanLeftoverTable;
