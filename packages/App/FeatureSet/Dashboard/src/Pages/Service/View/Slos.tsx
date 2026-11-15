import PageComponentProps from "../../PageComponentProps";
import {
  getSloTableColumns,
  getSloViewRoute,
  SLO_TABLE_SELECT_MORE_FIELDS,
} from "../../Slo/Slos";
import {
  getSloFormFields,
  SLO_CREATE_FORM_STEPS,
  SLO_CREATE_INITIAL_VALUES,
} from "../../Slo/SloFormFields";
import useSloBulkActions, {
  SLO_OWNER_RESOURCE_ID_FIELD,
  SloBulkActionsResult,
} from "../../../Components/Slo/useSloBulkActions";
import OwnersCell from "../../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../../Components/ResourceOwners/useResourceOwners";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveOwnerTeam from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceLevelObjectiveOwnerUser from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import SliType from "Common/Types/ServiceLevelObjective/SliType";
import SloStatus from "Common/Types/ServiceLevelObjective/SloStatus";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import LabelsElement from "Common/UI/Components/Label/Labels";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
} from "react";

/*
 * The create form a service's SLOs page opens: the SLOs page's own form,
 * already measuring this service's requests. Request success is the first
 * request answer; the reader can still pick latency, or monitor uptime.
 * `services` holds the service's id, as the services dropdown reads it.
 */
export type GetServiceSloCreateInitialValuesFunction = (
  serviceId: ObjectID,
) => FormValues<ServiceLevelObjective>;

export const getServiceSloCreateInitialValues: GetServiceSloCreateInitialValuesFunction =
  (serviceId: ObjectID): FormValues<ServiceLevelObjective> => {
    return {
      ...SLO_CREATE_INITIAL_VALUES,
      sliType: SliType.RequestSuccess,
      services: [
        serviceId.toString(),
      ] as unknown as FormValues<ServiceLevelObjective>["services"],
    };
  };

/**
 * The SLOs that measure this service's requests (#8443).
 *
 * A monitor's SLOs page tells a team which objectives a flapping monitor is
 * spending before they pause it; this is the same for a service: before a
 * risky deploy, or while its error rate climbs, which SLOs - and whose
 * error budgets - depend on it. A request SLO needs nothing but a service,
 * so this page can also create one, already measuring it.
 *
 * The columns come from the SLOs list, so the two surfaces never disagree
 * about what at-risk looks like.
 */
const ServiceSlos: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const { bulkActions, rowActions, modals }: SloBulkActionsResult =
    useSloBulkActions();

  const { getOwnersForResource, isLoadingOwners, onResourcesFetched } =
    useResourceOwners<ServiceLevelObjective>({
      ownerUserModelType: ServiceLevelObjectiveOwnerUser,
      ownerTeamModelType: ServiceLevelObjectiveOwnerTeam,
      resourceIdField: SLO_OWNER_RESOURCE_ID_FIELD,
    });

  const createInitialValues: FormValues<ServiceLevelObjective> =
    useMemo((): FormValues<ServiceLevelObjective> => {
      return getServiceSloCreateInitialValues(modelId);
    }, [modelId.toString()]);

  return (
    <Fragment>
      <ModelTable<ServiceLevelObjective>
        modelType={ServiceLevelObjective}
        actionButtons={[...rowActions]}
        id="service-slos-table"
        userPreferencesKey="service-slos-table"
        name="Service > SLOs"
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        showRefreshButton={true}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          services: new Includes([modelId]),
          /*
           * Live SLOs only, as the SLOs list shows: an archived SLO is not
           * evaluated, so this service's requests do not spend its budget.
           */
          isArchived: false,
        }}
        onFetchSuccess={(data: Array<ServiceLevelObjective>) => {
          onResourcesFetched(data);
        }}
        cardProps={{
          title: "Service Level Objectives",
          description:
            "Reliability targets that measure this service's requests. Failed or slow requests here spend their error budgets.",
        }}
        noItemsMessage="No SLO measures this service yet. Create one to track how many of its requests succeed, or how fast they are served."
        /*
         * The SLOs page's own two steps (SloFormFields.ts), with this
         * service already chosen and Request success already picked.
         */
        formFields={getSloFormFields()}
        formSteps={SLO_CREATE_FORM_STEPS}
        createInitialValues={createInitialValues}
        /*
         * As on the SLOs page: a new SLO's next steps - its rules, owners
         * and settings - hang off its own page, so open it.
         */
        onCreateSuccess={(
          item: ServiceLevelObjective,
          modalType?: ModalType,
        ): Promise<ServiceLevelObjective> => {
          if (modalType === ModalType.Create && item._id) {
            Navigation.navigate(getSloViewRoute(item));
          }

          return Promise.resolve(item);
        }}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              sloStatus: true,
            },
            title: "Status",
            type: FieldType.Dropdown,
            filterDropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(SloStatus),
          },
        ]}
        documentationLink={new Route("/docs/slo/request-slos")}
        bulkActions={{
          buttons: [...bulkActions],
        }}
        columns={[
          ...getSloTableColumns(),
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            hideOnMobile: true,
            getElement: (item: ServiceLevelObjective): ReactElement => {
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
            getElement: (item: ServiceLevelObjective): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
        ]}
        selectMoreFields={SLO_TABLE_SELECT_MORE_FIELDS}
        onViewPage={(item: ServiceLevelObjective): Promise<Route> => {
          return Promise.resolve(getSloViewRoute(item));
        }}
      />
      {modals}
    </Fragment>
  );
};

export default ServiceSlos;
