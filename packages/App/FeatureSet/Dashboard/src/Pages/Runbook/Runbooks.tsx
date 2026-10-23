import PageComponentProps from "../PageComponentProps";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import Route from "Common/Types/API/Route";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkSwitchActions from "Common/UI/Components/BulkUpdate/BulkSwitchActions";
import { BulkActionButtonSchema } from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
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

  /*
   * Labels, as every other resource list has them: the list shows and
   * filters runbooks by them, and they were set one runbook at a time.
   */
  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<Runbook>({ modelType: Runbook });

  // Enable and Disable: a disabled runbook does not run, whatever starts it.
  const switchBulkActions: Array<BulkActionButtonSchema<Runbook>> =
    useBulkSwitchActions<Runbook>({
      modelType: Runbook,
      column: "isEnabled",
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
        isDeleteable={true}
        isEditable={false}
        isCreateable={true}
        /*
         * A new runbook has no steps, and steps are what it runs: land on
         * its Steps page, which asks for the first one, as a new workflow
         * lands on its Builder. It used to stay on this list, and the
         * runbook's Overview offered Run Now over nothing to run.
         */
        onCreateSuccess={(
          item: Runbook,
          modalType?: ModalType,
        ): Promise<Runbook> => {
          if (modalType === ModalType.Create && item._id) {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.RUNBOOK_VIEW_STEPS] as Route,
                { modelId: item._id as string },
              ),
            );
          }

          return Promise.resolve(item);
        }}
        bulkActions={{
          buttons: [
            ...switchBulkActions,
            ...labelBulkActions,
            ...ownerBulkActions,
          ],
        }}
        // Whether each row is on, for Enable and Disable to count.
        selectMoreFields={{
          isEnabled: true,
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
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default Runbooks;
