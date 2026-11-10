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
### How Naming Rules Work

Naming rules name your network devices by your naming convention. A rule says **which devices** (its match criteria) and **what they are called** (its name pattern). Rules are tried from the top of the list: the first enabled rule that matches a device, and has every value its name pattern needs, names it. Drag the rows to reorder them.

Rules name a device when discovery imports it — from **Review Results**, from **Discovered Devices**, and through **Auto Import Rules**. The import dialog shows the name each device will get before you import. The name discovery found is kept on the device as its **Discovered Name**, and a later scan never renames a device a rule named.

### Name Patterns

A pattern is text, with the parts that differ from device to device in curly braces:

| Placeholder | Is replaced by | Example |
| --- | --- | --- |
| \`{site.code}\` | The code of the device's site (set it on the site's settings) | \`1216\` |
| \`{site}\` | The name of the device's site | \`Unit 1216\` |
| \`{discoveredName}\` | The name discovery found: SNMP or NetBIOS name, DNS name, or address | \`dmb-5\` |
| \`{ip}\` | The whole IP address | \`10.48.145.51\` |
| \`{ip.1}\` … \`{ip.4}\` | One part of the IP address | \`51\` |
| \`{mac}\` | The MAC address, 12 digits and letters | \`00050BB07FFC\` |
| \`{vendor}\` | Who made the device | \`SICOM Systems\` |
| \`{lookup}\` | The value of the rule's lookup table for the device | \`MNUPLR01\` |
| \`{n}\`, \`{nn}\`, \`{nnn}\` | The lowest number that makes the name unique: 1, 01, 001 | \`01\` |

A placeholder can be followed by filters: \`{vendor|first:3|upper}\` is \`SIC\`. The filters are \`upper\`, \`lower\`, \`first:N\`, \`last:N\`, \`digits\` (only the digits: \`{site|digits}\` is \`1216\` for "Unit 1216") and \`nospaces\`.

A device that lacks a value its pattern needs — a site without a code, no MAC address, no row in the lookup table — is not named by the rule, and the next rule is tried. Names are unique in a project: a pattern without a number whose name another device already has leaves the device under its discovered name, and the preview says so.

### Lookup Tables

Some conventions are a table rather than a formula: in every unit's subnet, the device at **.51** is the menu player **MNUPLR01** and the one at **.151** the left screen **MNUSCR01**. Open **Lookup table** in the rule's Name step, choose what the table is keyed by — the last part of the IP address, the IP address, the MAC address or the discovered name — and type the rows, paste them from a spreadsheet, or import a CSV file. Then put \`{lookup}\` in the pattern: \`UN{site.code}{lookup}\` names all the devices of every unit with one rule. **Export CSV** saves the table back as a file.

### Devices You Already Have

**Apply to existing devices** checks every device against the rules and lists the ones that do not follow them, with the name each would get. Devices named by discovery or by a rule are ticked; devices whose names someone typed are listed unticked. Devices a rule cannot name yet are listed with the reason. Nothing is renamed until you confirm, and you can do the same for a selection with **Apply Naming Rules** on the Devices list.
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
            getElement: (item: NetworkDeviceNamingRule): ReactElement => {
              return (
                <div className="min-w-0">
                  <span className="block text-sm font-medium text-gray-900">
                    {item.name}
                  </span>
                  {item.description && (
                    <span className="mt-0.5 block truncate text-xs text-gray-500">
                      {item.description}
                    </span>
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
                  {example || "—"}
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
