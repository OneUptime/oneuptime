import MonitorsElement from "../../../Components/Monitor/Monitors";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { ErrorFunction } from "Common/Types/FunctionTypes";
import { JSONObject } from "Common/Types/JSON";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorSecret from "Common/Models/DatabaseModels/MonitorSecret";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const MonitorSecrets: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [currentlyEditingItem, setCurrentlyEditingItem] =
    useState<MonitorSecret | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(false);

  return (
    <Fragment>
      <ModelTable<MonitorSecret>
        userPreferencesKey={"monitor-secrets-table"}
        modelType={MonitorSecret}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        id="monitor-secret-table"
        name="Settings > Monitor Secret"
        saveFilterProps={{
          tableId: "monitor-secrets-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        actionButtons={[
          {
            title: "Update Secret Value",
            buttonStyleType: ButtonStyleType.OUTLINE,
            onClick: async (
              item: MonitorSecret,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setCurrentlyEditingItem(item);
                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
        ]}
        cardProps={{
          title: "Monitor Secrets",
          description:
            "Monitor secrets are used to store sensitive information like API keys, passwords, etc. that can be shared with monitors.",
        }}
        documentationLink={Route.fromString("/docs/monitor/monitor-secrets")}
        noItemsMessage={
          'No monitor secret found. Click on the "Create" button to add a new monitor secret.'
        }
        viewPageRoute={Navigation.getCurrentRoute()}
        formSteps={[
          { title: "Secret", id: "secret" },
          { title: "Access", id: "access" },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "secret",
            fieldType: FormFieldSchemaType.Text,
            description:
              "Name of the secret. This is a unique identifier and can only contain letters, numbers, hyphens (-), and underscores (_). You can then use this name to access the secret in your monitors.",
            required: true,
            placeholder: "Secret Name",
            validation: {
              minLength: 2,
              noSpaces: true,
              noSpecialCharacters: true,
            },
            disableSpellCheck: true,
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "secret",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Secret Description",
          },
          {
            field: {
              secretValue: true,
            },
            title: "Secret Value",
            stepId: "secret",
            doNotShowWhenEditing: true, // Do not show this field when editing
            fieldType: FormFieldSchemaType.LongText,
            required: true,
            placeholder: "Secret Value (eg: API Key, Password, etc.)",
          },
          {
            field: {
              isAvailableToAllMonitors: true,
            },
            title: "Available to all monitors",
            stepId: "access",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "When this is on, every monitor in this project can use this secret. Leave it off to grant access to specific monitors and/or monitors with certain labels.",
          },
          {
            field: {
              monitors: true,
            },
            title: "Monitors which have access to this secret",
            stepId: "access",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Monitor,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            showIf: (item: FormValues<MonitorSecret>): boolean => {
              return !item.isAvailableToAllMonitors;
            },
            description:
              "Which monitors should have access to this secret? You can also (or instead) grant access by label below.",
            placeholder: "Select monitors",
          },
          {
            field: {
              labels: true,
            },
            title: "Monitors with these labels have access to this secret",
            stepId: "access",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            showIf: (item: FormValues<MonitorSecret>): boolean => {
              return !item.isAvailableToAllMonitors;
            },
            description:
              "Any monitor carrying at least one of these labels can use this secret.",
            placeholder: "Select labels",
          },
        ]}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
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
              monitors: true,
            },
            title: "Monitors which have access to this secret",
            type: FieldType.EntityArray,

            filterEntityType: Monitor,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
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
              description: true,
            },
            title: "Description",
            type: FieldType.LongText,
          },
          {
            field: {
              isAvailableToAllMonitors: true,
              monitors: {
                name: true,
                _id: true,
              },
              labels: {
                name: true,
                _id: true,
              },
            },
            title: "Access",
            type: FieldType.EntityArray,

            getElement: (item: MonitorSecret): ReactElement => {
              if (item.isAvailableToAllMonitors) {
                return (
                  <span className="text-sm font-medium text-indigo-600">
                    All monitors
                  </span>
                );
              }

              const monitors: Array<Monitor> = item.monitors || [];
              const labels: Array<Label> = item.labels || [];

              if (monitors.length === 0 && labels.length === 0) {
                return (
                  <span className="text-sm text-gray-500">
                    No monitors have access
                  </span>
                );
              }

              return (
                <div>
                  {monitors.length > 0 && (
                    <MonitorsElement monitors={monitors} />
                  )}
                  {labels.length > 0 && (
                    <div className="text-sm text-gray-600">
                      Monitors with labels:{" "}
                      {labels
                        .map((label: Label) => {
                          return label.name;
                        })
                        .join(", ")}
                    </div>
                  )}
                </div>
              );
            },
          },
        ]}
      />

      {currentlyEditingItem && (
        <BasicFormModal
          title={"Update Secret Value"}
          name="Monitor > Update Secret Value"
          isLoading={isLoading}
          onClose={() => {
            setIsLoading(false);
            return setCurrentlyEditingItem(null);
          }}
          onSubmit={async (data: JSONObject) => {
            try {
              setIsLoading(true);

              await ModelAPI.updateById<MonitorSecret>({
                modelType: MonitorSecret,
                id: currentlyEditingItem.id!,
                data: {
                  secretValue: data["secretValue"],
                },
              });

              setCurrentlyEditingItem(null);
            } catch {
              // do nothing
            }

            setIsLoading(false);
          }}
          formProps={{
            initialValues: {},
            fields: [
              {
                field: {
                  secretValue: true,
                },
                title: "Secret Value",
                description:
                  "This value will be encrypted and stored securely. Once saved, this value cannot be retrieved.",
                fieldType: FormFieldSchemaType.LongText,
                required: true,
                placeholder: "Secret Value (eg: API Key, Password, etc.)",
              },
            ],
          }}
        />
      )}
    </Fragment>
  );
};

export default MonitorSecrets;
