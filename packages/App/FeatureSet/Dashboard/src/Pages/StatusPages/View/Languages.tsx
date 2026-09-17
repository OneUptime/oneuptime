import PageComponentProps from "../../PageComponentProps";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import {
  DEFAULT_STATUS_PAGE_LANGUAGE,
  StatusPageLanguage,
  SUPPORTED_STATUS_PAGE_LANGUAGES,
} from "Common/Types/StatusPage/StatusPageLanguage";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const languageDropdownOptions: Array<DropdownOption> =
  SUPPORTED_STATUS_PAGE_LANGUAGES.map((language: StatusPageLanguage) => {
    return {
      value: language.code,
      label: `${language.nativeName} (${language.englishName})`,
    };
  });

const codeToLabel: Record<string, string> = Object.fromEntries(
  SUPPORTED_STATUS_PAGE_LANGUAGES.map((language: StatusPageLanguage) => {
    return [language.code, `${language.nativeName} (${language.englishName})`];
  }),
);

const StatusPageLanguages: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CardModelDetail<StatusPage>
        name="Status Page > Languages > Default Language"
        cardProps={{
          title: "Default Language",
          description:
            "The language that first-time visitors see. Visitors can always switch languages from the footer.",
        }}
        editButtonText={"Edit Default Language"}
        isEditable={true}
        formFields={[
          {
            field: {
              defaultLanguage: true,
            },
            title: "Default Language",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: languageDropdownOptions,
            required: true,
            defaultValue: DEFAULT_STATUS_PAGE_LANGUAGE,
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-status-page-default-language",
          fields: [
            {
              field: {
                defaultLanguage: true,
              },
              fieldType: FieldType.Text,
              title: "Default Language",
              placeholder: codeToLabel[DEFAULT_STATUS_PAGE_LANGUAGE] as string,
              getElement: (item: StatusPage): ReactElement => {
                const code: string =
                  item.defaultLanguage || DEFAULT_STATUS_PAGE_LANGUAGE;
                return <span>{codeToLabel[code] || code}</span>;
              },
            },
          ],
          modelId: modelId,
        }}
      />

      <CardModelDetail<StatusPage>
        name="Status Page > Languages > Enabled Languages"
        cardProps={{
          title: "Enabled Languages",
          description:
            "Languages offered in the footer language switcher. Leave empty to show all supported languages.",
        }}
        editButtonText={"Edit Enabled Languages"}
        isEditable={true}
        formFields={[
          {
            field: {
              enabledLanguages: true,
            },
            title: "Enabled Languages",
            description:
              "Leave empty to offer every supported language to visitors.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownOptions: languageDropdownOptions,
            required: false,
            placeholder: "All languages",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-status-page-enabled-languages",
          fields: [
            {
              field: {
                enabledLanguages: true,
              },
              fieldType: FieldType.Text,
              title: "Enabled Languages",
              placeholder: "All supported languages",
              getElement: (item: StatusPage): ReactElement => {
                const enabled: Array<string> | undefined =
                  item.enabledLanguages;
                if (!enabled || enabled.length === 0) {
                  return <span>All supported languages</span>;
                }
                const labels: Array<string> = enabled.map((code: string) => {
                  return codeToLabel[code] || code;
                });
                return <span>{labels.join(", ")}</span>;
              },
            },
          ],
          modelId: modelId,
        }}
      />
    </Fragment>
  );
};

export default StatusPageLanguages;
