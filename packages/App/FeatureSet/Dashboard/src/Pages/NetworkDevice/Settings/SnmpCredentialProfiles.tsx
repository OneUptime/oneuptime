import PageComponentProps from "../../PageComponentProps";
import { getSnmpConfigFormFields } from "../SnmpConfigFormFields";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import NetworkSnmpCredentialProfile from "Common/Models/DatabaseModels/NetworkSnmpCredentialProfile";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const snmpCredentialProfileDocumentation: string = `
An SNMP credential profile is one set of SNMP credentials, a v1 or v2c community string or a v3 user with its keys, that many devices share. Attach it to a device, or to a site for every device in it, and they are walked with it on their next poll. Rotating a community string is one edit here.

## Which Credentials a Device Uses

A probe uses the first of these that is usable:

1. **The device's own credentials**, typed on the device.
2. **The device's profile**, on its **Settings** (Network > Devices > a device).
3. **Its site's profile**, on the site's **Settings** (Network > Sites > a site), for every device in the site.

A v1 or v2c profile needs a community string, and a v3 profile a username, to be usable: an empty one is skipped. With none of the three, a device is **pinged only**: it has an up or down status and a place on the map and in its site, but no interfaces, inventory or health OIDs until credentials appear.

## Secrets

The community string and the v3 keys are encrypted, and only roles that may read a device's own credentials may read them here. A list of devices or sites shows a profile's name and version, never its secrets.

## Deleting a Profile

A profile a device or a site still uses cannot be deleted, and the refusal says how many use it. Move them to another profile, or clear it on them, first. Dropping it from under them would turn each into a ping-only device on its next poll, with nothing to say why.
`;

/*
 * Settings > Network > SNMP Credentials. A ModelTable over the project's
 * credential profiles, in the same shape as OID Collection Templates: the
 * rows are definitions other rows point at, so the page is deliberately a
 * plain list with a create/edit form and no per-row actions.
 *
 * The credential fields are the SAME fields the device create form, the
 * device Settings page and the discovery scan form render, from the shared
 * SnmpConfigFormFields module: a profile has to be able to hold anything a
 * device can, under the same labels, revealed by the same v3 rules. Only
 * the community-string caption differs, because here it applies to every
 * device that picks the profile rather than to one host.
 */
const NetworkSnmpCredentialProfilesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<NetworkSnmpCredentialProfile>
        modelType={NetworkSnmpCredentialProfile}
        id="network-snmp-credential-profiles-table"
        name="Settings > Network SNMP Credential Profiles"
        userPreferencesKey="network-snmp-credential-profiles-table"
        saveFilterProps={{
          tableId: "network-snmp-credential-profiles-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: "SNMP Credentials",
          description:
            "A device uses its own credentials, then the profile on the device, then the profile on its site. A profile in use cannot be deleted.",
        }}
        helpContent={{
          title: "How SNMP Credential Profiles Work",
          description:
            "Share one credential set across devices and sites, and how a device decides which credentials to use.",
          markdown: snmpCredentialProfileDocumentation,
        }}
        noItemsMessage="No SNMP credential profiles yet. Add one, then attach it to devices or to a site, and those devices are walked over SNMP on their next poll."
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        searchableFields={["name", "description"]}
        filters={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: { snmpVersion: true },
            title: "SNMP Version",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
            isNotCustomizable: true,
          },
          {
            field: { description: true },
            title: "Description",
            type: FieldType.Text,
            hideOnMobile: true,
          },
          {
            field: { snmpVersion: true },
            title: "SNMP Version",
            type: FieldType.Text,
          },
          {
            field: { snmpPort: true },
            title: "Port",
            type: FieldType.Number,
            hideOnMobile: true,
            noValueMessage: "161",
          },
          {
            field: { createdAt: true },
            title: "Created",
            type: FieldType.Date,
            hideOnMobile: true,
          },
        ]}
        formSteps={[
          { title: "Basic Info", id: "basic-info" },
          { title: "Credentials", id: "credentials" },
        ]}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Branch offices - v2c",
            validation: { minLength: 2 },
            description:
              "Usually where it is used or what it opens, such as Core switches.",
          },
          {
            field: { description: true },
            title: "Description",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "Read-only community configured on every branch office switch.",
          },
          /*
           * The shared SNMP fields, on their own step. The profile model
           * carries the same snmp* columns as the device, so the helper's
           * fields fit it without a cast; only the community-string caption
           * is this page's own.
           */
          ...getSnmpConfigFormFields({
            communityStringDescription:
              "Required for V1 and V2c, not used by V3.",
            stepId: "credentials",
          }),
        ]}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default NetworkSnmpCredentialProfilesPage;
