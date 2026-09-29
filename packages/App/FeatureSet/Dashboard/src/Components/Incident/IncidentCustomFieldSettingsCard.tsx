import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import IncidentCustomFieldCreateSettingsCopy from "./IncidentCustomFieldCreateSettingsCopy";
import {
  buildCustomFieldSettingsFormFields,
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
import Link from "Common/UI/Components/Link/Link";
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
 * Which of the project's incident custom fields are asked for when an
 * incident is created, for one record that decides it for itself (issue
 * #4114): the record's customFieldSettings, one setting per field keyed by
 * the field's template variable key (Common/Types/CustomField/
 * CustomFieldCreateSettings). The card lists every field in its order with
 * its type and setting; Edit opens one dropdown per field.
 *
 *   - mode "template", on an incident template's page: the Details step of
 *     declaring an incident from the template. A field left on Default
 *     follows its own Show on Create and Required on Create, and says which.
 *     A project with no custom fields (or none on its plan) has nothing to
 *     set, so the card then shows nothing at all - the page is about the
 *     template, not its custom fields.
 *   - mode "form", on an incident form's page: the form's questions. A field
 *     is Not Asked until the form names it, whatever its Show on Create says.
 *     The questions are the point of that card, so it stays: with a note on
 *     where custom fields are made when the project has none, and with the
 *     reason when they cannot be read.
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
}

const MODE_TEXT: Record<IncidentCustomFieldSettingsMode, ModeText> = {
  template: {
    title: IncidentCustomFieldCreateSettingsCopy.templateTitle,
    description: IncidentCustomFieldCreateSettingsCopy.templateDescription,
    editButton: IncidentCustomFieldCreateSettingsCopy.templateEditButton,
  },
  form: {
    title: IncidentCustomFieldCreateSettingsCopy.formTitle,
    description: IncidentCustomFieldCreateSettingsCopy.formDescription,
    editButton: IncidentCustomFieldCreateSettingsCopy.formEditButton,
  },
};

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
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");

  const mode: IncidentCustomFieldSettingsMode = props.mode;
  const text: ModeText = MODE_TEXT[mode];
  const title: string = props.title || text.title;
  const description: string = props.description || text.description;

  const load: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setLoadError("");

    try {
      const [fieldDefinitions, record]: [
        Array<IncidentCustomFieldDefinition>,
        SettingsRecord | null,
      ] = await Promise.all([
        fetchIncidentCustomFieldDefinitions(),
        ModelAPI.getItem<SettingsRecord>({
          modelType: props.modelType,
          id: props.modelId,
          select: {
            customFieldSettings: true,
          },
        }),
      ]);

      if (record) {
        setDefinitions(getKeyedCustomFieldDefinitions(fieldDefinitions));
        setSettings(readCustomFieldCreateSettings(record.customFieldSettings));
      } else {
        // Nothing to show settings for, and nothing a save could update.
        setLoadError(IncidentCustomFieldCreateSettingsCopy.formNotFound);
      }
    } catch (err) {
      setLoadError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useAsyncEffect(async () => {
    await load();
  }, [props.modelId.toString()]);

  type SaveFunction = (data: JSONObject) => Promise<void>;

  const save: SaveFunction = async (data: JSONObject): Promise<void> => {
    setEditValues(data);
    setSaveError("");
    setIsSaving(true);

    const newSettings: CustomFieldCreateSettings =
      packCustomFieldSettingsFormValues({
        definitions: definitions,
        formValues: data,
        startingSettings: settings,
        mode: mode,
      });

    try {
      await ModelAPI.updateById<SettingsRecord>({
        modelType: props.modelType,
        id: props.modelId,
        data: {
          customFieldSettings: newSettings,
        },
      });

      // The server stores the settings exactly as sent.
      setSettings(newSettings);
      setIsEditing(false);
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

            setEditValues(
              getCustomFieldSettingsFormInitialValues({
                definitions: definitions,
                settings: settings,
                mode: mode,
              }),
            );
            setSaveError("");
            setIsEditing(true);
          },
        },
      ]
    : [];

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
          isLoading={isSaving}
          onClose={() => {
            setIsEditing(false);
            setSaveError("");
          }}
          onSubmit={(data: JSONObject) => {
            void save(data);
          }}
          formProps={{
            initialValues: editValues,
            fields: buildCustomFieldSettingsFormFields({
              definitions: definitions,
              mode: mode,
            }),
            /*
             * The form's own error banner, above the dropdowns. (The
             * modal's error prop would show it twice: once from the modal
             * body and once from BasicFormModal itself.)
             */
            error: saveError || undefined,
          }}
        />
      ) : (
        <></>
      )}
    </Card>
  );
};

export default IncidentCustomFieldSettingsCard;
