import NetworkDeviceNamingRule from "Common/Models/DatabaseModels/NetworkDeviceNamingRule";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import {
  NamingLookupEntry,
  NamingLookupKey,
  isNamingLookupKey,
} from "Common/Types/NetworkDevice/DeviceNaming";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import type { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import {
  getGlobalTranslator,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import {
  NamePatternProblem,
  NamePlaceholder,
  ParsedNamePattern,
  getNamePatternProblem,
  parseNamePattern,
} from "Common/Utils/NetworkDevice/Naming/NamePattern";
import {
  NAMING_LOOKUP_KEY_TITLES,
  NAMING_LOOKUP_PROBLEMS,
  NamingLookupProblem,
  validateNamingLookupEntries,
} from "Common/Utils/NetworkDevice/Naming/NamingLookup";
import React, { ReactElement } from "react";
import NamePatternInput from "./NamePatternInput";
import NamingLookupTableEditor, {
  getExampleLookupValue,
  readLookupRows,
} from "./NamingLookupTableEditor";

/*
 * THE NAMING RULE FORM'S FIELDS (Network > Rules > Naming Rules, issue
 * #6619), in the three steps a rule is written in:
 *
 *   Basic Info      what the rule is called, and whether it is on.
 *   Match Criteria  which devices: the rule builder every network rule uses,
 *                   on the address, discovered name, MAC, vendor and site.
 *   Name            what they are called: the name pattern, with a button
 *                   per placeholder and the example device named as it is
 *                   typed; and, folded under it, the lookup table for a
 *                   convention kept as a table - most rules need none.
 *
 * Every check the server makes of a rule (NetworkDeviceNamingRuleService)
 * is made here too, as the form is filled in, in the reader's language.
 */

// The lookup table's key choices, in the order the dropdown offers them.
export function getLookupKeyOptions(): Array<DropdownOption> {
  return [
    NamingLookupKey.LastIpOctet,
    NamingLookupKey.IpAddress,
    NamingLookupKey.MacAddress,
    NamingLookupKey.DiscoveredName,
  ].map((key: NamingLookupKey): DropdownOption => {
    return { value: key, label: NAMING_LOOKUP_KEY_TITLES[key] };
  });
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function translate(problem: {
  template: string;
  values: Record<string, string>;
}): string {
  const translator: Translator = getGlobalTranslator();
  return translator.translateTemplate(problem.template, problem.values);
}

// What is wrong with the form's name pattern, in the reader's language.
export function getNamePatternFieldError(
  values: FormValues<NetworkDeviceNamingRule>,
): string | null {
  const pattern: string = readText(
    (values as Record<string, unknown>)["namePattern"],
  );

  if (!pattern.trim()) {
    return null;
  }

  const problem: NamePatternProblem | null = getNamePatternProblem(pattern);

  return problem ? translate(problem) : null;
}

/*
 * What is wrong with the form's lookup table: a row that is not a row of
 * its kind, a key twice - or a table the pattern never reads, or a pattern
 * that reads an empty one.
 */
export function getLookupTableFieldError(
  values: FormValues<NetworkDeviceNamingRule>,
): string | null {
  const record: Record<string, unknown> = values as Record<string, unknown>;
  const rows: Array<NamingLookupEntry> = readLookupRows(
    record["lookupEntries"],
  ).filter((row: NamingLookupEntry): boolean => {
    return Boolean(row.key.trim() || row.value.trim());
  });
  const validated:
    | { entries: Array<NamingLookupEntry> }
    | { problem: NamingLookupProblem } = validateNamingLookupEntries({
    kind: isNamingLookupKey(record["lookupKey"])
      ? record["lookupKey"]
      : NamingLookupKey.LastIpOctet,
    entries: rows,
  });

  if ("problem" in validated) {
    return translate(validated.problem);
  }

  const read: { pattern: ParsedNamePattern } | { problem: NamePatternProblem } =
    parseNamePattern(readText(record["namePattern"]));

  if ("problem" in read) {
    // The pattern's own field says what is wrong with it.
    return null;
  }

  const usesLookup: boolean = read.pattern.placeholders.includes(
    NamePlaceholder.Lookup,
  );

  if (usesLookup && validated.entries.length === 0) {
    return translate({
      template: NAMING_LOOKUP_PROBLEMS.emptyTable,
      values: {},
    });
  }

  if (!usesLookup && validated.entries.length > 0) {
    return translate({
      template: NAMING_LOOKUP_PROBLEMS.unusedTable,
      values: {},
    });
  }

  return null;
}

const LOOKUP_SECTION: {
  id: string;
  title: string;
  description: string;
} = {
  id: "naming-rule-lookup-table",
  title: translationKey("Lookup table"),
  description: translationKey(
    "For a convention kept as a table: map each device to a value of your own, such as the last part of its IP address to its device code (51 is MNUPLR01). Put {lookup} in the name pattern where the value goes. A device with no row in the table is left to the next rule.",
  ),
};

/*
 * The fields, by the steps the page lists (basic-info, match-criteria and
 * name). The default export, so the rule form contract test
 * (StaticRuleCriteriaRuntimeCoverage) reads the match fields from here.
 */
export default function getNamingRuleFormFields(): Array<
  ModelField<NetworkDeviceNamingRule>
> {
  return [
    {
      field: { name: true },
      title: "Name",
      stepId: "basic-info",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "Menu boards",
      validation: { minLength: 2 },
    },
    {
      field: { description: true },
      title: "Description",
      stepId: "basic-info",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder:
        "Menu players and screens of every unit, by their place in the unit's subnet.",
    },
    {
      field: { isEnabled: true },
      title: "Enabled",
      stepId: "basic-info",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      description: "A disabled rule names nothing, and the next rule is tried.",
      // A rule starts on: the switch is on its edit form only.
      doNotShowWhenCreating: true,
    },
    {
      field: { ipMatchTarget: true },
      title: "IP Address",
      stepId: "match-criteria",
      sectionTitle: "Match by Address",
      sectionDescription:
        "Leave every condition empty to name every device. A device must match each one you fill in.",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      placeholder: "10.0.0.0/8 or 10.*.*.150-159",
      description:
        "A subnet (10.48.145.0/24) or octet ranges, where * is any number (10.*.*.51).",
    },
    {
      field: { discoveredNamePattern: true },
      title: "Discovered Name",
      stepId: "match-criteria",
      sectionTitle: "Match by Identity",
      sectionDescription:
        "A regex or * pattern, such as dmb-*, matched without case.",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      placeholder: "dmb-* or *KDS*",
      description:
        "The name discovery found: its SNMP or NetBIOS name, its DNS name, or its address.",
    },
    {
      field: { macAddressPattern: true },
      title: "MAC Address",
      stepId: "match-criteria",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      placeholder: "00:05:0b*",
      description:
        "In any spelling: 00:05:0b*, 00-05-0B* and 00050b* match the same devices.",
    },
    {
      field: { vendorPattern: true },
      title: "Vendor",
      stepId: "match-criteria",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      placeholder: "Samsung* or *SICOM*",
      description: "Who made the device.",
    },
    {
      field: { sites: true },
      title: "Site",
      stepId: "match-criteria",
      sectionTitle: "Match by Site",
      sectionDescription:
        "A site includes every site below it, so a region's rule names the devices of all its stores.",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: NetworkSite,
        labelField: "name",
        valueField: "_id",
      },
      required: false,
      placeholder: "Any site",
    },
    {
      field: { namePattern: true },
      title: "Name Pattern",
      stepId: "name",
      fieldType: FormFieldSchemaType.CustomComponent,
      required: true,
      description:
        "Text, with the parts that differ from device to device in braces. Add a number, {nn}, when several devices share a pattern.",
      customValidation: (
        values: FormValues<NetworkDeviceNamingRule>,
      ): string | null => {
        return getNamePatternFieldError(values);
      },
      getCustomElement: (
        values: FormValues<NetworkDeviceNamingRule>,
        props: CustomElementProps,
      ): ReactElement => {
        return (
          <NamePatternInput
            value={readText((values as Record<string, unknown>)["namePattern"])}
            exampleLookupValue={getExampleLookupValue(values)}
            error={props.error}
            ariaLabelledby={props.ariaLabelledby}
            ariaDescribedby={props.ariaDescribedby}
            tabIndex={props.tabIndex}
            onBlur={props.onBlur}
            onChange={(value: string): void => {
              props.onChange?.(value);
            }}
          />
        );
      },
    },
    {
      field: { lookupKey: true },
      title: "Look Up By",
      stepId: "name",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: getLookupKeyOptions(),
      required: false,
      placeholder: "Last part of the IP address",
      description: "What each row of the table is keyed by.",
      collapsibleSection: {
        ...LOOKUP_SECTION,
        isConfigured: (
          values: FormValues<NetworkDeviceNamingRule>,
        ): boolean => {
          return (
            readLookupRows((values as Record<string, unknown>)["lookupEntries"])
              .length > 0
          );
        },
      },
    },
    {
      field: { lookupEntries: true },
      title: "Rows",
      stepId: "name",
      fieldType: FormFieldSchemaType.CustomComponent,
      required: false,
      customValidation: (
        values: FormValues<NetworkDeviceNamingRule>,
      ): string | null => {
        return getLookupTableFieldError(values);
      },
      collapsibleSection: {
        ...LOOKUP_SECTION,
        isConfigured: (
          values: FormValues<NetworkDeviceNamingRule>,
        ): boolean => {
          return (
            readLookupRows((values as Record<string, unknown>)["lookupEntries"])
              .length > 0
          );
        },
      },
      getCustomElement: (
        values: FormValues<NetworkDeviceNamingRule>,
        props: CustomElementProps,
      ): ReactElement => {
        const record: Record<string, unknown> = values as Record<
          string,
          unknown
        >;

        return (
          <NamingLookupTableEditor
            kind={
              isNamingLookupKey(record["lookupKey"])
                ? record["lookupKey"]
                : undefined
            }
            entries={readLookupRows(record["lookupEntries"])}
            error={props.error}
            ariaLabelledby={props.ariaLabelledby}
            onChange={(entries: Array<NamingLookupEntry>): void => {
              props.onChange?.(entries);
            }}
          />
        );
      },
    },
  ];
}
