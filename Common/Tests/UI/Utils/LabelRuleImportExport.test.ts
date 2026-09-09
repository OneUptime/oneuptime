import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import AlertLabelRule from "../../../Models/DatabaseModels/AlertLabelRule";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentLabelRule from "../../../Models/DatabaseModels/IncidentLabelRule";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorLabelRule from "../../../Models/DatabaseModels/MonitorLabelRule";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import LabelRuleImportExport, {
  LABEL_RULE_IMPORT_CONCURRENCY,
  LabelRuleImportPreview,
  LabelRuleImportResult,
  LabelRuleImportItem,
} from "../../../UI/Utils/LabelRuleImportExport";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import LabelRuleFile from "../../../Utils/LabelRuleImportExport";
import getJestMockFunction, { MockFunction } from "../../MockType";

const getListMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      create: (...args: Array<unknown>) => {
        return createMock(...args);
      },
    },
  };
});
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: Error): string => {
        return error.message;
      },
    },
  };
});

const projectId: ObjectID = new ObjectID(
  "11111111-1111-1111-1111-111111111111",
);
const base: JSONObject = {
  name: "Production",
  description: "A portable rule",
  isEnabled: false,
  labelsToAdd: ["Production"],
};
interface ListRequest {
  modelType: DatabaseBaseModelType;
  skip: number;
  limit: number;
}

const fileText: (
  items: Array<JSONObject>,
  modelType?: DatabaseBaseModelType,
) => string = (
  items: Array<JSONObject>,
  modelType: DatabaseBaseModelType = MonitorLabelRule,
): string => {
  return JSON.stringify(
    LabelRuleFile.envelope({ resourceType: new modelType().tableName!, items }),
  );
};
const makeRelation: (
  name: string,
  id: number,
  modelType?: DatabaseBaseModelType,
) => BaseModel = (
  name: string,
  id: number,
  modelType: DatabaseBaseModelType = Label,
): BaseModel => {
  const item: BaseModel = new modelType();
  item._id = `22222222-2222-2222-2222-${id.toString().padStart(12, "0")}`;
  item.setValue("name", name);
  return item;
};
const makeRule: (id: number) => MonitorLabelRule = (
  id: number,
): MonitorLabelRule => {
  const item: MonitorLabelRule = new MonitorLabelRule();
  item._id = `33333333-3333-3333-3333-${id.toString().padStart(12, "0")}`;
  item.name = `Rule ${id}`;
  item.description = `Description ${id}`;
  item.isEnabled = id % 2 === 0;
  item.monitorNamePattern = `^service-${id}$`;
  item.monitorLabels = [];
  item.labelsToAdd = [makeRelation("Production", 1) as Label];
  return item;
};
const mockPaged: (items: Array<BaseModel>, pageCap?: number) => void = (
  items: Array<BaseModel>,
  pageCap?: number,
): void => {
  getListMock.mockImplementation(async (request: ListRequest) => {
    return {
      data: items.slice(
        request.skip,
        request.skip + Math.min(request.limit, pageCap || request.limit),
      ),
      count: items.length,
      skip: request.skip,
      limit: request.limit,
    };
  });
};
const preview: (
  items?: Array<JSONObject>,
  modelType?: DatabaseBaseModelType,
) => Promise<LabelRuleImportPreview> = async (
  items: Array<JSONObject> = [base],
  modelType: DatabaseBaseModelType = MonitorLabelRule,
): Promise<LabelRuleImportPreview> => {
  return LabelRuleImportExport.preview({
    modelType,
    projectId,
    fileText: fileText(items, modelType),
  });
};

describe("label rule import and export API orchestration", () => {
  beforeEach(() => {
    getListMock.mockReset();
    createMock.mockReset();
    mockPaged([makeRelation("Production", 1)]);
    createMock.mockResolvedValue({});
  });

  test("exports more than 1500 rules through stable, project-scoped pages", async () => {
    mockPaged(
      Array.from(
        { length: 1603 },
        (_value: unknown, index: number): MonitorLabelRule => {
          return makeRule(index);
        },
      ),
    );
    const envelope: JSONObject = await LabelRuleImportExport.exportAll({
      modelType: MonitorLabelRule,
      projectId,
    });
    expect(envelope["items"]).toHaveLength(1603);
    expect((envelope["items"] as Array<JSONObject>)[1602]).toMatchObject({
      name: "Rule 1602",
      monitorNamePattern: "^service-1602$",
      labelsToAdd: ["Production"],
    });
    expect(JSON.stringify(envelope)).not.toContain("33333333-");
    expect(JSON.stringify(envelope)).not.toContain("22222222-");
    expect(
      getListMock.mock.calls.map((call: Array<any>): number => {
        return call[0].skip;
      }),
    ).toEqual([0, 500, 1000, 1500]);
    for (const [request] of getListMock.mock.calls) {
      expect(request).toMatchObject({
        query: { projectId },
        sort: { _id: "ASC" },
        requestOptions: { requestHeaders: { tenantid: projectId.toString() } },
        select: {
          labelsToAdd: { name: true },
          monitorLabels: { name: true },
          monitorNamePattern: true,
        },
      });
    }
  });

  test("keeps paging when the server caps page size below the requested limit", async () => {
    mockPaged(
      Array.from(
        { length: 225 },
        (_value: unknown, index: number): MonitorLabelRule => {
          return makeRule(index);
        },
      ),
      100,
    );
    const envelope: JSONObject = await LabelRuleImportExport.exportAll({
      modelType: MonitorLabelRule,
      projectId,
    });
    expect(envelope["items"]).toHaveLength(225);
    expect(
      getListMock.mock.calls.map((call: Array<any>): number => {
        return call[0].skip;
      }),
    ).toEqual([0, 100, 200]);
  });

  test("exports an empty list without getting stuck in pagination", async () => {
    mockPaged([]);
    expect(
      (
        await LabelRuleImportExport.exportAll({
          modelType: MonitorLabelRule,
          projectId,
        })
      )["items"],
    ).toEqual([]);
    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("fails the export on a later page instead of returning a truncated file", async () => {
    getListMock.mockResolvedValueOnce({
      data: [makeRule(0)],
      count: 2,
      skip: 0,
      limit: 500,
    });
    getListMock.mockRejectedValueOnce(new Error("Permission denied"));
    await expect(
      LabelRuleImportExport.exportAll({
        modelType: MonitorLabelRule,
        projectId,
      }),
    ).rejects.toThrow("Permission denied");
  });

  test("resolves a label beyond the first 1500 results and caches the label lookup across relation columns", async () => {
    const labels: Array<BaseModel> = Array.from(
      { length: 1602 },
      (_value: unknown, index: number): BaseModel => {
        return makeRelation(`Label ${index}`, index);
      },
    );
    mockPaged(labels);
    const result: LabelRuleImportPreview = await preview([
      { ...base, monitorLabels: ["Label 1599"], labelsToAdd: ["Label 1601"] },
    ]);
    expect(getListMock).toHaveBeenCalledTimes(4);
    expect(result.projectId).toBe(projectId.toString());
    expect(result.items[0]!.json).toMatchObject({
      monitorLabels: [{ _id: labels[1599]!._id }],
      labelsToAdd: [{ _id: labels[1601]!._id }],
    });
    expect(result.items[0]!.displayJson).toMatchObject({
      monitorLabels: ["Label 1599"],
      labelsToAdd: ["Label 1601"],
    });
    expect(JSON.stringify(result.items[0]!.displayJson)).not.toContain(
      "22222222-",
    );
    expect(createMock).not.toHaveBeenCalled();
  });

  test("resolves prerequisite labels, output labels, monitors, and remapped alert severities in the destination", async () => {
    const resources: Map<DatabaseBaseModelType, Array<BaseModel>> = new Map([
      [Label, [makeRelation("Production", 1), makeRelation("Existing", 2)]],
      [Monitor, [makeRelation("API", 3, Monitor)]],
      [AlertSeverity, [makeRelation("Critical", 4, AlertSeverity)]],
    ]);
    getListMock.mockImplementation(async (request: ListRequest) => {
      const data: Array<BaseModel> = resources.get(request.modelType)!;
      return { data, count: data.length, skip: 0, limit: 500 };
    });
    const result: LabelRuleImportPreview = await LabelRuleImportExport.preview({
      modelType: AlertLabelRule,
      projectId,
      fileText: fileText(
        [
          {
            ...base,
            incidentLabels: ["Existing"],
            incidentSeverities: ["Critical"],
            monitors: ["API"],
          },
        ],
        IncidentLabelRule,
      ),
    });
    expect(getListMock).toHaveBeenCalledTimes(3);
    expect(result.items[0]!.json).toMatchObject({
      alertSeverities: [{ _id: resources.get(AlertSeverity)![0]!._id }],
      alertLabels: [{ _id: resources.get(Label)![1]!._id }],
      monitors: [{ _id: resources.get(Monitor)![0]!._id }],
    });
    expect(result.items[0]!.portableJson).toMatchObject({
      incidentLabels: ["Existing"],
      incidentSeverities: ["Critical"],
    });
  });

  test("does not issue relation requests for unconfigured criteria", async () => {
    const result: LabelRuleImportPreview = await preview([
      { ...base, labelsToAdd: [] },
    ]);
    expect(result.items[0]!.labels).toEqual([]);
    expect(getListMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  test("blocks the whole batch for a missing label in a late row", async () => {
    const rows: Array<JSONObject> = Array.from(
      { length: 1601 },
      (): JSONObject => {
        return base;
      },
    );
    rows[1600] = { ...base, labelsToAdd: ["Missing"] };
    await expect(preview(rows)).rejects.toThrow(
      'Rule 1601 (Production): Labels to Add "Missing" was not found',
    );
    expect(createMock).not.toHaveBeenCalled();
  });

  test("rejects ambiguous destination names without choosing the first resource", async () => {
    mockPaged([makeRelation("Production", 1), makeRelation("Production", 2)]);
    await expect(preview()).rejects.toThrow("matches multiple resources");
    expect(createMock).not.toHaveBeenCalled();
  });

  test("uses exact names, including case, when resolving destination resources", async () => {
    mockPaged([makeRelation("production", 1)]);
    await expect(preview()).rejects.toThrow("was not found");
  });

  test("rejects unreadable or missing IDs instead of creating an empty relation", async () => {
    const label: BaseModel = makeRelation("Production", 1);
    delete label._id;
    mockPaged([label]);
    await expect(preview()).rejects.toThrow("was not found");
  });

  test("preflights all file rows before starting even read requests", async () => {
    await expect(
      preview([base, { ...base, isEnabled: "true" }]),
    ).rejects.toThrow("Rule 2");
    expect(getListMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  test("propagates failed relation reads without starting writes", async () => {
    getListMock.mockRejectedValueOnce(new Error("Cannot read labels"));
    await expect(preview()).rejects.toThrow("Cannot read labels");
    expect(createMock).not.toHaveBeenCalled();
  });

  test("imports through the create API with resolved relations, destination project and preserved disabled state", async () => {
    const prepared: LabelRuleImportPreview = await preview();
    const result: LabelRuleImportResult =
      await LabelRuleImportExport.importPreview({
        modelType: MonitorLabelRule,
        preview: prepared,
      });
    expect(result).toMatchObject({
      successCount: 1,
      failures: [],
      retryPreview: { items: [] },
    });
    const request: any = createMock.mock.calls[0]![0];
    expect(request.model).toBeInstanceOf(MonitorLabelRule);
    expect(request.model.projectId.toString()).toBe(projectId.toString());
    expect(request.model.isEnabled).toBe(false);
    expect(request.model.labelsToAdd[0].id.toString()).toBe(
      makeRelation("Production", 1)._id,
    );
    expect(request.model.id).toBeNull();
    expect(request).toMatchObject({
      modelType: MonitorLabelRule,
      requestOptions: { requestHeaders: { tenantid: projectId.toString() } },
    });
  });

  test("bounds simultaneous creates and reports each completed row once", async () => {
    const prepared: LabelRuleImportPreview = await preview(
      Array.from(
        { length: 43 },
        (_value: unknown, index: number): JSONObject => {
          return { ...base, name: `Rule ${index}` };
        },
      ),
    );
    let active: number = 0;
    let peak: number = 0;
    createMock.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return {};
    });
    const onProgress: MockFunction = getJestMockFunction();
    const result: LabelRuleImportResult =
      await LabelRuleImportExport.importPreview({
        modelType: MonitorLabelRule,
        preview: prepared,
        onProgress,
      });
    expect(peak).toBe(LABEL_RULE_IMPORT_CONCURRENCY);
    expect(createMock).toHaveBeenCalledTimes(43);
    expect(result.successCount).toBe(43);
    expect(onProgress.mock.calls).toEqual(
      Array.from(
        { length: 43 },
        (_value: unknown, index: number): Array<number> => {
          return [index + 1, 43];
        },
      ),
    );
  });

  test("records failures by original row index even with duplicate names and exports only failed portable rows", async () => {
    const prepared: LabelRuleImportPreview = await preview([
      base,
      { ...base, description: "Success" },
      { ...base, description: "Another failure" },
    ]);
    createMock.mockRejectedValueOnce(new Error("Response lost"));
    createMock.mockResolvedValueOnce({});
    createMock.mockRejectedValueOnce(new Error("Permission denied"));
    const result: LabelRuleImportResult =
      await LabelRuleImportExport.importPreview({
        modelType: MonitorLabelRule,
        preview: prepared,
      });
    expect(createMock).toHaveBeenCalledTimes(3);
    expect(result.successCount).toBe(1);
    expect(result.failures).toEqual([
      { index: 1, itemName: "Production", errorMessage: "Response lost" },
      { index: 3, itemName: "Production", errorMessage: "Permission denied" },
    ]);
    expect(
      result.retryPreview.items.map((item: LabelRuleImportItem): number => {
        return item.index;
      }),
    ).toEqual([1, 3]);
    const retry: JSONObject = LabelRuleImportExport.getRetryEnvelope(
      result.retryPreview,
    );
    expect(retry["items"]).toEqual([
      base,
      { ...base, description: "Another failure" },
    ]);
    expect(JSON.stringify(retry)).not.toContain("22222222-");
    expect(JSON.stringify(retry)).not.toContain(projectId.toString());
    createMock.mockClear();
    await LabelRuleImportExport.importPreview({
      modelType: MonitorLabelRule,
      preview: result.retryPreview,
    });
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  test("uses source resource fields in downloaded failures after cross-type import", async () => {
    const prepared: LabelRuleImportPreview =
      await LabelRuleImportExport.preview({
        modelType: AlertLabelRule,
        projectId,
        fileText: fileText(
          [{ ...base, incidentTitlePattern: "api" }],
          IncidentLabelRule,
        ),
      });
    createMock.mockRejectedValueOnce(new Error("Create failed"));
    const result: LabelRuleImportResult =
      await LabelRuleImportExport.importPreview({
        modelType: AlertLabelRule,
        preview: prepared,
      });
    const retry: JSONObject = LabelRuleImportExport.getRetryEnvelope(
      result.retryPreview,
    );
    expect(retry["resourceType"]).toBe("IncidentLabelRule");
    expect((retry["items"] as Array<JSONObject>)[0]).toMatchObject({
      incidentTitlePattern: "api",
      labelsToAdd: ["Production"],
    });
    expect(
      (retry["items"] as Array<JSONObject>)[0]!["alertTitlePattern"],
    ).toBeUndefined();
  });

  test("never retries or renames a failed create automatically", async () => {
    const prepared: LabelRuleImportPreview = await preview();
    createMock.mockRejectedValue(new Error("Rule already exists"));
    const result: LabelRuleImportResult =
      await LabelRuleImportExport.importPreview({
        modelType: MonitorLabelRule,
        preview: prepared,
      });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(result.failures).toHaveLength(1);
    expect(result.retryPreview.items[0]!.name).toBe("Production");
  });

  test("reports completed writes even when the progress callback throws", async () => {
    const prepared: LabelRuleImportPreview = await preview([base, base]);
    const result: LabelRuleImportResult =
      await LabelRuleImportExport.importPreview({
        modelType: MonitorLabelRule,
        preview: prepared,
        onProgress: () => {
          throw new Error("Render failed");
        },
      });
    expect(result.successCount).toBe(2);
    expect(result.failures).toEqual([]);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  test("rejects a changed destination type before writing", async () => {
    const prepared: LabelRuleImportPreview = await preview();
    await expect(
      LabelRuleImportExport.importPreview({
        modelType: IncidentLabelRule,
        preview: prepared,
      }),
    ).rejects.toThrow("destination rule type changed");
    expect(createMock).not.toHaveBeenCalled();
  });

  test("supports an injected API for both preview and import", async () => {
    const injectedCreate: MockFunction = getJestMockFunction();
    injectedCreate.mockResolvedValue({});
    const injectedAPI: typeof ModelAPI = {
      getList: ModelAPI.getList,
      create: injectedCreate,
    } as unknown as typeof ModelAPI;
    const prepared: LabelRuleImportPreview =
      await LabelRuleImportExport.preview({
        modelType: MonitorLabelRule,
        projectId,
        fileText: fileText([base]),
        modelAPI: injectedAPI,
      });
    await LabelRuleImportExport.importPreview({
      modelType: MonitorLabelRule,
      preview: prepared,
      modelAPI: injectedAPI,
    });
    expect(injectedCreate).toHaveBeenCalledTimes(1);
    expect(createMock).not.toHaveBeenCalled();
  });
});
