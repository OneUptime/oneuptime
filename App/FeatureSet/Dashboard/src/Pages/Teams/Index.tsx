import ProjectUtil from "Common/UI/Utils/Project";
import { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Team from "Common/Models/DatabaseModels/Team";
import IconProp from "Common/Types/Icon/IconProp";
import Query from "Common/Types/BaseDatabase/Query";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import useResourceOwners, {
  ResourceFacet,
  buildEntityFacetQuery,
} from "../../Components/ResourceOwners/useResourceOwners";
import { FilterOperator } from "../../Components/ResourceOwners/FilterChipDropdown";
import {
  computeTeamIdsForMembers,
  loadProjectUserOptions,
  resolveProjectUserOptions,
} from "../../Components/ResourceOwners/ProjectUserFacetOptions";
import ObjectID from "Common/Types/ObjectID";

const Teams: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const teamExtraFacets: Array<ResourceFacet> = [
    {
      key: "member",
      label: "Member",
      icon: IconProp.User,
      isMultiSelect: true,
      searchPlaceholder: "Search users...",
      supportedOperators: ["is", "is_not"],
      loadOptions: loadProjectUserOptions,
      resolveOptions: resolveProjectUserOptions,
      computeMatchingResourceIds: (
        projectId: ObjectID,
        values: Array<string>,
      ): Promise<Array<string>> => {
        return computeTeamIdsForMembers(projectId, values);
      },
    },
    {
      key: "createdByUser",
      queryField: "createdByUserId",
      label: "Created By",
      icon: IconProp.User,
      isMultiSelect: true,
      searchPlaceholder: "Search users...",
      loadOptions: loadProjectUserOptions,
      resolveOptions: resolveProjectUserOptions,
      toQueryValue: (
        values: Array<string>,
        operator: FilterOperator,
      ): unknown => {
        return buildEntityFacetQuery(values, operator, true);
      },
    },
  ];

  const {
    filterBar,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<Team>({
    persistKey: "settings-teams-table",
    showOwnerFacet: false,
    extraFacets: teamExtraFacets,
  });

  return (
    <Fragment>
      <ModelTable<Team>
        modelType={Team}
        id="teams-table"
        name="Settings > Teams"
        saveFilterProps={{
          tableId: "settings-teams-table",
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        userPreferencesKey="teams-table"
        topContent={filterBar}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        cardProps={{
          title: "Teams",
          description: "Here is a list of all the teams in this project.",
        }}
        noItemsMessage={"No teams found."}
        query={mergeFiltersIntoQuery({
          projectId: ProjectUtil.getCurrentProjectId()!,
        } as Query<Team>)}
        showViewIdButton={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Team Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Team Description",
          },
        ]}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        viewPageRoute={RouteUtil.populateRouteParams(props.pageRoute)}
        filters={[]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              description: true,
            },
            noValueMessage: "-",
            title: "Description",
            type: FieldType.LongText,
          },
        ]}
      />
    </Fragment>
  );
};

export default Teams;
