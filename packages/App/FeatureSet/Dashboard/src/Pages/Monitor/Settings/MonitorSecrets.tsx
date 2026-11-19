import MonitorSecretAccessElement from "../../../Components/MonitorSecret/MonitorSecretAccessElement";
import TotpCodePreview from "../../../Components/MonitorSecret/TotpCodePreview";
import {
  MONITOR_SECRET_ACCESS_STEP_ID,
  MONITOR_SECRET_ACCESS_TITLES,
  getMonitorSecretAccessFormFields,
} from "./MonitorSecretAccessFormFields";
import {
  MONITOR_SECRET_TYPE_TITLES,
  TOTP_SECRET_VALUE_DESCRIPTION,
  TOTP_SECRET_VALUE_PLACEHOLDER,
  TOTP_SECRET_VALUE_TITLE,
  getMonitorSecretTypeOptions,
  getTotpSecretValueProblem,
  isTextSecretForm,
  isTotpSecretForm,
} from "./MonitorSecretTypeFormFields";
import MonitorSecretType, {
  MonitorSecretTypeUtil,
} from "Common/Types/Monitor/MonitorSecretType";
import { Translator } from "Common/Types/Translator";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import useTranslator from "Common/UI/Utils/UseTranslator";
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
import API from "Common/UI/Utils/API/API";
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

  /*
   * Why a new secret value was not saved. It used to be dropped: the dialog
   * stopped spinning and stayed open with no word of what went wrong, so
   * the secret looked updated when it was not.
   */
  const [updateError, setUpdateError] = useState<string>("");

  const { translateString } = useTranslateValue();
  const translator: Translator = useTranslator();

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
              "Letters, numbers, hyphens and underscores. Monitors use this name to read the secret.",
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
            hideColumnDescription: true,
          },
          {
            field: {
              secretType: true,
            },
            title: "Type",
            stepId: "secret",
            // A secret keeps the type it is created with.
            doNotShowWhenEditing: true,
            description: "What the secret holds. It cannot be changed later.",
            fieldType: FormFieldSchemaType.CardSelect,
            cardSelectOptions: getMonitorSecretTypeOptions(translate),
            defaultValue: MonitorSecretType.Text,
            required: true,
          },
          {
            field: {
              secretValue: true,
            },
            title: "Secret Value",
            stepId: "secret",
            doNotShowWhenEditing: true, // Do not show this field when editing
            showIf: isTextSecretForm,
            description:
              "This value will be encrypted and stored securely. Once saved, this value cannot be retrieved.",
            fieldType: FormFieldSchemaType.LongText,
            required: true,
            placeholder: "Secret Value (eg: API Key, Password, etc.)",
          },
          {
            // The same value, asked as a setup key for a one-time code secret.
            field: {
              secretValue: true,
            },
            title: TOTP_SECRET_VALUE_TITLE,
            stepId: "secret",
            doNotShowWhenEditing: true,
            showIf: isTotpSecretForm,
            description: TOTP_SECRET_VALUE_DESCRIPTION,
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: TOTP_SECRET_VALUE_PLACEHOLDER,
            disableSpellCheck: true,
            customValidation: (
              values: FormValues<MonitorSecret>,
            ): string | null => {
              return getTotpSecretValueProblem(
                values.secretValue,
                translator.translateTemplate,
              );
            },
            getFooterElement: (
              values: FormValues<MonitorSecret>,
            ): ReactElement => {
              return <TotpCodePreview value={values.secretValue} />;
            },
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
              secretType: true,
            },
            title: "Type",
            type: FieldType.Dropdown,
            // The type titles in English, looked up as the menu draws them.
            filterDropdownOptions: MonitorSecretTypeUtil.ALL_TYPES.map(
              (secretType: MonitorSecretType) => {
                return {
                  label: MONITOR_SECRET_TYPE_TITLES[secretType],
                  value: secretType,
                };
              },
            ),
          },
          {
            field: {
              monitorAccess: true,
            },
            title: "Access",
            type: FieldType.Dropdown,
            /*
             * The access titles in English: the filter's menu and its chip
             * look them up, once (DropdownOption.isUserContent).
             */
            filterDropdownOptions: MonitorSecretAccessUtil.ALL_ACCESS_MODES.map(
              (access: MonitorSecretAccess) => {
                return {
                  label: MONITOR_SECRET_ACCESS_TITLES[access],
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
              secretType: true,
            },
            title: "Type",
            type: FieldType.Element,
            getElement: (item: MonitorSecret): ReactElement => {
              const secretType: MonitorSecretType =
                MonitorSecretTypeUtil.isTotp(item.secretType)
                  ? MonitorSecretType.TOTP
                  : MonitorSecretType.Text;

              return (
                <span
                  data-testid="monitor-secret-type"
                  data-secret-type={secretType}
                  className="text-sm text-gray-900"
                >
                  {translate(MONITOR_SECRET_TYPE_TITLES[secretType])}
                </span>
              );
            },
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
          error={updateError || undefined}
          onClose={() => {
            setIsLoading(false);
            setUpdateError("");
            return setCurrentlyEditingItem(null);
          }}
          onSubmit={async (data: JSONObject) => {
            try {
              setIsLoading(true);
              setUpdateError("");

              await ModelAPI.updateById<MonitorSecret>({
                modelType: MonitorSecret,
                id: currentlyEditingItem.id!,
                data: {
                  secretValue: data["secretValue"],
                },
              });

              setCurrentlyEditingItem(null);
            } catch (err) {
              // Said in the dialog, which stays open to try again.
              setUpdateError(API.getFriendlyMessage(err));
            }

            setIsLoading(false);
          }}
          formProps={{
            initialValues: {},
            /*
             * A one-time code secret's new value is a setup key, asked and
             * previewed as it is on create; any other secret's is text.
             */
            fields: MonitorSecretTypeUtil.isTotp(
              currentlyEditingItem.secretType,
            )
              ? [
                  {
                    field: {
                      secretValue: true,
                    },
                    title: TOTP_SECRET_VALUE_TITLE,
                    description: TOTP_SECRET_VALUE_DESCRIPTION,
                    fieldType: FormFieldSchemaType.Text,
                    required: true,
                    placeholder: TOTP_SECRET_VALUE_PLACEHOLDER,
                    disableSpellCheck: true,
                    customValidation: (
                      values: FormValues<JSONObject>,
                    ): string | null => {
                      return getTotpSecretValueProblem(
                        values["secretValue"],
                        translator.translateTemplate,
                      );
                    },
                    getFooterElement: (
                      values: FormValues<JSONObject>,
                    ): ReactElement => {
                      return <TotpCodePreview value={values["secretValue"]} />;
                    },
                  },
                ]
              : [
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
