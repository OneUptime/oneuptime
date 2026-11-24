import DataSourceModel from "Common/Models/DatabaseModels/DataSource";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import DataSourceType from "Common/Types/DataSource/DataSourceType";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";

/*
 * THE TYPE OF EACH OF THE PROJECT'S DATA SOURCES, READ ONCE A PAGE (issue
 * #10326).
 *
 * A widget fills a dashboard's variables into its query the way its source
 * reads them (DataSourceQueryText.applyVariablesForSource): PromQL over an
 * outside Prometheus as Grafana's Prometheus data source does, any other
 * source as text. A widget stores only its source's id, so its type is
 * read here: the project's data sources, once for every widget of the
 * page, with the person's own permissions, as the query editor reads them.
 * A source added since (an id not in the list) reads the list again, once.
 * A read that fails hands back nothing, and the query is filled as text,
 * as it always was.
 */

let readsByProject: Map<string, Promise<Map<string, DataSourceType>>> = new Map<
  string,
  Promise<Map<string, DataSourceType>>
>();

// The ids a list was read again for, so a deleted source is not read for again.
let readAgainFor: Set<string> = new Set<string>();

const readTypes: () => Promise<Map<string, DataSourceType>> = async (): Promise<
  Map<string, DataSourceType>
> => {
  const types: Map<string, DataSourceType> = new Map<string, DataSourceType>();
  const result: ListResult<DataSourceModel> =
    await ModelAPI.getList<DataSourceModel>({
      modelType: DataSourceModel,
      query: {},
      select: { _id: true, dataSourceType: true },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      sort: {},
    });

  for (const dataSource of result.data || []) {
    const id: string | undefined = dataSource.id?.toString();

    if (id && dataSource.dataSourceType) {
      types.set(id, dataSource.dataSourceType);
    }
  }

  return types;
};

export default class DataSourceTypes {
  // The type of one of the project's data sources; undefined when unknown.
  public static async getType(
    dataSourceId: string | undefined,
  ): Promise<DataSourceType | undefined> {
    if (!dataSourceId) {
      return undefined;
    }

    const projectId: string =
      ProjectUtil.getCurrentProjectId()?.toString() || "";

    const read: () => Promise<Map<string, DataSourceType>> = (): Promise<
      Map<string, DataSourceType>
    > => {
      const reading: Promise<Map<string, DataSourceType>> = readTypes().catch(
        (): Map<string, DataSourceType> => {
          // Read again next time: a failure is not the list.
          readsByProject.delete(projectId);
          return new Map<string, DataSourceType>();
        },
      );

      readsByProject.set(projectId, reading);

      return reading;
    };

    let types: Map<string, DataSourceType> = await (readsByProject.get(
      projectId,
    ) || read());

    if (!types.has(dataSourceId) && !readAgainFor.has(dataSourceId)) {
      readAgainFor.add(dataSourceId);
      types = await read();
    }

    return types.get(dataSourceId);
  }

  // Forgets what was read: a test's, or a project switched to.
  public static forget(): void {
    readsByProject = new Map<string, Promise<Map<string, DataSourceType>>>();
    readAgainFor = new Set<string>();
  }
}
