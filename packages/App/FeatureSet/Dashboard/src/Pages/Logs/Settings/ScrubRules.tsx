import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
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
import { LOG_SCRUB_PATTERN_TYPES } from "Common/Types/Telemetry/ScrubRule";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { getLogScrubRuleFormFields } from "../../../Components/Telemetry/ScrubRuleForm";
import ScrubRulePatternPill from "../../../Components/Telemetry/ScrubRulePatternPill";

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
  sensitiveKeys: {
    label: "Sensitive Keys",
    color: Purple500,
    icon: IconProp.Lock,
    tooltip:
      "Scrubs the whole value of attributes whose key looks sensitive (password, token, apiKey, authorization, cookie, ...) — regardless of what the value looks like",
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
| **Sensitive Attribute Keys** | The whole value of any attribute whose key looks sensitive (password, token, apiKey, authorization, cookie, ...) | \`password: "hunter2"\` → \`password: "[REDACTED]"\` |
| **Custom Regex** | Your own pattern | Any regex you define |

A **Custom Regex** rule needs its pattern: a regular expression for the text to scrub, written without slashes or flags (\`\\bSECRET-[A-Z0-9]+\\b\`, not \`/secret/i\`). Matching is case-sensitive. A pattern that is empty, does not compile, or matches empty text is refused when you save, because the rule would scrub nothing. A rule saved before that check without a usable pattern is marked **Scrubs nothing** in the table: edit it to give it one.

A new rule is named after its pattern type ("Scrub email addresses") until you type a name of your own.

---

### Scrub Actions Explained

| Action | Behavior | Example |
|--------|----------|---------|
| **Redact** | Replaces the entire match with \`[REDACTED]\` | \`user@example.com\` → \`[REDACTED]\` |
| **Mask** | Partially hides the value, preserving structure | \`user@example.com\` → \`u***@***.com\` |
| **Hash** | Replaces with a deterministic SHA-256 hash | \`user@example.com\` → \`a1b2c3d4...\` |

A new rule redacts, unless you pick another action under **Advanced**.

> **Tip:** Use **Hash** when you need to correlate occurrences of the same value across logs without exposing the actual data. The same input always produces the same hash.

---

### Fields to Scrub

Each log entry has two parts that can contain sensitive data:

- **Body**: The main log message text
- **Attributes**: Key-value metadata attached to the log (e.g. \`user.email\`, \`client.ip\`)

A new rule scrubs both; you can choose the body only or attributes only under **Advanced**. A **Sensitive Attribute Keys** rule always scrubs attribute values, since it matches attribute keys.

---

### Rule Ordering

Rules are evaluated in the order shown in the table. Drag and drop to reorder. Earlier rules are applied first, so place more specific rules before broader ones.
`;

const LogScrubRules: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();

  /*
   * One page that starts from what the rule scrubs: the pattern type, its
   * regex for Custom Regex, a name that follows the type, and the rest
   * folded under Advanced at the server's defaults
   * (Components/Telemetry/ScrubRuleForm, shared with Traces).
   */
  const formFields: Array<ModelField<LogScrubRule>> = useMemo((): Array<
    ModelField<LogScrubRule>
  > => {
    return getLogScrubRuleFormFields();
  }, []);

  return (
    <ModelTable<LogScrubRule>
      modelType={LogScrubRule}
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      id="log-scrub-rules-table"
      name="Logs > Settings > Scrub Rules"
      userPreferencesKey="log-scrub-rules-table"
      saveFilterProps={{
        tableId: "log-scrub-rules-table",
      }}
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
      formFields={formFields}
      /*
       * The pattern itself, so a custom rule ingest cannot use is flagged
       * in its row (ScrubRulePatternPill).
       */
      selectMoreFields={{
        customRegex: true,
      }}
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
                  {item.name || translator.translateText("Untitled")}
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
            return (
              <ScrubRulePatternPill
                patternType={item.patternType}
                customRegex={item.customRegex}
                patternTypes={patternTypeConfig}
                knownPatternTypes={LOG_SCRUB_PATTERN_TYPES}
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
  );
};

export default LogScrubRules;
