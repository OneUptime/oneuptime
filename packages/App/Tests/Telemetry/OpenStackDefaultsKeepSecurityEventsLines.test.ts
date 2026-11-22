import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import LogDropFilter from "Common/Models/DatabaseModels/LogDropFilter";
import DatabaseService from "Common/Server/Services/DatabaseService";
import {
  OPENSTACK_DEFAULT_DROP_FILTERS,
  OPENSTACK_DEFAULTS_NAME_PREFIX,
  OpenStackDefaultDropFilter,
} from "Common/Server/Utils/OpenStack/OpenStackLogDefaults";
import SecurityEventsReadTelemetry from "Common/Server/Utils/SecurityEvent/SecurityEventsReadTelemetry";
import { JSONObject } from "Common/Types/JSON";
import LogDropFilterAction from "Common/Types/Log/LogDropFilterAction";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackLogAttribute } from "Common/Utils/OpenStack/OpenStackLogs";

jest.mock("../../FeatureSet/Telemetry/Utils/DropFilterDropRecorder", () => {
  return {
    __esModule: true,
    DropFilterSignal: { Logs: "logs", Traces: "traces" },
    recordDroppedRecord: (): void => {},
  };
});

import LogDropFilterService, {
  LoadedLogDropFilter,
} from "../../FeatureSet/Telemetry/Services/LogDropFilterService";

/*
 * ONEUPTIME'S OWN DROP FILTERS KEEP WHAT SECURITY EVENTS READS (#10436).
 *
 * The OpenStack defaults are made the first time a cloud's logs arrive,
 * with no form and nobody to read what they would take. As OneUptime made
 * them - their name and their query - they keep every line Security
 * Events' log scan would read (its own prefilter), in a project whose
 * Security Events reads its logs. Changed by a person, a filter is theirs:
 * it drops what it matches. Run through the real loader and the real
 * engine, with the project's filters and its Security Events stood in for.
 */

const DEBUG_DEFAULT: OpenStackDefaultDropFilter =
  OPENSTACK_DEFAULT_DROP_FILTERS.find(
    (filter: OpenStackDefaultDropFilter): boolean => {
      return filter.name.includes("DEBUG");
    },
  ) as OpenStackDefaultDropFilter;

// An OpenStack DEBUG line, as the stamp leaves its row.
function debugLine(body: string): JSONObject {
  return {
    severityText: "Debug",
    body,
    attributes: { [OpenStackLogAttribute.Level]: "DEBUG" },
  };
}

const SIGN_IN_FAILURE: JSONObject = debugLine(
  "sshd[812]: Failed password for invalid user admin from 203.0.113.9 port 50122 ssh2",
);
const ATTACK_IN_A_REQUEST: JSONObject = debugLine(
  "keystone.server.flask.request_processing.req_logging PATH_INFO: /v3/users?name=' or '1'='1",
);
const ROUTINE_DEBUG: JSONObject = debugLine(
  "nova.compute.manager [req-1] Running periodic task ComputeManager._poll_volume_usage",
);

function filterRow(data: {
  name: string;
  filterQuery: string;
  action?: string;
}): LogDropFilter {
  const filter: LogDropFilter = new LogDropFilter(ObjectID.generate());

  filter.name = data.name;
  filter.filterQuery = data.filterQuery;
  filter.action = data.action || LogDropFilterAction.Drop;

  return filter;
}

async function loadFor(data: {
  filters: Array<LogDropFilter>;
  securityEventsReadsLogs: boolean;
}): Promise<{
  loaded: Array<LoadedLogDropFilter>;
  asked: SpyInstance<typeof SecurityEventsReadTelemetry.readsProjectTelemetry>;
}> {
  jest
    .spyOn(DatabaseService.prototype, "findBy")
    .mockResolvedValue(data.filters as never);

  const asked: SpyInstance<
    typeof SecurityEventsReadTelemetry.readsProjectTelemetry
  > = jest
    .spyOn(SecurityEventsReadTelemetry, "readsProjectTelemetry")
    .mockResolvedValue(data.securityEventsReadsLogs);

  // A project of its own each time: the loader keeps a project's filters a minute.
  const loaded: Array<LoadedLogDropFilter> =
    await LogDropFilterService.loadDropFilters(ObjectID.generate());

  return { loaded, asked };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an OpenStack default as OneUptime made it, where Security Events reads the logs", () => {
  test("keeps a sign-in line and an attack in a request, and drops a routine DEBUG line", async () => {
    const { loaded } = await loadFor({
      filters: [filterRow(DEBUG_DEFAULT)],
      securityEventsReadsLogs: true,
    });

    expect(loaded[0]!.keepsSecurityEventsLines).toBe(true);
    expect(LogDropFilterService.shouldDropLog(SIGN_IN_FAILURE, loaded)).toBe(
      false,
    );
    expect(
      LogDropFilterService.shouldDropLog(ATTACK_IN_A_REQUEST, loaded),
    ).toBe(false);
    expect(LogDropFilterService.shouldDropLog(ROUTINE_DEBUG, loaded)).toBe(
      true,
    );
  });

  test("a line it keeps still meets the project's next filter", async () => {
    const { loaded } = await loadFor({
      filters: [
        filterRow(DEBUG_DEFAULT),
        filterRow({
          name: "Drop every sshd line",
          filterQuery: "body LIKE 'sshd'",
        }),
      ],
      securityEventsReadsLogs: true,
    });

    expect(LogDropFilterService.shouldDropLog(SIGN_IN_FAILURE, loaded)).toBe(
      true,
    );
  });

  test("every default keeps what Security Events reads, as made", async () => {
    const { loaded } = await loadFor({
      filters: OPENSTACK_DEFAULT_DROP_FILTERS.map(filterRow),
      securityEventsReadsLogs: true,
    });

    expect(
      loaded.map((filter: LoadedLogDropFilter): boolean => {
        return Boolean(filter.keepsSecurityEventsLines);
      }),
    ).toEqual(
      OPENSTACK_DEFAULT_DROP_FILTERS.map((): boolean => {
        return true;
      }),
    );
  });
});

describe("where it drops what it matches", () => {
  test("a project whose Security Events reads no logs has nothing to keep", async () => {
    const { loaded } = await loadFor({
      filters: [filterRow(DEBUG_DEFAULT)],
      securityEventsReadsLogs: false,
    });

    expect(loaded[0]!.keepsSecurityEventsLines).toBe(false);
    expect(LogDropFilterService.shouldDropLog(SIGN_IN_FAILURE, loaded)).toBe(
      true,
    );
  });

  test("a default a person changed is theirs", async () => {
    const { loaded } = await loadFor({
      filters: [
        filterRow({
          name: DEBUG_DEFAULT.name,
          filterQuery: `${DEBUG_DEFAULT.filterQuery} OR severityText = 'Debug'`,
        }),
      ],
      securityEventsReadsLogs: true,
    });

    expect(loaded[0]!.keepsSecurityEventsLines).toBe(false);
    expect(LogDropFilterService.shouldDropLog(SIGN_IN_FAILURE, loaded)).toBe(
      true,
    );
  });

  test("a person's own filter of the same query, under a name of their own, is theirs", async () => {
    const { loaded } = await loadFor({
      filters: [
        filterRow({
          name: "My debug lines",
          filterQuery: DEBUG_DEFAULT.filterQuery,
        }),
      ],
      securityEventsReadsLogs: true,
    });

    expect(loaded[0]!.keepsSecurityEventsLines).toBe(false);
    expect(LogDropFilterService.shouldDropLog(SIGN_IN_FAILURE, loaded)).toBe(
      true,
    );
  });

  test("a project with none of OneUptime's filters is never asked about Security Events", async () => {
    const { asked } = await loadFor({
      filters: [
        filterRow({
          name: `${OPENSTACK_DEFAULTS_NAME_PREFIX}but a query of its own`,
          filterQuery: "severityText = 'Debug'",
        }),
      ],
      securityEventsReadsLogs: true,
    });

    expect(asked).not.toHaveBeenCalled();
  });
});
