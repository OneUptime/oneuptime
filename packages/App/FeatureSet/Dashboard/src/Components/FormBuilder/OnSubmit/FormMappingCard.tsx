import { loadFormCustomFields } from "../FormBuilderData";
import FormsCopy from "../FormsCopy";
import {
  FormMappingLine,
  FormMappingLineKind,
  FormMappingRow,
  getFormMappingRows,
} from "./FormMappingRows";
import { FormReferenceData, loadFormReferenceData } from "./FormOnSubmitData";
import {
  getFormSettingsFields,
  getFormSettingsInitialValues,
  getFormSettingsSteps,
  packFormSettingsValues,
} from "./FormSettingsEditor";
import Form from "Common/Models/DatabaseModels/Form";
import { readFormFields } from "Common/Types/Form/FormField";
import { FormCustomFieldDefinition } from "Common/Types/Form/FormPublic";
import {
  IncidentFormTargetSettings,
  readFormTargetSettings,
  ScheduledMaintenanceFormTargetSettings,
} from "Common/Types/Form/FormTargetSettings";
import FormTargetType from "Common/Types/Form/FormTargetType";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import Icon from "Common/UI/Components/Icon/Icon";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement, useState } from "react";
import useAsyncEffect from "use-async-effect";

/*
 * "How a Submission Becomes an Incident" (or a maintenance event): every
 * field of what a submission creates, and where its value comes from - the
 * answer to one of the form's questions, a setting of this form, the
 * incident template, or nothing at all. A form whose incidents would have
 * no severity says so here, in amber, before anybody submits it.
 *
 * Edit Settings opens the settings - the defaults, what is always attached,
 * the owners and, for maintenance events, publishing - and saves them in one
 * request; the server checks every record they name is the project's own.
 */

export interface ComponentProps {
  formId: ObjectID;
  targetType: FormTargetType;
  fields: unknown;
  targetSettings: unknown;
  onSaved: () => void;
}

const FormMappingCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const tx: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

  const [reference, setReference] = useState<FormReferenceData | null>(null);
  const [customFields, setCustomFields] = useState<
    Array<FormCustomFieldDefinition>
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");
  /*
   * What was last sent to be saved. The dialog's form is unmounted while it
   * saves, so after a failed save it opens again on these values - with the
   * error - instead of the stored ones, and nothing typed is lost.
   */
  const [unsavedValues, setUnsavedValues] = useState<JSONObject | null>(null);

  useAsyncEffect(async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const [loadedReference, loadedCustomFields]: [
        FormReferenceData,
        Array<FormCustomFieldDefinition>,
      ] = await Promise.all([
        loadFormReferenceData(props.targetType),
        loadFormCustomFields(props.targetType),
      ]);

      setReference(loadedReference);
      setCustomFields(loadedCustomFields);
    } catch (err) {
      setLoadError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  }, [props.formId.toString(), props.targetType]);

  const updateGate: PermissionGateResult = PermissionGate.check(
    new Form(),
    ModelAction.Update,
  );

  const isIncident: boolean = props.targetType === FormTargetType.Incident;

  const title: string = isIncident
    ? FormsCopy.mappingIncidentTitle
    : FormsCopy.mappingScheduledMaintenanceTitle;

  const description: string = isIncident
    ? FormsCopy.mappingIncidentDescription
    : FormsCopy.mappingScheduledMaintenanceDescription;

  const buttons: Array<CardButtonSchema> =
    reference && (updateGate.isAllowed || updateGate.disabledReason)
      ? [
          {
            title: FormsCopy.editOnSubmitSettings,
            icon: IconProp.Edit,
            buttonStyle: ButtonStyleType.NORMAL,
            disabled: !updateGate.isAllowed,
            tooltip: updateGate.disabledReason,
            onClick: () => {
              if (updateGate.isAllowed) {
                setSaveError("");
                setUnsavedValues(null);
                setIsEditing(true);
              }
            },
          },
        ]
      : [];

  const save: (values: JSONObject) => Promise<void> = async (
    values: JSONObject,
  ): Promise<void> => {
    setIsSaving(true);
    setSaveError("");
    setUnsavedValues(values);

    try {
      await ModelAPI.updateById<Form>({
        modelType: Form,
        id: props.formId,
        data: {
          targetSettings: packFormSettingsValues({
            targetType: props.targetType,
            values: values,
          }),
        },
      });

      setIsEditing(false);
      setUnsavedValues(null);
      props.onSaved();
    } catch (err) {
      setSaveError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  const renderLine: (line: FormMappingLine, index: number) => ReactElement = (
    line: FormMappingLine,
    index: number,
  ): ReactElement => {
    const text: string = line.isCopy ? tx(line.text) : line.text;

    switch (line.kind) {
      case FormMappingLineKind.Answer:
        return (
          <div
            key={index}
            className="flex items-start gap-1.5 text-sm text-gray-900"
            data-testid="form-mapping-answer"
          >
            <Icon
              icon={IconProp.ChatBubbleLeft}
              className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500"
            />
            <span>
              {tx(FormsCopy.fromAnswer)}{" "}
              <span className="font-medium">&ldquo;{text}&rdquo;</span>
            </span>
          </div>
        );

      case FormMappingLineKind.Fallback:
        return (
          <p key={index} className="pl-5 text-xs text-gray-500">
            {tx(FormsCopy.ifLeftEmpty)}{" "}
            <span className="font-medium text-gray-700">{text}</span>
          </p>
        );

      case FormMappingLineKind.Always:
        return (
          <div
            key={index}
            className="flex items-start gap-1.5 text-sm text-gray-900"
            data-testid="form-mapping-always"
          >
            <Icon
              icon={IconProp.Add}
              className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
            />
            <span>
              {tx(FormsCopy.alwaysAdded)}{" "}
              <span className="font-medium">{text}</span>
            </span>
          </div>
        );

      case FormMappingLineKind.Warning:
        return (
          <div
            key={index}
            className="flex items-start gap-1.5 text-sm font-medium text-amber-700"
            data-testid="form-mapping-warning"
          >
            <Icon icon={IconProp.Alert} className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{text}</span>
          </div>
        );

      case FormMappingLineKind.CustomField:
        return (
          <p key={index} className="text-sm text-gray-900">
            <span className="font-medium">{line.customFieldName}</span>{" "}
            <span className="text-gray-400" aria-hidden="true">
              &larr;
            </span>{" "}
            {tx(FormsCopy.fromAnswer)}{" "}
            <span className="font-medium">&ldquo;{text}&rdquo;</span>
          </p>
        );

      default:
        return (
          <p key={index} className="text-sm text-gray-700">
            {text}
          </p>
        );
    }
  };

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (loadError || !reference) {
      return <ErrorMessage message={loadError || FormsCopy.shareLinkNotFound} />;
    }

    const settings:
      | IncidentFormTargetSettings
      | ScheduledMaintenanceFormTargetSettings = readFormTargetSettings({
      targetType: props.targetType,
      value: props.targetSettings,
    });

    const rows: Array<FormMappingRow> = getFormMappingRows({
      targetType: props.targetType,
      fields: readFormFields(props.fields),
      settings: settings,
      reference: reference,
      customFields: customFields,
    });

    return (
      <div className="-mx-5 -mb-6 border-t border-gray-200 md:-mx-6">
        <dl
          className="divide-y divide-gray-100"
          data-testid="form-mapping-rows"
        >
          <div className="hidden grid-cols-3 gap-4 bg-gray-50 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 md:grid md:px-6">
            <span>{tx(FormsCopy.mappingFieldColumn)}</span>
            <span className="col-span-2">
              {tx(FormsCopy.mappingSourceColumn)}
            </span>
          </div>
          {rows.map((row: FormMappingRow): ReactElement => {
            return (
              <div
                key={row.key}
                className="grid grid-cols-1 gap-1 px-5 py-3 md:grid-cols-3 md:gap-4 md:px-6"
                data-testid={`form-mapping-row-${row.key}`}
              >
                <dt className="text-sm font-medium text-gray-900">
                  {tx(row.title)}
                </dt>
                <dd className="space-y-1 md:col-span-2">
                  {row.lines.map(renderLine)}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    );
  };

  return (
    <Card title={title} description={description} buttons={buttons}>
      {getBody()}
      {isEditing && reference ? (
        <BasicFormModal<JSONObject>
          title={FormsCopy.editOnSubmitSettings}
          description={description}
          modalWidth={ModalWidth.Large}
          isLoading={isSaving}
          submitButtonText={FormsCopy.saveChanges}
          saveFromAnyStep={true}
          onClose={() => {
            setIsEditing(false);
            setUnsavedValues(null);
          }}
          onSubmit={(values: JSONObject) => {
            void save(values);
          }}
          formProps={{
            id: "form-on-submit-settings",
            name: "Form On Submit Settings",
            steps: getFormSettingsSteps(props.targetType),
            fields: getFormSettingsFields({
              targetType: props.targetType,
              reference: reference,
            }),
            initialValues:
              unsavedValues ||
              getFormSettingsInitialValues({
                targetType: props.targetType,
                settings: props.targetSettings,
                reference: reference,
              }),
            error: saveError || undefined,
          }}
        />
      ) : (
        <></>
      )}
    </Card>
  );
};

export default FormMappingCard;
