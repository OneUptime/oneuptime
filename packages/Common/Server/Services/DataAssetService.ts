import ProjectReferencesService from "./ProjectReferencesService";
import DataAssetLabelRuleEngineService from "./DataAssetLabelRuleEngineService";
import DataAssetOwnerRuleEngineService from "./DataAssetOwnerRuleEngineService";
import DataAsset from "../../Models/DatabaseModels/DataAsset";
import { AppApiClientUrl } from "../EnvironmentConfig";
import { OnCreate } from "../Types/Database/Hooks";
import logger, { LogAttributes } from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
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

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<DataAsset>,
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
    const link: string = `${AppApiClientUrl.toString().replace(/\/api\/?$/, "")}/dashboard/${projectId.toString()}/data-observability/tables/${dataAssetId.toString()}`;

    return mdText`[Table ${name}](${link})`;
  }
}

export default new Service();
