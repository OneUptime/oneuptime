import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import CloudCostRecommendation from "../../../Models/DatabaseModels/CloudCostRecommendation";
import DataReconciliation from "../../../Models/DatabaseModels/DataReconciliation";
import IncidentReminderRule from "../../../Models/DatabaseModels/IncidentReminderRule";
import LlmModelPrice from "../../../Models/DatabaseModels/LlmModelPrice";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import CloudCostRecommendationService from "../../../Server/Services/CloudCostRecommendationService";
import DataReconciliationService from "../../../Server/Services/DataReconciliationService";
import IncidentReminderRuleService from "../../../Server/Services/IncidentReminderRuleService";
import LlmModelPriceService from "../../../Server/Services/LlmModelPriceService";
import CodeTaskLive from "../../../Server/Utils/AI/CodeTask/CodeTaskLive";
import logger from "../../../Server/Utils/Logger";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, describe, expect, test } from "@jest/globals";

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
 *   - LlmModelPrice's prices: 0 for a free model's tokens.
 *
 * Each service now says 0 is a value of those columns; everything else is
 * read as it always was.
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
