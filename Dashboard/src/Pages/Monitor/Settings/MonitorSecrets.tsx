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
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
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
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            description:
              "Name of the secret. This is a unique identifier and cannot have spaces or special characters. You can then use this name to access the secret in your monitors.",
            required: true,
            placeholder: "Secret Name",
            validation: {
              minLength: 2,
              noSpaces: true,
              noNumbers: true,
              noSpecialCharacters: true,
            },
            disableSpellCheck: true,
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Secret Description",
          },
          {
            field: {
              secretValue: true,
            },
            title: "Secret Value",
            doNotShowWhenEditing: true, // Do not show this field when editing
            fieldType: FormFieldSchemaType.LongText,
            required: true,
            placeholder: "Secret Value (eg: API Key, Password, etc.)",
          },
          {
            field: {
              monitors: true,
            },
            title: "Monitors which have access to this secret",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Monitor,
              labelField: "name",
              valueField: "_id",
            },
            required: true,
            description: "Whcih monitors should have access to this secret?",
            placeholder: "Select monitors",
          },
        ]}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        showRefreshButton={true}
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
              monitors: {
                name: true,
                _id: true,
                projectId: true,
              },
            },
            title: "Monitors which have access to this secret",
            type: FieldType.EntityArray,

            getElement: (item: MonitorSecret): ReactElement => {
              return <MonitorsElement monitors={item["monitors"] || []} />;
            },
          },
        ]}
      />

      {currentlyEditingItem && (
        <BasicFormModal
          title={"Update Secret Value"}
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
