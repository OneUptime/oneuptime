import DatabaseConfig from "../DatabaseConfig";
import ProjectReferencesService from "./ProjectReferencesService";
import DataPipelineOwnerRuleEngineService from "./DataPipelineOwnerRuleEngineService";
import DataPipeline from "../../Models/DatabaseModels/DataPipeline";
import { OnCreate } from "../Types/Database/Hooks";
import logger, { LogAttributes } from "../Utils/Logger";
import URL from "../../Types/API/URL";
import ObjectID from "../../Types/ObjectID";

/*
 * The pipelines that move data, from OpenLineage events
 * (Utils/DataObservability/OpenLineageIngest). OneUptime creates and
 * updates them; people describe or delete one.
 *
 * A pipeline seen for the first time gets the owners its project's owner
 * rules name (#9527), whichever ingest saw it first. The rules run after
 * the pipeline is saved and never hold up, or fail, the event that named
 * it.
 */
export class Service extends ProjectReferencesService<DataPipeline> {
  public constructor() {
    super(DataPipeline);
  }

  // Written from ingested events, whose project the ingestion key proved.
  protected override checksServerWrites(): boolean {
    return false;
  }

  protected override async onCreateSuccess(
    _onCreate: OnCreate<DataPipeline>,
    createdItem: DataPipeline,
  ): Promise<DataPipeline> {
    if (createdItem.projectId && createdItem.id) {
      Promise.resolve()
        .then(async () => {
          await DataPipelineOwnerRuleEngineService.applyRulesToDataPipeline(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying pipeline owner rules in DataPipelineService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              dataPipelineId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }

    return createdItem;
  }

  // The pipeline's page in Data Observability.
  public async getDataPipelineLinkInDashboard(
    projectId: ObjectID,
    dataPipelineId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/data-observability/pipelines/${dataPipelineId.toString()}`,
    );
  }
}

export default new Service();
