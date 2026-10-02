import FormsCopy from "../FormsCopy";
import Form from "Common/Models/DatabaseModels/Form";
import {
  convertFormFieldsForTarget,
  FormField,
  readFormFields,
} from "Common/Types/Form/FormField";
import FormTargetType, {
  FORM_TARGET_TYPE_TEXT,
  FORM_TARGET_TYPES,
} from "Common/Types/Form/FormTargetType";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * What each submission through the form creates: an incident or a scheduled
 * maintenance event, as two cards to choose between.
 *
 * Changing it is one request that writes the new target, the questions kept
 * for it (convertFormFieldsForTarget: nothing the submitter is asked goes
 * away; a question linked to a field the new target lacks becomes one of the
 * form's own) and empty On Submit settings - the old ones named the old
 * target's records. A confirmation says all of that first.
 */

export interface ComponentProps {
  formId: ObjectID;
  targetType: FormTargetType;
  // The stored questions, for the conversion.
  fields: unknown;
  onChanged: () => void;
}

const TARGET_ICONS: Record<FormTargetType, IconProp> = {
  [FormTargetType.Incident]: IconProp.Alert,
  [FormTargetType.ScheduledMaintenance]: IconProp.Clock,
};

const FormTargetCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const tx: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

  const [pendingTarget, setPendingTarget] = useState<FormTargetType | null>(
    null,
  );
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const updateGate: PermissionGateResult = PermissionGate.check(
    new Form(),
    ModelAction.Update,
  );

  const changeTarget: (to: FormTargetType) => Promise<void> = async (
    to: FormTargetType,
  ): Promise<void> => {
    setIsSaving(true);
    setError("");

    try {
      const fields: Array<FormField> = convertFormFieldsForTarget({
        fields: readFormFields(props.fields),
        from: props.targetType,
        to: to,
      });

      await ModelAPI.updateById<Form>({
        modelType: Form,
        id: props.formId,
        data: {
          targetType: to,
          fields: fields as unknown as JSONArray,
          targetSettings: {},
        },
      });

      setPendingTarget(null);
      props.onChanged();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  return (
    <Card
      title={FormsCopy.targetCardTitle}
      description={FormsCopy.targetCardDescription}
    >
      <div
        className="grid grid-cols-1 gap-3 md:grid-cols-2"
        role="radiogroup"
        aria-label={tx(FormsCopy.targetCardTitle)}
        data-testid="form-target-options"
      >
        {FORM_TARGET_TYPES.map((target: FormTargetType): ReactElement => {
          const isSelected: boolean = target === props.targetType;
          const isDisabled: boolean = !updateGate.isAllowed && !isSelected;

          return (
            <button
              key={target}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={isDisabled}
              title={isDisabled ? updateGate.disabledReason : undefined}
              data-testid={`form-target-${target}`}
              className={`flex items-start gap-3 rounded-lg border p-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 ${
                isSelected
                  ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500"
                  : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
              }`}
              onClick={() => {
                if (!isSelected && updateGate.isAllowed) {
                  setError("");
                  setPendingTarget(target);
                }
              }}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                  isSelected
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-100 text-gray-500"
                }`}
              >
                <Icon icon={TARGET_ICONS[target]} className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-gray-900">
                    {tx(FORM_TARGET_TYPE_TEXT[target].title)}
                  </span>
                  {isSelected ? (
                    <Icon
                      icon={IconProp.CheckCircle}
                      className="h-5 w-5 text-indigo-600"
                    />
                  ) : (
                    <></>
                  )}
                </span>
                <span className="mt-1 block text-sm text-gray-600">
                  {tx(FORM_TARGET_TYPE_TEXT[target].description)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {pendingTarget ? (
        <ConfirmModal
          title={FormsCopy.changeTargetTitle}
          description={
            pendingTarget === FormTargetType.Incident
              ? FormsCopy.changeTargetToIncident
              : FormsCopy.changeTargetToScheduledMaintenance
          }
          submitButtonText={FormsCopy.changeTargetConfirm}
          isLoading={isSaving}
          error={error || undefined}
          onClose={() => {
            setPendingTarget(null);
            setError("");
          }}
          onSubmit={() => {
            void changeTarget(pendingTarget);
          }}
        />
      ) : (
        <></>
      )}
    </Card>
  );
};

export default FormTargetCard;
