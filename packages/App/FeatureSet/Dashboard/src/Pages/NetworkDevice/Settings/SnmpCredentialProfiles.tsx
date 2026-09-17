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
### What an SNMP Credential Profile Is

A profile is one named set of SNMP credentials — a v1/v2c community string, or a v3 user with its security level, protocols and keys — that many devices share. Attach it to a device, or to a site so every device in that site picks it up, and the devices are walked over SNMP with those credentials on their next poll. Nothing is copied onto the device: rotating a community string is one edit here, not one per device.

### How a device's credentials are resolved

When a probe polls a device it looks for a usable credential set in this order and stops at the first hit:

1. **The device's own credentials**, typed on the device itself.
2. **The device's profile** (Network > Devices > a device > Settings).
3. **The site's profile** (Network > Sites > a site > Settings), inherited by every device in that site.

With none of the three the device is **pinged only**: it still has an up/down status, still sits on the map and in its site, but has no interfaces, inventory or health OIDs until credentials appear somewhere in that chain. "Usable" means a v1/v2c profile with a non-empty community string, or a v3 profile with a non-empty username — an empty profile is skipped, not used.

### Secrets

The community string and the v3 authentication and privacy keys are encrypted at rest, and only roles that may read a device's own credentials may read them here. A device or site listing that shows its profile shows the profile's name and version, never its secrets.

### Deleting a profile

A profile that any device or site still points at **cannot be deleted**; the delete is refused with a count of what is in the way. Move those devices and sites to another profile, or clear the profile on them, and then delete it. This is deliberate: silently dropping a profile out from under its devices would turn every one of them into a ping-only device on its next poll with nothing anywhere to say why.
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
            "Reusable SNMP credential sets. A device is walked with the first usable set it finds — its own credentials, then the profile on the device, then the profile on its site — and is pinged only when it has none. A profile that devices or sites still use cannot be deleted.",
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
              "What this credential set is for — usually where it is deployed or which platform it opens. Names are unique in the project.",
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
              "Required for SNMP V1 and V2c; not used for V3. Used for every device that picks this profile, on the device or through its site.",
            stepId: "credentials",
          }),
        ]}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default NetworkSnmpCredentialProfilesPage;
