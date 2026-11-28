// The display rules read nothing; the resolver beside them reads through ModelAPI.
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

/*
 * The resolver also asks PermissionGate whether the reader may read a
 * table's archive switch (f5f416c04ac); the gate's import chain reads
 * `window` as well. A member who reads the services reads it too.
 */
jest.mock("Common/UI/Utils/PermissionGate", () => {
  return {
    __esModule: true,
    default: {
      canReadColumn: (): boolean => {
        return true;
      },
    },
  };
});

import { describe, expect, jest, test } from "@jest/globals";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { ActiveFilter } from "Common/UI/Components/TelemetryViewer/types";
import { ActiveFilter as LogsActiveFilter } from "Common/UI/Components/LogsViewer/types";
import { TelemetryEntityNameMap } from "Common/UI/Utils/Telemetry/TelemetryEntityNames";
import { applyLogsEntityChipDisplay } from "../../FeatureSet/Dashboard/src/Components/Logs/LogsEntityChipDisplay";
import { resolveTraceChipDisplay } from "../../FeatureSet/Dashboard/src/Components/Traces/TracesEntityDisplay";
import { resolveExceptionChipDisplay } from "../../FeatureSet/Dashboard/src/Utils/ExceptionsEntityChipDisplay";
import {
  buildMetricsActiveFilterChips,
  resolveMetricsChipDisplay,
} from "../../FeatureSet/Dashboard/src/Utils/MetricsEntityChipDisplay";

/*
 * EVERY EXPLORER'S CHIP NAMING A RECORD THAT IS GONE, OR ARCHIVED (#11213).
 *
 * The logs, traces, exceptions and metrics explorers each name their chips
 * with their own display rules; a chip a link or a saved view brought,
 * naming a service, host or cluster deleted since, read as its raw id in
 * every one. Handed the ids every read settled as naming nothing, each
 * marks such a chip gone (the chip row draws it "No longer available"),
 * and one naming an archived record archived - never while it is still
 * unsettled, never when something else names it. The chip keeps its
 * facet, its value - the id it filters by - and its name otherwise.
 */

const GONE_ID: string = "dead0000-0000-4000-8000-00000000dead";
const LIVE_ID: string = "a1000000-0000-4000-8000-0000000000a1";
const ARCHIVED_ID: string = "a1000000-0000-4000-8000-0000000000a2";
const UNSETTLED_ID: string = "a1000000-0000-4000-8000-0000000000a3";

const NAMES: TelemetryEntityNameMap = {
  [LIVE_ID]: {
    id: LIVE_ID,
    name: "checkout-api",
    entityType: ServiceType.OpenTelemetry,
    typeLabel: "Service",
  },
  [ARCHIVED_ID]: {
    id: ARCHIVED_ID,
    name: "legacy-api",
    entityType: ServiceType.OpenTelemetry,
    typeLabel: "Service",
    isArchived: true,
  },
};

const NOT_FOUND: ReadonlySet<string> = new Set<string>([GONE_ID]);

const chip: (facetKey: string, value: string) => ActiveFilter = (
  facetKey: string,
  value: string,
): ActiveFilter => {
  // As a link or a saved view hands it over: the id, and nothing more.
  return {
    facetKey,
    value,
    displayKey: facetKey,
    displayValue: value,
  };
};

// What every explorer must leave as it was, whatever it marks.
const expectFilterKept: (marked: ActiveFilter, given: ActiveFilter) => void = (
  marked: ActiveFilter,
  given: ActiveFilter,
): void => {
  expect(marked.facetKey).toBe(given.facetKey);
  expect(marked.value).toBe(given.value);
};

describe("the logs explorer (applyLogsEntityChipDisplay)", () => {
  const apply: (
    filters: Array<LogsActiveFilter>,
    knownNames?: Record<string, string>,
  ) => Array<LogsActiveFilter> = (
    filters: Array<LogsActiveFilter>,
    knownNames?: Record<string, string>,
  ): Array<LogsActiveFilter> => {
    return applyLogsEntityChipDisplay(filters, {
      nameMap: NAMES,
      notFound: NOT_FOUND,
      knownNames,
    });
  };

  test("a chip naming a deleted service is marked gone, and keeps its id", () => {
    const given: LogsActiveFilter = chip("primaryEntityId", GONE_ID);
    const [marked] = apply([given]) as [LogsActiveFilter];

    expect(marked.isNotFound).toBe(true);
    expect(marked.isArchived).toBeUndefined();
    expectFilterKept(marked, given);
  });

  test("a chip leaving one out is marked gone as one keeping it is", () => {
    const [marked] = apply([chip("!primaryEntityId", GONE_ID)]) as [
      LogsActiveFilter,
    ];

    expect(marked.isNotFound).toBe(true);
    expect(marked.facetKey).toBe("!primaryEntityId");
  });

  test("named, it is not gone; archived, it is marked so", () => {
    const [live, archived] = apply([
      chip("primaryEntityId", LIVE_ID),
      chip("primaryEntityId", ARCHIVED_ID),
    ]) as [LogsActiveFilter, LogsActiveFilter];

    expect(live.displayValue).toBe("checkout-api");
    expect(live.isNotFound).toBeUndefined();
    expect(archived.displayValue).toBe("legacy-api");
    expect(archived.isArchived).toBe(true);
  });

  test("a name the server's facet gave wins: it is not gone", () => {
    const [marked] = apply([chip("primaryEntityId", GONE_ID)], {
      [GONE_ID]: "checkout-worker",
    }) as [LogsActiveFilter];

    expect(marked.displayValue).toBe("checkout-worker");
    expect(marked.isNotFound).toBeUndefined();
  });

  test("an id the lookup has not settled is left as it came", () => {
    const given: LogsActiveFilter = chip("primaryEntityId", UNSETTLED_ID);
    const [marked] = apply([given]) as [LogsActiveFilter];

    expect(marked.isNotFound).toBeUndefined();
    expect(marked.displayValue).toBe(UNSETTLED_ID);
  });
});

describe("the traces explorer (resolveTraceChipDisplay)", () => {
  const resolve: (
    given: ActiveFilter,
    extra?: { archivedEntityIds?: ReadonlySet<string> | undefined },
  ) => ActiveFilter = (
    given: ActiveFilter,
    extra?: { archivedEntityIds?: ReadonlySet<string> | undefined },
  ): ActiveFilter => {
    return resolveTraceChipDisplay(given, {
      facetConfigs: [
        {
          key: "primaryEntityId",
          title: "Service",
          valueDisplayMap: { "b1000000-0000-4000-8000-0000000000b1": "web" },
        } as never,
      ],
      entityNames: NAMES,
      notFoundEntityIds: NOT_FOUND,
      archivedEntityIds: extra?.archivedEntityIds,
    });
  };

  test("a chip naming a deleted service is marked gone, and keeps its id", () => {
    const given: ActiveFilter = chip("primaryEntityId", GONE_ID);
    const marked: ActiveFilter = resolve(given);

    expect(marked.isNotFound).toBe(true);
    expect(marked.displayKey).toBe("Service");
    expectFilterKept(marked, given);
  });

  test("the legacy serviceId chip, and one leaving the service out, are marked alike", () => {
    expect(resolve(chip("serviceId", GONE_ID)).isNotFound).toBe(true);

    const excluded: ActiveFilter = resolve(chip("!primaryEntityId", GONE_ID));

    expect(excluded.isNotFound).toBe(true);
    expect(excluded.facetKey).toBe("!primaryEntityId");
  });

  test("a resolved archived service is marked archived; a live one is not", () => {
    expect(resolve(chip("primaryEntityId", ARCHIVED_ID)).isArchived).toBe(true);

    const live: ActiveFilter = resolve(chip("primaryEntityId", LIVE_ID));

    expect(live.displayValue).toBe("checkout-api");
    expect(live.isArchived).toBeUndefined();
    expect(live.isNotFound).toBeUndefined();
  });

  test("a service the page read, named in the facet, is archived by what the page read of it", () => {
    const loadedId: string = "b1000000-0000-4000-8000-0000000000b1";
    const marked: ActiveFilter = resolve(chip("primaryEntityId", loadedId), {
      archivedEntityIds: new Set<string>([loadedId]),
    });

    expect(marked.displayValue).toBe("web");
    expect(marked.isArchived).toBe(true);
    expect(marked.isNotFound).toBeUndefined();
  });

  test("a chip that names no entity is never marked", () => {
    const marked: ActiveFilter = resolve(chip("statusCode", GONE_ID));

    expect(marked.isNotFound).toBeUndefined();
    expect(marked.isArchived).toBeUndefined();
  });

  test("an id the lookup has not settled is never marked gone", () => {
    expect(
      resolve(chip("primaryEntityId", UNSETTLED_ID)).isNotFound,
    ).toBeUndefined();
  });
});

describe("the exceptions explorer (resolveExceptionChipDisplay)", () => {
  const resolve: (
    given: ActiveFilter,
    facetDisplayNames?: Record<string, string>,
  ) => ActiveFilter = (
    given: ActiveFilter,
    facetDisplayNames?: Record<string, string>,
  ): ActiveFilter => {
    return resolveExceptionChipDisplay({
      chip: given,
      config: undefined,
      entityNames: NAMES,
      facetDisplayNames,
      notFound: NOT_FOUND,
    });
  };

  test("a Service chip naming a deleted service is marked gone, and keeps its id", () => {
    const given: ActiveFilter = chip("primaryEntityId", GONE_ID);
    const marked: ActiveFilter = resolve(given);

    expect(marked.isNotFound).toBe(true);
    expectFilterKept(marked, given);
  });

  test("a Host chip naming a deleted host is marked gone", () => {
    const marked: ActiveFilter = resolve(chip("hostId", GONE_ID));

    expect(marked.isNotFound).toBe(true);
    expect(marked.displayKey).toBe("Host");
  });

  test("a resolved archived service is marked archived", () => {
    const marked: ActiveFilter = resolve(chip("primaryEntityId", ARCHIVED_ID));

    expect(marked.displayValue).toBe("legacy-api");
    expect(marked.isArchived).toBe(true);
  });

  test("a name the server's facet gave wins: it is not gone", () => {
    const marked: ActiveFilter = resolve(chip("primaryEntityId", GONE_ID), {
      [GONE_ID]: "checkout-worker",
    });

    expect(marked.displayValue).toBe("checkout-worker");
    expect(marked.isNotFound).toBeUndefined();
  });

  test("a chip that names no entity is never marked", () => {
    const marked: ActiveFilter = resolve(chip("exceptionType", GONE_ID));

    expect(marked.isNotFound).toBeUndefined();
  });
});

describe("the metrics explorer (resolveMetricsChipDisplay, buildMetricsActiveFilterChips)", () => {
  test("a Service chip naming a deleted service is marked gone, and keeps its id", () => {
    const given: ActiveFilter = chip("primaryEntityId", GONE_ID);
    const marked: ActiveFilter = resolveMetricsChipDisplay({
      chip: given,
      facetConfigs: [],
      nameMap: NAMES,
      notFound: NOT_FOUND,
    });

    expect(marked.isNotFound).toBe(true);
    expectFilterKept(marked, given);
  });

  test("a Host chip naming a deleted host is marked gone; an archived service archived", () => {
    expect(
      resolveMetricsChipDisplay({
        chip: chip("hostId", GONE_ID),
        facetConfigs: [],
        nameMap: NAMES,
        notFound: NOT_FOUND,
      }).isNotFound,
    ).toBe(true);

    expect(
      resolveMetricsChipDisplay({
        chip: chip("primaryEntityId", ARCHIVED_ID),
        facetConfigs: [],
        nameMap: NAMES,
        notFound: NOT_FOUND,
      }).isArchived,
    ).toBe(true);
  });

  test("the chip bar hands the ids gone to every user chip", () => {
    const chips: Array<ActiveFilter> = buildMetricsActiveFilterChips({
      scopeIds: undefined,
      scopeEntityType: undefined,
      attributeFilters: undefined,
      activeFilters: [
        chip("primaryEntityId", GONE_ID),
        chip("primaryEntityId", LIVE_ID),
      ],
      facetConfigs: [],
      nameMap: NAMES,
      notFound: NOT_FOUND,
    });

    expect(
      chips.map((each: ActiveFilter): boolean => {
        return Boolean(each.isNotFound);
      }),
    ).toEqual([true, false]);
  });

  test("an attribute chip is never marked, whatever its value", () => {
    const marked: ActiveFilter = resolveMetricsChipDisplay({
      chip: chip("attributes.service.name", GONE_ID),
      facetConfigs: [],
      nameMap: NAMES,
      notFound: NOT_FOUND,
    });

    expect(marked.isNotFound).toBeUndefined();
  });
});
