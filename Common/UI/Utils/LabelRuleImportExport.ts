import BaseModel, {
  DatabaseBaseModelType,
} from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ListResult from "../../Types/BaseDatabase/ListResult";
import Query from "../../Types/BaseDatabase/Query";
import Select from "../../Types/BaseDatabase/Select";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import LabelRuleFile, {
  ParsedLabelRuleImport,
} from "../../Utils/LabelRuleImportExport";
import API from "./API/API";
import ModelAPI from "./ModelAPI/ModelAPI";

export interface LabelRuleImportItem {
  index: number;
  name: string;
  description: string;
  isEnabled: boolean;
  labels: Array<string>;
  json: JSONObject;
  displayJson: JSONObject;
  portableJson: JSONObject;
}

export interface LabelRuleImportPreview {
  projectId: string;
  sourceResourceType: string;
  destinationResourceType: string;
  mappings: Array<string>;
  items: Array<LabelRuleImportItem>;
}

export interface LabelRuleImportFailure {
  index: number;
  itemName: string;
  errorMessage: string;
}

export interface LabelRuleImportResult {
  successCount: number;
  failures: Array<LabelRuleImportFailure>;
  retryPreview: LabelRuleImportPreview;
}

export const LABEL_RULE_IMPORT_CONCURRENCY: number = 5;
const PAGE_SIZE: number = 500;

export default class LabelRuleImportExport {
  public static async exportAll(data: {
    modelType: DatabaseBaseModelType;
    projectId: ObjectID;
    modelAPI?: typeof ModelAPI | undefined;
  }): Promise<JSONObject> {
    const items: Array<BaseModel> = await this.getAll({
      ...data,
      select: LabelRuleFile.getExportSelect(data.modelType),
    });
    return LabelRuleFile.buildExportEnvelope({
      modelType: data.modelType,
      items,
    });
  }

  public static async preview(data: {
    modelType: DatabaseBaseModelType;
    fileText: string;
    projectId: ObjectID;
    modelAPI?: typeof ModelAPI | undefined;
  }): Promise<LabelRuleImportPreview> {
    // Parse every row before any lookup, and resolve every relation before any write.
    const parsed: ParsedLabelRuleImport = LabelRuleFile.parse(data);
    const model: BaseModel = new data.modelType();
    const relationColumns: Array<string> = LabelRuleFile.getColumns(
      data.modelType,
    ).filter((column: string): boolean => {
      return (
        model.getTableColumnMetadata(column)?.type ===
        TableColumnType.EntityArray
      );
    });
    const indexes: Map<
      DatabaseBaseModelType,
      Map<string, Array<string>>
    > = new Map();
    for (const column of relationColumns) {
      if (
        !parsed.items.some(
          (item: ParsedLabelRuleImport["items"][number]): boolean => {
            return (item.json[column] as Array<string>).length > 0;
          },
        )
      ) {
        continue;
      }
      const metadata: TableColumnMetadata =
        model.getTableColumnMetadata(column)!;
      const relationType: DatabaseBaseModelType = metadata.modelType!;
      if (indexes.has(relationType)) {
        continue;
      }
      const relations: Array<BaseModel> = await this.getAll({
        modelType: relationType,
        projectId: data.projectId,
        modelAPI: data.modelAPI,
        select: { _id: true, name: true } as Select<BaseModel>,
      });
      const names: Map<string, Array<string>> = new Map();
      for (const relation of relations) {
        const name: unknown = relation.getValue("name");
        if (typeof name === "string" && relation.id) {
          const ids: Array<string> = names.get(name) || [];
          if (!ids.includes(relation.id.toString())) {
            ids.push(relation.id.toString());
          }
          names.set(name, ids);
        }
      }
      indexes.set(relationType, names);
    }

    const errors: Array<string> = [];
    const items: Array<LabelRuleImportItem> = parsed.items.map(
      (
        item: ParsedLabelRuleImport["items"][number],
        index: number,
      ): LabelRuleImportItem => {
        const json: JSONObject = { ...item.json };
        for (const column of relationColumns) {
          const metadata: TableColumnMetadata =
            model.getTableColumnMetadata(column)!;
          json[column] = (item.json[column] as Array<string>).map(
            (name: string): JSONObject => {
              const ids: Array<string> =
                indexes.get(metadata.modelType!)?.get(name) || [];
              if (ids.length !== 1) {
                errors.push(
                  `Rule ${index + 1} (${item.json["name"]}): ${metadata.title || column} "${name}" ${ids.length ? "matches multiple resources" : "was not found"} in the destination project. ${ids.length ? "Give these resources distinct names" : "Create or rename the resource"} before importing.`,
                );
                return {};
              }
              return { _id: ids[0]! };
            },
          );
        }
        return {
          index: index + 1,
          name: item.json["name"] as string,
          description: (item.json["description"] as string) || "",
          isEnabled: item.json["isEnabled"] as boolean,
          labels: item.json["labelsToAdd"] as Array<string>,
          json,
          displayJson: item.json,
          portableJson: item.portableJson,
        };
      },
    );
    if (errors.length) {
      throw new BadDataException(
        errors.slice(0, 20).join("\n") +
          (errors.length > 20
            ? `\nAnd ${errors.length - 20} more unresolved resources.`
            : ""),
      );
    }
    return {
      projectId: data.projectId.toString(),
      sourceResourceType: parsed.sourceResourceType,
      destinationResourceType: parsed.destinationResourceType,
      mappings: parsed.mappings,
      items,
    };
  }

  public static getRetryEnvelope(preview: LabelRuleImportPreview): JSONObject {
    return LabelRuleFile.envelope({
      resourceType: preview.sourceResourceType,
      items: preview.items.map((item: LabelRuleImportItem): JSONObject => {
        return item.portableJson;
      }),
    });
  }

  public static async importPreview(data: {
    preview: LabelRuleImportPreview;
    modelType: DatabaseBaseModelType;
    modelAPI?: typeof ModelAPI | undefined;
    onProgress?:
      | ((completedCount: number, totalCount: number) => void)
      | undefined;
  }): Promise<LabelRuleImportResult> {
    if (
      new data.modelType().tableName !== data.preview.destinationResourceType
    ) {
      throw new BadDataException(
        "The destination rule type changed. Preview this file again before importing.",
      );
    }
    const projectId: ObjectID = new ObjectID(data.preview.projectId);
    const modelAPI: typeof ModelAPI = data.modelAPI || ModelAPI;
    let nextItem: number = 0;
    let completed: number = 0;
    let successCount: number = 0;
    const failures: Array<LabelRuleImportFailure> = [];
    const worker: () => Promise<void> = async (): Promise<void> => {
      while (nextItem < data.preview.items.length) {
        const item: LabelRuleImportItem = data.preview.items[nextItem++]!;
        try {
          const model: BaseModel = BaseModel.fromJSONObject(
            item.json,
            data.modelType,
          );
          model.setValue("projectId", projectId);
          // Each row uses the normal API permission checks and validation hooks.
          // Never automatically retry: a lost response can follow a successful write.
          await modelAPI.create({
            model,
            modelType: data.modelType,
            requestOptions: {
              requestHeaders: { tenantid: projectId.toString() },
            },
          });
          successCount++;
        } catch (error) {
          failures.push({
            index: item.index,
            itemName: item.name,
            errorMessage: API.getFriendlyMessage(error),
          });
        }
        completed++;
        if (data.onProgress) {
          try {
            data.onProgress(completed, data.preview.items.length);
          } catch {
            // A rendering failure must not hide completed writes or abort the batch.
          }
        }
      }
    };
    await Promise.all(
      Array.from(
        {
          length: Math.min(
            LABEL_RULE_IMPORT_CONCURRENCY,
            data.preview.items.length,
          ),
        },
        worker,
      ),
    );
    failures.sort(
      (left: LabelRuleImportFailure, right: LabelRuleImportFailure): number => {
        return left.index - right.index;
      },
    );
    const failedIndexes: Set<number> = new Set(
      failures.map((failure: LabelRuleImportFailure): number => {
        return failure.index;
      }),
    );
    return {
      successCount,
      failures,
      retryPreview: {
        ...data.preview,
        items: data.preview.items.filter(
          (item: LabelRuleImportItem): boolean => {
            return failedIndexes.has(item.index);
          },
        ),
      },
    };
  }

  private static async getAll(data: {
    modelType: DatabaseBaseModelType;
    projectId: ObjectID;
    modelAPI?: typeof ModelAPI | undefined;
    select: Select<BaseModel>;
  }): Promise<Array<BaseModel>> {
    const modelAPI: typeof ModelAPI = data.modelAPI || ModelAPI;
    const items: Array<BaseModel> = [];
    let skip: number = 0;
    while (true) {
      const result: ListResult<BaseModel> = await modelAPI.getList({
        modelType: data.modelType,
        query: { projectId: data.projectId } as Query<BaseModel>,
        select: data.select,
        skip,
        limit: PAGE_SIZE,
        sort: { _id: SortOrder.Ascending },
        requestOptions: {
          requestHeaders: { tenantid: data.projectId.toString() },
        },
      });
      items.push(...result.data);
      skip += result.data.length;
      if (result.data.length === 0 || skip >= result.count) {
        return items;
      }
    }
  }
}
