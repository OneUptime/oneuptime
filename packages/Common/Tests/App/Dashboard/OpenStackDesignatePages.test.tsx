import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, configure, screen } from "@testing-library/react";
import * as React from "react";
import path from "path";
import { OpenStackResourceBufferEntry } from "../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { OPENSTACK_DNS_ZONE_PENDING_STUCK_MINUTES } from "../../../Types/OpenStack/OpenStackHealthRules";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import OpenStackCloudDnsZoneDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/DnsZoneDetail";
import OpenStackCloudDnsZones from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/DnsZones";
import {
  OPENSTACK_FIXTURES_FOLDER,
  readRecordedSeries,
  scanRecordedSeries,
} from "../../Helpers/OpenStackRecordedRows";
import {
  Row,
  attentionRowsOf,
  partPath,
  renderPage,
  resetServer,
  server,
  settle,
  tableRow,
  tile,
} from "./OpenStackPartHarness";

/*
 * Designate's pages, rendered for real over the real tables and part cards with only the network replaced, on
 * what a real DevStack recorded (services-designate-barbican-swift). The one recordset in ERROR was written
 * into its row, because a zone's writes failing took the zone there and not one recordset alone.
 */

configure({ asyncUtilTimeout: 30000 });

jest.setTimeout(300000);

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return ["ProjectOwner"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: ["Public", "User", "CurrentUser"] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): { toString: () => string } => {
        return {
          toString: () => {
            return "80000000-0000-4000-8000-000000000001";
          },
        };
      },
      getName: (): string => {
        return "Test User";
      },
      getEmail: (): string => {
        return "test@example.com";
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceMetricsTab",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="resource-metrics-tab" />;
      },
    };
  },
);

const FOLDER: string = path.join(
  OPENSTACK_FIXTURES_FOLDER,
  "services-designate-barbican-swift",
);

let nextId: number = 1;

function id(): string {
  return `8d1b2a3d-4e5f-4a6b-8c7d-${String(nextId++).padStart(12, "0")}`;
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

// A scene's rows, as a row's first sighting: as long in its state as the test says.
function recorded(
  scene: string,
  exporter: string = "exporter",
  stateChangedAt: Date = minutesAgo(5),
): Array<Row> {
  return scanRecordedSeries(
    readRecordedSeries(path.join(FOLDER, scene, exporter)),
    Date.now(),
  ).map((entry: OpenStackResourceBufferEntry): Row => {
    return {
      _id: id(),
      kind: entry.kind,
      name: entry.name ?? undefined,
      externalId: entry.externalId,
      regionName: entry.regionName ?? undefined,
      openStackProjectId: entry.openStackProjectId ?? undefined,
      status: entry.status ?? undefined,
      stateChangedAt,
      facts: entry.facts,
      lastSeenAt: new Date(),
    };
  });
}

function zoneId(rows: Array<Row>, name: string): string {
  return rows.find((row: Row): boolean => {
    return (
      row["kind"] === OpenStackResourceKind.DnsZone && row["name"] === name
    );
  })!["externalId"] as string;
}

beforeEach(() => {
  resetServer();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("DNS Zones", () => {
  test("lists a real cloud's zones, each status in Designate's word, with what it holds", async () => {
    server.rows = recorded("designate-error");

    await renderPage(OpenStackCloudDnsZones, "/dns-zones");
    await settle();

    expect(
      await screen.findByText("ou-error.example.org."),
    ).toBeInTheDocument();
    expect(tableRow("ou-error.example.org.")).toHaveTextContent("ERROR");
    expect(tableRow("ou-payments.example.org.")).toHaveTextContent("ACTIVE");
  });

  test("an empty list on a cloud that doesn't run Designate says so, and is no error", async () => {
    server.rows = [];

    await renderPage(OpenStackCloudDnsZones, "/dns-zones");

    expect(
      await screen.findByText("This cloud doesn't run this service"),
    ).toBeInTheDocument();
  });

  test("a credential Designate refuses is told so, and not that its API is down", async () => {
    server.rows = recorded("access-check", "exporter/reader");

    await renderPage(OpenStackCloudDnsZones, "/dns-zones");

    expect(
      await screen.findByText("This credential has never read this service"),
    ).toBeInTheDocument();
    expect(screen.queryByText("This service's API isn't answering")).toBeNull();
  });
});

describe("a zone's page", () => {
  test("one in error, on what a real cloud said: why it matters, and what nothing here can say", async () => {
    server.rows = recorded("designate-error");
    const failed: string = zoneId(server.rows, "ou-error.example.org.");

    await renderPage(
      OpenStackCloudDnsZoneDetail,
      partPath("dns-zones", failed),
    );

    expect(
      await screen.findByTestId("openstack-dns-zone-explanation"),
    ).toHaveTextContent(/gave up/);
    expect(attentionRowsOf("openstack-dns-zone-attention")).toEqual([
      "This zone: In ERROR",
    ]);
    expect(
      screen.getByTestId("openstack-dns-zone-why-not-known"),
    ).toHaveTextContent(/designate-worker/);
  });

  test("a zone's recordsets that aren't ACTIVE are listed, each by name and type", async () => {
    server.rows = recorded("designate-error");
    const zone: string = zoneId(server.rows, "ou-active.example.org.");

    await renderPage(OpenStackCloudDnsZoneDetail, partPath("dns-zones", zone));
    await settle();

    expect(
      await screen.findByText("error.ou-active.example.org."),
    ).toBeInTheDocument();
    expect(tableRow("error.ou-active.example.org.")).toHaveTextContent("ERROR");
    expect(screen.queryByText("www.ou-active.example.org.")).toBeNull();
  });

  test("one still pending is on its way until the line, and stuck past it", async () => {
    server.rows = recorded(
      "designate-pending",
      "exporter",
      minutesAgo(OPENSTACK_DNS_ZONE_PENDING_STUCK_MINUTES + 30),
    );
    const stuck: string = zoneId(server.rows, "ou-pending.example.org.");

    await renderPage(OpenStackCloudDnsZoneDetail, partPath("dns-zones", stuck));

    expect(
      await screen.findByTestId("openstack-dns-zone-explanation"),
    ).toHaveTextContent(/designate-worker/);
    expect(attentionRowsOf("openstack-dns-zone-attention")).toEqual([
      `This zone: PENDING for ${OPENSTACK_DNS_ZONE_PENDING_STUCK_MINUTES + 30}m`,
    ]);
  });

  test("its alerts are the three that watch every zone", async () => {
    server.rows = recorded("designate-baseline");
    const zone: string = zoneId(server.rows, "ou-payments.example.org.");

    await renderPage(OpenStackCloudDnsZoneDetail, partPath("dns-zones", zone));

    expect(
      await screen.findByTestId("openstack-dns-zone-alerts"),
    ).toHaveTextContent(
      /DNS Zone in Error[\s\S]*DNS Zone Stuck Pending[\s\S]*DNS Recordset in Error/,
    );
    expect(tile("openstack-dns-zone-tiles", "Recordsets")).toHaveTextContent(
      /\d/,
    );
  });

  test("one that has gone says so, rather than a blank page", async () => {
    server.rows = recorded("designate-baseline");

    await renderPage(
      OpenStackCloudDnsZoneDetail,
      partPath("dns-zones", "not-a-zone"),
    );

    expect(
      await screen.findByTestId("openstack-dns-zone-not-reported"),
    ).toHaveTextContent(/not in this cloud's inventory/);
  });
});
