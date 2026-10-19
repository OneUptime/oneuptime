import RunnersElement from "../../Components/Runner/Runners";
import RunnerChoicesLoader, {
  GlobalRunnerRow,
} from "../../Components/Runner/RunnerChoices";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Field from "Common/UI/Components/Forms/Types/Field";
import Column from "Common/UI/Components/ModelTable/Column";
import { useAsyncEffect } from "use-async-effect";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { ErrorFunction } from "Common/Types/FunctionTypes";
import { JSONObject } from "Common/Types/JSON";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import Runner from "Common/Models/DatabaseModels/Runner";
import RunbookSecret from "Common/Models/DatabaseModels/RunbookSecret";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * What the page knows about global Runners - the Runners OneUptime runs for
 * every project - for the Access step: whether the server has any, and
 * whether the project uses them.
 */
interface GlobalRunnerAccess {
  hasGlobalRunners: boolean;
  projectUsesGlobalRunners: boolean;
}

const RunbookSecrets: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [currentlyEditingItem, setCurrentlyEditingItem] =
    useState<RunbookSecret | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [globalRunnerAccess, setGlobalRunnerAccess] =
    useState<GlobalRunnerAccess | null>(null);

  useAsyncEffect(async () => {
    const [globalRunners, projectUsesGlobalRunners]: [
      Array<GlobalRunnerRow>,
      boolean,
    ] = await Promise.all([
      RunnerChoicesLoader.loadGlobalRunners(),
      RunnerChoicesLoader.loadProjectUsesGlobalRunners(
        ProjectUtil.getCurrentProjectId()!,
      ),
    ]);

    setGlobalRunnerAccess({
      hasGlobalRunners: globalRunners.length > 0,
      projectUsesGlobalRunners,
    });
  }, []);

  if (!globalRunnerAccess) {
    return <ComponentLoader />;
  }

  const hasGlobalRunners: boolean = globalRunnerAccess.hasGlobalRunners;

  /*
   * Who may use a secret, on the Access step: the global Runners - asked
   * only on a server that has them - and the project's own Runners. A new
   * secret starts usable by the global Runners when the project uses them,
   * as a JavaScript step that picks no Runner runs there; a step of another
   * project never gets it (RunbookSecretsUtil.loadForGlobalRunnerJob).
   */
  const globalRunnersAccessFields: Array<Field<RunbookSecret>> =
    hasGlobalRunners
      ? [
          {
            field: {
              isAvailableToGlobalRunners: true,
            },
            title: "Global Runners can use this secret",
            stepId: "access",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Steps of this project that run on a global Runner get this secret. Steps of other projects never do.",
          },
        ]
      : [];

  const globalRunnersColumns: Array<Column<RunbookSecret>> = hasGlobalRunners
    ? [
        {
          field: {
            isAvailableToGlobalRunners: true,
          },
          title: "Global Runners",
          type: FieldType.Boolean,
        },
      ]
    : [];

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
        saveFilterProps={{
          tableId: "runbook-secrets-table",
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
            "Passwords, tokens and API keys your runbook scripts use. A secret reaches only the Runners you let use it.",
        }}
        createInitialValues={{
          isAvailableToGlobalRunners:
            hasGlobalRunners && globalRunnerAccess.projectUsesGlobalRunners,
        }}
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
              "Letters, numbers, hyphens and underscores. Scripts read the secret by this name.",
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
            doNotShowWhenEditing: true,
            fieldType: FormFieldSchemaType.LongText,
            required: true,
            /*
             * Its own line: the column's said only "the assigned runbook
             * agent" could read it, and global Runners may too (Access).
             */
            description:
              "Stored encrypted. Only the Runners you let use it can read it.",
            placeholder: "Secret Value (eg: API Key, Password, etc.)",
          },
          ...globalRunnersAccessFields,
          {
            field: {
              runners: true,
            },
            title: "Your Runners that can use this secret",
            stepId: "access",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Runner,
              labelField: "name",
              valueField: "_id",
            },
            // With global Runners, a secret may be theirs alone.
            required: !hasGlobalRunners,
            description: "The Runners you installed that get this secret.",
            placeholder: "Select Runners",
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
              runners: true,
            },
            title: "Your Runners",
            type: FieldType.EntityArray,

            filterEntityType: Runner,
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
          ...globalRunnersColumns,
          {
            field: {
              runners: {
                name: true,
                _id: true,
                projectId: true,
              },
            },
            title: "Your Runners",
            type: FieldType.EntityArray,

            getElement: (item: RunbookSecret): ReactElement => {
              return <RunnersElement runners={item["runners"] || []} />;
            },
          },
        ]}
      />

      {currentlyEditingItem && (
        <BasicFormModal
          title={"Update Secret Value"}
          name="Runbook > Update Secret Value"
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
