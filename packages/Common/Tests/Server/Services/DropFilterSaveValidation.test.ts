import LogDropFilterService from "../../../Server/Services/LogDropFilterService";
import TraceDropFilterService from "../../../Server/Services/TraceDropFilterService";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LogDropFilter from "../../../Models/DatabaseModels/LogDropFilter";
import TraceDropFilter from "../../../Models/DatabaseModels/TraceDropFilter";
import LogDropFilterAction from "../../../Types/Log/LogDropFilterAction";
import TraceDropFilterAction from "../../../Types/Trace/TraceDropFilterAction";
import { coerceNumericColumnsInJSON } from "../../../Types/Database/NumericColumnValue";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * Contract under test — the create/update hooks on both drop-filter services.
 *
 * A drop filter is the only piece of project config that deletes customer
 * data as its normal operation, and two of its fields could be saved in
 * states the engine could not honour:
 *
 *   - a blank `filterQuery`, which compiled to "match every record" and so
 *     turned the filter into "discard 100% of this project's telemetry",
 *   - `action = "sample"` with no percentage, which the engine read as
 *     "discard half".
 *
 * Update is the harder half: a request need not name every field, so
 * flipping `action` to "sample" while the stored percentage is null, or
 * blanking `filterQuery` on a row whose action is already "drop", both have
 * to be caught by validating the MERGED row rather than the incoming patch.
 */

const FILTER_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

interface StoredRow {
  action: string;
  samplePercentage: number | undefined;
  filterQuery: string;
}

const VALID_QUERY: string = "severityText = 'Debug'";

/*
 * Each case runs against both services. They are separate classes over
 * separate tables with their own action enums, and the whole point of sharing
 * the validator is that neither can drift — so every assertion is made twice
 * rather than trusting the log side to speak for the trace side.
 */
const SUITES: Array<{
  name: string;
  service: any;
  modelType: any;
  makeModel: () => any;
  sampleAction: string;
  dropAction: string;
  recordNoun: string;
}> = [
  {
    name: "LogDropFilterService",
    service: LogDropFilterService,
    modelType: LogDropFilter,
    makeModel: (): LogDropFilter => {
      return new LogDropFilter();
    },
    sampleAction: LogDropFilterAction.Sample,
    dropAction: LogDropFilterAction.Drop,
    recordNoun: "logs",
  },
  {
    name: "TraceDropFilterService",
    service: TraceDropFilterService,
    modelType: TraceDropFilter,
    makeModel: (): TraceDropFilter => {
      return new TraceDropFilter();
    },
    sampleAction: TraceDropFilterAction.Sample,
    dropAction: TraceDropFilterAction.Drop,
    recordNoun: "spans",
  },
];

describe.each(SUITES)(
  "$name save-time validation",
  ({ service, makeModel, sampleAction, dropAction, recordNoun }: any) => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    function createBy(data: {
      action?: string | undefined;
      samplePercentage?: number | undefined;
      filterQuery?: string | undefined;
    }): CreateBy<any> {
      const model: any = makeModel();
      model.name = "Noisy debug logs";
      model.projectId = PROJECT_ID;
      model.action = data.action;
      model.filterQuery = data.filterQuery;

      if (data.samplePercentage !== undefined) {
        model.samplePercentage = data.samplePercentage;
      }

      return { data: model, props: { isRoot: true } } as CreateBy<any>;
    }

    function updateBy(patch: Record<string, unknown>): UpdateBy<any> {
      return {
        query: { _id: FILTER_ID.toString() },
        data: patch,
        props: { isRoot: true },
      } as unknown as UpdateBy<any>;
    }

    /*
     * The update hook reads the rows the update matches so it can merge the
     * patch over them. This stands in for that read.
     */
    function mockStoredRow(row: StoredRow): jest.SpiedFunction<any> {
      const model: any = makeModel();
      model._id = FILTER_ID.toString();
      model.action = row.action;
      model.filterQuery = row.filterQuery;
      if (row.samplePercentage !== undefined) {
        model.samplePercentage = row.samplePercentage;
      }

      return jest
        .spyOn(service, "findBy")
        .mockImplementation(async (): Promise<Array<any>> => {
          return [model];
        }) as unknown as jest.SpiedFunction<any>;
    }

    describe("on create", () => {
      it("accepts a drop filter with a real condition", async () => {
        await expect(
          service.onBeforeCreate(
            createBy({ action: dropAction, filterQuery: VALID_QUERY }),
          ),
        ).resolves.toBeDefined();
      });

      it("accepts a sample filter with a percentage in range", async () => {
        await expect(
          service.onBeforeCreate(
            createBy({
              action: sampleAction,
              samplePercentage: 10,
              filterQuery: VALID_QUERY,
            }),
          ),
        ).resolves.toBeDefined();
      });

      it("rejects a blank filter query, which would match everything", async () => {
        for (const blank of ["", "   ", "\n\t"]) {
          await expect(
            service.onBeforeCreate(
              createBy({ action: dropAction, filterQuery: blank }),
            ),
          ).rejects.toThrow(BadDataException);
        }
      });

      it("rejects a missing filter query", async () => {
        await expect(
          service.onBeforeCreate(createBy({ action: dropAction })),
        ).rejects.toThrow(BadDataException);
      });

      it("names the right record type in the error", async () => {
        await expect(
          service.onBeforeCreate(
            createBy({ action: dropAction, filterQuery: "" }),
          ),
        ).rejects.toThrow(new RegExp(recordNoun));
      });

      it("rejects a sample filter with no percentage", async () => {
        await expect(
          service.onBeforeCreate(
            createBy({ action: sampleAction, filterQuery: VALID_QUERY }),
          ),
        ).rejects.toThrow(BadDataException);
      });

      it("rejects a sample percentage outside 1-99", async () => {
        for (const outOfRange of [0, 100, -1, 250]) {
          await expect(
            service.onBeforeCreate(
              createBy({
                action: sampleAction,
                samplePercentage: outOfRange,
                filterQuery: VALID_QUERY,
              }),
            ),
          ).rejects.toThrow(BadDataException);
        }
      });

      it("does not care about the percentage on a drop filter", async () => {
        await expect(
          service.onBeforeCreate(
            createBy({
              action: dropAction,
              samplePercentage: 0,
              filterQuery: VALID_QUERY,
            }),
          ),
        ).resolves.toBeDefined();
      });
    });

    describe("on update", () => {
      /*
       * The hook must not pay for a SELECT on writes that cannot break the
       * row — renaming a filter or toggling it off is the common case.
       */
      it("skips the row read entirely when no validated field is touched", async () => {
        const findBy: jest.SpiedFunction<any> = mockStoredRow({
          action: dropAction,
          samplePercentage: undefined,
          filterQuery: VALID_QUERY,
        });

        await service.onBeforeUpdate(
          updateBy({ name: "Renamed", isEnabled: false, sortOrder: 3 }),
        );

        expect(findBy).not.toHaveBeenCalled();
      });

      it("accepts a percentage change that stays in range", async () => {
        mockStoredRow({
          action: sampleAction,
          samplePercentage: 10,
          filterQuery: VALID_QUERY,
        });

        await expect(
          service.onBeforeUpdate(updateBy({ samplePercentage: 25 })),
        ).resolves.toBeDefined();
      });

      it("rejects a percentage change that leaves the range", async () => {
        mockStoredRow({
          action: sampleAction,
          samplePercentage: 10,
          filterQuery: VALID_QUERY,
        });

        await expect(
          service.onBeforeUpdate(updateBy({ samplePercentage: 0 })),
        ).rejects.toThrow(BadDataException);
      });

      /*
       * The merge case that a patch-only check would miss: the request names
       * only `action`, and the row it lands on has no percentage stored.
       */
      it("rejects flipping to sample when the stored percentage is null", async () => {
        mockStoredRow({
          action: dropAction,
          samplePercentage: undefined,
          filterQuery: VALID_QUERY,
        });

        await expect(
          service.onBeforeUpdate(updateBy({ action: sampleAction })),
        ).rejects.toThrow(BadDataException);
      });

      it("allows flipping to sample when the patch supplies the percentage", async () => {
        mockStoredRow({
          action: dropAction,
          samplePercentage: undefined,
          filterQuery: VALID_QUERY,
        });

        await expect(
          service.onBeforeUpdate(
            updateBy({ action: sampleAction, samplePercentage: 5 }),
          ),
        ).resolves.toBeDefined();
      });

      it("allows flipping to sample when the stored percentage is already valid", async () => {
        mockStoredRow({
          action: dropAction,
          samplePercentage: 20,
          filterQuery: VALID_QUERY,
        });

        await expect(
          service.onBeforeUpdate(updateBy({ action: sampleAction })),
        ).resolves.toBeDefined();
      });

      /*
       * The other merge case: blanking the query on a row that is already a
       * drop filter. The patch alone looks like a harmless text edit.
       */
      it("rejects blanking the filter query on an existing drop filter", async () => {
        mockStoredRow({
          action: dropAction,
          samplePercentage: undefined,
          filterQuery: VALID_QUERY,
        });

        for (const blank of ["", "  "]) {
          await expect(
            service.onBeforeUpdate(updateBy({ filterQuery: blank })),
          ).rejects.toThrow(BadDataException);
        }
      });

      it("allows replacing the filter query with another real condition", async () => {
        mockStoredRow({
          action: dropAction,
          samplePercentage: undefined,
          filterQuery: VALID_QUERY,
        });

        await expect(
          service.onBeforeUpdate(
            updateBy({ filterQuery: "body CONTAINS 'healthcheck'" }),
          ),
        ).resolves.toBeDefined();
      });

      /*
       * A query can match more than one row. Every matched row has to be
       * checked, or a bulk update could break the ones it did not look at.
       */
      it("validates every row the update matches, not just the first", async () => {
        const healthy: any = makeModel();
        healthy._id = FILTER_ID.toString();
        healthy.action = sampleAction;
        healthy.samplePercentage = 10;
        healthy.filterQuery = VALID_QUERY;

        const wouldBreak: any = makeModel();
        wouldBreak._id = PROJECT_ID.toString();
        wouldBreak.action = dropAction;
        wouldBreak.filterQuery = VALID_QUERY;
        // no samplePercentage stored

        jest
          .spyOn(service, "findBy")
          .mockImplementation(async (): Promise<Array<any>> => {
            return [healthy, wouldBreak];
          });

        await expect(
          service.onBeforeUpdate(updateBy({ action: sampleAction })),
        ).rejects.toThrow(BadDataException);
      });

      it("passes when the update matches no rows at all", async () => {
        jest
          .spyOn(service, "findBy")
          .mockImplementation(async (): Promise<Array<any>> => {
            return [];
          });

        await expect(
          service.onBeforeUpdate(updateBy({ filterQuery: "" })),
        ).resolves.toBeDefined();
      });

      /*
       * A raw SQL expression cannot be evaluated here. Skipping is correct;
       * rejecting would break a legitimate caller and validating a
       * stringified function would be nonsense.
       */
      it("skips validation when a validated field is a raw SQL expression", async () => {
        const findBy: jest.SpiedFunction<any> = mockStoredRow({
          action: dropAction,
          samplePercentage: undefined,
          filterQuery: VALID_QUERY,
        });

        await expect(
          service.onBeforeUpdate(
            updateBy({
              filterQuery: () => {
                return "'x'";
              },
            }),
          ),
        ).resolves.toBeDefined();

        expect(findBy).not.toHaveBeenCalled();
      });
    });
  },
);

/*
 * The reported failure, driven the way the product actually drives it.
 *
 * The suites above hand the hook a model built in TypeScript, where a number
 * is a number by construction. Nothing reaches the hook that way in
 * production: BaseAPI.createItem rebuilds the model from the request body
 * with BaseModel.fromJSON, and that body comes from a dashboard form whose
 * "Sample Percentage" field is an `<input type="number">` — a DOM input
 * whose value is a *string*. So the hook was handed "10", the check read
 * `typeof samplePercentage !== "number"`, and a user who had filled the form
 * in correctly got:
 *
 *   HTTP 400 — Sample percentage is required when the action is "Sample".
 *   Enter the percentage of matching logs to keep, between 1 and 99.
 *
 * github.com/OneUptime/oneuptime/issues/3027
 *
 * These go through fromJSON on purpose. A test that constructs the model
 * directly cannot fail on this bug, which is precisely why the existing
 * suite passed while the feature was unusable.
 */
describe.each(SUITES)(
  "$name create from a dashboard request body",
  ({ service, modelType, sampleAction, dropAction }: any) => {
    function createByFromRequestBody(body: Record<string, unknown>): any {
      return {
        data: BaseModel.fromJSON(body as any, modelType),
        props: { isRoot: true },
      };
    }

    it("accepts the sample percentage as the number input sends it", async () => {
      await expect(
        service.onBeforeCreate(
          createByFromRequestBody({
            name: "Sample healthcheck logs",
            filterQuery: VALID_QUERY,
            action: sampleAction,
            samplePercentage: "10",
            sortOrder: "1",
            isEnabled: true,
          }),
        ),
      ).resolves.toBeDefined();
    });

    it("stores it as a number, not as the string it arrived as", async () => {
      const createBy: any = createByFromRequestBody({
        filterQuery: VALID_QUERY,
        action: sampleAction,
        samplePercentage: "10",
      });

      await service.onBeforeCreate(createBy);

      expect(createBy.data.samplePercentage).toBe(10);
      expect(typeof createBy.data.samplePercentage).toBe("number");
    });

    it("accepts every percentage the form allows", async () => {
      for (const percentage of ["1", "5", "10", "50", "99"]) {
        await expect(
          service.onBeforeCreate(
            createByFromRequestBody({
              filterQuery: VALID_QUERY,
              action: sampleAction,
              samplePercentage: percentage,
            }),
          ),
        ).resolves.toBeDefined();
      }
    });

    /*
     * Coercion must not become a way around the range check — "0" and "100"
     * are still the two values that mean something the Sample action cannot
     * express.
     */
    it("still rejects an out-of-range percentage that arrives as a string", async () => {
      for (const percentage of ["0", "100", "-1", "250"]) {
        await expect(
          service.onBeforeCreate(
            createByFromRequestBody({
              filterQuery: VALID_QUERY,
              action: sampleAction,
              samplePercentage: percentage,
            }),
          ),
        ).rejects.toThrow(BadDataException);
      }
    });

    it("still rejects a sample filter whose percentage field was left blank", async () => {
      await expect(
        service.onBeforeCreate(
          createByFromRequestBody({
            filterQuery: VALID_QUERY,
            action: sampleAction,
            samplePercentage: "",
          }),
        ),
      ).rejects.toThrow(BadDataException);
    });

    it("still rejects a percentage that is not a number at all", async () => {
      await expect(
        service.onBeforeCreate(
          createByFromRequestBody({
            filterQuery: VALID_QUERY,
            action: sampleAction,
            samplePercentage: "abc",
          }),
        ),
      ).rejects.toThrow(BadDataException);
    });

    it("accepts the drop payload, which carries no percentage at all", async () => {
      await expect(
        service.onBeforeCreate(
          createByFromRequestBody({
            name: "Drop debug",
            filterQuery: VALID_QUERY,
            action: dropAction,
            sortOrder: "1",
            isEnabled: true,
          }),
        ),
      ).resolves.toBeDefined();
    });

    /*
     * The other half of the same create. `droppedCount` is ingest-owned and
     * never present in a create body, so it has to stay unset all the way to
     * the INSERT — where the column's DEFAULT 0 applies. A create that
     * carried an explicit null instead is what made this a 500 rather than a
     * 400. github.com/OneUptime/oneuptime/issues/3026
     */
    it("leaves the ingest-owned counter unset for the column default", async () => {
      const createBy: any = createByFromRequestBody({
        name: "Drop debug",
        filterQuery: VALID_QUERY,
        action: dropAction,
      });

      await service.onBeforeCreate(createBy);

      expect(createBy.data.droppedCount).toBeUndefined();
      expect(createBy.data.lastDroppedAt).toBeUndefined();
    });
  },
);

/*
 * The same request body, sent as an edit rather than a create.
 *
 * `BaseAPI.updateItem` does not build a model — it deserializes the body
 * into a partial entity — so it normalizes number columns itself. Without
 * that, changing a saved filter's percentage in the dashboard failed the
 * same way creating one did, and only on the update verb.
 */
describe.each(SUITES)(
  "$name update from a dashboard request body",
  ({ service, makeModel, sampleAction, dropAction }: any) => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    function updateByFromRequestBody(body: Record<string, unknown>): any {
      return {
        query: { _id: FILTER_ID.toString() },
        data: coerceNumericColumnsInJSON(body as any, makeModel()),
        props: { isRoot: true },
      };
    }

    function mockStoredRow(row: StoredRow): void {
      const model: any = makeModel();
      model._id = FILTER_ID.toString();
      model.action = row.action;
      model.filterQuery = row.filterQuery;
      if (row.samplePercentage !== undefined) {
        model.samplePercentage = row.samplePercentage;
      }

      jest
        .spyOn(service, "findBy")
        .mockImplementation(async (): Promise<Array<any>> => {
          return [model];
        });
    }

    it("accepts a percentage change sent as a string", async () => {
      mockStoredRow({
        action: sampleAction,
        samplePercentage: 10,
        filterQuery: VALID_QUERY,
      });

      await expect(
        service.onBeforeUpdate(
          updateByFromRequestBody({ samplePercentage: "25" }),
        ),
      ).resolves.toBeDefined();
    });

    it("accepts flipping a drop filter to sample with a string percentage", async () => {
      mockStoredRow({
        action: dropAction,
        samplePercentage: undefined,
        filterQuery: VALID_QUERY,
      });

      await expect(
        service.onBeforeUpdate(
          updateByFromRequestBody({
            action: sampleAction,
            samplePercentage: "5",
          }),
        ),
      ).resolves.toBeDefined();
    });

    it("still rejects an out-of-range percentage sent as a string", async () => {
      mockStoredRow({
        action: sampleAction,
        samplePercentage: 10,
        filterQuery: VALID_QUERY,
      });

      for (const percentage of ["0", "100"]) {
        await expect(
          service.onBeforeUpdate(
            updateByFromRequestBody({ samplePercentage: percentage }),
          ),
        ).rejects.toThrow(BadDataException);
      }
    });
  },
);
