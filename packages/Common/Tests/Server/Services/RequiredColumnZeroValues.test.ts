import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import CloudCostRecommendation from "../../../Models/DatabaseModels/CloudCostRecommendation";
import DataReconciliation from "../../../Models/DatabaseModels/DataReconciliation";
import IncidentReminderRule from "../../../Models/DatabaseModels/IncidentReminderRule";
import Models from "../../../Models/DatabaseModels/Index";
import LlmModelPrice from "../../../Models/DatabaseModels/LlmModelPrice";
import OpenStackProjectUsage from "../../../Models/DatabaseModels/OpenStackProjectUsage";
import ServiceLevelObjectiveErrorBudgetPolicyTier from "../../../Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import BaseService from "../../../Server/Services/BaseService";
import CloudCostRecommendationService from "../../../Server/Services/CloudCostRecommendationService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import DataReconciliationService from "../../../Server/Services/DataReconciliationService";
import IncidentReminderRuleService from "../../../Server/Services/IncidentReminderRuleService";
import Services from "../../../Server/Services/Index";
import LlmModelPriceService from "../../../Server/Services/LlmModelPriceService";
import OpenStackProjectUsageService from "../../../Server/Services/OpenStackProjectUsageService";
import RunnerJobService from "../../../Server/Services/RunnerJobService";
import ServiceLevelObjectiveErrorBudgetPolicyTierService from "../../../Server/Services/ServiceLevelObjectiveErrorBudgetPolicyTierService";
import TelemetryIngestionKeyRefusalService from "../../../Server/Services/TelemetryIngestionKeyRefusalService";
import CodeTaskLive from "../../../Server/Utils/AI/CodeTask/CodeTaskLive";
import logger from "../../../Server/Utils/Logger";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, describe, expect, test } from "@jest/globals";
import { ValueTransformer, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * Required numbers that 0 is a real value of.
 *
 * The required-column check (DatabaseService.checkRequiredFields) reads every
 * falsy value as missing, 0 included - right for a reminder every 0 minutes,
 * wrong for these, which a create refused as "<column> is required":
 *
 *   - AIRunEvent.sequence: a run's first event is sequence 0. Every AI run's
 *     first event was refused, and a code-fix run's every event - its
 *     sequence is the run's event count, which stayed 0 - so the Runner's
 *     progress never reached the task's log (issue #6144: "Failed to append
 *     AIRunEvent (ProgressLog): Error: sequence is required");
 *   - CloudCostRecommendation.monthlySavings: 0 while a right-sizing's cost
 *     is not known, so the recommendation was dropped;
 *   - DataReconciliation.tolerance: 0 means the two must agree exactly;
 *   - LlmModelPrice's prices: 0 for a free model's tokens;
 *   - ServiceLevelObjectiveErrorBudgetPolicyTier.thresholdPercentage: 0% is
 *     the tier of an exhausted budget, the recommended policy's last tier
 *     (Budget exhausted, the one that freezes deployments). A tier at 0%
 *     was refused, and "Use the recommended policy" stopped after adding
 *     its first two tiers (#6978);
 *   - OpenStackProjectUsage.sortValue: 0 for a project that has cost
 *     nothing (its rows are written by raw SQL today, which the check never
 *     sees, but a create would have been refused).
 *
 * Each service now says 0 is a value of those columns; everything else is
 * read as it always was. And every required number of every table is held
 * to a decision, at the end of this file, so the next one is made on
 * purpose rather than found by a customer.
 */

type RequiredCheck = {
  checkRequiredFields: (data: unknown) => unknown;
  isRequiredColumnValueGiven: (column: string, value: unknown) => boolean;
};

function asRequiredCheck(service: unknown): RequiredCheck {
  return service as RequiredCheck;
}

/*
 * A record with every required column given - the check only asks whether
 * each is there - and `values` on top.
 */
function recordOf<TModel extends BaseModel>(
  model: TModel,
  values: Record<string, unknown>,
): TModel {
  for (const column of model.getRequiredColumns().columns) {
    (model as unknown as Record<string, unknown>)[column] = "given";
  }

  for (const column of Object.keys(values)) {
    (model as unknown as Record<string, unknown>)[column] = values[column];
  }

  return model;
}

interface ZeroCase {
  name: string;
  service: unknown;
  makeModel: () => BaseModel;
  columns: Array<string>;
  // Another of the model's required columns, which must still be given.
  otherRequiredColumn: string;
}

const CASES: Array<ZeroCase> = [
  {
    name: "an AI run's first event",
    service: AIRunEventService,
    makeModel: (): BaseModel => {
      return new AIRunEvent();
    },
    columns: ["sequence"],
    otherRequiredColumn: "eventType",
  },
  {
    name: "a cloud saving not known yet",
    service: CloudCostRecommendationService,
    makeModel: (): BaseModel => {
      return new CloudCostRecommendation();
    },
    columns: ["monthlySavings"],
    otherRequiredColumn: "action",
  },
  {
    name: "a reconciliation that must agree exactly",
    service: DataReconciliationService,
    makeModel: (): BaseModel => {
      return new DataReconciliation();
    },
    columns: ["tolerance"],
    otherRequiredColumn: "toleranceType",
  },
  {
    name: "a free model's price",
    service: LlmModelPriceService,
    makeModel: (): BaseModel => {
      return new LlmModelPrice();
    },
    columns: [
      "inputPricePerMillionTokensInUSD",
      "outputPricePerMillionTokensInUSD",
    ],
    otherRequiredColumn: "modelPrefix",
  },
  {
    name: "an error budget policy tier for an exhausted budget",
    service: ServiceLevelObjectiveErrorBudgetPolicyTierService,
    makeModel: (): BaseModel => {
      return new ServiceLevelObjectiveErrorBudgetPolicyTier();
    },
    columns: ["thresholdPercentage"],
    otherRequiredColumn: "name",
  },
  {
    name: "an OpenStack project that has cost nothing",
    service: OpenStackProjectUsageService,
    makeModel: (): BaseModel => {
      return new OpenStackProjectUsage();
    },
    columns: ["sortValue"],
    otherRequiredColumn: "period",
  },
];

describe("required numbers 0 is a value of", () => {
  for (const zeroCase of CASES) {
    for (const column of zeroCase.columns) {
      describe(`${zeroCase.name}: ${column}`, () => {
        test("is a required column of the model - else this suite proves nothing", () => {
          expect(zeroCase.makeModel().getRequiredColumns().columns).toContain(
            column,
          );
        });

        test("0 is not refused as missing", () => {
          expect(() => {
            asRequiredCheck(zeroCase.service).checkRequiredFields(
              recordOf(zeroCase.makeModel(), { [column]: 0 }),
            );
          }).not.toThrow();
        });

        test.each([[1], [42], [0.5]])("nor is %p", (value: number) => {
          expect(() => {
            asRequiredCheck(zeroCase.service).checkRequiredFields(
              recordOf(zeroCase.makeModel(), { [column]: value }),
            );
          }).not.toThrow();
        });

        test.each([
          ["no value at all", undefined],
          ["null", null],
          ["a number that is not one", Number.NaN],
          ["an empty string", ""],
        ] as Array<[string, unknown]>)(
          "%s is still refused",
          (_what: string, value: unknown) => {
            const attempt: () => void = (): void => {
              asRequiredCheck(zeroCase.service).checkRequiredFields(
                recordOf(zeroCase.makeModel(), { [column]: value }),
              );
            };

            expect(attempt).toThrow(BadDataException);
            expect(attempt).toThrow(`${column} is required`);
          },
        );

        test("the model's other required columns are still required", () => {
          const model: BaseModel = recordOf(zeroCase.makeModel(), {
            [column]: 0,
            [zeroCase.otherRequiredColumn]: undefined,
          });

          expect(model.getRequiredColumns().columns).toContain(
            zeroCase.otherRequiredColumn,
          );
          expect(() => {
            asRequiredCheck(zeroCase.service).checkRequiredFields(model);
          }).toThrow(`${zeroCase.otherRequiredColumn} is required`);
        });

        test("the service lets 0 through for that column alone", () => {
          const service: RequiredCheck = asRequiredCheck(zeroCase.service);

          expect(service.isRequiredColumnValueGiven(column, 0)).toBe(true);
          expect(service.isRequiredColumnValueGiven("someOtherColumn", 0)).toBe(
            false,
          );
        });
      });
    }
  }

  test("a reminder every 0 minutes is still refused, as the check always did", () => {
    const service: RequiredCheck = asRequiredCheck(IncidentReminderRuleService);

    expect(
      service.isRequiredColumnValueGiven("reminderIntervalInMinutes", 0),
    ).toBe(false);
    expect(() => {
      service.checkRequiredFields(
        recordOf(new IncidentReminderRule(), {
          reminderIntervalInMinutes: 0,
        }),
      );
    }).toThrow("reminderIntervalInMinutes is required");
  });
});

/*
 * The path the customer's log came from: the Runner's progress lines reach
 * appendEventToRun, whose sequence is the run's event count - 0 for a run
 * with none yet. The create here runs the same required-column check the
 * real one does, so the first event of a run is held to it.
 */
describe("AIRunEventService.appendEventToRun", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a run's first event, sequence 0, is kept - not refused as 'sequence is required'", async () => {
    const created: Array<AIRunEvent> = [];

    jest
      .spyOn(AIRunEventService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(AIRunEventService, "create")
      .mockImplementation(async (createBy: CreateBy<AIRunEvent>) => {
        asRequiredCheck(AIRunEventService).checkRequiredFields(createBy.data);
        created.push(createBy.data);
        return createBy.data;
      });
    jest.spyOn(CodeTaskLive, "announce").mockResolvedValue(undefined as never);
    const errors: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        // Kept quiet; asserted below.
      });

    await AIRunEventService.appendEventToRun({
      projectId: ObjectID.generate(),
      aiRunId: ObjectID.generate(),
      eventType: AIRunEventType.ProgressLog,
      resultSummary: { message: "Cloning repository acme/checkout..." },
    });

    expect(errors).not.toHaveBeenCalled();
    expect(created).toHaveLength(1);
    expect(created[0]!.sequence).toBe(0);
    expect(created[0]!.eventType).toBe(AIRunEventType.ProgressLog);
  });

  test("each later event takes the next number", async () => {
    jest
      .spyOn(AIRunEventService, "countBy")
      .mockResolvedValue(new PositiveNumber(7));
    const create: jest.SpyInstance = jest
      .spyOn(AIRunEventService, "create")
      .mockImplementation(async (createBy: CreateBy<AIRunEvent>) => {
        asRequiredCheck(AIRunEventService).checkRequiredFields(createBy.data);
        return createBy.data;
      });
    jest.spyOn(CodeTaskLive, "announce").mockResolvedValue(undefined as never);

    await AIRunEventService.appendEventToRun({
      projectId: ObjectID.generate(),
      aiRunId: ObjectID.generate(),
      eventType: AIRunEventType.RunFailed,
    });

    expect(
      (create.mock.calls[0]![0] as CreateBy<AIRunEvent>).data.sequence,
    ).toBe(7);
  });
});

/*
 * EVERY REQUIRED NUMBER SAYS WHETHER 0 IS A VALUE OF IT.
 *
 * The required-column check reads 0 as missing unless the column's service
 * says otherwise (DatabaseService.isRequiredColumnValueGiven), and seven
 * tables found that out the hard way, each from a create refused as
 * "<column> is required" for a 0 that meant something - the last an SLO's
 * error budget policy tier at 0% (#6978). So every required number column
 * of every table, with no default to fall back on, is listed here once,
 * with why:
 *
 *   - ZERO_IS_A_VALUE: 0 means something, so the column's service lets it
 *     through the check (the 0 as a row holds it - a number, or a Decimal);
 *   - ZERO_IS_NOT_A_VALUE: 0 means nothing, so the check refuses it as
 *     missing - or the service's own hook refuses it first, in its own
 *     words.
 *
 * A new required number fails here until somebody decides which it is.
 */

const ZERO_IS_A_VALUE: Record<string, string> = {
  "AIRunEvent.sequence": "a run's first event is sequence 0",
  "CloudCostRecommendation.monthlySavings":
    "a right-sizing whose saving is not known yet, or one that rounds to nothing",
  "DataReconciliation.tolerance": "the two tables must agree exactly",
  "LlmModelPrice.inputPricePerMillionTokensInUSD":
    "a model that bills its output only",
  "LlmModelPrice.outputPricePerMillionTokensInUSD":
    "a model that bills its input only, as embeddings do",
  "OpenStackProjectUsage.sortValue": "a project that has cost nothing",
  "ServiceLevelObjectiveErrorBudgetPolicyTier.thresholdPercentage":
    "the tier of an exhausted budget, which the recommended policy ends with",
  "StatusPageHistoryChartBarColorRule.uptimePercentGreaterThanOrEqualTo":
    "the rule every day reaches: an uptime of at least 0%",
  "TelemetryUsageBilling.dataIngestedInGB":
    "a day whose usage rounds to nothing",
  "TelemetryUsageBilling.totalCostInUSD":
    "usage metered where billing is off, which costs nothing",
};

const ZERO_IS_NOT_A_VALUE: Record<string, string> = {
  "AlertReminderRule.reminderIntervalInMinutes":
    "a reminder every 0 minutes, which the service refuses first",
  "CloudBudget.monthlyAmount":
    "a budget of nothing, which the service refuses first",
  "HostCollectorConfigVersion.versionNumber": "versions count from 1",
  "IncidentReminderRule.reminderIntervalInMinutes":
    "a reminder every 0 minutes, which the service refuses first",
  "LlmCostBudget.dailyBudgetInUSD":
    "a budget of nothing, which the service refuses first",
  "MarketplaceCharge.amountInUSD":
    "a charge of nothing, which the service refuses first",
  "MarketplaceUsageReport.quantity":
    "a report is written only for usage there is to bill",
  "NetworkInterface.interfaceIndex":
    "an interface's ifIndex is greater than zero (RFC 2863)",
  "OpenStackBudget.monthlyAmount":
    "a budget of nothing, which the service refuses first",
  "RunnerJob.timeoutInMs": "a job with no time to run",
  "ScheduledMaintenanceReminderRule.reminderIntervalInMinutes":
    "a reminder every 0 minutes, which the service refuses first",
  "ServiceLevelObjective.targetPercentage":
    "a target of 0%, which the service refuses first",
  "ServiceLevelObjectiveBurnRateRule.burnRateThreshold":
    "a burn rate of 0, which the service refuses first",
  "ServiceLevelObjectiveBurnRateRule.longWindowInMinutes":
    "a window of no time, which the service refuses first",
  "ServiceLevelObjectiveBurnRateRule.shortWindowInMinutes":
    "a window of no time, which the service refuses first",
  "TelemetryIngestionKeyRefusal.refusedCount":
    "a row is a refusal that happened",
  "UserOnCallShiftReminder.minutesBeforeShift":
    "a reminder at least 15 minutes before a shift, which the service holds it to first",
  "WorkflowVersion.versionNumber": "versions count from 1",
  "WorkspaceNotificationSummary.numberOfDaysOfData":
    "a summary of no days, which the service refuses first",
};

// Services/Index's, and the ones it does not list.
const databaseServices: Array<DatabaseService<BaseModel>> = [
  ...(Services as Array<BaseService>),
  AIRunEventService,
  RunnerJobService,
  TelemetryIngestionKeyRefusalService,
].filter((service: unknown): boolean => {
  return service instanceof DatabaseService;
}) as Array<DatabaseService<BaseModel>>;

function serviceOf(tableName: string): DatabaseService<BaseModel> {
  const service: DatabaseService<BaseModel> | undefined = databaseServices.find(
    (candidate: DatabaseService<BaseModel>): boolean => {
      return candidate.getModel().tableName === tableName;
    },
  );

  if (!service) {
    throw new Error(
      `No service of ${tableName}: import it into this suite's databaseServices.`,
    );
  }

  return service;
}

function modelTypeOf(tableName: string): new () => BaseModel {
  const modelType: (new () => BaseModel) | undefined = (
    Models as Array<new () => BaseModel>
  ).find((candidate: new () => BaseModel): boolean => {
    return new candidate().tableName === tableName;
  });

  if (!modelType) {
    throw new Error(`No model of ${tableName} in Models/DatabaseModels/Index.`);
  }

  return modelType;
}

// "Table.column" of every required number a create checks with nothing to fall back on.
function requiredNumbersWithoutDefault(): Array<string> {
  const found: Array<string> = [];

  for (const modelType of Models as Array<new () => BaseModel>) {
    const model: BaseModel = new modelType();

    for (const column of model.getRequiredColumns().columns) {
      const metadata: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(column);

      if (
        metadata &&
        metadata.type === TableColumnType.Number &&
        !model.isDefaultValueColumn(column)
      ) {
        found.push(`${model.tableName}.${column}`);
      }
    }
  }

  return found.sort();
}

/*
 * The column's 0 as a row holds it: what Postgres answers ("0", a decimal
 * comes back as text) read through the column's transformer - a number,
 * or a Decimal. A column with no transformer holds the number.
 */
function zeroAsHeld(modelType: new () => BaseModel, column: string): unknown {
  const columnArgs: ColumnMetadataArgs | undefined =
    getMetadataArgsStorage().columns.find((args: ColumnMetadataArgs) => {
      return args.target === modelType && args.propertyName === column;
    });

  const transformer: ValueTransformer | Array<ValueTransformer> | undefined =
    columnArgs?.options.transformer;

  if (transformer && !Array.isArray(transformer)) {
    return transformer.from("0");
  }

  return 0;
}

describe("every required number says whether 0 is a value of it", () => {
  test("each required number with no default is listed once, and nothing else is", () => {
    const listed: Array<string> = [
      ...Object.keys(ZERO_IS_A_VALUE),
      ...Object.keys(ZERO_IS_NOT_A_VALUE),
    ].sort();

    // Listed in both says nothing.
    expect(
      Object.keys(ZERO_IS_A_VALUE).filter((key: string): boolean => {
        return key in ZERO_IS_NOT_A_VALUE;
      }),
    ).toEqual([]);

    /*
     * A new column turns up on the left: put it in ZERO_IS_A_VALUE - and
     * have its service let 0 through (isRequiredColumnValueGiven) - or in
     * ZERO_IS_NOT_A_VALUE, with why. One gone from its model turns up on
     * the right.
     */
    expect(requiredNumbersWithoutDefault()).toEqual(listed);
  });

  for (const [key, why] of Object.entries(ZERO_IS_A_VALUE)) {
    const [tableName, column] = key.split(".") as [string, string];

    describe(`${key} (${why})`, () => {
      test("its 0 is let through by the service's required-column check", () => {
        const modelType: new () => BaseModel = modelTypeOf(tableName);

        expect(() => {
          asRequiredCheck(serviceOf(tableName)).checkRequiredFields(
            recordOf(new modelType(), {
              [column]: zeroAsHeld(modelType, column),
            }),
          );
        }).not.toThrow();
      });

      test("a value that is not there is still refused", () => {
        const modelType: new () => BaseModel = modelTypeOf(tableName);

        for (const missing of [undefined, null]) {
          expect(() => {
            asRequiredCheck(serviceOf(tableName)).checkRequiredFields(
              recordOf(new modelType(), { [column]: missing }),
            );
          }).toThrow(`${column} is required`);
        }
      });
    });
  }

  for (const [key, why] of Object.entries(ZERO_IS_NOT_A_VALUE)) {
    const [tableName, column] = key.split(".") as [string, string];

    test(`${key}: 0 is refused as missing (${why})`, () => {
      const service: RequiredCheck = asRequiredCheck(serviceOf(tableName));
      const modelType: new () => BaseModel = modelTypeOf(tableName);

      expect(service.isRequiredColumnValueGiven(column, 0)).toBe(false);
      expect(() => {
        service.checkRequiredFields(recordOf(new modelType(), { [column]: 0 }));
      }).toThrow(`${column} is required`);
    });
  }
});
