import IncidentCustomFieldCreateSettingsCopy from "./IncidentCustomFieldCreateSettingsCopy";
import {
  buildCustomFieldSettingsFormFields,
  getChangedCustomFieldSettingsFormValues,
  getCustomFieldProjectDefaultLabel,
  getCustomFieldSettingLabel,
  getCustomFieldSettingsFormInitialValues,
  getCustomFieldTypeLabel,
  getKeyedCustomFieldDefinitions,
  isCustomFieldSettingChosen,
  KeyedIncidentCustomFieldDefinition,
  packCustomFieldSettingsFormValues,
} from "./IncidentCustomFieldCreateSettingsForm";
import {
  fetchIncidentCustomFieldDefinitions,
  IncidentCustomFieldDefinition,
} from "./IncidentCustomFieldDefinitions";
import IncidentTemplate from "Common/Models/DatabaseModels/IncidentTemplate";
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
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
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
 * incident is declared from an incident template (issue #4114): the
 * template's customFieldSettings, one setting per field keyed by the field's
 * template variable key (Common/Types/CustomField/CustomFieldCreateSettings).
 * The card lists every field in its order with its type and setting; Edit
 * opens one dropdown per field.
 *
 * A field left on Default follows its own Show on Create and Required on
 * Create, and says which; a field the template overrides says it too
 * ("Project default: Required"), under its type - otherwise only the editor,
 * which a viewer cannot open, would tell a template that relaxes a field the
 * project requires from one that asks a field the project leaves out. A
 * project with no custom fields (or none on its plan) has nothing to set, so
 * the card then shows nothing at all - the page is about the template, not
 * its custom fields.
 *
 * The page may have been open a while when Edit is pressed, and somebody
 * else - another admin, another tab, the API, Terraform - may have changed
 * the settings, or the fields, since. So Edit reads the fields and the
 * settings again before the modal shows a dropdown, and Save reads both once
 * more and lays only the dropdowns changed in the modal over what is stored
 * then, for the fields that exist then: a field this edit leaves alone keeps
 * whatever somebody else gave it, and a change to a field deleted meanwhile
 * is not written back.
 *
 * Saving writes the compacted settings (Default is left out) with the
 * template's other columns untouched. A template keeps the settings of fields
 * the card does not list - a field deleted since gets its setting back when
 * it is made again.
 */

export interface ComponentProps {
  // The incident template.
  modelId: ObjectID;
  // Instead of the card's own title and description.
  title?: string | undefined;
  description?: string | undefined;
}

/*
 * The modal's button while the settings could not be read: there is nothing
 * to save, so it reads them again. Every Dashboard locale has these words.
 */
const READ_AGAIN_BUTTON_TEXT: string = "Try again";

// A field the template overrides is set apart from the fields left as they are.
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

  const title: string =
    props.title || IncidentCustomFieldCreateSettingsCopy.templateTitle;
  const description: string =
    props.description ||
    IncidentCustomFieldCreateSettingsCopy.templateDescription;
  const notFound: string =
    IncidentCustomFieldCreateSettingsCopy.templateNotFound;
  const editButton: string =
    IncidentCustomFieldCreateSettingsCopy.templateEditButton;

  type ReadRecordFunction = () => Promise<IncidentTemplate | null>;

  // The template's settings as they are stored now; null when it is gone.
  const readRecord: ReadRecordFunction =
    async (): Promise<IncidentTemplate | null> => {
      return await ModelAPI.getItem<IncidentTemplate>({
        modelType: IncidentTemplate,
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
        IncidentTemplate | null,
      ] = await Promise.all([
        fetchIncidentCustomFieldDefinitions(),
        readRecord(),
      ]);

      if (record) {
        setDefinitions(getKeyedCustomFieldDefinitions(fieldDefinitions));
        setSettings(readCustomFieldCreateSettings(record.customFieldSettings));
      } else {
        // Nothing to show settings for, and nothing a save could update.
        setLoadError(notFound);
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
        IncidentTemplate | null,
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
        setEditReadError(notFound);
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
       * setting. The fields are read again too, so a change made here to a
       * field deleted since is not written back for a field that no longer
       * exists.
       */
      const [fieldDefinitions, record]: [
        Array<IncidentCustomFieldDefinition>,
        IncidentTemplate | null,
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
            }),
            startingSettings: record.customFieldSettings,
          });

        await ModelAPI.updateById<IncidentTemplate>({
          modelType: IncidentTemplate,
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
        setSaveError(notFound);
      }
    } catch (err) {
      setSaveError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  const hasFields: boolean = definitions.length > 0;

  /*
   * The template's page shows nothing until it knows there is something to
   * set: no loader flash, no error about custom fields the project may not
   * have on its plan, and no card for a project without any.
   */
  if (isLoading || Boolean(loadError) || !hasFields) {
    return <></>;
  }

  /*
   * The settings live on the record, so changing them is an update of it.
   * Without the permission the button stays and says why; while the
   * permissions are not known yet it is left out.
   */
  const updateGate: PermissionGateResult = PermissionGate.check(
    new IncidentTemplate(),
    ModelAction.Update,
  );

  const showEditButton: boolean =
    updateGate.isAllowed || Boolean(updateGate.disabledReason);

  const cardButtons: Array<CardButtonSchema> = showEditButton
    ? [
        {
          title: editButton,
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

  const getBody: () => ReactElement = (): ReactElement => {
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
            );

            const projectDefaultLabel: string | undefined =
              getCustomFieldProjectDefaultLabel(definition, settings);

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
                </div>
                <span
                  className={`inline-flex shrink-0 items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${
                    isCustomFieldSettingChosen(definition, settings)
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
          title={editButton}
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
            fields: editReadError
              ? []
              : buildCustomFieldSettingsFormFields({ definitions }),
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
