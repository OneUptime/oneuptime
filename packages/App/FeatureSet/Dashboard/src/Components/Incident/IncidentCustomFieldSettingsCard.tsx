import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import IncidentCustomFieldCreateSettingsCopy from "./IncidentCustomFieldCreateSettingsCopy";
import {
  buildCustomFieldSettingsFormFields,
  getChangedCustomFieldSettingsFormValues,
  getCustomFieldProjectDefaultLabel,
  getCustomFieldQuestionNote,
  getCustomFieldSettingFormKey,
  getCustomFieldSettingLabel,
  getCustomFieldSettingsFormInitialValues,
  getCustomFieldTypeLabel,
  getKeyedCustomFieldDefinitions,
  IncidentCustomFieldSettingsMode,
  isCustomFieldSettingChosen,
  KeyedIncidentCustomFieldDefinition,
  packCustomFieldSettingsFormValues,
} from "./IncidentCustomFieldCreateSettingsForm";
import {
  fetchIncidentCustomFieldDefinitions,
  IncidentCustomFieldDefinition,
} from "./IncidentCustomFieldDefinitions";
import IncidentForm from "Common/Models/DatabaseModels/IncidentForm";
import IncidentTemplate from "Common/Models/DatabaseModels/IncidentTemplate";
import Route from "Common/Types/API/Route";
import {
  CustomFieldCreateSettings,
  readCustomFieldCreateSettings,
} from "Common/Types/CustomField/CustomFieldCreateSettings";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import Field from "Common/UI/Components/Forms/Types/Field";
import Link from "Common/UI/Components/Link/Link";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, {
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";
import useAsyncEffect from "use-async-effect";

/*
 * Which of the project's incident custom fields are asked for when an
 * incident is created, for one record that decides it for itself (issue
 * #4114): the record's customFieldSettings, one setting per field keyed by
 * the field's template variable key (Common/Types/CustomField/
 * CustomFieldCreateSettings). The card lists every field in its order with
 * its type and setting; Edit opens one dropdown per field.
 *
 *   - mode "template", on an incident template's page: the Details step of
 *     declaring an incident from the template. A field left on Default
 *     follows its own Show on Create and Required on Create, and says which;
 *     a field the template overrides says it too ("Project default:
 *     Required"), under its type - otherwise only the editor, which a viewer
 *     cannot open, would tell a template that relaxes a field the project
 *     requires from one that asks a field the project leaves out.
 *     A project with no custom fields (or none on its plan) has nothing to
 *     set, so the card then shows nothing at all - the page is about the
 *     template, not its custom fields.
 *   - mode "form", on an incident form's page: the form's questions. A field
 *     is Not Asked until the form names it, whatever its Show on Create says.
 *     A field copied from a monitor custom field says, on the card and in
 *     the modal, that the form does not ask it while its incident template
 *     attaches monitors. The questions are the point of that card, so it
 *     stays: with a note on where custom fields are made when the project
 *     has none, and with the reason when they cannot be read.
 *
 * The page may have been open a while when Edit is pressed, and somebody
 * else - another admin, another tab, the API, Terraform - may have changed
 * the settings, or the fields, since. So Edit reads the fields and the
 * settings again before the modal shows a dropdown, and Save reads both once
 * more and lays only the dropdowns changed in the modal over what is stored
 * then, for the fields that exist then: a field this edit leaves alone keeps
 * whatever somebody else gave it - on a form, a question another admin took
 * off the public page stays off, and one they added for a field made while
 * the modal was open stays on - and a change to a field deleted meanwhile is
 * not written back.
 *
 * Saving writes the compacted settings (Default and, on a form, Not Asked
 * are left out) with the record's other columns untouched. A template keeps
 * the settings of fields the card does not list - a field deleted since gets
 * its setting back when it is made again. A form does not: a question for a
 * field that is gone would be asked, on its public page, of any new field
 * that gets the same key (packCustomFieldSettingsFormValues).
 */

interface CommonProps {
  modelId: ObjectID;
  // Instead of the mode's own title and description.
  title?: string | undefined;
  description?: string | undefined;
}

interface TemplateModeProps extends CommonProps {
  mode: "template";
  modelType: typeof IncidentTemplate;
}

interface FormModeProps extends CommonProps {
  mode: "form";
  modelType: typeof IncidentForm;
}

export type ComponentProps = TemplateModeProps | FormModeProps;

// What a record the card reads and writes has in common.
type SettingsRecord = IncidentTemplate | IncidentForm;

interface ModeText {
  title: string;
  description: string;
  editButton: string;
  // The record itself is gone.
  notFound: string;
}

const MODE_TEXT: Record<IncidentCustomFieldSettingsMode, ModeText> = {
  template: {
    title: IncidentCustomFieldCreateSettingsCopy.templateTitle,
    description: IncidentCustomFieldCreateSettingsCopy.templateDescription,
    editButton: IncidentCustomFieldCreateSettingsCopy.templateEditButton,
    notFound: IncidentCustomFieldCreateSettingsCopy.templateNotFound,
  },
  form: {
    title: IncidentCustomFieldCreateSettingsCopy.formTitle,
    description: IncidentCustomFieldCreateSettingsCopy.formDescription,
    editButton: IncidentCustomFieldCreateSettingsCopy.formEditButton,
    notFound: IncidentCustomFieldCreateSettingsCopy.formNotFound,
  },
};

/*
 * The modal's button while the settings could not be read: there is nothing
 * to save, so it reads them again. Every Dashboard locale has these words.
 */
const READ_AGAIN_BUTTON_TEXT: string = "Try again";

/*
 * A field the record decides for itself - overridden by the template, asked
 * by the form - is set apart from the fields left as they are.
 */
const CHOSEN_SETTING_CLASS_NAME: string =
  "bg-indigo-50 text-indigo-700 ring-indigo-200";
const UNSET_SETTING_CLASS_NAME: string =
  "bg-gray-50 text-gray-600 ring-gray-200";

const IncidentCustomFieldSettingsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const [definitions, setDefinitions] = useState<
    Array<KeyedIncidentCustomFieldDefinition>
  >([]);
  const [settings, setSettings] = useState<CustomFieldCreateSettings>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");

  const [isEditing, setIsEditing] = useState<boolean>(false);
  /*
   * What the modal's form starts from. Set to the submitted values while a
   * save is in flight: the modal swaps its form for a loader meanwhile, and a
   * failed save must bring the form back with the choices just made, not the
   * stored ones.
   */
  const [editValues, setEditValues] = useState<JSONObject>({});
  /*
   * The dropdowns' values when the modal opened, from the read Edit makes. A
   * save sends only the ones changed since
   * (getChangedCustomFieldSettingsFormValues).
   */
  const [openedValues, setOpenedValues] = useState<JSONObject>({});
  // Edit's read of the record: on its way, or why it failed.
  const [isReadingForEdit, setIsReadingForEdit] = useState<boolean>(false);
  const [editReadError, setEditReadError] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");

  /*
   * Which opening of the modal a read belongs to. A read that answers after
   * the modal was closed - or closed and opened again - is dropped, rather
   * than filling a form nobody is looking at with what it found.
   */
  const editSessionRef: React.MutableRefObject<number> = useRef<number>(0);

  const mode: IncidentCustomFieldSettingsMode = props.mode;
  const text: ModeText = MODE_TEXT[mode];
  const title: string = props.title || text.title;
  const description: string = props.description || text.description;

  type ReadRecordFunction = () => Promise<SettingsRecord | null>;

  // The record's settings as they are stored now; null when it is gone.
  const readRecord: ReadRecordFunction =
    async (): Promise<SettingsRecord | null> => {
      return await ModelAPI.getItem<SettingsRecord>({
        modelType: props.modelType,
        id: props.modelId,
        select: {
          customFieldSettings: true,
        },
      });
    };

  const load: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setLoadError("");

    try {
      const [fieldDefinitions, record]: [
        Array<IncidentCustomFieldDefinition>,
        SettingsRecord | null,
      ] = await Promise.all([
        fetchIncidentCustomFieldDefinitions(),
        readRecord(),
      ]);

      if (record) {
        setDefinitions(getKeyedCustomFieldDefinitions(fieldDefinitions));
        setSettings(readCustomFieldCreateSettings(record.customFieldSettings));
      } else {
        // Nothing to show settings for, and nothing a save could update.
        setLoadError(text.notFound);
      }
    } catch (err) {
      setLoadError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useAsyncEffect(async () => {
    await load();
  }, [props.modelId.toString()]);

  /*
   * Opens the modal on the fields and settings as they are now - read again,
   * not the ones the page loaded with - and shows them on the card too. The
   * modal shows a loader until the read answers, and why when it fails: a
   * modal filled from what the page loaded would save that back over
   * whatever changed since.
   */
  const openEditor: PromiseVoidFunction = async (): Promise<void> => {
    editSessionRef.current += 1;
    const session: number = editSessionRef.current;

    setSaveError("");
    setEditReadError("");
    setIsReadingForEdit(true);
    setIsEditing(true);

    try {
      const [fieldDefinitions, record]: [
        Array<IncidentCustomFieldDefinition>,
        SettingsRecord | null,
      ] = await Promise.all([
        fetchIncidentCustomFieldDefinitions(),
        readRecord(),
      ]);

      if (session !== editSessionRef.current) {
        return;
      }

      if (record) {
        const freshDefinitions: Array<KeyedIncidentCustomFieldDefinition> =
          getKeyedCustomFieldDefinitions(fieldDefinitions);
        const freshSettings: CustomFieldCreateSettings =
          readCustomFieldCreateSettings(record.customFieldSettings);
        const initialValues: JSONObject =
          getCustomFieldSettingsFormInitialValues({
            definitions: freshDefinitions,
            settings: freshSettings,
            mode: mode,
          });

        setDefinitions(freshDefinitions);
        setSettings(freshSettings);
        setOpenedValues(initialValues);
        setEditValues(initialValues);

        // Every field was deleted since the page loaded: nothing to set.
        if (freshDefinitions.length === 0) {
          setIsEditing(false);
        }
      } else {
        setEditReadError(text.notFound);
      }
    } catch (err) {
      if (session !== editSessionRef.current) {
        return;
      }

      setEditReadError(API.getFriendlyMessage(err));
    }

    setIsReadingForEdit(false);
  };

  const closeEditor: () => void = (): void => {
    // A read still on its way is for a modal that is gone.
    editSessionRef.current += 1;
    setIsEditing(false);
    setIsReadingForEdit(false);
    setEditReadError("");
    setSaveError("");
  };

  type SaveFunction = (data: JSONObject) => Promise<void>;

  const save: SaveFunction = async (data: JSONObject): Promise<void> => {
    setEditValues(data);
    setSaveError("");
    setIsSaving(true);

    try {
      /*
       * The fields and the settings as they are now, not as the modal
       * opened: only the dropdowns changed in the modal are laid over the
       * stored settings, so a field somebody else set meanwhile keeps their
       * setting. The fields are read again too, because a form keeps the
       * stored questions of the fields it is packed over and of no other: a
       * field created since Edit, and asked on the form by somebody else,
       * keeps its question, and a change made here to a field deleted since
       * is not written back for a field that no longer exists.
       */
      const [fieldDefinitions, record]: [
        Array<IncidentCustomFieldDefinition>,
        SettingsRecord | null,
      ] = await Promise.all([
        fetchIncidentCustomFieldDefinitions(),
        readRecord(),
      ]);

      if (record) {
        const freshDefinitions: Array<KeyedIncidentCustomFieldDefinition> =
          getKeyedCustomFieldDefinitions(fieldDefinitions);

        const newSettings: CustomFieldCreateSettings =
          packCustomFieldSettingsFormValues({
            // The fields that exist now.
            definitions: freshDefinitions,
            // What changed is judged against the dropdowns the modal showed.
            formValues: getChangedCustomFieldSettingsFormValues({
              definitions: definitions,
              formValues: data,
              initialValues: openedValues,
              mode: mode,
            }),
            startingSettings: record.customFieldSettings,
            mode: mode,
          });

        await ModelAPI.updateById<SettingsRecord>({
          modelType: props.modelType,
          id: props.modelId,
          data: {
            customFieldSettings: newSettings,
          },
        });

        // The server stores the settings exactly as sent.
        setDefinitions(freshDefinitions);
        setSettings(newSettings);
        setIsEditing(false);
      } else {
        setSaveError(text.notFound);
      }
    } catch (err) {
      setSaveError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  const hasFields: boolean = definitions.length > 0;

  /*
   * A template's page shows nothing until it knows there is something to
   * set: no loader flash, no error about custom fields the project may not
   * have on its plan, and no card for a project without any.
   */
  if (mode === "template" && (isLoading || Boolean(loadError) || !hasFields)) {
    return <></>;
  }

  /*
   * The settings live on the record, so changing them is an update of it.
   * Without the permission the button stays and says why; while the
   * permissions are not known yet it is left out.
   */
  const updateGate: PermissionGateResult = PermissionGate.check(
    new props.modelType(),
    ModelAction.Update,
  );

  const canEdit: boolean = !isLoading && !loadError && hasFields;

  const showEditButton: boolean =
    canEdit && (updateGate.isAllowed || Boolean(updateGate.disabledReason));

  const cardButtons: Array<CardButtonSchema> = showEditButton
    ? [
        {
          title: text.editButton,
          buttonStyle: ButtonStyleType.NORMAL,
          icon: IconProp.Edit,
          disabled: !updateGate.isAllowed,
          tooltip: updateGate.disabledReason,
          onClick: () => {
            if (!updateGate.isAllowed) {
              return;
            }

            void openEditor();
          },
        },
      ]
    : [];

  /*
   * The modal's dropdowns, one per field. A field with a note says it there
   * too, under its type: the modal is where somebody makes it Required.
   */
  const getEditFields: () => Array<Field<JSONObject>> = (): Array<
    Field<JSONObject>
  > => {
    const notes: Map<string, string> = new Map<string, string>();

    for (const definition of definitions) {
      const note: string | undefined = getCustomFieldQuestionNote(
        definition,
        mode,
      );

      if (note) {
        notes.set(getCustomFieldSettingFormKey(definition.variableKey), note);
      }
    }

    return buildCustomFieldSettingsFormFields({
      definitions: definitions,
      mode: mode,
    }).map((field: Field<JSONObject>): Field<JSONObject> => {
      const note: string | undefined = notes.get(
        Object.keys(field.field || {})[0] || "",
      );

      if (!note) {
        return field;
      }

      const typeLabel: string | undefined =
        typeof field.description === "string" ? field.description : undefined;

      return {
        ...field,
        /*
         * An element, which the label shows as it is - so the type and the
         * note are looked up here.
         */
        description: (
          <>
            {typeLabel ? (
              <span className="block">
                {translateString(typeLabel) || typeLabel}
              </span>
            ) : (
              <></>
            )}
            <span
              className="mt-1 block"
              data-testid="incident-custom-field-question-note"
            >
              {translateString(note) || note}
            </span>
          </>
        ),
      };
    });
  };

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (loadError) {
      return <ErrorMessage message={loadError} />;
    }

    if (!hasFields) {
      return (
        <EmptyState
          id="incident-custom-field-settings-no-fields"
          icon={IconProp.TableCells}
          title={IncidentCustomFieldCreateSettingsCopy.formNoFieldsTitle}
          description={
            IncidentCustomFieldCreateSettingsCopy.formNoFieldsDescription
          }
          paddingClassName="py-8"
          footer={
            <Link
              className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.INCIDENTS_SETTINGS_CUSTOM_FIELDS] as Route,
              )}
            >
              {translateString(
                IncidentCustomFieldCreateSettingsCopy.formNoFieldsLink,
              ) || IncidentCustomFieldCreateSettingsCopy.formNoFieldsLink}
            </Link>
          }
        />
      );
    }

    /*
     * Edge to edge, like the Custom Fields card above it and the tables on
     * the same page: the negative margins cancel the card's padding.
     */
    return (
      <ul
        role="list"
        className="-mx-5 -mb-6 divide-y divide-gray-100 border-t border-gray-200 md:-mx-6"
        data-testid="incident-custom-field-settings-list"
      >
        {definitions.map(
          (definition: KeyedIncidentCustomFieldDefinition): ReactElement => {
            const typeLabel: string | undefined =
              getCustomFieldTypeLabel(definition);

            const settingLabel: string = getCustomFieldSettingLabel(
              definition,
              settings,
              mode,
            );

            const projectDefaultLabel: string | undefined =
              getCustomFieldProjectDefaultLabel(definition, settings, mode);

            const questionNote: string | undefined = getCustomFieldQuestionNote(
              definition,
              mode,
            );

            return (
              <li
                key={definition.variableKey}
                className="flex items-start justify-between gap-4 px-5 py-4 md:px-6"
                data-testid={`incident-custom-field-setting-${definition.variableKey}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 break-words">
                    {definition.name}
                  </p>
                  {typeLabel ? (
                    <p className="mt-0.5 text-xs text-gray-500">
                      {translateString(typeLabel) || typeLabel}
                    </p>
                  ) : (
                    <></>
                  )}
                  {projectDefaultLabel ? (
                    <p
                      className="mt-0.5 text-xs text-gray-500"
                      data-testid="incident-custom-field-project-default"
                    >
                      {translateString(projectDefaultLabel) ||
                        projectDefaultLabel}
                    </p>
                  ) : (
                    <></>
                  )}
                  {questionNote ? (
                    <p
                      className="mt-1 text-xs text-gray-500"
                      data-testid="incident-custom-field-question-note"
                    >
                      {translateString(questionNote) || questionNote}
                    </p>
                  ) : (
                    <></>
                  )}
                </div>
                <span
                  className={`inline-flex shrink-0 items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${
                    isCustomFieldSettingChosen(definition, settings, mode)
                      ? CHOSEN_SETTING_CLASS_NAME
                      : UNSET_SETTING_CLASS_NAME
                  }`}
                  data-testid="incident-custom-field-setting-value"
                >
                  {translateString(settingLabel) || settingLabel}
                </span>
              </li>
            );
          },
        )}
      </ul>
    );
  };

  return (
    <Card title={title} description={description} buttons={cardButtons}>
      {getBody()}
      {isEditing ? (
        <BasicFormModal<JSONObject>
          title={text.editButton}
          description={description}
          isLoading={isSaving || isReadingForEdit}
          submitButtonText={editReadError ? READ_AGAIN_BUTTON_TEXT : undefined}
          onClose={closeEditor}
          onSubmit={(data: JSONObject) => {
            if (editReadError) {
              void openEditor();
              return;
            }

            void save(data);
          }}
          formProps={{
            initialValues: editValues,
            // No dropdowns at all over settings that could not be read.
            fields: editReadError ? [] : getEditFields(),
            /*
             * The form's own error banner, above the dropdowns. (The
             * modal's error prop would show it twice: once from the modal
             * body and once from BasicFormModal itself.)
             */
            error: editReadError || saveError || undefined,
          }}
        />
      ) : (
        <></>
      )}
    </Card>
  );
};

export default IncidentCustomFieldSettingsCard;
