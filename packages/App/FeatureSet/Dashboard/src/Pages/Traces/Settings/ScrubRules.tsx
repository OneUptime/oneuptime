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
import ScrubRuleReadersPreview, {
  ScrubRuleReadersPreviewRule,
} from "../../../Components/Telemetry/FieldReaders/ScrubRuleReadersPreview";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import NamedSentence from "Common/UI/Components/DeleteConfirmation/NamedSentence";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { RowActionConfirmation } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { translatableTerm } from "Common/Types/Translator";

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
A scrub rule finds sensitive data, such as email addresses, card numbers or tokens, in your spans as they arrive, and removes it before the spans are stored. It never reaches your trace storage.

## How It Works

- Scrub rules run after drop filters and before pipelines.
- Rules run in the order of the table: drag a rule to change its place. Put narrow rules before broad ones.
- A rule changes the spans that arrive after you save it, within about a minute. Spans already stored stay as they are.
- A new rule is named after what it finds ("Scrub email addresses") until you type a name of your own.

## What a Rule Finds

Email addresses, card numbers, US Social Security numbers, phone numbers, IP addresses, **Sensitive Attribute Keys** (the whole value of every attribute whose key looks sensitive, such as a password or a token), or your own **Custom Regex**.

A **Custom Regex** is written without slashes or flags (\`\\bSECRET-[A-Z0-9]+\\b\`, not \`/secret/i\`), and matches case-sensitively. A pattern that is empty, does not compile, or matches empty text is refused when you save, since it would scrub nothing. A rule saved before that check without a usable pattern shows **Scrubs nothing** in the table: edit it to give it one.

## What It Does with What It Finds

- **Redact**: replaces it with \`[REDACTED]\`. A new rule does this.
- **Mask**: hides part of it, keeping its shape.
- **Hash**: replaces it with its SHA-256 hash, the same for the same value, so you can follow it across spans without showing it.

## Where It Looks

| Fields | What is scrubbed |
|--------|------------------|
| **All** | The span's name, its attributes and its events' attributes. A new rule does this. |
| **Span Name** | Only the span's name |
| **Attributes** | Only the span's attribute values |
| **Events** | Only its events' attribute values |

A **Sensitive Attribute Keys** rule always scrubs attribute and event attribute values, since it matches their keys. The action and the fields are under **More fields** in the form.

## Whose Spans

A new rule scrubs the spans of every service. Under **More fields**, pick one service in **Only for one service**: the rule scrubs that service's spans, and other services' spans stay as they are. The **Scope** column says which a rule does. A rule Data Security's **Scrub It** makes is for the service the data was found in.

## What It Changes for Others

Before you save a rule, or turn one on, the form lists what reads the values it would hide: monitors, dashboards, saved views, recording rules and SLOs, and what Security Events would lose. From then on they read what the rule leaves: a monitor that filters on a hidden value stops matching it, and a chart grouped by it no longer shows the real values. The rule is saved either way; the list is there so you decide knowing.
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
    /*
     * Under the rule's name, what reads the values it would hide, from the
     * form's values as they are (#10433).
     */
    return getTraceScrubRuleFormFields(
      (values: FormValues<LogScrubRule>): ReactElement => {
        return (
          <ScrubRuleReadersPreview
            signal="trace"
            rule={values as unknown as ScrubRuleReadersPreviewRule}
            dataTestId="scrub-rule-form-readers"
          />
        );
      },
    );
  }, []);

  return (
    <ModelTable<TraceScrubRule>
      modelType={TraceScrubRule}
      // Enable or Disable in each row's ⋯ menu: the one that changes the row.
      rowSwitch={{
        column: "isEnabled",
        /*
         * Turning a rule on says what reads the values it would hide, as
         * the form does before a rule is saved (#10433). Turning one off
         * hides nothing more, and asks nothing.
         */
        getRowConfirmation: (data: {
          value: boolean;
          item: TraceScrubRule;
          name: string;
        }): RowActionConfirmation | undefined => {
          if (!data.value) {
            return undefined;
          }

          return {
            title: translator.translateTemplate("Enable {{itemName}}", {
              itemName: translatableTerm(
                new TraceScrubRule().singularName || "",
              ),
            }),
            description: (
              <NamedSentence
                template="Are you sure you want to enable {{name}}?"
                name={data.name}
                dataTestId="row-switch-name"
              />
            ),
            details: (
              <ScrubRuleReadersPreview
                signal="trace"
                rule={data.item}
                dataTestId="scrub-rule-enable-readers"
              />
            ),
            submitButtonText: "Enable",
            submitButtonType: ButtonStyleType.PRIMARY,
          };
        },
      }}
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
        description: "Remove sensitive data from spans before they are stored.",
        markdown: documentationMarkdown,
      }}
      noItemsMessage={"No scrub rules yet."}
      formFields={formFields}
      /*
       * The pattern itself, so a rule that scrubs nothing - a custom one
       * ingest cannot use - is flagged in its row (ScrubRulePatternPill).
       */
      selectMoreFields={{
        customRegex: true,
        /*
         * The whole rule, whichever columns are shown: what Enable asks
         * about is what the rule would hide, and where (#10433).
         */
        patternType: true,
        scrubAction: true,
        fieldsToScrub: true,
        serviceId: true,
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
        /*
         * Whose spans the rule scrubs (#10433): one service's, or every
         * service's, as the metric pipeline rules say it.
         */
        {
          field: { service: { name: true } },
          title: "Scope",
          type: FieldType.Element,
          getElement: (item: TraceScrubRule): ReactElement => {
            if (item.service?.name) {
              return (
                <span className="inline-flex items-center text-sm font-medium text-gray-900">
                  <span className="text-gray-500 me-1">
                    {translator.translateText("Service:")}
                  </span>
                  {item.service.name}
                </span>
              );
            }

            return (
              <span className="text-sm text-gray-500">
                {translator.translateText("Project-wide")}
              </span>
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
