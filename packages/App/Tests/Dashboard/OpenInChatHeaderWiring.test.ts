import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { WorkspaceChannelRecordType } from "Common/Types/Workspace/WorkspaceChannelLink";

/*
 * Open in Slack / Open in Microsoft Teams in the header of every page whose
 * record a workspace notification rule makes a channel for: incidents,
 * alerts, both kinds of episode and scheduled maintenance events. The page
 * asks for the record's links (useRecordChannelLinks) and hands them to its
 * header as actions beside the state buttons (getOpenInChatActions); the
 * server answers at the route the client builds.
 */

const APP_ROOT: string = path.join(__dirname, "../..");
const DASHBOARD_SRC: string = path.join(APP_ROOT, "FeatureSet/Dashboard/src");
const COMMON_ROOT: string = path.join(APP_ROOT, "../Common");

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|\s)\/\/.*$/gm;
const WHITESPACE: RegExp = /\s+/g;
const SOURCE_FILE: RegExp = /\.tsx?$/;

// Comments removed and whitespace squashed, so Prettier can reflow freely.
function read(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ")
    .replace(WHITESPACE, " ");
}

function readDashboard(relativePath: string): string {
  return read(path.join(DASHBOARD_SRC, relativePath));
}

function indexOf(source: string, marker: string): number {
  const at: number = source.indexOf(marker);

  if (at < 0) {
    throw new Error(`Marker not found: ${marker}`);
  }

  return at;
}

interface RecordPage {
  name: string;
  recordType: WorkspaceChannelRecordType;
  page: string;
  // The page's first early return: the hook must be called before it.
  firstEarlyReturn: string;
  // How the page hands its actions to the header.
  secondaryActions: string;
  // The header component, when the page renders it through one.
  header?: string;
}

const PAGES: Array<RecordPage> = [
  {
    name: "Incident",
    recordType: WorkspaceChannelRecordType.Incident,
    page: "Pages/Incidents/View/Index.tsx",
    firstEarlyReturn: "if (loadedModelId !== modelIdString) {",
    secondaryActions:
      "secondaryActions={[ ...getJoinVideoCallActions(videoCalls), ...getOpenInChatActions(channelLinks), ]}",
  },
  {
    name: "Alert",
    recordType: WorkspaceChannelRecordType.Alert,
    page: "Pages/Alerts/View/Index.tsx",
    firstEarlyReturn: "if (loadedModelId !== modelIdString) {",
    secondaryActions:
      "secondaryActions={[ ...(joinVideoCallAction ? [joinVideoCallAction] : []), ...getOpenInChatActions(channelLinks), ]}",
  },
  {
    name: "Incident episode",
    recordType: WorkspaceChannelRecordType.IncidentEpisode,
    page: "Pages/Incidents/EpisodeView/Index.tsx",
    firstEarlyReturn: "if (loadedModelId !== modelIdString) {",
    secondaryActions: "secondaryActions={getOpenInChatActions(channelLinks)}",
    header: "Components/IncidentEpisode/ChangeState.tsx",
  },
  {
    name: "Alert episode",
    recordType: WorkspaceChannelRecordType.AlertEpisode,
    page: "Pages/Alerts/EpisodeView/Index.tsx",
    firstEarlyReturn: "if (loadedModelId !== modelIdString) {",
    secondaryActions: "secondaryActions={getOpenInChatActions(channelLinks)}",
    header: "Components/AlertEpisode/ChangeState.tsx",
  },
  {
    name: "Scheduled maintenance event",
    recordType: WorkspaceChannelRecordType.ScheduledMaintenance,
    page: "Pages/ScheduledMaintenanceEvents/View/Index.tsx",
    firstEarlyReturn: "if (!isCurrentEventLoaded) {",
    secondaryActions: "secondaryActions={getOpenInChatActions(channelLinks)}",
    header: "Components/ScheduledMaintenance/ChangeState.tsx",
  },
];

describe("every record with channels of its own has the buttons", () => {
  test("one page per record type the server answers for", () => {
    expect(
      PAGES.map((page: RecordPage) => {
        return page.recordType;
      }).sort(),
    ).toEqual(Object.values(WorkspaceChannelRecordType).sort());
  });

  test.each(PAGES)(
    "$name: the page asks for its record's links",
    (page: RecordPage) => {
      const source: string = readDashboard(page.page);

      expect(source).toContain(
        'import useRecordChannelLinks, { getOpenInChatActions, } from "../../../Components/Workspace/useRecordChannelLinks";',
      );
      expect(source).toContain(
        `const channelLinks: Array<WorkspaceChannelLink> = useRecordChannelLinks({ recordType: WorkspaceChannelRecordType.${Object.keys(
          WorkspaceChannelRecordType,
        ).find((key: string) => {
          return (
            (WorkspaceChannelRecordType as Record<string, string>)[key] ===
            page.recordType
          );
        })!}, recordId: modelId,`,
      );
      // So a channel a rule is still creating shows up without a reload.
      expect(source).toContain("recordStartedAt:");
    },
  );

  test.each(PAGES)(
    "$name: the hook runs on every render, before the page can return early",
    (page: RecordPage) => {
      const source: string = readDashboard(page.page);

      expect(indexOf(source, "useRecordChannelLinks({")).toBeLessThan(
        indexOf(source, page.firstEarlyReturn),
      );
    },
  );

  test.each(PAGES)(
    "$name: the links reach the header as actions beside the state buttons",
    (page: RecordPage) => {
      const source: string = readDashboard(page.page);

      expect(source).toContain(page.secondaryActions);
    },
  );

  test.each(
    PAGES.filter((page: RecordPage) => {
      return Boolean(page.header);
    }),
  )("$name: its header passes them on to the panel", (page: RecordPage) => {
    const header: string = readDashboard(page.header!);

    expect(header).toContain(
      "secondaryActions?: Array<EventPanelAction> | undefined;",
    );
    expect(header).toContain("secondaryActions={props.secondaryActions}");
  });

  test("no other page asks: a record without channels of its own has no button", () => {
    const askers: Array<string> = [];

    const walk: (directory: string) => void = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full: string = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          walk(full);
          continue;
        }

        if (!SOURCE_FILE.test(entry.name)) {
          continue;
        }

        if (read(full).includes("useRecordChannelLinks({")) {
          askers.push(path.relative(DASHBOARD_SRC, full));
        }
      }
    };

    walk(path.join(DASHBOARD_SRC, "Pages"));
    walk(path.join(DASHBOARD_SRC, "Components"));

    expect(askers.sort()).toEqual(
      PAGES.map((page: RecordPage) => {
        return page.page;
      }).sort(),
    );
  });
});

describe("the header renders them as links", () => {
  const panel: string = readDashboard(
    "Components/EventView/EventStatusPanel.tsx",
  );

  test("one channel: a link that opens in a new tab, never handing the page to the chat app", () => {
    expect(panel).toContain(
      "if (action.href && !props.isDisabled && !action.isDisabled) {",
    );
    expect(panel).toContain(
      '<a key={action.id} id={action.id} href={action.href} target="_blank" rel="noopener noreferrer"',
    );
  });

  test("several channels in one workspace: a menu under its button", () => {
    expect(panel).toContain(
      "if (action.menuItems && action.menuItems.length > 0 && !props.isDisabled) {",
    );
    expect(panel).toContain(
      "{action.menuItems.map((item: EventPanelMenuItem) => { return ( <MoreMenuItem key={item.id} text={item.label} onClick={item.onClick} /> ); })}",
    );
  });

  test("a menu opens each channel in a new tab, without an opener", () => {
    const hook: string = readDashboard(
      "Components/Workspace/useRecordChannelLinks.ts",
    );

    expect(hook).toContain(
      'window.open(url, "_blank", "noopener,noreferrer");',
    );
    expect(hook).toContain(
      'group.workspaceType === WorkspaceType.Slack ? "open-in-slack" : "open-in-microsoft-teams"',
    );
  });
});

describe("the client asks where the server answers", () => {
  test("the page builds its route from the shared constant", () => {
    const links: string = readDashboard("Components/Workspace/ChannelLinks.ts");
    const hook: string = readDashboard(
      "Components/Workspace/useRecordChannelLinks.ts",
    );

    expect(links).toContain(
      "return `${WORKSPACE_CHANNEL_LINK_ROUTE}/${data.recordType}/${data.recordId.toString()}`;",
    );
    expect(hook).toContain(
      "url: URL.fromString(APP_API_URL.toString()).addRoute( getChannelLinkRoute(data), ),",
    );
    // The project the record is in goes with the request (tenantid).
    expect(hook).toContain("headers: ModelAPI.getCommonHeaders(),");
  });

  test("the server serves the same route, for signed-in users, and the API mounts it", () => {
    const api: string = read(
      path.join(COMMON_ROOT, "Server/API/WorkspaceChannelLinkAPI.ts"),
    );
    const baseApi: string = read(
      path.join(APP_ROOT, "FeatureSet/BaseAPI/Index.ts"),
    );

    expect(api).toContain(
      "`${WORKSPACE_CHANNEL_LINK_ROUTE}/:recordType/:recordId`, UserMiddleware.getUserMiddleware, UserMiddleware.requireUserAuthentication,",
    );
    expect(baseApi).toContain(
      'import WorkspaceChannelLinkAPI from "Common/Server/API/WorkspaceChannelLinkAPI";',
    );
    expect(baseApi).toContain(
      "app.use(`/${APP_NAME.toLocaleLowerCase()}`, WorkspaceChannelLinkAPI);",
    );
  });
});
