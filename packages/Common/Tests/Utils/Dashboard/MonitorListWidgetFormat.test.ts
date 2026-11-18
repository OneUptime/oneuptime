import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Includes from "../../../Types/BaseDatabase/Includes";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import { Gray500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import { ComponentArgument } from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardMonitorListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardMonitorListComponent";
import ObjectID from "../../../Types/ObjectID";
import DashboardMonitorListComponentUtil from "../../../Utils/Dashboard/Components/DashboardMonitorListComponent";
import {
  getMonitorListQuery,
  getMonitorListRowStatus,
  MONITOR_LIST_MONITORING_OFF_STATUS_COLOR,
  MONITOR_LIST_MONITORING_OFF_STATUS_LABEL,
  MONITOR_LIST_NO_STATUS_LABEL,
  MONITOR_LIST_STATUS_FILTER_NON_OPERATIONAL,
  MONITOR_LIST_STATUS_FILTER_OPERATIONAL,
  MONITOR_LIST_STATUS_FILTER_VALUES,
  MONITOR_LIST_WIDGET_SELECT,
  MonitorListRowStatus,
} from "../../../Utils/Dashboard/MonitorListWidgetFormat";
import MonitoringOff from "../../../Utils/Monitor/MonitoringOff";
import { MonitorRowStatusKind } from "../../../Utils/Monitor/MonitorRowStatus";
import NotOperationalMonitorQuery from "../../../Utils/Monitor/NotOperationalMonitorQuery";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * THE MONITOR LIST WIDGET'S RULES (issue #6476).
 *
 * Its "non-operational" filter listed a monitor whose monitoring is turned
 * off - its status frozen at "Offline" by its last check - beside the
 * monitors that really are down, and archived monitors too; "operational"
 * listed one whose last check was fine; and every row drew the frozen status
 * as if it were live. The widget in the browser and the public dashboard's
 * policy on the server both read these rules now, so a board and its public
 * page list the same monitors and say the same of them.
 */

const STATUS_IDS: Array<string> = [
  "8b1d6a3e-3a52-4f1f-9b8e-0b5a3a3f0001",
  "8b1d6a3e-3a52-4f1f-9b8e-0b5a3a3f0002",
];

const RED: Color = Color.fromString("#ef4444");
const GREEN: Color = Color.fromString("#10b981");

describe("which monitors a stored filter lists", () => {
  test("with no status setting: every monitor but the archived ones, whether its monitoring is on or off", () => {
    expect(getMonitorListQuery({})).toEqual({ isArchived: false });
  });

  test("an empty setting is no setting", () => {
    for (const statusFilter of [undefined, null, ""]) {
      for (const monitorStatusIds of [undefined, null, []]) {
        expect(getMonitorListQuery({ statusFilter, monitorStatusIds })).toEqual(
          { isArchived: false },
        );
      }
    }
  });

  test("'non-operational' is the Not Operational rule, word for word: no monitor whose monitoring is off, no archived one", () => {
    expect(
      getMonitorListQuery({
        statusFilter: MONITOR_LIST_STATUS_FILTER_NON_OPERATIONAL,
      }),
    ).toEqual(NotOperationalMonitorQuery.getQuery());
    expect(
      getMonitorListQuery({
        statusFilter: MONITOR_LIST_STATUS_FILTER_NON_OPERATIONAL,
      }),
    ).toEqual({
      isArchived: false,
      disableActiveMonitoring: false,
      currentMonitorStatus: { isOperationalState: false },
    });
  });

  /*
   * Issue #8899: a monitor nothing has checked yet holds the operational
   * status it was created in, and its row says Waiting for data. It is not
   * one of the operational monitors. A manual monitor is stamped measured
   * when it is created, so it still is.
   */
  test("'operational' is an operational status among the monitors that are checked and have been measured", () => {
    expect(
      getMonitorListQuery({
        statusFilter: MONITOR_LIST_STATUS_FILTER_OPERATIONAL,
      }),
    ).toEqual({
      ...MonitoringOff.getMonitoredQuery(),
      currentMonitorStatus: { isOperationalState: true },
      firstMeasuredAt: new NotNull(),
    });
  });

  test("picked statuses: one of them, among the monitors that are checked", () => {
    expect(getMonitorListQuery({ monitorStatusIds: STATUS_IDS })).toEqual({
      isArchived: false,
      disableActiveMonitoring: false,
      currentMonitorStatusId: new Includes(STATUS_IDS),
    });
  });

  test("a status filter and picked statuses together: both, among the monitors that are checked", () => {
    expect(
      getMonitorListQuery({
        statusFilter: MONITOR_LIST_STATUS_FILTER_NON_OPERATIONAL,
        monitorStatusIds: STATUS_IDS,
      }),
    ).toEqual({
      isArchived: false,
      disableActiveMonitoring: false,
      currentMonitorStatus: { isOperationalState: false },
      currentMonitorStatusId: new Includes(STATUS_IDS),
    });
    expect(
      getMonitorListQuery({
        statusFilter: MONITOR_LIST_STATUS_FILTER_OPERATIONAL,
        monitorStatusIds: STATUS_IDS,
      }),
    ).toEqual({
      isArchived: false,
      disableActiveMonitoring: false,
      currentMonitorStatus: { isOperationalState: true },
      firstMeasuredAt: new NotNull(),
      currentMonitorStatusId: new Includes(STATUS_IDS),
    });
  });

  test("picked statuses ask for the stored status, as the Monitors list's Status filter does", () => {
    expect(
      getMonitorListQuery({ monitorStatusIds: STATUS_IDS })["firstMeasuredAt"],
    ).toBeUndefined();
    expect(
      getMonitorListQuery({
        statusFilter: MONITOR_LIST_STATUS_FILTER_NON_OPERATIONAL,
      })["firstMeasuredAt"],
    ).toBeUndefined();
  });

  /*
   * Issue #8096: given the project the list is read in, "non-operational"
   * asks for the status in that project too - the same monitors, read from
   * the project's few problem statuses rather than from every monitor of
   * the project. The board passes its project; the public policy does not.
   */
  describe("given the project the list is read in", () => {
    const PROJECT_ID: string = "8b1d6a3e-3a52-4f1f-9b8e-0b5a3a3f00aa";

    test("'non-operational' asks for the status in the project: the Not Operational rule, asked in it", () => {
      for (const projectId of [new ObjectID(PROJECT_ID), PROJECT_ID]) {
        expect(
          getMonitorListQuery(
            { statusFilter: MONITOR_LIST_STATUS_FILTER_NON_OPERATIONAL },
            projectId,
          ),
        ).toEqual(NotOperationalMonitorQuery.getQuery(projectId));
        expect(
          getMonitorListQuery(
            { statusFilter: MONITOR_LIST_STATUS_FILTER_NON_OPERATIONAL },
            projectId,
          ),
        ).toEqual({
          isArchived: false,
          disableActiveMonitoring: false,
          currentMonitorStatus: {
            isOperationalState: false,
            projectId: new ObjectID(PROJECT_ID),
          },
        });
      }
    });

    test("beside picked statuses too", () => {
      expect(
        getMonitorListQuery(
          {
            statusFilter: MONITOR_LIST_STATUS_FILTER_NON_OPERATIONAL,
            monitorStatusIds: STATUS_IDS,
          },
          PROJECT_ID,
        ),
      ).toEqual({
        isArchived: false,
        disableActiveMonitoring: false,
        currentMonitorStatus: {
          isOperationalState: false,
          projectId: new ObjectID(PROJECT_ID),
        },
        currentMonitorStatusId: new Includes(STATUS_IDS),
      });
    });

    test("with no project, the status alone, as the public policy asks it", () => {
      for (const projectId of [undefined, null, ""]) {
        expect(
          getMonitorListQuery(
            { statusFilter: MONITOR_LIST_STATUS_FILTER_NON_OPERATIONAL },
            projectId,
          ),
        ).toEqual(
          getMonitorListQuery({
            statusFilter: MONITOR_LIST_STATUS_FILTER_NON_OPERATIONAL,
          }),
        );
      }
    });

    /*
     * Most monitors hold an operational status: starting from it would not
     * narrow the read. Picked statuses are ids already, and the rest of the
     * settings name no status.
     */
    test("every other setting is asked as before", () => {
      for (const filter of [
        {},
        { statusFilter: MONITOR_LIST_STATUS_FILTER_OPERATIONAL },
        { monitorStatusIds: STATUS_IDS },
        {
          statusFilter: MONITOR_LIST_STATUS_FILTER_OPERATIONAL,
          monitorStatusIds: STATUS_IDS,
        },
      ]) {
        expect(getMonitorListQuery(filter, PROJECT_ID)).toEqual(
          getMonitorListQuery(filter),
        );
      }
    });
  });

  /*
   * Every way the settings can filter on a status, crossed: whichever it is,
   * a monitor whose monitoring is off is not matched by it, and an archived
   * monitor is never listed.
   */
  test("no status setting ever matches a monitor whose monitoring is off", () => {
    for (const statusFilter of [
      undefined,
      MONITOR_LIST_STATUS_FILTER_OPERATIONAL,
      MONITOR_LIST_STATUS_FILTER_NON_OPERATIONAL,
    ]) {
      for (const monitorStatusIds of [undefined, [], [STATUS_IDS[0]!]]) {
        const query: Record<string, unknown> = getMonitorListQuery({
          statusFilter,
          monitorStatusIds,
        });
        const filtersOnStatus: boolean =
          Boolean(statusFilter) || Boolean(monitorStatusIds?.length);

        expect({
          statusFilter,
          monitorStatusIds,
          isArchived: query["isArchived"],
          disableActiveMonitoring: query["disableActiveMonitoring"],
        }).toEqual({
          statusFilter,
          monitorStatusIds,
          isArchived: false,
          disableActiveMonitoring: filtersOnStatus ? false : undefined,
        });
      }
    }
  });

  test("a stored value the settings never offer filters on no status, as the widget always read it", () => {
    for (const statusFilter of ["Operational", "down", "all", "true"]) {
      expect(getMonitorListQuery({ statusFilter })).toEqual({
        isArchived: false,
      });
    }
  });

  test("hands out a fresh query each time: a caller that adds to it changes no one else's", () => {
    const first: Record<string, unknown> = getMonitorListQuery({
      statusFilter: MONITOR_LIST_STATUS_FILTER_NON_OPERATIONAL,
    });
    first["projectId"] = "project";
    first["disableActiveMonitoring"] = true;
    (first["currentMonitorStatus"] as Record<string, unknown>)[
      "isOperationalState"
    ] = true;

    expect(
      getMonitorListQuery({
        statusFilter: MONITOR_LIST_STATUS_FILTER_NON_OPERATIONAL,
      }),
    ).toEqual(NotOperationalMonitorQuery.getQuery());
    expect(NotOperationalMonitorQuery.getQuery()).toEqual({
      isArchived: false,
      disableActiveMonitoring: false,
      currentMonitorStatus: { isOperationalState: false },
    });
  });

  test("the settings form offers exactly the status filters the query knows, and All", () => {
    const argument:
      | ComponentArgument<DashboardMonitorListComponent>
      | undefined =
      DashboardMonitorListComponentUtil.getComponentConfigArguments().find(
        (
          candidate: ComponentArgument<DashboardMonitorListComponent>,
        ): boolean => {
          return candidate.id === "statusFilter";
        },
      );

    const values: Array<unknown> = (argument?.dropdownOptions || []).map(
      (option: { value: unknown }): unknown => {
        return option.value;
      },
    );

    expect(values).toEqual(["", ...MONITOR_LIST_STATUS_FILTER_VALUES]);
    expect(MONITOR_LIST_STATUS_FILTER_VALUES).toEqual([
      "operational",
      "non-operational",
    ]);
  });
});

describe("what a row says a monitor's status is", () => {
  test("a monitor whose monitoring is off says Disabled, in gray, whatever status it was frozen at", () => {
    for (const currentMonitorStatus of [
      { name: "Offline", color: RED },
      { name: "Operational", color: GREEN },
      { name: "Offline", color: null },
      null,
      undefined,
    ]) {
      expect(
        getMonitorListRowStatus({
          disableActiveMonitoring: true,
          currentMonitorStatus,
        }),
      ).toEqual({
        kind: MonitorRowStatusKind.MonitoringOff,
        text: "Disabled",
        color: Gray500,
        isProductWords: true,
        shouldAnimate: false,
        isMonitoringOff: true,
      });
    }
  });

  test("a monitor whose monitoring is on says its status, in its colour", () => {
    expect(
      getMonitorListRowStatus({
        disableActiveMonitoring: false,
        currentMonitorStatus: { name: "Offline", color: RED },
      }),
    ).toEqual({
      kind: MonitorRowStatusKind.Status,
      text: "Offline",
      color: RED,
      isProductWords: false,
      shouldAnimate: true,
      isMonitoringOff: false,
    });
  });

  test("a monitor read without the flag says its status, as every row did before", () => {
    for (const disableActiveMonitoring of [undefined, null]) {
      expect(
        getMonitorListRowStatus({
          disableActiveMonitoring,
          currentMonitorStatus: { name: "Degraded", color: RED },
        }),
      ).toMatchObject({ text: "Degraded", color: RED, isMonitoringOff: false });
    }
  });

  test("a monitor read without a status says Unknown, with no colour", () => {
    for (const currentMonitorStatus of [null, undefined]) {
      expect(
        getMonitorListRowStatus({
          disableActiveMonitoring: false,
          currentMonitorStatus,
        }),
      ).toEqual({
        kind: MonitorRowStatusKind.NoStatus,
        text: MONITOR_LIST_NO_STATUS_LABEL,
        color: null,
        isProductWords: true,
        shouldAnimate: false,
        isMonitoringOff: false,
      });
    }

    // A status read with no name or colour is still the monitor's status.
    for (const currentMonitorStatus of [{}, { name: "", color: null }]) {
      expect(
        getMonitorListRowStatus({
          disableActiveMonitoring: false,
          currentMonitorStatus,
        }),
      ).toMatchObject({
        text: MONITOR_LIST_NO_STATUS_LABEL,
        color: null,
        isProductWords: true,
        isMonitoringOff: false,
      });
    }

    expect(MONITOR_LIST_NO_STATUS_LABEL).toBe("Unknown");
  });

  test("a status without a colour keeps its name and has no colour", () => {
    expect(
      getMonitorListRowStatus({
        currentMonitorStatus: { name: "Paused", color: undefined },
      }),
    ).toMatchObject({ text: "Paused", color: null, isMonitoringOff: false });
  });

  /*
   * Issue #8899: the widget says what the Monitors table says, and the
   * table what the monitor's page says (Utils/Monitor/MonitorRowStatus).
   */
  test("a monitor nothing has checked yet says Waiting for data, then No results yet, in the widget too", () => {
    const now: Date = new Date("2026-11-16T12:00:00.000Z");
    const row: Parameters<typeof getMonitorListRowStatus>[0] = {
      monitorType: "Website",
      firstMeasuredAt: null,
      createdAt: new Date(now.getTime() - 60 * 1000),
      monitoringInterval: "*/5 * * * *",
      disableActiveMonitoring: false,
      currentMonitorStatus: {
        name: "Operational",
        color: GREEN,
        isOperationalState: true,
        isOfflineState: false,
      },
    };

    expect(getMonitorListRowStatus(row, now)).toMatchObject({
      kind: MonitorRowStatusKind.WaitingForData,
      text: "Waiting for data",
      color: Gray500,
      isProductWords: true,
      isMonitoringOff: false,
    });
    expect(
      getMonitorListRowStatus(
        { ...row, createdAt: new Date(now.getTime() - 3 * 3600 * 1000) },
        now,
      ),
    ).toMatchObject({
      kind: MonitorRowStatusKind.NoResultsYet,
      text: "No results yet",
      isMonitoringOff: false,
    });
    expect(
      getMonitorListRowStatus({ ...row, firstMeasuredAt: now }, now),
    ).toMatchObject({
      kind: MonitorRowStatusKind.Status,
      text: "Operational",
      color: GREEN,
    });
  });

  test("a monitor no probe checks says so in the widget, as in the table", () => {
    expect(
      getMonitorListRowStatus({
        isNoProbeEnabledOnThisMonitor: true,
        currentMonitorStatus: { name: "Operational", color: GREEN },
      }),
    ).toMatchObject({ text: "No Probe Enabled", isMonitoringOff: false });
    expect(
      getMonitorListRowStatus({
        isAllProbesDisconnectedFromThisMonitor: true,
        currentMonitorStatus: { name: "Operational", color: GREEN },
      }),
    ).toMatchObject({ text: "Probes Disconnected", isMonitoringOff: false });
  });

  test("reads a Monitor as the API hands it over", () => {
    const off: Monitor = Monitor.fromJSON(
      {
        _id: "8b1d6a3e-3a52-4f1f-9b8e-0b5a3a3f0003",
        name: "Checkout",
        disableActiveMonitoring: true,
        currentMonitorStatus: { name: "Offline", color: "#ef4444" },
      },
      Monitor,
    ) as Monitor;
    const on: Monitor = Monitor.fromJSON(
      {
        _id: "8b1d6a3e-3a52-4f1f-9b8e-0b5a3a3f0004",
        name: "Search",
        disableActiveMonitoring: false,
        currentMonitorStatus: { name: "Offline", color: "#ef4444" },
      },
      Monitor,
    ) as Monitor;

    const offStatus: MonitorListRowStatus = getMonitorListRowStatus(off);
    const onStatus: MonitorListRowStatus = getMonitorListRowStatus(on);

    expect(offStatus.text).toBe("Disabled");
    expect(offStatus.isMonitoringOff).toBe(true);
    expect(onStatus.text).toBe("Offline");
    expect(onStatus.isMonitoringOff).toBe(false);
  });
});

describe("Disabled is the Monitors table's word and colour, in every language", () => {
  const PACKAGES: string = path.resolve(__dirname, "../../../..");

  test("the word and the colour", () => {
    expect(MONITOR_LIST_MONITORING_OFF_STATUS_LABEL).toBe("Disabled");
    expect(MONITOR_LIST_MONITORING_OFF_STATUS_COLOR).toBe(Gray500);
    expect(MONITOR_LIST_MONITORING_OFF_STATUS_COLOR.toString()).toBe("#6b7280");
  });

  // The Monitors table's status column reads the same rule as the widget.
  test("the Monitors table draws the same", () => {
    const table: string = fs.readFileSync(
      path.join(
        PACKAGES,
        "App/FeatureSet/Dashboard/src/Components/Monitor/MonitorTable.tsx",
      ),
      "utf8",
    );

    expect(table).toContain("MonitorRowStatusUtil.getRowStatus(item)");
    expect(table).not.toContain('text={"Disabled"}');

    // With every column the rule reads.
    for (const column of [
      "isArchived: true",
      "disableActiveMonitoring: true",
      "disableActiveMonitoringBecauseOfManualIncident: true",
      "disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true",
      "isNoProbeEnabledOnThisMonitor: true",
      "isAllProbesDisconnectedFromThisMonitor: true",
      "monitorType: true",
      "firstMeasuredAt: true",
      "createdAt: true",
      "monitoringInterval: true",
    ]) {
      expect(table).toContain(column);
    }

    expect(table).toContain("...STARTING_STATUS_SELECT");
  });

  test.each(["en", ...DASHBOARD_LANGUAGES])(
    "the Dashboard has the word in %s",
    (language: string) => {
      const locale: Record<string, unknown> = JSON.parse(
        fs.readFileSync(
          path.join(
            PACKAGES,
            `App/FeatureSet/Dashboard/src/Locales/${language}.json`,
          ),
          "utf8",
        ),
      ) as Record<string, unknown>;
      const word: unknown = locale[MONITOR_LIST_MONITORING_OFF_STATUS_LABEL];

      expect(typeof word).toBe("string");
      expect((word as string).length).toBeGreaterThan(0);

      if (language === "en") {
        expect(word).toBe("Disabled");
      } else {
        expect({ language, translated: word !== "Disabled" }).toEqual({
          language,
          translated: true,
        });
      }
    },
  );
});

describe("what a row reads", () => {
  test("what the row rule reads, beside what it always drew", () => {
    expect(MONITOR_LIST_WIDGET_SELECT).toEqual({
      _id: true,
      name: true,
      isArchived: true,
      disableActiveMonitoring: true,
      disableActiveMonitoringBecauseOfManualIncident: true,
      disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
      isNoProbeEnabledOnThisMonitor: true,
      isAllProbesDisconnectedFromThisMonitor: true,
      monitorType: true,
      firstMeasuredAt: true,
      createdAt: true,
      monitoringInterval: true,
      currentMonitorStatus: {
        name: true,
        color: true,
        isOperationalState: true,
        isOfflineState: true,
        // Orders a honeycomb's legend as Status sorts the list (#7344).
        priority: true,
      },
    });
  });

  test("every field is a column of the Monitor model", () => {
    const monitor: Monitor = new Monitor();

    for (const column of Object.keys(MONITOR_LIST_WIDGET_SELECT)) {
      expect({ column, isColumn: monitor.isTableColumn(column) }).toEqual({
        column,
        isColumn: true,
      });
    }
  });
});
