import LogPipelineProcessorService from "../../../Server/Services/LogPipelineProcessorService";
import LogPipelineProcessor from "../../../Models/DatabaseModels/LogPipelineProcessor";
import BadDataException from "../../../Types/Exception/BadDataException";
import LogPipelineProcessorType from "../../../Types/Log/LogPipelineProcessorType";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * Contract under test — the create/update hooks on
 * LogPipelineProcessorService.
 *
 * `processorType` is a free-text column, so the API has always accepted
 * a GrokParser processor with any configuration at all. Before the
 * processor was implemented that meant a silent no-op
 * (OneUptime/oneuptime#2515); now it means an unparsable pattern would
 * be a silent no-op instead, which is the same failure wearing a
 * different hat. The hooks compile the pattern while a human is still
 * looking at the form.
 *
 * Update is the harder half: a request need not name both fields, so
 * switching `processorType` to GrokParser over a stored severity-remap
 * configuration, or replacing the pattern on a row that is already a
 * GrokParser, both have to be caught by validating the MERGED row.
 */

const PROCESSOR_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const service: any = LogPipelineProcessorService as any;

function createBy(data: {
  processorType?: string | undefined;
  configuration?: JSONObject | string | undefined;
}): CreateBy<LogPipelineProcessor> {
  const model: any = new LogPipelineProcessor();
  model.name = "Parse nginx access logs";
  model.processorType = data.processorType;
  model.configuration = data.configuration;

  return {
    data: model,
    props: { isRoot: true },
  } as CreateBy<LogPipelineProcessor>;
}

function updateBy(
  patch: Record<string, unknown>,
): UpdateBy<LogPipelineProcessor> {
  return {
    query: { _id: PROCESSOR_ID.toString() },
    data: patch,
    props: { isRoot: true },
  } as unknown as UpdateBy<LogPipelineProcessor>;
}

/*
 * The update hook reads the rows the update matches so it can merge the
 * patch over them. This stands in for that read.
 */
function mockStoredRow(row: {
  processorType: string;
  configuration: JSONObject | string;
}): void {
  const model: any = new LogPipelineProcessor();
  model._id = PROCESSOR_ID.toString();
  model.processorType = row.processorType;
  model.configuration = row.configuration;

  jest
    .spyOn(service, "findBy")
    .mockImplementation(async (): Promise<Array<LogPipelineProcessor>> => {
      return [model];
    });
}

describe("LogPipelineProcessorService — on create", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("accepts a grok processor with a pattern that compiles", async () => {
    await expect(
      service.onBeforeCreate(
        createBy({
          processorType: LogPipelineProcessorType.GrokParser,
          configuration: {
            source: "body",
            pattern: "%{IPV4:client_ip} %{WORD:verb}",
          },
        }),
      ),
    ).resolves.toBeDefined();
  });

  it("rejects a grok processor whose pattern does not compile", async () => {
    await expect(
      service.onBeforeCreate(
        createBy({
          processorType: LogPipelineProcessorType.GrokParser,
          configuration: { source: "body", pattern: "%{NOSUCHTHING:x}" },
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  it("rejects a grok processor created with no pattern at all", async () => {
    await expect(
      service.onBeforeCreate(
        createBy({
          processorType: LogPipelineProcessorType.GrokParser,
          configuration: { source: "body" },
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  it("accepts the other processor types unchanged", async () => {
    await expect(
      service.onBeforeCreate(
        createBy({
          processorType: LogPipelineProcessorType.SeverityRemapper,
          configuration: {
            sourceKey: "level",
            mappings: [
              {
                matchValue: "warn",
                severityText: "Warning",
                severityNumber: 13,
              },
            ],
          },
        }),
      ),
    ).resolves.toBeDefined();
  });
});

describe("LogPipelineProcessorService — on update", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("accepts a new pattern that compiles", async () => {
    mockStoredRow({
      processorType: LogPipelineProcessorType.GrokParser,
      configuration: { source: "body", pattern: "%{WORD:verb}" },
    });

    await expect(
      service.onBeforeUpdate(
        updateBy({
          configuration: { source: "body", pattern: "%{IPV4:client_ip}" },
        }),
      ),
    ).resolves.toBeDefined();
  });

  it("rejects a new pattern that does not compile", async () => {
    mockStoredRow({
      processorType: LogPipelineProcessorType.GrokParser,
      configuration: { source: "body", pattern: "%{WORD:verb}" },
    });

    await expect(
      service.onBeforeUpdate(
        updateBy({
          configuration: { source: "body", pattern: "%{NOSUCHTHING:x}" },
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  it("catches a type switch to GrokParser over an unrelated stored configuration", async () => {
    mockStoredRow({
      processorType: LogPipelineProcessorType.SeverityRemapper,
      configuration: { sourceKey: "level", mappings: [] },
    });

    await expect(
      service.onBeforeUpdate(
        updateBy({ processorType: LogPipelineProcessorType.GrokParser }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  it("catches a broken pattern written onto a row that is already a GrokParser", async () => {
    mockStoredRow({
      processorType: LogPipelineProcessorType.GrokParser,
      configuration: { source: "body", pattern: "%{WORD:verb}" },
    });

    await expect(
      service.onBeforeUpdate(
        updateBy({ configuration: { source: "body", pattern: "%{WORD:a b}" } }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  it("does not read the stored row when the update touches neither field", async () => {
    const findBySpy: any = jest
      .spyOn(service, "findBy")
      .mockImplementation(async (): Promise<Array<LogPipelineProcessor>> => {
        return [];
      });

    await expect(
      service.onBeforeUpdate(updateBy({ name: "renamed" })),
    ).resolves.toBeDefined();

    expect(findBySpy).not.toHaveBeenCalled();
  });

  it("skips validation for a raw SQL expression it cannot evaluate", async () => {
    const findBySpy: any = jest
      .spyOn(service, "findBy")
      .mockImplementation(async (): Promise<Array<LogPipelineProcessor>> => {
        return [];
      });

    await expect(
      service.onBeforeUpdate(
        updateBy({
          configuration: () => {
            return "some_sql_expression";
          },
        }),
      ),
    ).resolves.toBeDefined();

    expect(findBySpy).not.toHaveBeenCalled();
  });

  it("leaves a non-grok processor's configuration alone", async () => {
    mockStoredRow({
      processorType: LogPipelineProcessorType.AttributeRemapper,
      configuration: { sourceKey: "src_ip", targetKey: "source_ip" },
    });

    await expect(
      service.onBeforeUpdate(
        updateBy({ configuration: { sourceKey: "a", targetKey: "b" } }),
      ),
    ).resolves.toBeDefined();
  });
});
