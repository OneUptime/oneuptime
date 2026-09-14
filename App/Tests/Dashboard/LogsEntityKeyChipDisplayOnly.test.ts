/*
 * The entity-key chip is display only on the Common logs viewer, too.
 *
 * The Dashboard viewer hands its locked chips to the Common viewer as
 * `baseActiveFilters`, which reads them in two places besides rendering:
 * collectLogsEntityIdsToResolve (which ids to send to the entity-name
 * resolver) and enrichLogsActiveFilters (which chips to rename). An
 * Inventory item's entity key is a hash, not an entity id — sent to the
 * resolver it would cost a request per table for nothing, and "named" from a
 * lookup it could overwrite "Kubernetes Pod: checkout-7d9f" with someone
 * else's name. These tests pin that both helpers leave the chip alone.
 *
 * ModelAPI is mocked the way LogsEntityChipDisplay.test.ts mocks it: the
 * entity-name module imports it, and it reaches the browser at load.
 */
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

import { describe, expect, test } from "@jest/globals";
import type Service from "Common/Models/DatabaseModels/Service";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { isResourceFacetKey } from "Common/Types/Telemetry/ResourceEntityFacet";
import {
  LogsEntityLookupMaps,
  LogsEntityResolutionRequest,
  collectLogsEntityIdsToResolve,
  enrichLogsActiveFilters,
} from "Common/UI/Components/LogsViewer/LogsEntityNames";
import type { ActiveFilter } from "Common/UI/Components/LogsViewer/types";
import type { TelemetryEntityNameMap } from "Common/UI/Utils/Telemetry/TelemetryEntityNames";
import { buildLockedEntityKeyChips } from "../../FeatureSet/Dashboard/src/Utils/LockedEntityKeyChips";

/*
 * UUID-shaped on purpose: the resolver collector drops values that are not
 * entity ids, and these tests must show the chip is skipped for its COLUMN,
 * not rescued by its value's shape.
 */
const UUID_SHAPED_KEY: string = "84858d6c-1111-4111-8111-111111111111";
const SERVICE_ID: string = "22222222-2222-4222-8222-222222222222";

const MAPS_KNOWING_THE_KEY: LogsEntityLookupMaps = {
  serviceMap: {
    [UUID_SHAPED_KEY]: { name: "payments-api" } as unknown as Service,
  },
};

const NAME_MAP_KNOWING_THE_KEY: TelemetryEntityNameMap = {
  [UUID_SHAPED_KEY]: {
    id: UUID_SHAPED_KEY,
    name: "someone-elses-name",
    entityType: ServiceType.OpenTelemetry,
    typeLabel: "Service",
  },
};

describe("the Common logs viewer leaves entity-key chips alone", () => {
  test("entityKeys is not a resource facet — the gate both entity-name helpers check first", () => {
    expect(isResourceFacetKey("entityKeys")).toBe(false);
  });

  test("a named chip is never renamed, even when every lookup knows its value", () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [UUID_SHAPED_KEY],
      displays: {
        [UUID_SHAPED_KEY]: {
          displayKey: "Kubernetes Pod",
          displayValue: "checkout-7d9f",
        },
      },
    });

    const enriched: Array<ActiveFilter> = enrichLogsActiveFilters(
      chips,
      MAPS_KNOWING_THE_KEY,
      NAME_MAP_KNOWING_THE_KEY,
    );

    // The same objects: nothing was copied, so nothing could have changed.
    expect(enriched).toHaveLength(1);
    expect(enriched[0]).toBe(chips[0]);
    expect(`${enriched[0]!.displayKey}: ${enriched[0]!.displayValue}`).toBe(
      "Kubernetes Pod: checkout-7d9f",
    );
  });

  test('the "Resource: <key>" fallback chip — whose value IS its text — is not renamed either', () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [UUID_SHAPED_KEY],
    });

    const enriched: Array<ActiveFilter> = enrichLogsActiveFilters(
      chips,
      MAPS_KNOWING_THE_KEY,
      NAME_MAP_KNOWING_THE_KEY,
    );

    expect(enriched[0]).toBe(chips[0]);
    expect(`${enriched[0]!.displayKey}: ${enriched[0]!.displayValue}`).toBe(
      `Resource: ${UUID_SHAPED_KEY}`,
    );
  });

  test("the key is never sent to the entity-name resolver", () => {
    const request: LogsEntityResolutionRequest = collectLogsEntityIdsToResolve({
      filters: buildLockedEntityKeyChips({
        rows: "logs",
        entityKeys: [UUID_SHAPED_KEY],
      }),
      maps: { serviceMap: {} },
    });

    expect(request).toEqual({ ids: [], typeHints: {} });
  });

  test("...while an entity-id chip beside it still is — the collector works, it just skips the key", () => {
    const request: LogsEntityResolutionRequest = collectLogsEntityIdsToResolve({
      filters: [
        {
          facetKey: "primaryEntityId",
          value: SERVICE_ID,
          displayKey: "Service",
          displayValue: SERVICE_ID,
          readOnly: true,
        },
        ...buildLockedEntityKeyChips({
          rows: "logs",
          entityKeys: [UUID_SHAPED_KEY],
        }),
      ],
      maps: { serviceMap: {} },
    });

    expect(request.ids).toEqual([SERVICE_ID]);
    expect(request.ids).not.toContain(UUID_SHAPED_KEY);
    expect(Object.keys(request.typeHints)).not.toContain(UUID_SHAPED_KEY);
  });
});
