import MonitorSecretAccessElement from "../../../Components/MonitorSecret/MonitorSecretAccessElement";
import {
  MONITOR_SECRET_ACCESS_STEP_ID,
  MONITOR_SECRET_ACCESS_TITLES,
  getMonitorSecretAccessFormFields,
} from "./MonitorSecretAccessFormFields";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { ErrorFunction } from "Common/Types/FunctionTypes";
import { JSONObject } from "Common/Types/JSON";
import MonitorSecretAccess, {
  MonitorSecretAccessUtil,
} from "Common/Types/Monitor/MonitorSecretAccess";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslateValue from "Common/UI/Utils/Translation";
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

  const { translateString } = useTranslateValue();

  const translate: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

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
            icon: IconProp.Key,
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
        viewPageRoute={Navigation.getCurrentRoute()}
        formSteps={[
          { title: "Secret", id: "secret" },
          { title: "Access", id: MONITOR_SECRET_ACCESS_STEP_ID },
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
          ...getMonitorSecretAccessFormFields(translate),
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
              monitorAccess: true,
            },
            title: "Access",
            type: FieldType.Dropdown,
            filterDropdownOptions: MonitorSecretAccessUtil.ALL_ACCESS_MODES.map(
              (access: MonitorSecretAccess) => {
                return {
                  label: translate(MONITOR_SECRET_ACCESS_TITLES[access]),
                  value: access,
                };
              },
            ),
          },
          {
            field: {
              monitors: true,
            },
            title: "Monitors",
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
          {
            field: {
              labels: true,
            },
            title: "Labels",
            type: FieldType.EntityArray,

            filterEntityType: Label,
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
              monitorAccess: true,
              monitors: {
                name: true,
                _id: true,
                projectId: true,
              },
              labels: {
                name: true,
                color: true,
                _id: true,
              },
            },
            title: "Access",
            type: FieldType.Element,

            getElement: (item: MonitorSecret): ReactElement => {
              return <MonitorSecretAccessElement secret={item} />;
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
