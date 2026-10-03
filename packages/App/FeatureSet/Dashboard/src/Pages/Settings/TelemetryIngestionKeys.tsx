import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import { TelemetryPayAsYouGoCard } from "../../Components/Billing/PayAsYouGo";
import {
  getIngestionKeyFormFields,
  getIngestionKeyFormSteps,
  prepareIngestionKeyForCreate,
} from "../../Components/Telemetry/IngestionKeyForm";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
} from "react";

type GetIngestionKeyRouteFunction = (item: TelemetryIngestionKey) => Route;

// The key's own page: where its secret is.
const getIngestionKeyRoute: GetIngestionKeyRouteFunction = (
  item: TelemetryIngestionKey,
): Route => {
  return new Route(
    RouteUtil.populateRouteParams(
      RouteMap[PageMap.SETTINGS_TELEMETRY_INGESTION_KEY_VIEW] as Route,
      {
        modelId: new ObjectID(item._id as string),
      },
    ).toString(),
  );
};

const TelemetryIngestionKeys: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * The create form every door onto a new key shares
   * (Components/Telemetry/IngestionKeyForm): a name already filled in -
   * "Server key", following the type until someone types their own - the
   * type, Server picked, and the description under Advanced. A Browser key
   * walks on to its allowed origins, and the Free plan to the pricing.
   * Built once: the Free plan's Billing step is decided by the plan.
   */
  const formSteps: Array<FormStep<TelemetryIngestionKey>> = useMemo((): Array<
    FormStep<TelemetryIngestionKey>
  > => {
    return getIngestionKeyFormSteps({});
  }, []);

  const formFields: Array<ModelField<TelemetryIngestionKey>> =
    useMemo((): Array<ModelField<TelemetryIngestionKey>> => {
      return getIngestionKeyFormFields({});
    }, []);

  return (
    <Fragment>
      {/*
       * Telemetry is metered and nothing about it is included in the Free
       * plan, so a Free plan project is told what an ingestion key costs
       * before it creates one, including a step in the create dialog.
       */}
      <TelemetryPayAsYouGoCard />
      <ModelTable<TelemetryIngestionKey>
        modelType={TelemetryIngestionKey}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        id="api-keys-table"
        name="Settings > Telemetry Ingestion Keys"
        saveFilterProps={{
          tableId: "settings-telemetry-ingestion-keys-table",
        }}
        isDeleteable={false}
        isEditable={false}
        showViewIdButton={false}
        isCreateable={true}
        isViewable={true}
        singularName="Ingestion Key"
        userPreferencesKey="telemetry-ingestion-keys-table"
        cardProps={{
          title: "Telemetry Ingestion Keys",
          description:
            "These keys are used to ingest telemetry data like Logs, Traces and Metrics for your project.",
        }}
        noItemsMessage={"No telemetry ingestion keys found."}
        formSteps={formSteps}
        formFields={formFields}
        onBeforeCreate={async (
          item: TelemetryIngestionKey,
        ): Promise<TelemetryIngestionKey> => {
          return prepareIngestionKeyForCreate(item, {});
        }}
        /*
         * A key is created to be used, and what using it takes - its secret
         * - is on its own page. Landing there beats leaving the user to find
         * the new row in the list and click through.
         */
        onCreateSuccess={(
          item: TelemetryIngestionKey,
          modalType?: ModalType,
        ): Promise<TelemetryIngestionKey> => {
          if (modalType === ModalType.Create && item._id) {
            Navigation.navigate(getIngestionKeyRoute(item));
          }

          return Promise.resolve(item);
        }}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              name: true,
            },
            type: FieldType.Text,
            title: "Name",
          },
          {
            field: {
              keyType: true,
            },
            type: FieldType.Dropdown,
            title: "Key Type",
            filterDropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnumWithReadableLabels(
                TelemetryIngestionKeyType,
              ),
          },
          {
            field: {
              description: true,
            },
            type: FieldType.Text,
            title: "Description",
          },
        ]}
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
              keyType: true,
            },
            title: "Type",
            type: FieldType.Text,
          },
          {
            field: {
              lastUsedAt: true,
            },
            /*
             * The column that answers "is anything still sending with this?",
             * which is the question you have to answer before rotating or
             * deleting a key. Empty means no ingest has been recorded since
             * this started being tracked, not that the key never worked -
             * hence "Never" rather than a dash.
             */
            noValueMessage: "Never",
            title: "Last Used",
            type: FieldType.DateTime,
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

export default TelemetryIngestionKeys;
