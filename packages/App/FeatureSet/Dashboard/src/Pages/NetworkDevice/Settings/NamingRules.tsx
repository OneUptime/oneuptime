import PageComponentProps from "../../PageComponentProps";
import ApplyNamingRulesModal from "../../../Components/NetworkDevice/Naming/ApplyNamingRulesModal";
import getNamingRuleFormFields from "../../../Components/NetworkDevice/Naming/NamingRuleFormFields";
import { getExampleLookupValue } from "../../../Components/NetworkDevice/Naming/NamingLookupTableEditor";
import NetworkDeviceNamingRule from "Common/Models/DatabaseModels/NetworkDeviceNamingRule";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Green, Red } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import { getExampleName } from "Common/Utils/NetworkDevice/Naming/NamePattern";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";
import IsolatedLine from "Common/UI/Components/IsolatedText/IsolatedLine";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";

/*
 * NAMING RULES (Network > Rules > Naming Rules, OneUptime issue #6619).
 *
 * The project's naming convention, as rules: which devices, and what they
 * are called. The list is in the order rules are tried - drag a row to
 * reorder - and each row shows its pattern and the name it gives the
 * example device. "Apply to existing devices" renames the devices already
 * in the project that do not follow the rules, after a preview.
 */

const namingRulesDocumentation: string = `
A naming rule names your network devices by your naming convention: which devices, by its match criteria, and what they are called, by its name pattern. A device is named as discovery imports it, and the import shows each name before you import.

## How Rules Name Devices

- Rules name a device when discovery imports it: from **Review Results**, from **Discovered Devices** and through **Auto Import Rules**.
- Rules are tried from the top of the list down, and the first enabled rule that matches a device, and has every value its pattern needs, names it. Drag a rule to change its place.
- The name discovery found is kept on the device as its **Discovered Name**, and a later scan never renames a device a rule named.

## Match Criteria

A rule names the devices that match its conditions. A rule with no conditions can name every device.

## What the Conditions Compare

- **IP Address**: the device's address. **Is in** takes a subnet (\`10.48.145.0/24\`) or octet ranges, where \`*\` is any number (\`10.*.*.51\`, \`10.*.*.154-159\`).
- **Discovered Name**: the name discovery found, from SNMP, NetBIOS or DNS, or the address. A pattern is a case-insensitive regular expression or a \`*\` wildcard.
- **MAC Address**: in any spelling: \`00:05:0b*\`, \`00-05-0B*\` and \`00050b*\` match the same devices.
- **Vendor**: who made the device, from its MAC address or its SNMP answer.
- **Site**: the device's site, and the sites under it, so one rule can cover a whole region.

## Name Patterns

A pattern is text, with the parts that change from device to device in curly braces:

| Placeholder | Is replaced by | For example |
| --- | --- | --- |
| \`{site.code}\` | The code of the device's site, set on the site's settings | \`1216\` |
| \`{site}\` | The name of the device's site | \`Unit 1216\` |
| \`{discoveredName}\` | The name discovery found | \`dmb-5\` |
| \`{ip}\` | The whole IP address | \`10.48.145.51\` |
| \`{ip.1}\` … \`{ip.4}\` | One part of the IP address | \`51\` |
| \`{mac}\` | The MAC address, 12 digits and letters | \`00050BB07FFC\` |
| \`{vendor}\` | Who made the device | \`SICOM Systems\` |
| \`{lookup}\` | The value of the rule's lookup table for the device | \`MNUPLR01\` |
| \`{n}\`, \`{nn}\`, \`{nnn}\` | The lowest number that makes the name unique: 1, 01, 001 | \`01\` |

Filters change a placeholder: \`{vendor|first:3|upper}\` is \`SIC\`. They are \`upper\`, \`lower\`, \`first:N\`, \`last:N\`, \`digits\` (only the digits: \`{site|digits}\` is \`1216\` for "Unit 1216") and \`nospaces\`.

A device without a value its pattern needs, such as a site with no code, no MAC address or no row in the lookup table, is left to the next rule. Names are unique in a project: when a pattern with no number gives a name another device has, the device keeps its discovered name, and the preview says so.

## Lookup Tables

Some conventions are a table rather than a formula: in every unit's subnet, the device at **.51** is the menu player **MNUPLR01** and the one at **.151** the left screen **MNUSCR01**. Open **Lookup table** in the rule's Name step, choose what it is keyed by (the last part of the IP address, the IP address, the MAC address or the discovered name), and type the rows, paste them from a spreadsheet, or import a CSV file. Then put \`{lookup}\` in the pattern: \`UN{site.code}{lookup}\` names every device of every unit with one rule. **Export CSV** saves the table back to a file.

## Devices You Already Have

**Apply to existing devices** lists the devices that do not follow the rules, with the name each would get. Devices named by discovery or by a rule are ticked; devices whose names someone typed are listed unticked; devices a rule cannot name yet are listed with the reason. Nothing is renamed until you confirm. **Apply Naming Rules** on the Devices list does the same for the devices you select.
`;

const NetworkDeviceNamingRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [isApplyOpen, setIsApplyOpen] = useState<boolean>(false);

  return (
    <Fragment>
      <ModelTable<NetworkDeviceNamingRule>
        modelType={NetworkDeviceNamingRule}
        // Enable or Disable in each row's ⋯ menu: the one that changes the row.
        rowSwitch={{ column: "isEnabled" }}
        id="network-device-naming-rules-table"
        name="Settings > Network Device Naming Rules"
        userPreferencesKey="network-device-naming-rules-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        showRefreshButton={true}
        createEditModalWidth={ModalWidth.Large}
        /*
         * Highest priority number first: the rule at the top is tried
         * first. Drag a rule to change its place; a new rule goes to the
         * end, below the others.
         */
        sortBy="priority"
        sortOrder={SortOrder.Descending}
        enableDragAndDrop={true}
        dragDropIndexField="priority"
        cardProps={{
          title: "Naming Rules",
          description:
            "Name devices by your naming convention as they are imported. The first rule from the top that matches a device names it: drag to reorder.",
          buttons: [
            {
              title: "Apply to existing devices",
              buttonStyle: ButtonStyleType.NORMAL,
              icon: IconProp.Play,
              onClick: (): void => {
                setIsApplyOpen(true);
              },
            },
          ],
        }}
        noItemsMessage="No naming rules yet. Add one to name discovered devices by your naming convention, such as UN{site.code}{lookup}."
        helpContent={{
          title: "How Naming Rules Work",
          description:
            "Name network devices by your naming convention, as they are imported and after.",
          markdown: namingRulesDocumentation,
        }}
        selectMoreFields={{
          isEnabled: true,
          lookupKey: true,
          lookupEntries: true,
        }}
        filters={[
          { field: { name: true }, title: "Name", type: FieldType.Text },
          {
            field: { namePattern: true },
            title: "Name Pattern",
            type: FieldType.Text,
          },
          {
            field: { isEnabled: true },
            title: "Enabled",
            type: FieldType.Boolean,
          },
        ]}
        columns={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Element,
            // A description under the name: each reads its own way.
            getLineText: drawsItsOwnLines,
            getElement: (item: NetworkDeviceNamingRule): ReactElement => {
              return (
                <div className="min-w-0">
                  <IsolatedLine
                    as="span"
                    text={item.name || ""}
                    className="block truncate text-sm font-medium text-gray-900"
                  />
                  {item.description && (
                    <IsolatedLine
                      as="span"
                      text={item.description}
                      className="mt-0.5 block truncate text-xs text-gray-500"
                    />
                  )}
                </div>
              );
            },
          },
          {
            field: { namePattern: true },
            title: "Name Pattern",
            type: FieldType.Element,
            getElement: (item: NetworkDeviceNamingRule): ReactElement => {
              return (
                <span
                  dir="ltr"
                  className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800"
                >
                  {item.namePattern}
                </span>
              );
            },
          },
          {
            field: { namePattern: true },
            title: "Example",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: NetworkDeviceNamingRule): ReactElement => {
              const example: string | null = getExampleName(
                item.namePattern,
                getExampleLookupValue(item),
              );

              return (
                <span dir="ltr" className="font-mono text-xs text-gray-600">
                  {example || <TableEmptyValue isSmall={true} />}
                </span>
              );
            },
          },
          {
            field: { isEnabled: true },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: NetworkDeviceNamingRule): ReactElement => {
              return item.isEnabled ? (
                <Pill color={Green} text="Enabled" />
              ) : (
                <Pill color={Red} text="Disabled" />
              );
            },
          },
        ]}
        /*
         * In the order a rule is written: what it is, which devices, what
         * they are called (Components/NetworkDevice/Naming/
         * NamingRuleFormFields).
         */
        formSteps={[
          { title: "Basic Info", id: "basic-info" },
          { title: "Match Criteria", id: "match-criteria" },
          { title: "Name", id: "name" },
        ]}
        formFields={getNamingRuleFormFields()}
      />

      {isApplyOpen && (
        <ApplyNamingRulesModal
          onClose={(): void => {
            setIsApplyOpen(false);
          }}
        />
      )}
    </Fragment>
  );
};

export default NetworkDeviceNamingRulesPage;
