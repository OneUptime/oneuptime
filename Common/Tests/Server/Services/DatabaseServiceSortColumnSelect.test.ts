import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentReminderRule from "../../../Models/DatabaseModels/IncidentReminderRule";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * A column can be ordered by without being selected in a plain SELECT, but not
 * once a relation is also selected: the join sends the query down TypeORM's
 * paginated path, which wraps it and orders the outer SELECT by a column the
 * inner query only emits when that column was selected. Postgres then rejects
 * the whole request with `column distinctAlias.<Alias>_<column> does not
 * exist`, which surfaces as a 500 and blanks the page.
 *
 * It went wrong twice: the monitor overview's probe query sorting by createdAt,
 * then the reminder countdown's three rule queries sorting by `order`.
 * _findBy used to fill the sort column in only for callers that passed NO sort
 * at all, so an explicit sort bypassed the safety net entirely. It now fills in
 * every sorted column and strips the ones it added back off the results, so no
 * call site has to know about any of this.
 */

type FindArgs = {
  select?: Record<string, unknown> | undefined;
  order?: Record<string, unknown> | undefined;
};

describe("DatabaseService._findBy selects the columns it sorts by", () => {
  let service: DatabaseService<IncidentReminderRule>;
  let find: jest.Mock;
  let rowsReturnedByDatabase: Array<IncidentReminderRule>;

  type MakeRowFunction = (data: {
    order: number;
    reminderIntervalInMinutes: number;
  }) => IncidentReminderRule;

  const makeRow: MakeRowFunction = (data: {
    order: number;
    reminderIntervalInMinutes: number;
  }): IncidentReminderRule => {
    const rule: IncidentReminderRule = new IncidentReminderRule();
    rule.order = data.order;
    rule.reminderIntervalInMinutes = data.reminderIntervalInMinutes;
    return rule;
  };

  type FindByFunction = (data: {
    select?: Record<string, unknown> | undefined;
    sort?: Record<string, unknown> | undefined;
  }) => Promise<Array<IncidentReminderRule>>;

  const findBy: FindByFunction = (data: {
    select?: Record<string, unknown> | undefined;
    sort?: Record<string, unknown> | undefined;
  }): Promise<Array<IncidentReminderRule>> => {
    return service.findBy({
      query: {},
      limit: 10,
      skip: 0,
      select: data.select as any,
      sort: data.sort as any,
      props: { isRoot: true },
    });
  };

  const selectPassedToDatabase: () => Record<string, unknown> = (): Record<
    string,
    unknown
  > => {
    return (find.mock.calls[0]![0] as FindArgs).select || {};
  };

  beforeEach(() => {
    jest.restoreAllMocks();

    service = new DatabaseService<IncidentReminderRule>(IncidentReminderRule);

    /*
     * The row the database hands back always carries the sorted column,
     * because _findBy asked for it - that is the point. Whether the caller
     * gets to see it is what these tests are about.
     */
    rowsReturnedByDatabase = [
      makeRow({ order: 1, reminderIntervalInMinutes: 15 }),
      makeRow({ order: 2, reminderIntervalInMinutes: 30 }),
    ];

    find = jest
      .fn()
      .mockImplementation(async (): Promise<Array<IncidentReminderRule>> => {
        return rowsReturnedByDatabase;
      });

    jest.spyOn(service, "getRepository").mockReturnValue({ find: find } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("adds an explicitly sorted column that the caller did not select", async () => {
    await findBy({
      select: {
        reminderIntervalInMinutes: true,
        incidentSeverities: { _id: true },
        labels: { _id: true },
      },
      sort: { order: SortOrder.Ascending },
    });

    expect(selectPassedToDatabase()["order"]).toBe(true);
  });

  it("hides the added column from the caller", async () => {
    const rules: Array<IncidentReminderRule> = await findBy({
      select: {
        reminderIntervalInMinutes: true,
        labels: { _id: true },
      },
      sort: { order: SortOrder.Ascending },
    });

    expect(rules).toHaveLength(2);

    for (const rule of rules) {
      expect(rule.order).toBeUndefined();
      expect(rule.reminderIntervalInMinutes).toBeDefined();
    }
  });

  it("keeps the column when the caller selected it themselves", async () => {
    const rules: Array<IncidentReminderRule> = await findBy({
      select: {
        order: true,
        reminderIntervalInMinutes: true,
        labels: { _id: true },
      },
      sort: { order: SortOrder.Ascending },
    });

    expect(
      rules.map((rule: IncidentReminderRule) => {
        return rule.order;
      }),
    ).toEqual([1, 2]);
  });

  it("adds every column of a multi-column sort", async () => {
    await findBy({
      select: { labels: { _id: true } },
      sort: {
        order: SortOrder.Ascending,
        reminderIntervalInMinutes: SortOrder.Descending,
      },
    });

    expect(selectPassedToDatabase()["order"]).toBe(true);
    expect(selectPassedToDatabase()["reminderIntervalInMinutes"]).toBe(true);
  });

  it("does not add a relation that is being sorted on", async () => {
    await findBy({
      select: { reminderIntervalInMinutes: true },
      sort: { labels: SortOrder.Ascending },
    });

    expect(selectPassedToDatabase()["labels"]).toBeUndefined();
  });

  it("leaves the caller's own select object untouched", async () => {
    const callerSelect: Record<string, unknown> = {
      reminderIntervalInMinutes: true,
      labels: { _id: true },
    };

    await findBy({
      select: callerSelect,
      sort: { order: SortOrder.Ascending },
    });

    expect(callerSelect["order"]).toBeUndefined();
  });

  it("still fills in and hides createdAt for callers that pass no sort", async () => {
    const rules: Array<IncidentReminderRule> = await findBy({
      select: {
        reminderIntervalInMinutes: true,
        labels: { _id: true },
      },
    });

    expect(selectPassedToDatabase()["createdAt"]).toBe(true);
    expect((find.mock.calls[0]![0] as FindArgs).order?.["createdAt"]).toBe(
      SortOrder.Descending,
    );

    for (const rule of rules) {
      expect(rule.createdAt).toBeUndefined();
    }
  });
});
