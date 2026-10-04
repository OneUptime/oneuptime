import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
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
import {
  TRACE_SCRUB_FIELDS,
  TRACE_SCRUB_PATTERN_TYPES,
} from "Common/Types/Telemetry/ScrubRule";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { getTraceScrubRuleFormFields } from "../../../Components/Telemetry/ScrubRuleForm";
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
  sensitiveKeys: {
    label: "Sensitive Keys",
    color: Purple500,
    icon: IconProp.Lock,
    tooltip:
      "Scrubs the whole value of span/event attributes whose key looks sensitive (password, token, apiKey, authorization, cookie, ...) — regardless of what the value looks like",
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

Email, Credit Card, SSN, Phone Number, IP Address, Sensitive Attribute Keys (the whole value of every attribute whose key looks sensitive, such as a password or a token), or your own custom regex.

A **Custom Regex** rule needs its pattern: a regular expression for the text to scrub, written without slashes or flags (\`\\bSECRET-[A-Z0-9]+\\b\`, not \`/secret/i\`). Matching is case-sensitive. A pattern that is empty, does not compile, or matches empty text is refused when you save, because the rule would scrub nothing. A rule saved before that check without a usable pattern is marked **Scrubs nothing** in the table: edit it to give it one.

A new rule is named after its pattern type ("Scrub email addresses") until you type a name of your own.

### Scrub Actions

- **Redact** — replace with \`[REDACTED]\` (what a new rule does)
- **Mask** — partially hide value
- **Hash** — replace with deterministic SHA-256 hash

### Fields to Scrub

- **All** — span name, attributes, and event attributes (what a new rule scrubs)
- **Span Name** — only the span name
- **Attributes** — only span attribute values
- **Events** — only span event attribute values

A **Sensitive Attribute Keys** rule always scrubs attribute and event attribute values, since it matches attribute keys. The action and the fields are under **More fields** in the form.
`;

const TraceScrubRules: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();

  /*
   * One page that starts from what the rule scrubs: the pattern type, its
   * regex for Custom Regex, a name that follows the type, and the rest
   * folded under Advanced at the server's defaults
   * (Components/Telemetry/ScrubRuleForm, shared with Logs).
   */
  const formFields: Array<ModelField<TraceScrubRule>> = useMemo((): Array<
    ModelField<TraceScrubRule>
  > => {
    return getTraceScrubRuleFormFields();
  }, []);

  return (
    <ModelTable<TraceScrubRule>
      modelType={TraceScrubRule}
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      id="trace-scrub-rules-table"
      name="Traces > Settings > Scrub Rules"
      userPreferencesKey="trace-scrub-rules-table"
      saveFilterProps={{
        tableId: "trace-scrub-rules-table",
      }}
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
      formFields={formFields}
      /*
       * The pattern itself, so a rule that scrubs nothing - a custom one
       * ingest cannot use - is flagged in its row (ScrubRulePatternPill).
       */
      selectMoreFields={{
        customRegex: true,
      }}
      showRefreshButton={true}
      searchableFields={["name", "description"]}
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
          field: { patternType: true },
          title: "Pattern Type",
          type: FieldType.Element,
          getElement: (item: TraceScrubRule): ReactElement => {
            return (
              <ScrubRulePatternPill
                patternType={item.patternType}
                customRegex={item.customRegex}
                fieldsToScrub={item.fieldsToScrub}
                patternTypes={patternTypeConfig}
                knownPatternTypes={TRACE_SCRUB_PATTERN_TYPES}
                knownFieldsToScrub={TRACE_SCRUB_FIELDS}
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
