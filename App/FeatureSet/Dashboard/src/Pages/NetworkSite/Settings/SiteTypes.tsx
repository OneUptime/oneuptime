import PageComponentProps from "../../PageComponentProps";
import { fetchParentNetworkSiteTypeOptions } from "../../../Components/NetworkSite/NetworkSiteFormDropdownOptions";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Gray500, Green } from "Common/Types/BrandColors";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import NetworkSiteType from "Common/Models/DatabaseModels/NetworkSiteType";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const networkSiteTypeDocumentation: string = `
### How Site Types Work

Site Types describe the levels of your network site hierarchy. Every network site is assigned one. The defaults — Account Type, Region, Franchisee, Market, Unit, Data Center, Other — are just a starting point: rename them, arrange them, delete the ones you don't use, or add your own to match how your organisation is actually structured.

### Parent Site Type

Choose the type directly above this one. For example, set Account Type as the parent of Region, Region as the parent of Franchisee, Franchisee as the parent of Market, and Market as the parent of Unit. Leave the parent empty for a top-level type. When you create a network site, this relationship determines which parent sites are valid.

To keep existing site trees valid, a type that is already in use can move only when its sites already match the new relationship. For a larger reorganisation, create the replacement type under the new parent, then move each site and assign the replacement type together.

### Unit Level

\`Is Unit Level\` marks the leaf level of your hierarchy — the type given to the actual physical locations, the ones that contain devices rather than more sites. **Normally exactly one type is the unit level.**

The flag is not cosmetic. It drives two things:

- **Network Map** — drilling into a site of a unit-level type opens that site's **device topology** instead of a map of child sites.
- **Health Rollup** — the unit counts shown on parent sites (\`12 of 14 units healthy\`) count only sites whose type is unit level.

Because types are renameable, nothing in OneUptime keys off the *name* "Unit" — it keys off this flag. If you rename "Unit" to "Store" or "Branch", keep the flag on it and everything keeps working.
`;

/*
 * Per-project configuration of the site hierarchy levels. This replaces what
 * used to be a hardcoded enum, which is why the isUnitLevel flag gets so much
 * explanatory copy here: it is the one field on this page that changes app
 * behaviour rather than just labelling.
 */
const NetworkSiteTypesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<NetworkSiteType>
        modelType={NetworkSiteType}
        id="network-site-types-table"
        name="Settings > Network Site Types"
        userPreferencesKey="network-site-types-table"
        saveFilterProps={{
          tableId: "network-site-types-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: "Site Types",
          description:
            "The levels of your site hierarchy — Region, Market, Unit and so on. Connect each type to the level directly above it.",
        }}
        helpContent={{
          title: "How Site Types Work",
          description:
            "Connect your hierarchy levels and pick which one is the unit level.",
          markdown: networkSiteTypeDocumentation,
        }}
        noItemsMessage="No site types yet. Add one to start describing your site hierarchy."
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        searchableFields={["name", "description"]}
        selectMoreFields={{
          isUnitLevel: true,
          parentNetworkSiteTypeId: true,
        }}
        filters={[
          { field: { name: true }, title: "Name", type: FieldType.Text },
          {
            field: { isUnitLevel: true },
            title: "Unit Level",
            type: FieldType.Boolean,
          },
        ]}
        columns={[
          { field: { name: true }, title: "Name", type: FieldType.Text },
          {
            field: { description: true },
            title: "Description",
            type: FieldType.Text,
          },
          {
            field: {
              parentNetworkSiteType: {
                name: true,
              },
            },
            title: "Parent Site Type",
            type: FieldType.Entity,
            getElement: (item: NetworkSiteType): ReactElement => {
              if (!item.parentNetworkSiteType?.name) {
                return <span className="text-gray-400">Top level</span>;
              }

              return <span>{item.parentNetworkSiteType.name}</span>;
            },
          },
          {
            field: { isUnitLevel: true },
            title: "Unit Level",
            type: FieldType.Boolean,
            getElement: (item: NetworkSiteType): ReactElement => {
              return item.isUnitLevel ? (
                <Pill color={Green} text="Unit Level" />
              ) : (
                <Pill color={Gray500} text="Container" />
              );
            },
          },
        ]}
        formSteps={[
          { title: "Basic Info", id: "basic-info" },
          { title: "Hierarchy", id: "hierarchy" },
        ]}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Unit",
            validation: { minLength: 2 },
          },
          {
            field: { description: true },
            title: "Description",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "A single store, restaurant or branch office.",
          },
          {
            field: { parentNetworkSiteType: true },
            title: "Parent Site Type",
            stepId: "hierarchy",
            sectionTitle: "Parent Relationship",
            sectionDescription:
              "Choose the type directly above this one. A type cannot be nested beneath itself, one of its descendants, or a unit-level type.",
            description:
              "Leave empty to make this a top-level type. Options show their full hierarchy path.",
            fieldType: FormFieldSchemaType.Dropdown,
            fetchDropdownOptions: fetchParentNetworkSiteTypeOptions,
            required: false,
            placeholder: "No parent site type (top level)",
          },
          {
            field: { isUnitLevel: true },
            title: "Is Unit Level",
            stepId: "hierarchy",
            sectionTitle: "Leaf Level",
            sectionDescription:
              "Normally exactly one of your site types is the unit level — the bottom of the hierarchy, where sites hold devices instead of more sites.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Sites of this type are the leaf level. The network map opens their device topology instead of a child-site map, and the health rollup on parent sites counts them as units. Because types can be renamed, this flag — not the name — is what OneUptime checks.",
          },
        ]}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default NetworkSiteTypesPage;
