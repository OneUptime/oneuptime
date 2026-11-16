import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";

/*
 * A PRIVATE RECORD'S PAGING AND RUNBOOK RUNS FOLLOW ITS OWNING TEAMS (#8913).
 *
 * Paging about a private incident, alert or episode, and starting a runbook
 * run linked to one, take their permission from the teams that own it, as
 * the server asks (OnCallPageService, RunbookPrivateRecordAccess). The
 * record's page provides what the reader holds on it (PrivateRecordScope),
 * and each feed's Actions menu asks its Execute On-Call Policy and Execute
 * Runbook with it: locked, saying why, for a reader whose teams that own
 * the record may not, though another team of theirs may anywhere else.
 *
 * The four REAL feeds are rendered with their REAL Actions menu, under the
 * scope a private record's layout provides, and the reader's REAL
 * permission snapshot - the rows the API's headers leave in storage. Only
 * the network (ModelAPI), the markdown-rendering FeedItem, the runbook
 * picker and the form are stubbed.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (): Promise<{ data: Array<unknown>; count: number }> => {
        return Promise.resolve({ data: [], count: 0 });
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Components/Feed/FeedItem", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: { title: string }): React.ReactElement => {
      return React.createElement("div", {
        role: "dialog",
        "aria-label": props.title,
      });
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/RunbookPicker",
  () => {
    return {
      __esModule: true,
      // Drawn always, open only once Execute Runbook is pressed.
      default: (props: { isOpen: boolean }): React.ReactElement | null => {
        return props.isOpen
          ? React.createElement("div", {
              role: "dialog",
              "aria-label": "Runbook picker",
            })
          : null;
      },
    };
  },
);

import IncidentFeedElement from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentFeed";
import AlertFeedElement from "../../../../App/FeatureSet/Dashboard/src/Components/Alert/AlertFeed";
import IncidentEpisodeFeedElement from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentEpisode/IncidentEpisodeFeed";
import AlertEpisodeFeedElement from "../../../../App/FeatureSet/Dashboard/src/Components/AlertEpisode/AlertEpisodeFeed";
import { EventStanding } from "../../../../App/FeatureSet/Dashboard/src/Utils/EventDuration";
import { HeldPermissions } from "../../../Types/HeldPermissions";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import {
  PrivateRecordScope,
  PrivateRecordScopeContext,
} from "../../../UI/Utils/PrivateRecordScope";
import { keepProjectPermissionsInTab } from "../../Helpers/TabProjectPermissions";

const PROJECT_ID: ObjectID = new ObjectID(
  "89130000-0000-4000-8000-000000000001",
);
const RECORD_ID: ObjectID = new ObjectID(
  "89130000-0000-4000-8000-000000000002",
);
const TEAM_1: string = "89130000-0000-4000-8000-0000000000a1";
const TEAM_2: string = "89130000-0000-4000-8000-0000000000a2";

const PAGE: string = "Execute On-Call Policy";
const RUN: string = "Execute Runbook";

// What the record's layout says after a gate's first sentence (PrivateRecordScopeProvider's).
const REASON: string =
  "This incident is private, so it is changed only with the permissions of the teams that own it, and Team 2, your team that owns it, may not do this.";

const row: (
  permission: Permission,
  teamId?: string | undefined,
) => UserPermission = (
  permission: Permission,
  teamId?: string | undefined,
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
    ...(teamId ? { teamId: new ObjectID(teamId) } : {}),
  };
};

/*
 * The reader: Team 1 may change everything (Project Member), Team 2 - the
 * only team that owns the private record - may only view it.
 */
const READER_ROWS: Array<UserPermission> = [
  row(Permission.CurrentUser),
  row(Permission.ProjectUser),
  row(Permission.ProjectMember, TEAM_1),
  row(Permission.Viewer, TEAM_2),
];

// What the API's permission headers leave in storage for the project, in its tab.
function store(rows: Array<UserPermission>): void {
  PermissionUtil.setGlobalPermissions({
    _type: "UserGlobalAccessPermission",
    globalPermissions: [Permission.Public, Permission.User],
    projectIds: [PROJECT_ID],
  });
  keepProjectPermissionsInTab({
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: rows,
  });
}

// What the private record's layout provides: what the reader holds on it, by Team 2.
function scopeOf(tableName: string): PrivateRecordScope {
  const held: HeldPermissions | null = PermissionGate.getHeldOnPrivateRecord({
    isPrivate: true,
    isOwnedByReader: false,
    owningTeamIds: [TEAM_2],
  });

  expect(held).not.toBeNull();

  return { tableName: tableName, held: held!, reason: REASON };
}

interface FeedCase {
  name: string;
  tableName: string;
  render: () => React.ReactElement;
  // Whether its menu starts a runbook run: an incident's and an alert's do.
  runsRunbooks: boolean;
}

const FEEDS: Array<FeedCase> = [
  {
    name: "a private incident's feed",
    tableName: "Incident",
    render: (): React.ReactElement => {
      return (
        <IncidentFeedElement
          incidentId={RECORD_ID}
          standing={EventStanding.Open}
        />
      );
    },
    runsRunbooks: true,
  },
  {
    name: "a private alert's feed",
    tableName: "Alert",
    render: (): React.ReactElement => {
      return (
        <AlertFeedElement alertId={RECORD_ID} standing={EventStanding.Open} />
      );
    },
    runsRunbooks: true,
  },
  {
    name: "a private incident episode's feed",
    tableName: "IncidentEpisode",
    render: (): React.ReactElement => {
      return (
        <IncidentEpisodeFeedElement
          incidentEpisodeId={RECORD_ID}
          standing={EventStanding.Open}
        />
      );
    },
    runsRunbooks: false,
  },
  {
    name: "a private alert episode's feed",
    tableName: "AlertEpisode",
    render: (): React.ReactElement => {
      return (
        <AlertEpisodeFeedElement
          alertEpisodeId={RECORD_ID}
          standing={EventStanding.Open}
        />
      );
    },
    runsRunbooks: false,
  },
];

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

// The feed, rendered on its page (with `scope`, or on none), its Actions menu open.
async function openMenu(
  feed: FeedCase,
  scope: PrivateRecordScope | null,
): Promise<void> {
  render(
    <PrivateRecordScopeContext.Provider value={scope}>
      {feed.render()}
    </PrivateRecordScopeContext.Provider>,
  );
  await flush();

  const trigger: HTMLElement = screen
    .getByText("Actions")
    .closest('[aria-haspopup="menu"]') as HTMLElement;

  fireEvent.click(trigger);
  await screen.findByRole("menuitem", { name: PAGE });
}

// The reason a menu item reads, or null when it is offered.
function lockOf(name: string): string | null {
  const item: HTMLElement = screen.getByRole("menuitem", { name: name });

  if (item.getAttribute("aria-disabled") !== "true") {
    return null;
  }

  const reasonId: string | null = item.getAttribute("aria-describedby");

  return reasonId ? document.getElementById(reasonId)?.textContent || "" : "";
}

// Presses a menu item: whether anything opened.
async function opens(name: string): Promise<boolean> {
  fireEvent.click(screen.getByRole("menuitem", { name: name }));
  await flush();

  return screen.queryAllByRole("dialog").length > 0;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  PermissionGate.clearPermissionPropsCache();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  jest.restoreAllMocks();
});

describe.each(FEEDS)("$name", (feed: FeedCase) => {
  test("a reader whose team that owns it may only view it: paging is locked, saying why, and opens nothing", async () => {
    store(READER_ROWS);
    await openMenu(feed, scopeOf(feed.tableName));

    const lock: string | null = lockOf(PAGE);

    expect(lock).not.toBeNull();
    expect(lock!.endsWith(REASON)).toBe(true);
    expect(await opens(PAGE)).toBe(false);
  });

  if (feed.runsRunbooks) {
    test("a reader whose team that owns it may only view it: running a runbook is locked, saying why, and opens nothing", async () => {
      store(READER_ROWS);
      await openMenu(feed, scopeOf(feed.tableName));

      const lock: string | null = lockOf(RUN);

      expect(lock).not.toBeNull();
      expect(lock!.endsWith(REASON)).toBe(true);
      expect(await opens(RUN)).toBe(false);
    });
  }

  test("once the team that owns it may page and run runbooks, both are offered", async () => {
    store([
      ...READER_ROWS,
      row(Permission.OnCallMember, TEAM_2),
      row(Permission.RunbookMember, TEAM_2),
    ]);
    await openMenu(feed, scopeOf(feed.tableName));

    expect(lockOf(PAGE)).toBeNull();

    if (feed.runsRunbooks) {
      expect(lockOf(RUN)).toBeNull();
      expect(await opens(RUN)).toBe(true);
    } else {
      expect(await opens(PAGE)).toBe(true);
    }
  });

  test("on a record that is not private, the reader's own permissions decide, as before", async () => {
    store(READER_ROWS);
    await openMenu(feed, null);

    expect(lockOf(PAGE)).toBeNull();

    if (feed.runsRunbooks) {
      expect(lockOf(RUN)).toBeNull();
    }
  });

  test("a reader who may page nowhere is told what would let them, not the record's reason", async () => {
    store([
      row(Permission.CurrentUser),
      row(Permission.ProjectUser),
      row(Permission.Viewer, TEAM_1),
      row(Permission.Viewer, TEAM_2),
    ]);
    await openMenu(feed, scopeOf(feed.tableName));

    const lock: string | null = lockOf(PAGE);

    expect(lock).not.toBeNull();
    expect(lock).not.toContain(REASON);
  });

  test("before the permission snapshot lands, both are offered, the server keeping the last word", async () => {
    await openMenu(feed, null);

    expect(lockOf(PAGE)).toBeNull();

    if (feed.runsRunbooks) {
      expect(lockOf(RUN)).toBeNull();
    }
  });
});
