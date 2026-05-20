import RunbookAgentsElement from "../../Components/RunbookAgent/RunbookAgents";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
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
import RunbookAgent from "Common/Models/DatabaseModels/RunbookAgent";
import RunbookSecret from "Common/Models/DatabaseModels/RunbookSecret";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const RunbookSecrets: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [currentlyEditingItem, setCurrentlyEditingItem] =
    useState<RunbookSecret | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(false);

  return (
    <Fragment>
      <ModelTable<RunbookSecret>
        userPreferencesKey={"runbook-secrets-table"}
        modelType={RunbookSecret}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        id="runbook-secret-table"
        name="Settings > Runbook Secret"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        actionButtons={[
          {
            title: "Update Secret Value",
            buttonStyleType: ButtonStyleType.OUTLINE,
            onClick: async (
              item: RunbookSecret,
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
          title: "Runbook Secrets",
          description:
            "Runbook secrets are used to store sensitive information like API keys, passwords, etc. that can be shared with runbook agents.",
        }}
        noItemsMessage={
          'No runbook secret found. Click on the "Create" button to add a new runbook secret.'
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
              "Name of the secret. This is a unique identifier and can only contain letters, numbers, hyphens (-), and underscores (_). You can then use this name to access the secret in your runbook agents.",
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
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Secret Description",
          },
          {
            field: {
              secretValue: true,
            },
            title: "Secret Value",
            doNotShowWhenEditing: true,
            fieldType: FormFieldSchemaType.LongText,
            required: true,
            placeholder: "Secret Value (eg: API Key, Password, etc.)",
          },
          {
            field: {
              runbookAgents: true,
            },
            title: "Runbook agents which have access to this secret",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: RunbookAgent,
              labelField: "name",
              valueField: "_id",
            },
            required: true,
            description:
              "Which runbook agents should have access to this secret?",
            placeholder: "Select runbook agents",
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
              runbookAgents: true,
            },
            title: "Runbook agents which have access to this secret",
            type: FieldType.EntityArray,

            filterEntityType: RunbookAgent,
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
              runbookAgents: {
                name: true,
                _id: true,
                projectId: true,
              },
            },
            title: "Runbook agents which have access to this secret",
            type: FieldType.EntityArray,

            getElement: (item: RunbookSecret): ReactElement => {
              return (
                <RunbookAgentsElement
                  runbookAgents={item["runbookAgents"] || []}
                />
              );
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

              await ModelAPI.updateById<RunbookSecret>({
                modelType: RunbookSecret,
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

export default RunbookSecrets;
