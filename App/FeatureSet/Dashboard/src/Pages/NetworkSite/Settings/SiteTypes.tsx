import PageComponentProps from "../../PageComponentProps";
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

Site Types are the levels of your network site hierarchy. Every network site is assigned one. The defaults — Account Type, Region, Franchisee, Market, Unit, Data Center, Other — are just a starting point: rename them, reorder them, delete the ones you don't use, or add your own to match how your organisation is actually structured.

### Order

\`Order\` places a type in the hierarchy. **Lower numbers are higher up.** A Region (order 2) contains Markets (order 4), which contain Units (order 5). The order is how the site hierarchy and the network map decide what nests inside what.

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
            "The levels of your site hierarchy — Region, Market, Unit and so on. Rename them, reorder them, or add your own.",
        }}
        helpContent={{
          title: "How Site Types Work",
          description:
            "Configure your hierarchy levels and pick which one is the unit level.",
          markdown: networkSiteTypeDocumentation,
        }}
        noItemsMessage="No site types yet. Add one to start describing your site hierarchy."
        sortBy="order"
        sortOrder={SortOrder.Ascending}
        searchableFields={["name", "description"]}
        selectMoreFields={{ isUnitLevel: true }}
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
            field: { order: true },
            title: "Order",
            type: FieldType.Number,
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
            field: { order: true },
            title: "Order",
            stepId: "hierarchy",
            sectionTitle: "Position in the Hierarchy",
            sectionDescription:
              "Where this type sits relative to the others. Lower numbers are higher up: a Region (2) contains Markets (4), which contain Units (5).",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "5",
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
