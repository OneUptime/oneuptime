import React, { FunctionComponent, ReactElement, useState } from "react";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricQueryConfigData, {
  MetricChartType,
} from "Common/Types/Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricExplorerUrl, {
  SerializedMetricFormula,
  SerializedMetricQuery,
} from "Common/Utils/Metrics/MetricExplorerUrl";
import {
  buildFormulaConfigsFromSerializedFormulas,
  buildQueryConfigsFromSerializedQueries,
} from "./Utils/MetricConfigReconstruct";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";
import DashboardChartComponent from "Common/Types/Dashboard/DashboardComponents/DashboardChartComponent";
import DashboardChartType from "Common/Types/Dashboard/Chart/ChartType";
import DashboardChartComponentUtil from "Common/Utils/Dashboard/Components/DashboardChartComponent";
import DashboardViewConfigUtil from "Common/Utils/Dashboard/DashboardViewConfig";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ModelListModal from "Common/UI/Components/ModelListModal/ModelListModal";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { ShowToastNotification } from "Common/UI/Components/Toast/ToastInit";
import { ToastType } from "Common/UI/Components/Toast/Toast";
import ProjectUtil from "Common/UI/Utils/Project";
import Navigation from "Common/UI/Utils/Navigation";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import ObjectID from "Common/Types/ObjectID";
import JSONFunctions from "Common/Types/JSONFunctions";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/UI/Utils/API/API";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";

export interface ComponentProps {
  metricViewData: MetricViewData;
  onClose: () => void;
}

type MapChartTypeFunction = (
  chartType: MetricChartType | undefined,
) => DashboardChartType;

/*
 * The explorer renders an area chart when no explicit type is chosen
 * (see MetricCharts.getChartTypeForConfig), so an unset type maps to
 * Area — the widget then shows what the user was looking at.
 */
const mapMetricChartTypeToDashboardChartType: MapChartTypeFunction = (
  chartType: MetricChartType | undefined,
): DashboardChartType => {
  if (chartType === MetricChartType.LINE) {
    return DashboardChartType.Line;
  }
  if (chartType === MetricChartType.BAR) {
    return DashboardChartType.Bar;
  }
  return DashboardChartType.Area;
};

/*
 * Picks a project dashboard and appends the explorer's current view to it
 * as a chart component. Read-modify-write on dashboardViewConfig — same
 * (accepted) concurrency model as the dashboard editor itself.
 */
const AddToDashboardModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [addedToDashboard, setAddedToDashboard] = useState<Dashboard | null>(
    null,
  );

  /*
   * Persistable plain shapes of the current view. Round-tripping through
   * the shared serializer strips any runtime-injected function fields, so
   * only JSON-safe data lands in the dashboard config.
   */
  const serializedQueries: Array<SerializedMetricQuery> =
    props.metricViewData.queryConfigs
      .map((queryConfig: MetricQueryConfigData): SerializedMetricQuery => {
        return MetricExplorerUrl.buildSerializedMetricQuery(queryConfig);
      })
      .filter(MetricExplorerUrl.isMeaningfulMetricQuery);

  const serializedFormulas: Array<SerializedMetricFormula> =
    props.metricViewData.formulaConfigs
      .map(
        (formulaConfig: MetricFormulaConfigData): SerializedMetricFormula => {
          return MetricExplorerUrl.buildSerializedMetricFormula(formulaConfig);
        },
      )
      .filter(MetricExplorerUrl.isMeaningfulMetricFormula);

  const addChartToDashboard: (dashboard: Dashboard) => Promise<void> = async (
    dashboard: Dashboard,
  ): Promise<void> => {
    setIsAdding(true);
    setError("");

    try {
      /*
       * ModelList keeps selected records as plain object copies. That strips
       * BaseModel's prototype getter for `id`, while retaining the underlying
       * `_id` value. Resolve both shapes so submitting the dashboard picker
       * cannot silently return without adding the chart.
       */
      const dashboardId: ObjectID | null =
        dashboard.id || (dashboard._id ? new ObjectID(dashboard._id) : null);

      if (!dashboardId) {
        throw new Error("The selected dashboard does not have a valid ID.");
      }

      const fullDashboard: Dashboard | null = await ModelAPI.getItem<Dashboard>(
        {
          modelType: Dashboard,
          id: dashboardId,
          select: {
            name: true,
            dashboardViewConfig: true,
          },
        },
      );

      if (!fullDashboard) {
        throw new Error("This dashboard could not be loaded.");
      }

      const dashboardViewConfig: DashboardViewConfig =
        fullDashboard.dashboardViewConfig &&
        fullDashboard.dashboardViewConfig.components
          ? fullDashboard.dashboardViewConfig
          : DashboardViewConfigUtil.createDefaultDashboardViewConfig();

      const plainQueryConfigs: Array<MetricQueryConfigData> =
        buildQueryConfigsFromSerializedQueries(serializedQueries);
      const plainFormulaConfigs: Array<MetricFormulaConfigData> =
        buildFormulaConfigsFromSerializedFormulas(
          serializedFormulas,
          plainQueryConfigs.length,
        );

      const firstQueryConfig: MetricQueryConfigData | undefined =
        plainQueryConfigs[0];

      const chartTitle: string =
        firstQueryConfig?.metricAliasData?.title ||
        firstQueryConfig?.metricAliasData?.legend ||
        firstQueryConfig?.metricQueryData?.filterData?.metricName?.toString() ||
        "Metric Chart";

      const chartComponent: DashboardChartComponent =
        DashboardChartComponentUtil.getDefaultComponent();

      chartComponent.arguments = {
        metricQueryConfig: firstQueryConfig,
        ...(plainQueryConfigs.length > 1
          ? { metricQueryConfigs: plainQueryConfigs.slice(1) }
          : {}),
        ...(plainFormulaConfigs.length > 0
          ? { metricFormulaConfigs: plainFormulaConfigs }
          : {}),
        chartTitle: chartTitle,
        chartType: mapMetricChartTypeToDashboardChartType(
          firstQueryConfig?.chartType,
        ),
      };

      const updatedViewConfig: DashboardViewConfig =
        DashboardViewConfigUtil.addComponentToDashboard({
          component: chartComponent,
          dashboardViewConfig: dashboardViewConfig,
        });

      await ModelAPI.updateById({
        modelType: Dashboard,
        id: dashboardId,
        data: {
          dashboardViewConfig: JSONFunctions.serializeValue(
            updatedViewConfig as unknown as JSONObject,
          ),
        },
      });

      ShowToastNotification({
        title: "Chart Added",
        description: `"${chartTitle}" was added to the ${
          fullDashboard.name || "selected"
        } dashboard.`,
        type: ToastType.SUCCESS,
      });

      setAddedToDashboard(fullDashboard);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsAdding(false);
  };

  // Nothing chartable yet — nudge instead of writing an empty widget.
  if (serializedQueries.length === 0) {
    return (
      <ConfirmModal
        title="Nothing to Add Yet"
        description="Select a metric in the explorer before adding this view to a dashboard."
        submitButtonText="Close"
        submitButtonType={ButtonStyleType.NORMAL}
        onSubmit={props.onClose}
      />
    );
  }

  if (error) {
    return (
      <ConfirmModal
        title="Could Not Add Chart"
        description={error}
        submitButtonText="Close"
        submitButtonType={ButtonStyleType.NORMAL}
        onSubmit={props.onClose}
      />
    );
  }

  if (isAdding) {
    return (
      <ConfirmModal
        title="Add to Dashboard"
        description="Adding this chart to the dashboard..."
        isLoading={true}
        submitButtonText="Close"
        submitButtonType={ButtonStyleType.NORMAL}
        onSubmit={props.onClose}
      />
    );
  }

  if (addedToDashboard) {
    return (
      <ConfirmModal
        title="Chart Added"
        description={`The chart was added to the ${
          addedToDashboard.name || "selected"
        } dashboard.`}
        submitButtonText="Open Dashboard"
        closeButtonText="Close"
        onClose={props.onClose}
        onSubmit={() => {
          props.onClose();
          if (addedToDashboard.id) {
            Navigation.navigate(
              RouteUtil.populateRouteParams(RouteMap[PageMap.DASHBOARD_VIEW]!, {
                modelId: addedToDashboard.id,
              }),
            );
          }
        }}
      />
    );
  }

  return (
    <ModelListModal<Dashboard>
      modalTitle="Add to Dashboard"
      modalDescription="Select the dashboard this chart should be added to."
      modelType={Dashboard}
      titleField="name"
      descriptionField="description"
      isSearchEnabled={true}
      noItemsMessage="No dashboards found. Create a dashboard first."
      query={
        {
          projectId: ProjectUtil.getCurrentProjectId() as ObjectID,
        } as Query<Dashboard>
      }
      select={
        {
          name: true,
          description: true,
        } as Select<Dashboard>
      }
      onClose={props.onClose}
      onSave={(dashboards: Array<Dashboard>) => {
        const selectedDashboard: Dashboard | undefined = dashboards[0];
        if (!selectedDashboard) {
          props.onClose();
          return;
        }
        void addChartToDashboard(selectedDashboard);
      }}
    />
  );
};

export default AddToDashboardModal;
