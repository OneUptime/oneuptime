import { loadFormCustomFields } from "../FormBuilderData";
import FormsCopy from "../FormsCopy";
import {
  FormMappingLine,
  FormMappingLineKind,
  FormMappingRow,
  getFormMappingRows,
} from "./FormMappingRows";
import {
  FormReferenceData,
  loadFormReferenceData,
  NamedRecord,
} from "./FormOnSubmitData";
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
import DirectionArrow from "Common/UI/Components/DirectionArrow/DirectionArrow";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import IsolatedTextList from "Common/UI/Components/IsolatedText/IsolatedTextList";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement, useState } from "react";
import useAsyncEffect from "use-async-effect";
import { useCardRuledBodyClassName } from "Common/UI/Components/Card/CardSurface";

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

/*
 * Where a value comes from when a question's answer gives it: "Answer to
 * the question: “What happened?”". One sentence, so each language puts the
 * question in the quotes it writes - „…“ in German, 「…」 in Japanese, «…»
 * in Persian - where English curly quotes were drawn on every page. The
 * question reads the way it is written (IsolatedText): one typed in
 * Persian keeps its full stop at its own end on a German page, as one
 * typed in English keeps its "?" on a Persian page.
 */
export const ANSWER_TO_THE_QUESTION: string = translationKey(
  "Answer to the question: “{{question}}”",
);

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
  const ruledBodyClassName: string = useCardRuledBodyClassName();
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

    /*
     * What applies - a default title, a severity, the labels always added,
     * the owners - read the way it is written: each name an isolate of its
     * own, and a line of records separated the reader's way ("، " in Arabic
     * and Persian, "、" in Japanese and Chinese). Drawn as part of an Arabic
     * or Persian line, "Checkout down." read ".Checkout down", and one
     * name's full stop landed beside the next name. A record deleted since
     * is the reader's word for it, in its place: the page's own words, never
     * a name (#7857). A record called "Deleted" is still drawn as written.
     */
    const renderValue: (className?: string) => ReactElement = (
      className?: string,
    ): ReactElement => {
      return line.names && line.names.length > 0 ? (
        <IsolatedTextList
          texts={line.names.map(
            (record: NamedRecord): string | ReactElement => {
              return record.isDeleted ? (
                <span>{tx(FormsCopy.deletedRecord)}</span>
              ) : (
                record.name
              );
            },
          )}
          className={className}
        />
      ) : (
        <IsolatedText text={text} className={className} />
      );
    };

    // "Answer to the question: “Title”", the question in the reader's quotes.
    const answerToTheQuestion: ReactElement = (
      <TranslatedSentence
        template={ANSWER_TO_THE_QUESTION}
        slots={{
          question: <IsolatedText text={text} className="font-medium" />,
        }}
      />
    );

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
            <span>{answerToTheQuestion}</span>
          </div>
        );

      case FormMappingLineKind.Fallback:
        return (
          <p
            key={index}
            className="pl-5 text-xs text-gray-500"
            data-testid="form-mapping-fallback"
          >
            {tx(FormsCopy.ifLeftEmpty)}{" "}
            {renderValue("font-medium text-gray-700")}
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
              {tx(FormsCopy.alwaysAdded)} {renderValue("font-medium")}
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
            {/*
             * The field, then where its value comes from: the arrow points
             * back at the field, the way the page reads.
             */}
            <bdi className="font-medium">{line.customFieldName}</bdi>{" "}
            <DirectionArrow
              pointsBack={true}
              isDecorative={true}
              className="text-gray-400"
            />{" "}
            {answerToTheQuestion}
          </p>
        );

      default:
        // One of the card's own sentences ("Not set"), or a value as written.
        return (
          <p
            key={index}
            className="text-sm text-gray-700"
            data-testid="form-mapping-value"
          >
            {line.isCopy ? text : renderValue()}
          </p>
        );
    }
  };

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (loadError || !reference) {
      return <ErrorMessage message={loadError || FormsCopy.formNotFound} />;
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
      <div className={ruledBodyClassName}>
        <dl
          className="divide-y divide-gray-100"
          data-testid="form-mapping-rows"
        >
          <div className="max-md:hidden grid-cols-3 gap-4 bg-gray-50 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 md:grid md:px-6">
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
            /*
             * Every step is filled in already: the step list opens any of
             * them, so Save Changes, on the last step, is one click away.
             */
            allowAnyStepNavigation: true,
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
