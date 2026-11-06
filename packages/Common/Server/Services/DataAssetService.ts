import DatabaseConfig from "../DatabaseConfig";
import ProjectReferencesService from "./ProjectReferencesService";
import DataAssetLabelRuleEngineService from "./DataAssetLabelRuleEngineService";
import DataAssetOwnerRuleEngineService from "./DataAssetOwnerRuleEngineService";
import DataAsset from "../../Models/DatabaseModels/DataAsset";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import logger, { LogAttributes } from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import {
  DataAssetColumn,
  readDataAssetColumns,
} from "../../Types/DataObservability/DataAssetColumn";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import URL from "../../Types/API/URL";
import { MarkdownText, mdText } from "../../Utils/Markdown/FeedMarkdown";

/*
 * The tables and views of connected data stores. OneUptime writes them as
 * it collects each store (Utils/DataObservability/TableHealthIngest); people
 * add a description, or delete one with its history. A table seen for the
 * first time takes its labels and owners from the project's rules.
 */
export class Service extends ProjectReferencesService<DataAsset> {
  public constructor() {
    super(DataAsset);
  }

  // A table's freshness column must be one of its columns: the name goes into a statement.
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<DataAsset>,
  ): Promise<OnUpdate<DataAsset>> {
    await super.onBeforeUpdate(updateBy);

    const column: unknown = (updateBy.data as unknown as JSONObject)[
      "freshnessColumn"
    ];

    if (typeof column === "string" && column) {
      for (const asset of await this.findRowsAndHoldUpdateToThem(updateBy, {
        columns: true,
        name: true,
      })) {
        const isKnown: boolean = readDataAssetColumns(asset.columns).some(
          (known: DataAssetColumn): boolean => {
            return known.name === column;
          },
        );

        if (!isKnown) {
          throw new BadDataException(
            `${asset.name || "The table"} has no column "${column}".`,
          );
        }
      }
    }

    return { updateBy, carryForward: undefined };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<DataAsset>,
    createdItem: DataAsset,
  ): Promise<DataAsset> {
    if (createdItem.projectId && createdItem.id) {
      Promise.resolve()
        .then(async () => {
          await DataAssetLabelRuleEngineService.applyRulesToDataAsset(
            createdItem,
          );
        })
        .then(async () => {
          await DataAssetOwnerRuleEngineService.applyRulesToDataAsset(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying table rules in DataAssetService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              dataAssetId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }

    return createdItem;
  }

  // The table, linked to its page, for a feed item.
  public async getDataAssetMarkdownLink(
    projectId: ObjectID,
    dataAssetId: ObjectID,
  ): Promise<MarkdownText> {
    const asset: DataAsset | null = await this.findOneById({
      id: dataAssetId,
      select: { name: true, schemaName: true },
      props: { isRoot: true },
    });
    const name: string = asset?.schemaName
      ? `${asset.schemaName}.${asset.name || ""}`
      : asset?.name || "";
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();
    const link: URL = URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/data-observability/tables/${dataAssetId.toString()}`,
    );

    return mdText`[Table ${name}](${link.toString()})`;
  }
}

export default new Service();
