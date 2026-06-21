import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import BadDataException from "../../Types/Exception/BadDataException";
import ModelImportExport from "../../Utils/ModelImportExport";
import API from "./API/API";
import ModelAPI from "./ModelAPI/ModelAPI";

export interface ImportFailure {
  itemName: string;
  errorMessage: string;
}

export interface ImportResult {
  successCount: number;
  failures: Array<ImportFailure>;
}

export default class ModelImportExportUtil {
  public static async fetchItemForExport<TBaseModel extends BaseModel>(data: {
    modelType: { new (): TBaseModel };
    modelId: ObjectID;
    modelAPI?: typeof ModelAPI | undefined;
  }): Promise<TBaseModel> {
    const modelAPI: typeof ModelAPI = data.modelAPI || ModelAPI;

    const item: TBaseModel | null = await modelAPI.getItem<TBaseModel>({
      modelType: data.modelType,
      id: data.modelId,
      select: ModelImportExport.getImportExportSelect(data.modelType),
    });

    if (!item || !item.id) {
      const model: BaseModel = new data.modelType();
      throw new BadDataException(
        `${model.singularName || "Item"} not found. It may have been deleted.`,
      );
    }

    return item;
  }

  public static downloadExportFile<TBaseModel extends BaseModel>(data: {
    modelType: { new (): TBaseModel };
    items: Array<TBaseModel>;
  }): void {
    const model: BaseModel = new data.modelType();

    const envelope: JSONObject = ModelImportExport.buildExportEnvelope({
      modelType: data.modelType,
      items: data.items,
      exportedAt: new Date(),
    });

    const resourceName: string = (model.tableName || "resources")
      .replace(/[^a-zA-Z0-9-]/g, "-")
      .toLowerCase();

    const timestamp: string = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);

    this.downloadJSONFile({
      content: JSON.stringify(envelope, null, 2),
      filename: `${resourceName}-export-${timestamp}.json`,
    });
  }

  public static downloadJSONFile(data: {
    content: string;
    filename: string;
  }): void {
    const blob: Blob = new Blob([data.content], {
      type: "application/json;charset=utf-8;",
    });
    const url: string = window.URL.createObjectURL(blob);
    const anchor: HTMLAnchorElement = document.createElement("a");
    anchor.href = url;
    anchor.download = data.filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(url);
  }

  public static parseImportFileText(data: {
    modelType: { new (): BaseModel };
    fileText: string;
  }): Array<JSONObject> {
    let payload: unknown = null;

    try {
      payload = JSON.parse(data.fileText);
    } catch {
      throw new BadDataException(
        "This file is not valid JSON. Please select a JSON export file.",
      );
    }

    return ModelImportExport.parseImportPayload({
      modelType: data.modelType,
      payload: payload as JSONObject,
    });
  }

  /*
   * Creates each item through the regular create API so all server-side
   * validation, permission checks and hooks apply. When an item fails only
   * because a resource with the same name already exists, it is retried once
   * with an "(Imported)" suffix so re-importing into the same project works.
   */
  public static async importItems<TBaseModel extends BaseModel>(data: {
    modelType: { new (): TBaseModel };
    itemJsons: Array<JSONObject>;
    modelAPI?: typeof ModelAPI | undefined;
    onProgress?:
      | ((completedCount: number, totalCount: number) => void)
      | undefined;
  }): Promise<ImportResult> {
    const modelAPI: typeof ModelAPI = data.modelAPI || ModelAPI;

    const result: ImportResult = {
      successCount: 0,
      failures: [],
    };

    /*
     * The column that holds the human-readable name of the resource - used
     * to label failures and to rename on duplicate-name conflicts. Most
     * models use "name"; template models use "templateName".
     */
    const displayNameColumn: string | undefined = [
      "name",
      "templateName",
      "title",
    ].find((columnName: string) => {
      return new data.modelType().getTableColumns().hasColumn(columnName);
    });

    let completedCount: number = 0;

    for (const itemJson of data.itemJsons) {
      const itemName: string =
        (displayNameColumn &&
          typeof itemJson[displayNameColumn] === "string" &&
          (itemJson[displayNameColumn] as string)) ||
        `Item ${completedCount + 1}`;

      try {
        const item: TBaseModel = ModelImportExport.fromImportJSON({
          json: itemJson,
          modelType: data.modelType,
        });

        try {
          await modelAPI.create<TBaseModel>({
            model: item,
            modelType: data.modelType,
          });

          result.successCount += 1;
        } catch (err) {
          const errorMessage: string = API.getFriendlyMessage(err);

          const canRetryWithNewName: boolean = Boolean(
            errorMessage.toLowerCase().includes("already exists") &&
              displayNameColumn &&
              typeof item.getValue(displayNameColumn) === "string",
          );

          if (canRetryWithNewName) {
            item.setValue(
              displayNameColumn!,
              `${item.getValue(displayNameColumn!)?.toString()} (Imported)`,
            );

            await modelAPI.create<TBaseModel>({
              model: item,
              modelType: data.modelType,
            });

            result.successCount += 1;
          } else {
            result.failures.push({
              itemName: itemName,
              errorMessage: errorMessage,
            });
          }
        }
      } catch (err) {
        result.failures.push({
          itemName: itemName,
          errorMessage: API.getFriendlyMessage(err),
        });
      }

      completedCount += 1;

      if (data.onProgress) {
        data.onProgress(completedCount, data.itemJsons.length);
      }
    }

    return result;
  }
}
