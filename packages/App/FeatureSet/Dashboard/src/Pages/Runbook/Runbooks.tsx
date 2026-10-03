import PageComponentProps from "../PageComponentProps";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import getLabelsFormField from "../../Utils/Form/LabelsFormField";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import RunbookOwnerTeam from "Common/Models/DatabaseModels/RunbookOwnerTeam";
import RunbookOwnerUser from "Common/Models/DatabaseModels/RunbookOwnerUser";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green500, Red500 } from "Common/Types/BrandColors";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners, {
  ResourceFacet,
  buildBooleanFacetQuery,
} from "../../Components/ResourceOwners/useResourceOwners";
import { FilterOperator } from "../../Components/ResourceOwners/FilterChipDropdown";
import IconProp from "Common/Types/Icon/IconProp";

const Runbooks: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<Runbook>({
      ownerUserModelType: RunbookOwnerUser,
      ownerTeamModelType: RunbookOwnerTeam,
      resourceIdField: "runbookId",
    });

  const runbookExtraFacets: Array<ResourceFacet> = [
    {
      key: "isEnabled",
      label: "Enabled",
      icon: IconProp.Power,
      isMultiSelect: false,
      options: [
        { value: "true", label: "Enabled" },
        { value: "false", label: "Disabled" },
      ],
      supportedOperators: ["is", "is_not"],
      toQueryValue: (
        values: Array<string>,
        operator: FilterOperator,
      ): unknown => {
        return buildBooleanFacetQuery(values, operator);
      },
    },
  ];

  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    emptyState: facetEmptyState,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<Runbook>({
    persistKey: "runbooks-table",
    ownerUserModelType: RunbookOwnerUser,
    ownerTeamModelType: RunbookOwnerTeam,
    resourceIdField: "runbookId",
    showLabelsFacet: true,
    extraFacets: runbookExtraFacets,
  });

  /*
   * The create form asks for a name and what the runbook is for, and folds
   * the rest under Advanced: the Enabled switch (on by default, and on the
   * runbook's Settings page) and the labels. Three rows, so no steps.
   */
  const advancedSection: FormFieldCollapsibleSection<Runbook> =
    getAdvancedFormSection<Runbook>();

  return (
    <Fragment>
      <ModelTable<Runbook>
        modelType={Runbook}
        id="runbooks-table"
        userPreferencesKey="runbooks-table"
        topContent={filterBar}
        emptyState={facetEmptyState}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery(undefined)}
        onFetchSuccess={(data: Array<Runbook>) => {
          onResourcesFetched(data);
        }}
        saveFilterProps={{
          tableId: "runbooks-table",
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        bulkActions={{
          buttons: [...ownerBulkActions],
        }}
        name="Runbooks"
        isViewable={true}
        showViewIdButton={true}
        cardProps={{
          title: "Runbooks",
          description:
            "Reusable response procedures: ordered checklists of manual or automated steps.",
        }}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Database failover runbook",
            validation: { minLength: 2 },
          },
          {
            field: { description: true },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "What this runbook is for and when it should be triggered.",
          },
          {
            field: { isEnabled: true },
            title: "Enabled",
            fieldType: FormFieldSchemaType.Toggle,
            collapsibleSection: advancedSection,
          },
          getLabelsFormField<Runbook>({
            collapsibleSection: advancedSection,
          }),
        ]}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            title: "Name",
            type: FieldType.Text,
            field: { name: true },
          },
          {
            title: "Description",
            type: FieldType.Text,
            field: { description: true },
          },
        ]}
        columns={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: { description: true },
            title: "Description",
            type: FieldType.LongText,
            hideOnMobile: true,
          },
          {
            field: { isEnabled: true },
            title: "Enabled",
            type: FieldType.Element,
            getElement: (item: Runbook): ReactElement => {
              if (item.isEnabled) {
                return (
                  <Pill text="Enabled" color={Green500} isMinimal={true} />
                );
              }
              return <Pill text="Disabled" color={Red500} isMinimal={true} />;
            },
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            getElement: (item: Runbook): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
          {
            field: {
              _id: true,
            },
            title: "Owners",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: Runbook): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
        ]}
      />
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default Runbooks;
