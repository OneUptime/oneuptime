import FormsCopy from "../../Components/FormBuilder/FormsCopy";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Form from "Common/Models/DatabaseModels/Form";
import Route from "Common/Types/API/Route";
import {
  getDefaultFormFields,
  translateFormFieldDefaults,
} from "Common/Types/Form/FormField";
import FormTargetType, {
  DEFAULT_FORM_TARGET_TYPE,
  FORM_TARGET_TYPE_TEXT,
  FORM_TARGET_TYPES,
  readFormTargetType,
} from "Common/Types/Form/FormTargetType";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Forms: every form of the project, what each one creates and whether it is
 * taking submissions.
 *
 * Creating one asks only what a form cannot start without - a name and what
 * its submissions create - and, if you like, a description. The new form
 * opens on its builder, already asking for a title, a description and who is
 * submitting (getDefaultFormFields), so it works the moment it exists and the
 * next step is obvious: adjust the questions, then share the link.
 */

const TARGET_ICONS: Record<FormTargetType, IconProp> = {
  [FormTargetType.Incident]: IconProp.Alert,
  [FormTargetType.ScheduledMaintenance]: IconProp.Clock,
};

const Forms: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const tx: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

  return (
    <Fragment>
      <ModelTable<Form>
        modelType={Form}
        id="forms-table"
        userPreferencesKey="forms-table"
        name="Forms"
        saveFilterProps={{
          tableId: "forms-table",
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: FormsCopy.productTitle,
          description: FormsCopy.listDescription,
        }}
        documentationLink={new Route("/docs/forms/index")}
        noItemsMessage={FormsCopy.listEmpty}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        selectMoreFields={{
          targetType: true,
          isEnabled: true,
        }}
        createInitialValues={{
          targetType: DEFAULT_FORM_TARGET_TYPE,
        }}
        showViewIdButton={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            description: FormsCopy.nameDescription,
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: FormsCopy.namePlaceholder,
          },
          {
            field: {
              targetType: true,
            },
            title: FormsCopy.createsTitle,
            description: FormsCopy.createsDescription,
            fieldType: FormFieldSchemaType.CardSelect,
            cardSelectSingleColumn: true,
            cardSelectOptions: FORM_TARGET_TYPES.map(
              (target: FormTargetType): CardSelectOption => {
                return {
                  value: target,
                  title: FORM_TARGET_TYPE_TEXT[target].title,
                  description: FORM_TARGET_TYPE_TEXT[target].description,
                  icon: TARGET_ICONS[target],
                };
              },
            ),
            required: true,
            defaultValue: DEFAULT_FORM_TARGET_TYPE,
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            description: FormsCopy.descriptionDescription,
            fieldType: FormFieldSchemaType.Markdown,
            required: false,
            // Shown on the public page, where a private image cannot load.
            allowImageUpload: false,
          },
        ]}
        onBeforeCreate={async (item: Form): Promise<Form> => {
          /*
           * The questions a new form starts with, worded in the language of
           * the dashboard it is created in. Without them the server would
           * add the same questions in English.
           */
          const targetType: FormTargetType = readFormTargetType(
            item.targetType,
          );

          item.fields = translateFormFieldDefaults({
            fields: getDefaultFormFields(targetType),
            targetType: targetType,
            translate: tx,
          }) as unknown as JSONArray;

          return item;
        }}
        onCreateSuccess={async (item: Form): Promise<Form> => {
          // A new form opens on its builder: its questions are the next step.
          if (item._id) {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.FORM_VIEW] as Route,
                { modelId: new ObjectID(item._id.toString()) },
              ),
            );
          }

          return item;
        }}
        showRefreshButton={true}
        viewPageRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.FORMS] as Route,
        )}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              targetType: true,
            },
            title: FormsCopy.createsTitle,
            type: FieldType.Dropdown,
            filterDropdownOptions: FORM_TARGET_TYPES.map(
              (target: FormTargetType) => {
                return {
                  value: target,
                  label: FORM_TARGET_TYPE_TEXT[target].title,
                };
              },
            ),
          },
          {
            field: {
              isEnabled: true,
            },
            title: FormsCopy.acceptingSubmissions,
            type: FieldType.Boolean,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              targetType: true,
            },
            title: FormsCopy.createsTitle,
            type: FieldType.Element,
            getElement: (item: Form): ReactElement => {
              const target: FormTargetType = readFormTargetType(
                item.targetType,
              );

              return (
                <span
                  className="inline-flex items-center gap-1.5 rounded-md bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-200"
                  data-testid="form-creates"
                >
                  {tx(FORM_TARGET_TYPE_TEXT[target].title)}
                </span>
              );
            },
            getExportValue: (item: Form): string => {
              return FORM_TARGET_TYPE_TEXT[readFormTargetType(item.targetType)]
                .title;
            },
          },
          {
            field: {
              isEnabled: true,
            },
            title: FormsCopy.statusTitle,
            type: FieldType.Element,
            getElement: (item: Form): ReactElement => {
              const isOn: boolean = item.isEnabled !== false;

              return (
                <span
                  className="inline-flex items-center gap-1.5 text-sm text-gray-700"
                  data-testid="form-status"
                >
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      isOn ? "bg-emerald-500" : "bg-gray-300"
                    }`}
                    aria-hidden="true"
                  />
                  {tx(isOn ? FormsCopy.statusAccepting : FormsCopy.statusOff)}
                </span>
              );
            },
            getExportValue: (item: Form): string => {
              return item.isEnabled !== false
                ? FormsCopy.statusAccepting
                : FormsCopy.statusOff;
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default Forms;
