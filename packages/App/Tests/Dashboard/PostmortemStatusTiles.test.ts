jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  FacetColumnQuery,
  buildFacetColumnQuery,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FacetColumnQuery";
import {
  FacetOperatorMap,
  FacetSelectionMap,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FacetTileSelection";
import {
  FilterChipDropdownOption,
  FilterOperator,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import { ResourceFacet } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/ResourceFacet";
import {
  POSTMORTEMS_TABLE_ID,
  POSTMORTEM_STATUS_FACET_KEY,
  POSTMORTEM_STATUS_FACET_LABEL,
} from "../../FeatureSet/Dashboard/src/Components/Postmortem/PostmortemListFacetKeys";
import { POSTMORTEM_LIST_FACETS } from "../../FeatureSet/Dashboard/src/Components/Postmortem/PostmortemListFacets";
import {
  PostmortemStatusChoice,
  toPostmortemStatusChoices,
} from "../../FeatureSet/Dashboard/src/Components/Postmortem/PostmortemStatusChoices";
import {
  PostmortemStatusTile,
  applyPostmortemStatusTile,
  getPostmortemStatusTileCountClassName,
  getPostmortemStatusTileSelection,
  getPostmortemStatusTiles,
  getPostmortemStatusTilesGridClassName,
  isPostmortemStatusTileApplied,
} from "../../FeatureSet/Dashboard/src/Components/Postmortem/PostmortemStatusTiles";
import { ARCHIVED_FACET_GROUP } from "../../FeatureSet/Dashboard/src/Components/ArchivableValue/ArchivedValueFacetOptions";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentPostmortemStatus from "Common/Models/DatabaseModels/IncidentPostmortemStatus";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import { PostmortemProgress } from "Common/Utils/Incident/PostmortemStatus";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The Postmortems list (Incidents > Postmortems) answers the customer's
 * question - "which postmortems are still owed, by which team, for which
 * severity?" - with chips over the list and a tile per status above it.
 * A tile is worth having only if three things agree: the number on it, the
 * rows its click puts on screen, and the chip that click lights. Those are
 * built in three places (a COUNT in PostmortemStatusSummaryCards, the
 * Postmortem Status chip's query, the tile's click), all from the modules
 * pinned here.
 */

const getListMock: jest.Mock = ModelAPI.getList as unknown as jest.Mock;

const PROJECT_ID: ObjectID = new ObjectID(
  "6c000000-0000-4000-8000-0000000000aa",
);

// A column count from md up: a tablet, where the side menu takes a third.
const MD_GRID_COLUMNS: RegExp = /(^|\s)md:grid-cols-/;

const NOT_STARTED: string = "6c000000-0000-4000-8000-000000000001";
const DRAFT: string = "6c000000-0000-4000-8000-000000000002";
const IN_REVIEW: string = "6c000000-0000-4000-8000-000000000003";
const COMPLETED: string = "6c000000-0000-4000-8000-000000000004";
const NOT_NEEDED: string = "6c000000-0000-4000-8000-000000000005";
const OLD_PROCESS: string = "6c000000-0000-4000-8000-000000000006";

const OWNER_TEAM_ID: string = "6c000000-0000-4000-8000-0000000000b1";
const CRITICAL_ID: string = "6c000000-0000-4000-8000-0000000000c1";

function status(
  id: string,
  name: string,
  order: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    _id: id,
    name: name,
    order: order,
    description: `${name}: what it means.`,
    color: `#00000${order}`,
    ...extra,
  };
}

// A project with its own In Review, and a status it archived.
const CHOICES: Array<PostmortemStatusChoice> = toPostmortemStatusChoices([
  status(NOT_STARTED, "Not Started", 1, { isNotStartedStatus: true }),
  status(DRAFT, "Draft", 2, { isDraftStatus: true }),
  status(IN_REVIEW, "In Review", 3),
  status(COMPLETED, "Completed", 4, { isCompletedStatus: true }),
  status(NOT_NEEDED, "Not Needed", 5),
  status(OLD_PROCESS, "Old Process", 6, { isArchived: true }),
]);

const TILES: Array<PostmortemStatusTile> = getPostmortemStatusTiles(CHOICES);

function tile(id: string): PostmortemStatusTile {
  const found: PostmortemStatusTile | undefined = TILES.find(
    (candidate: PostmortemStatusTile): boolean => {
      return candidate.statusId === id;
    },
  );

  if (!found) {
    throw new Error(`No tile for ${id}`);
  }

  return found;
}

/*
 * A stand-in for useResourceOwners' facet state. As with the hook, a change
 * is not seen by the handler that made it until the next render: the maps
 * a click was handed are a snapshot.
 */
interface FakeFacetBar {
  selections: FacetSelectionMap;
  operators: FacetOperatorMap;
  calls: Array<{
    key: string;
    values: Array<string>;
    operator?: string | undefined;
  }>;
  setFacetSelection: (
    facetKey: string,
    values: Array<string>,
    operator?: FilterOperator,
  ) => void;
}

function facetBar(
  selections: FacetSelectionMap = {},
  operators: FacetOperatorMap = {},
): FakeFacetBar {
  const bar: FakeFacetBar = {
    selections: { ...selections },
    operators: { ...operators },
    calls: [],
    setFacetSelection: (): void => {},
  };

  bar.setFacetSelection = (
    facetKey: string,
    values: Array<string>,
    operator?: FilterOperator,
  ): void => {
    bar.calls.push({ key: facetKey, values: values, operator: operator });
    bar.selections = { ...bar.selections, [facetKey]: values };
    bar.operators = { ...bar.operators, [facetKey]: operator || "is" };
  };

  return bar;
}

function click(bar: FakeFacetBar, id: string): void {
  applyPostmortemStatusTile({
    tile: tile(id),
    facetSelections: bar.selections,
    facetOperators: bar.operators,
    setFacetSelection: bar.setFacetSelection,
  });
}

function isLit(bar: FakeFacetBar, id: string): boolean {
  return isPostmortemStatusTileApplied(tile(id), bar.selections, bar.operators);
}

function facet(key: string): ResourceFacet {
  const found: ResourceFacet | undefined = POSTMORTEM_LIST_FACETS.find(
    (candidate: ResourceFacet): boolean => {
      return candidate.key === key;
    },
  );

  if (!found) {
    throw new Error(`No chip ${key}`);
  }

  return found;
}

function idsIn(value: unknown): Array<string> {
  return ((value as Includes | IncludesNone).values as Array<unknown>).map(
    (id: unknown): string => {
      return String(id);
    },
  );
}

// What the list asks for under the chips, as useResourceOwners merges them.
function queryFromChips(bar: FakeFacetBar): Record<string, unknown> {
  const merged: Record<string, unknown> = { projectId: PROJECT_ID };

  for (const chip of POSTMORTEM_LIST_FACETS) {
    const columnQuery: FacetColumnQuery | null = buildFacetColumnQuery({
      facet: chip,
      operator: bar.operators[chip.key] || "is",
      values: bar.selections[chip.key] || [],
      existingValue: merged[chip.queryField || chip.key],
    });

    if (columnQuery) {
      merged[columnQuery.field] = columnQuery.value;
    }
  }

  return merged;
}

beforeEach(() => {
  getListMock.mockReset();
  getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 0 });
});

describe("the tiles above the Postmortems list", () => {
  test("one per status the project uses, top of its list first: an archived one gets none", () => {
    expect(
      TILES.map((candidate: PostmortemStatusTile): string => {
        return candidate.name;
      }),
    ).toEqual(["Not Started", "Draft", "In Review", "Completed", "Not Needed"]);
  });

  test("each carries the status's id, words, colour and what it counts as", () => {
    expect(tile(IN_REVIEW)).toEqual({
      statusId: IN_REVIEW,
      name: "In Review",
      description: "In Review: what it means.",
      color: "#000003",
      progress: PostmortemProgress.InProgress,
    });
    expect(tile(NOT_STARTED).progress).toBe(PostmortemProgress.NotStarted);
    expect(tile(NOT_NEEDED).progress).toBe(PostmortemProgress.Done);
  });

  test("a project whose statuses could not be read has no tiles", () => {
    expect(getPostmortemStatusTiles([])).toEqual([]);
  });
});

describe("a tile's click moves the Postmortem Status chip", () => {
  test("to exactly the status it counts", () => {
    const bar: FakeFacetBar = facetBar();

    click(bar, DRAFT);

    expect(bar.calls).toEqual([
      { key: POSTMORTEM_STATUS_FACET_KEY, values: [DRAFT], operator: "is" },
    ]);
    expect(isLit(bar, DRAFT)).toBe(true);
    expect(isLit(bar, NOT_STARTED)).toBe(false);
  });

  test("a second click clears that chip again", () => {
    const bar: FakeFacetBar = facetBar();

    click(bar, NOT_STARTED);
    click(bar, NOT_STARTED);

    expect(bar.calls[1]).toEqual({
      key: POSTMORTEM_STATUS_FACET_KEY,
      values: [],
      operator: "is",
    });
    expect(isLit(bar, NOT_STARTED)).toBe(false);
  });

  test("another tile moves the chip from one status to the other", () => {
    const bar: FakeFacetBar = facetBar();

    click(bar, NOT_STARTED);
    click(bar, DRAFT);

    expect(bar.selections[POSTMORTEM_STATUS_FACET_KEY]).toEqual([DRAFT]);
    expect(isLit(bar, NOT_STARTED)).toBe(false);
    expect(isLit(bar, DRAFT)).toBe(true);
  });

  test("the owner and severity the reader picked stay: only the status chip moves", () => {
    const bar: FakeFacetBar = facetBar({
      owner: [`team:${OWNER_TEAM_ID}`],
      incidentSeverity: [CRITICAL_ID],
    });

    click(bar, NOT_STARTED);

    expect(
      bar.calls.map((call: { key: string }): string => {
        return call.key;
      }),
    ).toEqual([POSTMORTEM_STATUS_FACET_KEY]);
    expect(bar.selections["owner"]).toEqual([`team:${OWNER_TEAM_ID}`]);
    expect(bar.selections["incidentSeverity"]).toEqual([CRITICAL_ID]);
  });

  test("a chip on two statuses is narrowed to the tile's one, not cleared", () => {
    const bar: FakeFacetBar = facetBar({
      [POSTMORTEM_STATUS_FACET_KEY]: [NOT_STARTED, DRAFT],
    });

    expect(isLit(bar, NOT_STARTED)).toBe(false);

    click(bar, NOT_STARTED);

    expect(bar.selections[POSTMORTEM_STATUS_FACET_KEY]).toEqual([NOT_STARTED]);
    expect(isLit(bar, NOT_STARTED)).toBe(true);
  });

  test("a chip saying 'is not' that status is not what the tile counts: the click turns it to 'is'", () => {
    const bar: FakeFacetBar = facetBar(
      { [POSTMORTEM_STATUS_FACET_KEY]: [COMPLETED] },
      { [POSTMORTEM_STATUS_FACET_KEY]: "is_not" },
    );

    expect(isLit(bar, COMPLETED)).toBe(false);

    click(bar, COMPLETED);

    expect(bar.operators[POSTMORTEM_STATUS_FACET_KEY]).toBe("is");
    expect(bar.selections[POSTMORTEM_STATUS_FACET_KEY]).toEqual([COMPLETED]);
  });

  test("a chip restored with no operator reads as 'is', so its tile is lit", () => {
    expect(
      isPostmortemStatusTileApplied(
        tile(IN_REVIEW),
        { [POSTMORTEM_STATUS_FACET_KEY]: [IN_REVIEW] },
        {},
      ),
    ).toBe(true);
  });

  test("the selection a tile stands for is the status chip, its one status, 'is'", () => {
    expect(getPostmortemStatusTileSelection(tile(NOT_NEEDED))).toEqual({
      facetKey: POSTMORTEM_STATUS_FACET_KEY,
      values: [NOT_NEEDED],
      operator: "is",
    });
  });
});

describe("what a tile counts is what its click shows", () => {
  test("its click asks for the incidents in its status, by the incident's postmortem status", () => {
    const bar: FakeFacetBar = facetBar();

    click(bar, DRAFT);

    const query: Record<string, unknown> = queryFromChips(bar);

    expect(Object.keys(query).sort()).toEqual(
      ["postmortemStatus", "projectId"].sort(),
    );
    expect(query["postmortemStatus"]).toBeInstanceOf(Includes);
    expect(idsIn(query["postmortemStatus"])).toEqual([DRAFT]);
  });

  test("the chip's relation is the column the tile counts by", () => {
    /*
     * The tile counts Incident.postmortemStatusId; the chip filters by the
     * postmortemStatus relation, which is that column.
     */
    expect(
      new Incident().getTableColumnMetadata(POSTMORTEM_STATUS_FACET_KEY)
        .manyToOneRelationColumn,
    ).toBe("postmortemStatusId");
  });

  test("with a severity picked, the tile's rows are that severity's in that status", () => {
    const bar: FakeFacetBar = facetBar({
      incidentSeverity: [CRITICAL_ID],
    });

    click(bar, NOT_STARTED);

    const query: Record<string, unknown> = queryFromChips(bar);

    expect(idsIn(query["postmortemStatus"])).toEqual([NOT_STARTED]);
    expect(idsIn(query["incidentSeverity"])).toEqual([CRITICAL_ID]);
  });

  test("a second click asks for every status again", () => {
    const bar: FakeFacetBar = facetBar();

    click(bar, DRAFT);
    click(bar, DRAFT);

    expect(queryFromChips(bar)).toEqual({ projectId: PROJECT_ID });
  });
});

describe("the chips of the Postmortems list", () => {
  test("are Postmortem Status, Severity, Incident State and what the incident affects, all multi-select", () => {
    expect(
      POSTMORTEM_LIST_FACETS.slice(0, 3).map((chip: ResourceFacet): string => {
        return `${chip.key}:${chip.label}`;
      }),
    ).toEqual([
      `${POSTMORTEM_STATUS_FACET_KEY}:${POSTMORTEM_STATUS_FACET_LABEL}`,
      "incidentSeverity:Severity",
      "currentIncidentState:Incident State",
    ]);
    expect(POSTMORTEM_LIST_FACETS).toHaveLength(4);

    for (const chip of POSTMORTEM_LIST_FACETS.slice(0, 3)) {
      expect(chip.isMultiSelect).toBe(true);
    }
  });

  test("each value chip filters an incident relation of that name", () => {
    expect(POSTMORTEM_STATUS_FACET_LABEL).toBe("Postmortem Status");

    for (const [key, modelType] of [
      [POSTMORTEM_STATUS_FACET_KEY, IncidentPostmortemStatus],
      ["incidentSeverity", IncidentSeverity],
      ["currentIncidentState", IncidentState],
    ] as Array<[string, unknown]>) {
      expect(new Incident().getTableColumnMetadata(key).modelType).toBe(
        modelType,
      );
    }
  });

  test("the list's table, its preferences, its saved views and its URL state share one name", () => {
    expect(POSTMORTEMS_TABLE_ID).toBe("postmortems-table");
  });

  test("the status chip lists the project's statuses top first, the archived ones last under Archived", async () => {
    const live: IncidentPostmortemStatus = new IncidentPostmortemStatus();
    live._id = DRAFT;
    live.name = "Draft";

    const archived: IncidentPostmortemStatus = new IncidentPostmortemStatus();
    archived._id = OLD_PROCESS;
    archived.name = "Old Process";
    archived.isArchived = true;

    const notNeeded: IncidentPostmortemStatus = new IncidentPostmortemStatus();
    notNeeded._id = NOT_NEEDED;
    notNeeded.name = "Not Needed";

    getListMock.mockResolvedValue({
      data: [live, archived, notNeeded],
      count: 3,
      skip: 0,
      limit: 50,
    });

    const options: Array<FilterChipDropdownOption> = await facet(
      POSTMORTEM_STATUS_FACET_KEY,
    ).loadOptions!(PROJECT_ID, "");

    expect(
      options.map((option: FilterChipDropdownOption): string => {
        return `${option.label}:${option.group || ""}`;
      }),
    ).toEqual(["Draft:", "Not Needed:", `Old Process:${ARCHIVED_FACET_GROUP}`]);
    expect(options[0]!.value).toBe(DRAFT);

    const request: {
      modelType: unknown;
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
    } = getListMock.mock.calls[0]![0];

    expect(request.modelType).toBe(IncidentPostmortemStatus);
    expect(request.query).toEqual({ projectId: PROJECT_ID });
    expect(request.sort).toEqual({ order: SortOrder.Ascending });
    expect(request.select["isArchived"]).toBe(true);
  });

  test("a search reads the statuses by name, on the server", async () => {
    await facet(POSTMORTEM_STATUS_FACET_KEY).loadOptions!(
      PROJECT_ID,
      "  review ",
    );

    const query: Record<string, unknown> = getListMock.mock.calls[0]![0].query;

    expect(query["name"]).toBeInstanceOf(Search);
    expect(String(query["name"])).toBe("review");
  });

  test("a saved view's statuses are named by reading exactly those", async () => {
    const chip: ResourceFacet = facet(POSTMORTEM_STATUS_FACET_KEY);

    expect(await chip.resolveOptions!(PROJECT_ID, [])).toEqual([]);
    expect(getListMock).not.toHaveBeenCalled();

    await chip.resolveOptions!(PROJECT_ID, [DRAFT, IN_REVIEW]);

    const request: {
      query: Record<string, unknown>;
      limit: number;
    } = getListMock.mock.calls[0]![0];

    expect(idsIn(request.query["_id"])).toEqual([DRAFT, IN_REVIEW]);
    expect(request.query["projectId"]).toBe(PROJECT_ID);
    expect(request.limit).toBe(2);
  });

  test("is, is not, is empty and is not empty each ask what they say", () => {
    const chip: ResourceFacet = facet(POSTMORTEM_STATUS_FACET_KEY);

    const is: unknown = chip.toQueryValue!([DRAFT, IN_REVIEW], "is");
    expect(is).toBeInstanceOf(Includes);
    expect(idsIn(is)).toEqual([DRAFT, IN_REVIEW]);
    expect((is as Includes).values[0]).toBeInstanceOf(ObjectID);

    const isNot: unknown = chip.toQueryValue!([COMPLETED], "is_not");
    expect(isNot).toBeInstanceOf(IncludesNone);
    expect(idsIn(isNot)).toEqual([COMPLETED]);

    expect(chip.toQueryValue!([], "is_empty")).toBeInstanceOf(IsNull);
    expect(chip.toQueryValue!([], "is_not_empty")).toBeInstanceOf(NotNull);
    expect(chip.toQueryValue!([], "is")).toBeUndefined();
  });

  test("'is not Completed or Not Needed' is the postmortems still owed", () => {
    const bar: FakeFacetBar = facetBar(
      { [POSTMORTEM_STATUS_FACET_KEY]: [COMPLETED, NOT_NEEDED] },
      { [POSTMORTEM_STATUS_FACET_KEY]: "is_not" },
    );

    const query: Record<string, unknown> = queryFromChips(bar);

    expect(query["postmortemStatus"]).toBeInstanceOf(IncludesNone);
    expect(idsIn(query["postmortemStatus"])).toEqual([COMPLETED, NOT_NEEDED]);
  });
});

describe("how a tile draws its count", () => {
  test("a postmortem still owed draws the eye: amber not started, indigo under way; done stays quiet", () => {
    expect(getPostmortemStatusTileCountClassName(tile(NOT_STARTED), 3)).toBe(
      "text-amber-600",
    );
    expect(getPostmortemStatusTileCountClassName(tile(DRAFT), 2)).toBe(
      "text-indigo-600",
    );
    expect(getPostmortemStatusTileCountClassName(tile(IN_REVIEW), 1)).toBe(
      "text-indigo-600",
    );
    expect(getPostmortemStatusTileCountClassName(tile(COMPLETED), 9)).toBe(
      "text-gray-900",
    );
    expect(getPostmortemStatusTileCountClassName(tile(NOT_NEEDED), 4)).toBe(
      "text-gray-900",
    );
  });

  test("a zero is gray, whatever the status", () => {
    for (const candidate of TILES) {
      expect(getPostmortemStatusTileCountClassName(candidate, 0)).toBe(
        "text-gray-400",
      );
    }
  });

  test("two to a line on a phone and a tablet; the four a project starts with share one line from lg up, six from xl up", () => {
    expect(getPostmortemStatusTilesGridClassName(1)).toBe(
      "grid grid-cols-2 gap-4",
    );
    expect(getPostmortemStatusTilesGridClassName(2)).toBe(
      "grid grid-cols-2 gap-4",
    );
    expect(getPostmortemStatusTilesGridClassName(3)).toBe(
      "grid grid-cols-2 gap-4 lg:grid-cols-3",
    );
    expect(getPostmortemStatusTilesGridClassName(4)).toBe(
      "grid grid-cols-2 gap-4 lg:grid-cols-4",
    );
    expect(getPostmortemStatusTilesGridClassName(5)).toBe(
      "grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5",
    );
    expect(getPostmortemStatusTilesGridClassName(6)).toBe(
      "grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6",
    );
    // More wrap onto a second line rather than squeezing.
    expect(getPostmortemStatusTilesGridClassName(8)).toBe(
      "grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6",
    );
  });

  test("never more than two to a line below lg: beside a tablet's side menu, four tiles were ~105px each", () => {
    for (let count: number = 1; count <= 8; count++) {
      const className: string = getPostmortemStatusTilesGridClassName(count);

      // No md: column count at all - md is a tablet with the side menu open.
      expect(className).not.toMatch(MD_GRID_COLUMNS);
      expect(className).toContain("grid-cols-2");
    }
  });
});
