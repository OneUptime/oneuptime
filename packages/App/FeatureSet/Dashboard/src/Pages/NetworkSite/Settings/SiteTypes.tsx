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
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const networkSiteTypeDocumentation: string = `
Site types are the levels of your network site hierarchy, such as Region, Market and Unit, and every site has one. Rename them, arrange them, delete the ones you do not use, or add your own to match how your organisation is structured.

## Parent Site Type

Choose the type right above this one: Account Type above Region, Region above Franchisee, Franchisee above Market, Market above Unit. Leave it empty for a top-level type. When you place a site, its type's parent decides which sites are suggested first.

It guides without dictating: a site can go under any site that is not below it in this tree, so you can skip a level, or hang a site under a catch-all type such as Other. Only an upside-down placement is refused, such as a Region site under a Market site, and a unit-level site never has sites under it.

A type already in use can be moved, unless the move would turn an existing site upside down: move that site first.

## Unit Level

**Is Unit Level** marks the bottom of your hierarchy: the type of the real places that hold devices rather than more sites. Normally exactly one type is the unit level, and it matters:

- **Network Map**: opening a unit-level site shows its device topology, not a map of sites under it.
- **Health rollup**: the unit counts on a parent site (\`12 of 14 units healthy\`) count only unit-level sites.

Nothing keys off the name "Unit", only this switch: rename it to "Store" or "Branch", keep the switch on, and everything keeps working.
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
  const translator: Translator = useTranslator();
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
                return (
                  <span className="text-gray-500">
                    {translator.translateText("Top level")}
                  </span>
                );
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
              "The type directly above this one, such as Region above Store.",
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
              "Usually one type is the unit level: the bottom, where sites hold devices.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Sites of this type hold devices, not more sites. The map opens on their devices.",
          },
        ]}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default NetworkSiteTypesPage;
