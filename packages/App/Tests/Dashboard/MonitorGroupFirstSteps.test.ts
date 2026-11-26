import MonitorGroupMonitorsCopy, {
  ADD_MONITORS_QUERY_PARAM,
} from "../../FeatureSet/Dashboard/src/Components/MonitorGroup/MonitorGroupMonitorsCopy";
import {
  getAddMonitorsErrorMessage,
  getMonitorsToOfferQuery,
  getNothingToAddMessage,
} from "../../FeatureSet/Dashboard/src/Components/MonitorGroup/MonitorGroupMembership";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import {
  createTranslator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DASHBOARD_LANGUAGES } from "Common/Tests/Helpers/TranslatedLanguages";

/*
 * A monitor group's first steps.
 *
 * A new group has no monitors. Its Overview used to show the operational
 * status and an uptime bar anyway, with the one thing to do next - put
 * monitors in it - on another page, under a menu section called "More",
 * behind "Assign Monitor", one monitor per dialog. Now:
 *
 *   - an empty group's Overview says so and offers Add Monitors, which opens
 *     the group's Monitors page with its picker open (?addMonitors=true);
 *   - Add Monitors picks every monitor of the group in one dialog, offering
 *     only the ones the group does not hold, and says how many were added
 *     when some are refused;
 *   - a monitor is taken out with Remove (it was "Unassign");
 *   - the group's menu leads with what a group is - its Overview and its
 *     Monitors - then its Activity, then Advanced (with Owners), as a
 *     monitor's own menu does.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const OTHER_LOCALES: Array<string> = [...DASHBOARD_LANGUAGES];

const MONITORS_PAGE: string = "Pages/MonitorGroup/View/Monitors.tsx";
const OVERVIEW_PAGE: string = "Pages/MonitorGroup/View/Index.tsx";
const SIDE_MENU: string = "Pages/MonitorGroup/View/SideMenu.tsx";
const LIST_PAGE: string = "Pages/MonitorGroup/MonitorGroups.tsx";

function readDashboard(relative: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8");
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const API_ID: string = "71000000-0000-4000-8000-000000000001";
const WEB_ID: string = "71000000-0000-4000-8000-000000000002";
const PAYMENTS_ID: string = "71000000-0000-4000-8000-000000000003";

const ENGLISH: Translator = createTranslator(undefined, "en");

/*
 * Which monitors Add Monitors offers is the server's to say (#10399): the
 * picker searches it with this query, 50 names at a time. The dialog used to
 * read the project's first 10,000 monitors and drop the group's in the
 * browser, so a monitor past them was never offered.
 */
describe("Add Monitors offers the monitors the group does not hold", () => {
  test("an empty group is offered every live monitor", () => {
    expect(getMonitorsToOfferQuery({ monitorIdsInGroup: [] })).toEqual({
      isArchived: false,
    });
  });

  test("a monitor already in the group is not offered again", () => {
    const query: Record<string, unknown> = getMonitorsToOfferQuery({
      monitorIdsInGroup: [new ObjectID(WEB_ID), API_ID],
    });

    expect(query["isArchived"]).toBe(false);
    expect(query["_id"]).toBeInstanceOf(IncludesNone);
    expect((query["_id"] as IncludesNone).values).toEqual([WEB_ID, API_ID]);
  });

  test("is sent to the server as a list of ids none of which it offers", () => {
    expect(
      JSON.parse(
        JSON.stringify(
          JSONFunctions.serialize(
            getMonitorsToOfferQuery({
              monitorIdsInGroup: [new ObjectID(PAYMENTS_ID)],
            }) as JSONObject,
          ),
        ),
      ),
    ).toEqual({
      isArchived: false,
      _id: { _type: "IncludesNone", value: [PAYMENTS_ID] },
    });
  });
});

describe("when Add Monitors has nothing to offer", () => {
  test("a project with no monitor yet says so, and that one is created first", () => {
    expect(getNothingToAddMessage({ inProject: 0, toOffer: 0 })).toBe(
      "This project has no monitors yet. Create one, then add it to this group.",
    );
  });

  test("a group holding every monitor says so - not that the project has none", () => {
    expect(getNothingToAddMessage({ inProject: 3, toOffer: 0 })).toBe(
      "Every monitor in this project is already in this group.",
    );
  });

  test("says nothing while there is a monitor to pick", () => {
    expect(
      getNothingToAddMessage({ inProject: undefined, toOffer: 2 }),
    ).toBeUndefined();
  });
});

describe("what Add Monitors says afterwards", () => {
  test("nothing, when every picked monitor was added", () => {
    expect(
      getAddMonitorsErrorMessage(
        { added: 3, total: 3, firstError: undefined },
        ENGLISH,
      ),
    ).toBeNull();
  });

  test("the reason, when none was", () => {
    expect(
      getAddMonitorsErrorMessage(
        { added: 0, total: 2, firstError: "You do not have permission." },
        ENGLISH,
      ),
    ).toBe("No monitor was added: You do not have permission.");
  });

  test("how many were, and that the ones still picked were not, with the reason", () => {
    expect(
      getAddMonitorsErrorMessage(
        { added: 2, total: 5, firstError: "Monitor not found." },
        ENGLISH,
      ),
    ).toBe(
      "Added 2 of 5 monitors. Those still picked were not added: Monitor not found.",
    );
  });

  test("in the reader's language", () => {
    const de: Record<string, unknown> = readLocale("de");
    const german: Translator = createTranslator(
      (key: string): string | undefined => {
        return typeof de[key] === "string" ? (de[key] as string) : undefined;
      },
      "de",
    );

    expect(
      getAddMonitorsErrorMessage(
        { added: 0, total: 1, firstError: "Nein." },
        german,
      ),
    ).not.toContain("No monitor was added");
  });
});

describe("the Monitors page", () => {
  const page: string = readDashboard(MONITORS_PAGE);

  test("adds several monitors in one dialog, with only the ones not in the group to pick from", () => {
    expect(page).toContain("<BasicFormModal<AddMonitorsFormValues>");
    expect(page).toContain(
      "fieldType: FormFieldSchemaType.MultiSelectDropdown",
    );
    // Searched on the server, within the monitors the group does not hold.
    expect(page).toContain("getMonitorsToOfferQuery(");
    expect(page).toContain("dropdownModal: {");
    expect(page).toContain("query: monitorsToOfferQuery,");
    // Never the project's first 10,000 monitors, searched in the browser.
    expect(page).not.toContain("dropdownOptions:");
    expect(page).not.toContain("getList<Monitor>");
    expect(page).toContain("title={MonitorGroupMonitorsCopy.addDialogTitle}");
    expect(page).toContain(
      "submitButtonText={MonitorGroupMonitorsCopy.addButton}",
    );
  });

  test("creates one row per picked monitor, so one refusal does not lose the others", () => {
    expect(page).toContain("for (const monitorId of pickedIds) {");
    expect(page).toContain("await ModelAPI.create<MonitorGroupResource>({");
    expect(page).toContain("getAddMonitorsErrorMessage(");
    // The picks that were not added wait in the picker for another try.
    expect(page).toContain("setPickedMonitorIds(notAddedIds);");
    expect(page).toContain("monitors: pickedMonitorIds,");
  });

  test("with nothing to pick, says why and offers Create Monitor instead of an empty picker", () => {
    // Decided by the server's counts, not by a list read into the browser.
    expect(page).toContain("getNothingToAddMessage(offerCounts)");
    expect(page).toContain("await ModelAPI.count<Monitor>({");
    // Only once the monitors are counted, and never over a pick kept for a retry.
    expect(page).toContain('offerState === "loaded" &&');
    expect(page).toContain("pickedMonitorIds.length === 0 &&");
    expect(page).toContain("!isAddLoading");
    expect(page).toContain(
      "submitButtonText={MonitorGroupMonitorsCopy.createMonitorButton}",
    );
    expect(page).toContain("RouteMap[PageMap.MONITOR_CREATE] as Route");
    // Create Monitor only for whoever may create one; a notice for the rest.
    expect(page).toContain(
      "const canCreateMonitor: boolean = PermissionGate.check(\n    new Monitor(),\n    ModelAction.Create,",
    );
    expect(page).toContain('closeButtonText="Close"');
    // Drawn like the product's other "nothing to add" dialogs.
    expect(page).toContain(
      "<NothingToAddNotice reason={nothingToAddMessage} />",
    );
    // The empty picker's old line is gone.
    expect(page).not.toContain("MonitorGroupMonitorsCopy.nothingToAdd");
  });

  test("when the monitors cannot be read, says why and offers Try again", () => {
    expect(page).toContain('if (offerState === "failed") {');
    expect(page).toContain("error={offerError}");
    expect(page).toContain('submitButtonText="Try again"');
  });

  test("reads the members again in place after an add or a remove, so nothing flashes", () => {
    expect(page).toContain("fetchMonitorsInGroup({ showPageLoader: false })");
    expect(
      page.split("fetchMonitorsInGroup({ showPageLoader: false })").length - 1,
    ).toBe(2);
  });

  test("opens Add Monitors as the page opens when the Overview sent the reader here", () => {
    expect(page).toContain(
      'Navigation.getQueryStringByName(ADD_MONITORS_QUERY_PARAM) === "true"',
    );
    expect(ADD_MONITORS_QUERY_PARAM).toBe("addMonitors");
  });

  test("offers Add Monitors only to whoever may put a monitor in a group", () => {
    expect(page).toContain("PermissionGate.gateCardButton(");
    expect(page).toContain(
      "new MonitorGroupResource(),\n      ModelAction.Create,",
    );
    expect(page).toContain(
      "cardButtons={addMonitorsButton ? [addMonitorsButton] : []}",
    );
  });

  test("takes a monitor out with Remove, in plain words", () => {
    expect(page).toContain('title: "Remove",');
    expect(page).toContain('submitButtonText="Remove"');
    expect(page).toContain(
      "title={MonitorGroupMonitorsCopy.removeDialogTitle}",
    );
    expect(page).toContain("MonitorGroupMonitorsCopy.removeDialogDescription");
    expect(page).toContain("MonitorGroupMonitorsCopy.alreadyRemovedError");
  });

  test("no longer says Assign, Unassign, or the old service wording", () => {
    for (const retired of [
      "Assign Monitor",
      "Unassign",
      "Service monitor not found",
      "Select monitor to assign to this group.",
      "This is helpful for determining the health of the group.",
    ]) {
      expect(page).not.toContain(retired);
    }
  });
});

describe("the Overview of an empty group", () => {
  const page: string = readDashboard(OVERVIEW_PAGE);

  test("counts the group's monitors", () => {
    expect(page).toContain("await ModelAPI.count({");
    expect(page).toContain("modelType: MonitorGroupResource,");
  });

  test("says it has none, with Add Monitors, in place of an uptime bar", () => {
    expect(page).toContain("monitorCount === 0 ? (");
    expect(page).toContain('id="monitor-group-no-monitors"');
    expect(page).toContain("title={MonitorGroupMonitorsCopy.emptyTitle}");
    expect(page).toContain(
      "description={MonitorGroupMonitorsCopy.emptyDescription}",
    );
    expect(page).toContain('dataTestId="monitor-group-add-monitors"');
    expect(page).toContain('[ADD_MONITORS_QUERY_PARAM]: "true"');
    // The uptime bar is still there for a group with monitors.
    expect(page).toContain('title="Uptime Graph"');
  });

  test("offers Add Monitors only to whoever may put a monitor in a group", () => {
    expect(page).toContain(
      "const canAddMonitors: boolean = PermissionGate.check(",
    );
    expect(page).toContain("canAddMonitors ? (");
  });

  test("its Current Status, like the list's, says it has no monitors yet", () => {
    expect(page).toContain("return <NoMonitorsStatus />;");
    const list: string = readDashboard(
      "Components/MonitorGroup/CurrentStatus.tsx",
    );
    expect(list).toContain("return <NoMonitorsStatus />;");
    expect(list).toContain("modelType: MonitorGroupResource,");
  });

  // A Button has no margin of its own (#9128): nothing to take back.
  test("its button is centred: nothing pushes it off centre", () => {
    expect(page).toContain('dataTestId="monitor-group-add-monitors"');
    expect(page).not.toMatch(/button\]:(md:)?ml-0/u);
  });

  test("names a group's fields as the create form does", () => {
    expect(page).not.toContain('title: "Group Name"');
    expect(page).not.toContain('title: "Group Description"');
    expect(page).not.toContain('title: "Monitor Group Name"');
  });
});

describe("the group's menu", () => {
  const menu: string = readDashboard(SIDE_MENU);

  // Section titles and page titles, in the order the menu draws them.
  const titles: Array<string> = Array.from(
    menu.matchAll(/title: "([^"]+)"/g),
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );

  test("leads with the group and its monitors, then its activity, then Advanced", () => {
    expect(titles).toEqual([
      "Overview",
      "Overview",
      "Monitors",
      "Activity",
      "Incidents",
      "Alerts",
      "Advanced",
      "Owners",
      "Audit Logs",
      "Delete Group",
    ]);
  });

  test("has no catch-all sections any more", () => {
    expect(titles).not.toContain("Basic");
    expect(titles).not.toContain("More");
  });
});

describe("the list names a group as its forms do", () => {
  test("its column and filter say Name", () => {
    const list: string = readDashboard(LIST_PAGE);

    expect(list).not.toContain('title: "Group Name"');
  });
});

describe("translations", () => {
  const words: Array<string> = Object.values(MonitorGroupMonitorsCopy).filter(
    (word: string) => {
      // Already translated keys the pages reuse.
      return ![
        "Add Monitors",
        "Monitors",
        "Select Monitors",
        "Remove",
        "Monitors in Group",
      ].includes(word);
    },
  );

  test("en.json carries every word as itself", () => {
    const en: Record<string, unknown> = readLocale("en");

    for (const word of Object.values(MonitorGroupMonitorsCopy)) {
      expect(en[word]).toBe(word);
    }
  });

  test.each(OTHER_LOCALES)(
    "%s.json translates every new word",
    (locale: string) => {
      const json: Record<string, unknown> = readLocale(locale);

      for (const word of words) {
        expect(typeof json[word]).toBe("string");
        expect(json[word]).not.toBe(word);
      }
    },
  );
});
