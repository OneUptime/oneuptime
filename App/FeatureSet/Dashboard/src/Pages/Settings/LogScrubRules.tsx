import PageComponentProps from "../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const LogScrubRules: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<LogScrubRule>
        modelType={LogScrubRule}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        id="log-scrub-rules-table"
        name="Settings > Data Privacy > Log Scrub Rules"
        userPreferencesKey="log-scrub-rules-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        sortBy="sortOrder"
        sortOrder={SortOrder.Ascending}
        enableDragAndDrop={true}
        dragDropIndexField="sortOrder"
        cardProps={{
          title: "Log Scrub Rules",
          description:
            "Automatically detect and scrub sensitive data (PII) from logs at ingest time. Matching patterns are masked, hashed, or redacted before storage. Drag to reorder.",
        }}
        noItemsMessage={"No scrub rules found."}
        formSteps={[
          {
            title: "Basic Info",
            id: "basic-info",
          },
          {
            title: "Pattern Configuration",
            id: "pattern-config",
          },
          {
            title: "Scrub Settings",
            id: "scrub-settings",
          },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "e.g. Scrub Email Addresses",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Describe what this scrub rule does.",
          },
          {
            field: {
              patternType: true,
            },
            title: "Pattern Type",
            stepId: "pattern-config",
            description:
              "The type of sensitive data to detect. Select 'Custom' to provide your own regex pattern.",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            dropdownOptions: [
              {
                label: "Email Address",
                value: "email",
              },
              {
                label: "Credit Card Number",
                value: "creditCard",
              },
              {
                label: "SSN (Social Security Number)",
                value: "ssn",
              },
              {
                label: "Phone Number",
                value: "phoneNumber",
              },
              {
                label: "IP Address",
                value: "ipAddress",
              },
              {
                label: "Custom Regex",
                value: "custom",
              },
            ],
          },
          {
            field: {
              customRegex: true,
            },
            title: "Custom Regex Pattern",
            stepId: "pattern-config",
            description:
              "A regular expression to match sensitive data. Only used when Pattern Type is 'Custom Regex'.",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "e.g. \\bSECRET-[A-Z0-9]+\\b",
          },
          {
            field: {
              scrubAction: true,
            },
            title: "Scrub Action",
            stepId: "scrub-settings",
            description:
              "How to handle matched data. Mask: partially hide (e.g. j***@***.com). Hash: replace with deterministic hash. Redact: replace with [REDACTED].",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            dropdownOptions: [
              {
                label: "Redact",
                value: "redact",
              },
              {
                label: "Mask",
                value: "mask",
              },
              {
                label: "Hash",
                value: "hash",
              },
            ],
          },
          {
            field: {
              fieldsToScrub: true,
            },
            title: "Fields to Scrub",
            stepId: "scrub-settings",
            description:
              "Which parts of the log to scrub: the log body (message), attribute values, or both.",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            dropdownOptions: [
              {
                label: "Both (Body & Attributes)",
                value: "both",
              },
              {
                label: "Body Only",
                value: "body",
              },
              {
                label: "Attributes Only",
                value: "attributes",
              },
            ],
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            stepId: "scrub-settings",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        showRefreshButton={true}
        showViewIdButton={true}
        filters={[
          {
            field: {
              name: true,
            },
            type: FieldType.Text,
            title: "Name",
          },
          {
            field: {
              patternType: true,
            },
            type: FieldType.Text,
            title: "Pattern Type",
          },
          {
            field: {
              scrubAction: true,
            },
            type: FieldType.Text,
            title: "Scrub Action",
          },
          {
            field: {
              isEnabled: true,
            },
            type: FieldType.Boolean,
            title: "Enabled",
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
              patternType: true,
            },
            title: "Pattern Type",
            type: FieldType.Text,
          },
          {
            field: {
              scrubAction: true,
            },
            title: "Scrub Action",
            type: FieldType.Text,
          },
          {
            field: {
              fieldsToScrub: true,
            },
            title: "Fields",
            type: FieldType.Text,
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            type: FieldType.Boolean,
          },
        ]}
      />
    </Fragment>
  );
};

export default LogScrubRules;
