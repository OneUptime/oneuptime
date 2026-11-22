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
import {
  LOG_SCRUB_FIELDS,
  LOG_SCRUB_PATTERN_TYPES,
} from "Common/Types/Telemetry/ScrubRule";
import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  doesFormRuleHideAddresses,
  LOG_SCRUB_RULE_FORM_OPTIONS,
  getLogScrubRuleFormFields,
} from "../../../Components/Telemetry/ScrubRuleForm";
import HashInsteadNotice, {
  HashInsteadFormNote,
} from "../../../Components/Telemetry/HashInstead/HashInsteadNotice";
import {
  ScrubRulesHidingAddressesState,
  useScrubRulesHidingAddresses,
} from "../../../Components/Telemetry/HashInstead/UseScrubRulesHidingAddresses";
import { ScrubRuleHidingAddresses } from "Common/Types/Telemetry/ScrubRuleAddresses";
import ScrubRulePatternPill from "../../../Components/Telemetry/ScrubRulePatternPill";
import ScrubRuleReadersPreview, {
  ScrubRuleReadersPreviewRule,
} from "../../../Components/Telemetry/FieldReaders/ScrubRuleReadersPreview";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
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
A scrub rule finds sensitive data, such as email addresses, card numbers or passwords, in your logs as they arrive, and removes it before the logs are stored. It never reaches your log storage.

## How It Works

- Scrub rules run after drop filters and before pipelines, on each log's body and attributes.
- Rules run in the order of the table: drag a rule to change its place. Put narrow rules before broad ones.
- A rule changes the logs that arrive after you save it, within about a minute. Logs already stored stay as they are.
- A new rule is named after what it finds ("Scrub email addresses") until you type a name of your own.

## What a Rule Finds

| Pattern | Finds | For example |
|---------|-------|-------------|
| **Email Address** | Email addresses | user@example.com |
| **Credit Card** | Card numbers | 4111-1111-1111-1111 |
| **SSN** | US Social Security numbers | 123-45-6789 |
| **Phone Number** | Phone numbers | +1 (555) 123-4567 |
| **IP Address** | IPv4 addresses | 192.168.1.1 |
| **Sensitive Attribute Keys** | The whole value of every attribute whose key looks sensitive: password, token, apiKey, authorization, cookie and more | \`password: "hunter2"\` → \`password: "[REDACTED]"\` |
| **Custom Regex** | Your own pattern | Anything your regular expression matches |

A **Custom Regex** is written without slashes or flags (\`\\bSECRET-[A-Z0-9]+\\b\`, not \`/secret/i\`), and matches case-sensitively. A pattern that is empty, does not compile, or matches empty text is refused when you save, since it would scrub nothing. A rule saved before that check without a usable pattern shows **Scrubs nothing** in the table: edit it to give it one.

## What It Does with What It Finds

| Action | What it does | For example |
|--------|--------------|-------------|
| **Redact** | Replaces it with \`[REDACTED]\`. A new rule does this. | \`user@example.com\` → \`[REDACTED]\` |
| **Mask** | Hides part of it, keeping its shape | \`user@example.com\` → \`u***@***.com\` |
| **Hash** | Replaces it with its SHA-256 hash | \`user@example.com\` → \`a1b2c3d4...\` |

The action is under **More fields**.

> **Tip:** Use **Hash** to follow one value across logs without showing it: the same value always gives the same hash.

## Where It Looks

A new rule scrubs both the log's **Body**, its message, and its **Attributes**, such as \`user.email\` or \`client.ip\`. Under **More fields**, pick the body only or the attributes only. A **Sensitive Attribute Keys** rule always scrubs attributes, since it matches their keys.

## Whose Logs

A new rule scrubs the logs of every service. Under **More fields**, pick one service in **Only for one service**: the rule scrubs that service's logs, and other services' logs stay as they are. The **Scope** column says which a rule does. A rule Data Security's **Scrub It** makes is for the service the data was found in; one made for a session replay scrubs every service's logs and every app's replays.

## What It Changes for Others

Before you save a rule, or turn one on, the form lists what reads the values it would hide: monitors, dashboards, saved views, recording rules and SLOs, and what Security Events would lose. From then on they read what the rule leaves: a monitor that filters on a hidden value stops matching it, and a chart grouped by it no longer shows the real values. The rule is saved either way; the list is there so you decide knowing.
`;

const LogScrubRules: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  /*
   * The IP Address rules that keep Security Events from naming an
   * attacker's address: each says so on its row, with Hash Instead, and the
   * form says so under its actions (#10396).
   */
  const addressRules: ScrubRulesHidingAddressesState =
    useScrubRulesHidingAddresses();
  const [refreshToggle, setRefreshToggle] = useState<string>("");

  const hidingRuleOf: (
    item: LogScrubRule,
  ) => ScrubRuleHidingAddresses | undefined = (
    item: LogScrubRule,
  ): ScrubRuleHidingAddresses | undefined => {
    const id: string = (item._id?.toString() || "").toLowerCase();

    return addressRules.rules.find(
      (rule: ScrubRuleHidingAddresses): boolean => {
        return rule.signal === "log" && rule.ruleId === id;
      },
    );
  };

  /*
   * One page that starts from what the rule scrubs: the pattern type, its
   * regex for Custom Regex, a name that follows the type, and the rest
   * folded under Advanced at the server's defaults
   * (Components/Telemetry/ScrubRuleForm, shared with Traces).
   */
  const formFields: Array<ModelField<LogScrubRule>> = useMemo((): Array<
    ModelField<LogScrubRule>
  > => {
    /*
     * Under the rule's name, what reads the values it would hide, from the
     * form's values as they are (#10433).
     */
    return getLogScrubRuleFormFields(
      (values: FormValues<LogScrubRule>): ReactElement => {
        return (
          <ScrubRuleReadersPreview
            signal="log"
            rule={values as unknown as ScrubRuleReadersPreviewRule}
            dataTestId="scrub-rule-form-readers"
          />
        );
      },
      (values: FormValues<LogScrubRule>): ReactElement | undefined => {
        return doesFormRuleHideAddresses({
          options: LOG_SCRUB_RULE_FORM_OPTIONS,
          values,
          signalsRead: addressRules.signalsRead,
        }) ? (
          <HashInsteadFormNote dataTestId="scrub-rule-form-address-note" />
        ) : undefined;
      },
    );
  }, [addressRules.signalsRead]);

  return (
    <ModelTable<LogScrubRule>
      modelType={LogScrubRule}
      refreshToggle={refreshToggle}
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
          item: LogScrubRule;
          name: string;
        }): RowActionConfirmation | undefined => {
          if (!data.value) {
            return undefined;
          }

          return {
            title: translator.translateTemplate("Enable {{itemName}}", {
              itemName: translatableTerm(new LogScrubRule().singularName || ""),
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
                signal="log"
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
        description: "Remove sensitive data from logs before they are stored.",
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
                {hidingRuleOf(item) ? (
                  <div className="mt-2">
                    <HashInsteadNotice
                      rule={hidingRuleOf(item)!}
                      onSwitched={() => {
                        addressRules.reload();
                        setRefreshToggle(Date.now().toString());
                      }}
                      dataTestId="scrub-rule-hash-instead"
                    />
                  </div>
                ) : (
                  <></>
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
                fieldsToScrub={item.fieldsToScrub}
                patternTypes={patternTypeConfig}
                knownPatternTypes={LOG_SCRUB_PATTERN_TYPES}
                knownFieldsToScrub={LOG_SCRUB_FIELDS}
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
        /*
         * Whose logs the rule scrubs (#10433): one service's, or every
         * service's, as the metric pipeline rules say it.
         */
        {
          field: { service: { name: true } },
          title: "Scope",
          type: FieldType.Element,
          getElement: (item: LogScrubRule): ReactElement => {
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
