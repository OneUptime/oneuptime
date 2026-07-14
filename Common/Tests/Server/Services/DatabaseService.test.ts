import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { getJestSpyOn } from "../../Spy";

/*
 * Regression tests for DatabaseService._findBy sort/select handling.
 *
 * When a query loads relations, TypeORM paginates with a DISTINCT subquery and
 * references the sort columns in the outer ORDER BY. If a sort column is not in
 * the select, Postgres fails with "column ... does not exist". _findBy must add
 * every sort column to the select and strip the auto-added ones from the result.
 */
describe("DatabaseService._findBy sort columns", () => {
  type FindMock = jest.Mock;

  const makeItem: (fields: Record<string, unknown>) => AlertStateTimeline = (
    fields: Record<string, unknown>,
  ): AlertStateTimeline => {
    return Object.assign(new AlertStateTimeline(), fields);
  };

  const mockRepositoryFind: (items: Array<unknown>) => FindMock = (
    items: Array<unknown>,
  ): FindMock => {
    const find: FindMock = jest.fn().mockResolvedValue(items);
    getJestSpyOn(AlertStateTimelineService, "getRepository").mockReturnValue({
      find,
    } as never);
    return find;
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("adds a sorted-but-unselected column to the select passed to the repository", async () => {
    const find: FindMock = mockRepositoryFind([]);

    await AlertStateTimelineService.findBy({
      query: {},
      select: { alertStateId: true } as never,
      sort: { startsAt: SortOrder.Ascending } as never,
      skip: 0,
      limit: 10,
      props: { isRoot: true, ignoreHooks: true },
    });

    const select: Record<string, unknown> = find.mock.calls[0]![0].select;

    // The explicitly requested column stays selected.
    expect(select["alertStateId"]).toBe(true);
    // The sort column was added so the ORDER BY can resolve it.
    expect(select["startsAt"]).toBe(true);
  });

  test("strips the auto-added sort column from returned items", async () => {
    mockRepositoryFind([
      makeItem({
        _id: "1",
        alertStateId: "state-1",
        startsAt: new Date("2020-01-01"),
      }),
    ]);

    const items: Array<unknown> = await AlertStateTimelineService.findBy({
      query: {},
      select: { alertStateId: true } as never,
      sort: { startsAt: SortOrder.Ascending } as never,
      skip: 0,
      limit: 10,
      props: { isRoot: true, ignoreHooks: true },
    });

    const item: Record<string, unknown> = items[0] as Record<string, unknown>;
    expect(item["alertStateId"]).toBe("state-1");
    // startsAt was only added internally for the ORDER BY, so it is removed.
    expect(item).not.toHaveProperty("startsAt");
  });

  test("keeps a sort column that the caller explicitly selected", async () => {
    mockRepositoryFind([
      makeItem({
        _id: "1",
        alertStateId: "state-1",
        startsAt: new Date("2020-01-01"),
      }),
    ]);

    const items: Array<unknown> = await AlertStateTimelineService.findBy({
      query: {},
      select: { alertStateId: true, startsAt: true } as never,
      sort: { startsAt: SortOrder.Ascending } as never,
      skip: 0,
      limit: 10,
      props: { isRoot: true, ignoreHooks: true },
    });

    const item: Record<string, unknown> = items[0] as Record<string, unknown>;
    // Explicitly selected, so it must survive in the result.
    expect(item).toHaveProperty("startsAt");
  });

  test("defaults to createdAt sort and strips it when no sort is given", async () => {
    const find: FindMock = mockRepositoryFind([
      makeItem({
        _id: "1",
        alertStateId: "state-1",
        createdAt: new Date("2020-01-01"),
      }),
    ]);

    const items: Array<unknown> = await AlertStateTimelineService.findBy({
      query: {},
      select: { alertStateId: true } as never,
      skip: 0,
      limit: 10,
      props: { isRoot: true, ignoreHooks: true },
    });

    // Default sort is applied and its column is selected for the ORDER BY.
    expect(find.mock.calls[0]![0].order).toEqual({
      createdAt: SortOrder.Descending,
    });
    expect(find.mock.calls[0]![0].select["createdAt"]).toBe(true);

    // ...but the auto-added createdAt is stripped from the returned item.
    const item: Record<string, unknown> = items[0] as Record<string, unknown>;
    expect(item).not.toHaveProperty("createdAt");
  });
});
