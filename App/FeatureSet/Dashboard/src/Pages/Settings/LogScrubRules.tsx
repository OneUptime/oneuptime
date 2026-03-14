import PageComponentProps from "../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
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
import React, { Fragment, FunctionComponent, ReactElement } from "react";

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
    tooltip: "Matches email addresses (e.g. user@example.com)",
  },
  creditCard: {
    label: "Credit Card",
    color: Orange500,
    icon: IconProp.CreditCard,
    tooltip: "Matches credit card numbers (e.g. 4111-1111-1111-1111)",
  },
  ssn: {
    label: "SSN",
    color: Purple500,
    icon: IconProp.ShieldExclamation,
    tooltip: "Matches US Social Security Numbers (e.g. 123-45-6789)",
  },
  phoneNumber: {
    label: "Phone Number",
    color: Teal500,
    icon: IconProp.Phone,
    tooltip: "Matches phone numbers (e.g. +1 555-123-4567)",
  },
  ipAddress: {
    label: "IP Address",
    color: Cyan500,
    icon: IconProp.Globe,
    tooltip: "Matches IPv4 addresses (e.g. 192.168.1.1)",
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
    tooltip: "Partially hide data (e.g. j***@***.com)",
  },
  hash: {
    label: "Hash",
    color: Purple500,
    icon: IconProp.Hashtag,
    tooltip: "Replace with a deterministic SHA-256 hash",
  },
};

const fieldsToScrubConfig: Record<string, PillConfig> = {
  both: {
    label: "Body & Attributes",
    color: Green500,
    icon: IconProp.ShieldCheck,
    tooltip: "Scrub both the log body (message) and attribute values",
  },
  body: {
    label: "Body Only",
    color: Blue500,
    icon: IconProp.File,
    tooltip: "Scrub only the log body (message text)",
  },
  attributes: {
    label: "Attributes Only",
    color: Cyan500,
    icon: IconProp.Settings,
    tooltip: "Scrub only log attribute values",
  },
};

const documentationMarkdown: string = `
### How Log Scrub Rules Work

Log scrub rules automatically detect and remove sensitive data (PII) from your logs **at ingest time** — before they are stored. This ensures sensitive information never reaches your log storage.

\`\`\`mermaid
flowchart TD
    A[Log Received] --> B{Match Against Scrub Rules}
    B -->|Pattern Matches| C[Apply Scrub Action]
    B -->|No Match| D[Store Log As-Is]
    C -->|Redact| E["Replace with [REDACTED]"]
    C -->|Mask| F["Partially hide e.g. j***@***.com"]
    C -->|Hash| G[Replace with deterministic hash]
    E --> H[Store Scrubbed Log]
    F --> H
    G --> H
\`\`\`

---

### Pattern Types

| Pattern | What It Detects | Example Match |
|---------|----------------|---------------|
| **Email Address** | Email addresses | user@example.com |
| **Credit Card** | Credit card numbers | 4111-1111-1111-1111 |
| **SSN** | US Social Security Numbers | 123-45-6789 |
| **Phone Number** | Phone numbers | +1 (555) 123-4567 |
| **IP Address** | IPv4 addresses | 192.168.1.1 |
| **Custom Regex** | Your own pattern | Any regex you define |

---

### Scrub Actions Explained

| Action | Behavior | Example |
|--------|----------|---------|
| **Redact** | Replaces the entire match with \`[REDACTED]\` | \`user@example.com\` → \`[REDACTED]\` |
| **Mask** | Partially hides the value, preserving structure | \`user@example.com\` → \`u***@***.com\` |
| **Hash** | Replaces with a deterministic SHA-256 hash | \`user@example.com\` → \`a1b2c3d4...\` |

> **Tip:** Use **Hash** when you need to correlate occurrences of the same value across logs without exposing the actual data. The same input always produces the same hash.

---

### Fields to Scrub

Each log entry has two parts that can contain sensitive data:

- **Body**: The main log message text
- **Attributes**: Key-value metadata attached to the log (e.g. \`user.email\`, \`client.ip\`)

You can choose to scrub the body only, attributes only, or both.

---

### Rule Ordering

Rules are evaluated in the order shown in the table. Drag and drop to reorder. Earlier rules are applied first, so place more specific rules before broader ones.
`;

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
        helpContent={{
          title: "How Log Scrub Rules Work",
          description:
            "Understanding pattern types, scrub actions, and how sensitive data is removed from logs at ingest time",
          markdown: documentationMarkdown,
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
            description: "A regular expression to match sensitive data.",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "e.g. \\bSECRET-[A-Z0-9]+\\b",
            showIf: (values: FormValues<LogScrubRule>): boolean => {
              return values.patternType === "custom";
            },
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
              description: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: LogScrubRule): ReactElement => {
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
            field: {
              patternType: true,
            },
            title: "Pattern Type",
            type: FieldType.Element,
            getElement: (item: LogScrubRule): ReactElement => {
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
            field: {
              scrubAction: true,
            },
            title: "Scrub Action",
            type: FieldType.Element,
            getElement: (item: LogScrubRule): ReactElement => {
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
            field: {
              fieldsToScrub: true,
            },
            title: "Fields",
            type: FieldType.Element,
            getElement: (item: LogScrubRule): ReactElement => {
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
