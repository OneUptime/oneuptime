import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import ProjectUtil from "Common/UI/Utils/Project";
import Pill from "Common/UI/Components/Pill/Pill";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import {
  Blue500,
  Green500,
  Purple500,
  Cyan500,
  Orange500,
  Yellow500,
  Teal500,
  Indigo500,
} from "Common/Types/BrandColors";
import React, { FunctionComponent, ReactElement } from "react";

interface PillConfig {
  label: string;
  color: Color;
  icon: IconProp;
  tooltip: string;
}

const patternTypeConfig: Record<string, PillConfig> = {
  email: {
    label: "Email Address",
    color: Blue500,
    icon: IconProp.Email,
    tooltip: "Matches email addresses",
  },
  creditCard: {
    label: "Credit Card",
    color: Orange500,
    icon: IconProp.CreditCard,
    tooltip: "Matches credit card numbers",
  },
  ssn: {
    label: "SSN",
    color: Purple500,
    icon: IconProp.ShieldExclamation,
    tooltip: "Matches US Social Security Numbers",
  },
  phoneNumber: {
    label: "Phone Number",
    color: Teal500,
    icon: IconProp.Phone,
    tooltip: "Matches phone numbers",
  },
  ipAddress: {
    label: "IP Address",
    color: Cyan500,
    icon: IconProp.Globe,
    tooltip: "Matches IPv4 addresses",
  },
  custom: {
    label: "Custom Regex",
    color: Indigo500,
    icon: IconProp.Code,
    tooltip: "Uses a custom regular expression pattern",
  },
};

const scrubActionConfig: Record<string, PillConfig> = {
  redact: {
    label: "Redact",
    color: Orange500,
    icon: IconProp.EyeSlash,
    tooltip: "Replace matched data with [REDACTED]",
  },
  mask: {
    label: "Mask",
    color: Yellow500,
    icon: IconProp.Eye,
    tooltip: "Partially hide data",
  },
  hash: {
    label: "Hash",
    color: Purple500,
    icon: IconProp.Hashtag,
    tooltip: "Replace with a deterministic SHA-256 hash",
  },
};

const fieldsToScrubConfig: Record<string, PillConfig> = {
  all: {
    label: "All Fields",
    color: Green500,
    icon: IconProp.ShieldCheck,
    tooltip: "Scrub span name, attributes, and span event attributes",
  },
  name: {
    label: "Span Name",
    color: Blue500,
    icon: IconProp.File,
    tooltip: "Scrub only the span name",
  },
  attributes: {
    label: "Attributes",
    color: Cyan500,
    icon: IconProp.Settings,
    tooltip: "Scrub only span attribute values",
  },
  events: {
    label: "Events",
    color: Teal500,
    icon: IconProp.Activity,
    tooltip: "Scrub only span event attribute values",
  },
};

const documentationMarkdown: string = `
### How Trace Scrub Rules Work

Trace scrub rules automatically detect and remove sensitive data (PII) from your spans **at ingest time** — before they are stored. This ensures sensitive information never reaches your span storage.

### Pattern Types

Email, Credit Card, SSN, Phone Number, IP Address, or your own custom regex.

### Scrub Actions

- **Redact** — replace with \`[REDACTED]\`
- **Mask** — partially hide value
- **Hash** — replace with deterministic SHA-256 hash

### Fields to Scrub

- **All** — span name, attributes, and event attributes
- **Span Name** — only the span name
- **Attributes** — only span attribute values
- **Events** — only span event attribute values
`;

const TraceScrubRules: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <ModelTable<TraceScrubRule>
      modelType={TraceScrubRule}
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      id="trace-scrub-rules-table"
      name="Traces > Settings > Scrub Rules"
      userPreferencesKey="trace-scrub-rules-table"
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      sortBy="sortOrder"
      sortOrder={SortOrder.Ascending}
      enableDragAndDrop={true}
      dragDropIndexField="sortOrder"
      cardProps={{
        title: "Trace Scrub Rules",
        description:
          "Automatically detect and scrub sensitive data (PII) from spans at ingest time. Matching patterns are masked, hashed, or redacted before storage. Drag to reorder.",
      }}
      helpContent={{
        title: "How Trace Scrub Rules Work",
        description:
          "Understanding pattern types, scrub actions, and how sensitive data is removed from spans at ingest time",
        markdown: documentationMarkdown,
      }}
      noItemsMessage={"No scrub rules found."}
      createInitialValues={{
        isEnabled: true,
        scrubAction: "redact",
        fieldsToScrub: "all",
      }}
      onBeforeCreate={async (item: TraceScrubRule) => {
        if (!item.sortOrder) {
          item.sortOrder = 1;
        }
        if (!item.scrubAction) {
          item.scrubAction = "redact";
        }
        if (!item.fieldsToScrub) {
          item.fieldsToScrub = "all";
        }
        if (item.isEnabled === undefined || item.isEnabled === null) {
          item.isEnabled = true;
        }
        return item;
      }}
      formSteps={[
        { title: "Basic Info", id: "basic-info" },
        { title: "Pattern Configuration", id: "pattern-config" },
        { title: "Scrub Settings", id: "scrub-settings" },
      ]}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "e.g. Scrub Email Addresses",
          validation: { minLength: 2 },
        },
        {
          field: { description: true },
          title: "Description",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          placeholder: "Describe what this scrub rule does.",
        },
        {
          field: { patternType: true },
          title: "Pattern Type",
          stepId: "pattern-config",
          description:
            "The type of sensitive data to detect. Select 'Custom' to provide your own regex pattern.",
          fieldType: FormFieldSchemaType.Dropdown,
          required: true,
          dropdownOptions: [
            { label: "Email Address", value: "email" },
            { label: "Credit Card Number", value: "creditCard" },
            { label: "SSN (Social Security Number)", value: "ssn" },
            { label: "Phone Number", value: "phoneNumber" },
            { label: "IP Address", value: "ipAddress" },
            { label: "Custom Regex", value: "custom" },
          ],
        },
        {
          field: { customRegex: true },
          title: "Custom Regex Pattern",
          stepId: "pattern-config",
          description: "A regular expression to match sensitive data.",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          placeholder: "e.g. \\bSECRET-[A-Z0-9]+\\b",
          showIf: (values: FormValues<TraceScrubRule>): boolean => {
            return values.patternType === "custom";
          },
        },
        {
          field: { scrubAction: true },
          title: "Scrub Action",
          stepId: "scrub-settings",
          description:
            "How to handle matched data. Mask: partially hide. Hash: replace with deterministic hash. Redact: replace with [REDACTED].",
          fieldType: FormFieldSchemaType.Dropdown,
          required: true,
          dropdownOptions: [
            { label: "Redact", value: "redact" },
            { label: "Mask", value: "mask" },
            { label: "Hash", value: "hash" },
          ],
        },
        {
          field: { fieldsToScrub: true },
          title: "Fields to Scrub",
          stepId: "scrub-settings",
          description:
            "Which parts of the span to scrub: span name, attribute values, event attribute values, or all.",
          fieldType: FormFieldSchemaType.Dropdown,
          required: true,
          dropdownOptions: [
            { label: "All (Name, Attributes & Events)", value: "all" },
            { label: "Span Name Only", value: "name" },
            { label: "Attributes Only", value: "attributes" },
            { label: "Event Attributes Only", value: "events" },
          ],
        },
        {
          field: { isEnabled: true },
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
          field: { name: true },
          type: FieldType.Text,
          title: "Name",
        },
        {
          field: { patternType: true },
          type: FieldType.Text,
          title: "Pattern Type",
        },
        {
          field: { scrubAction: true },
          type: FieldType.Text,
          title: "Scrub Action",
        },
        {
          field: { isEnabled: true },
          type: FieldType.Boolean,
          title: "Enabled",
        },
      ]}
      columns={[
        {
          field: { name: true, description: true },
          title: "Name",
          type: FieldType.Element,
          getElement: (item: TraceScrubRule): ReactElement => {
            return (
              <div>
                <div className="font-medium text-gray-900">
                  {item.name || "Untitled"}
                </div>
                {item.description && (
                  <div className="text-xs text-gray-500 mt-0.5">
                    {item.description}
                  </div>
                )}
              </div>
            );
          },
        },
        {
          field: { patternType: true },
          title: "Pattern Type",
          type: FieldType.Element,
          getElement: (item: TraceScrubRule): ReactElement => {
            const key: string = (item.patternType as string) || "unknown";
            const config: PillConfig = patternTypeConfig[key] || {
              label: key,
              color: Blue500,
              icon: IconProp.ShieldCheck,
              tooltip: key,
            };
            return (
              <Pill
                text={config.label}
                color={config.color}
                icon={config.icon}
                tooltip={config.tooltip}
              />
            );
          },
        },
        {
          field: { scrubAction: true },
          title: "Scrub Action",
          type: FieldType.Element,
          getElement: (item: TraceScrubRule): ReactElement => {
            const key: string = (item.scrubAction as string) || "unknown";
            const config: PillConfig = scrubActionConfig[key] || {
              label: key,
              color: Blue500,
              icon: IconProp.ShieldCheck,
              tooltip: key,
            };
            return (
              <Pill
                text={config.label}
                color={config.color}
                icon={config.icon}
                tooltip={config.tooltip}
              />
            );
          },
        },
        {
          field: { fieldsToScrub: true },
          title: "Fields",
          type: FieldType.Element,
          getElement: (item: TraceScrubRule): ReactElement => {
            const key: string = (item.fieldsToScrub as string) || "unknown";
            const config: PillConfig = fieldsToScrubConfig[key] || {
              label: key,
              color: Blue500,
              icon: IconProp.ShieldCheck,
              tooltip: key,
            };
            return (
              <Pill
                text={config.label}
                color={config.color}
                icon={config.icon}
                tooltip={config.tooltip}
              />
            );
          },
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          type: FieldType.Boolean,
        },
      ]}
    />
  );
};

export default TraceScrubRules;
