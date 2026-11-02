import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ALERT_EPISODE_MEMBERS_ADD_PATH,
  INCIDENT_EPISODE_MEMBERS_ADD_PATH,
} from "Common/Types/Episode/EpisodeMembersAdd";

/*
 * Where adding several incidents or alerts to an episode is wired in. The
 * App suite runs in Node with no renderer, so this reads the sources, as
 * ProjectScopedApiTenantHeader.test.ts does; the dialogs and the bulk
 * actions themselves are rendered in Common/Tests/App/Dashboard
 * (EpisodeMemberDialogs, BulkAddToEpisodeActions).
 *
 *   - An episode's Alerts / Incidents page adds through the shared
 *     several-at-once dialog, behind a card button gated on adding to an
 *     episode and on reading what is added - never the table's one-at-a-
 *     time create form - and takes one out with Remove, which says the
 *     record itself is not deleted.
 *   - The alerts and incidents lists offer Add to Existing Episode and Add
 *     to New Episode among their bulk actions, before Delete, and draw their
 *     dialogs.
 *   - The add request goes to the route the server serves.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type ReadFunction = (...parts: Array<string>) => string;

// A source with its comments taken out and its whitespace run together.
const read: ReadFunction = (...parts: Array<string>): string => {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
};

interface EpisodePage {
  name: string;
  file: Array<string>;
  memberModel: string;
  recordModel: string;
  kind: string;
  buttonTitle: string;
  removeTitle: string;
}

const EPISODE_PAGES: Array<EpisodePage> = [
  {
    name: "an alert episode's Alerts",
    file: ["Pages", "Alerts", "EpisodeView", "Alerts.tsx"],
    memberModel: "AlertEpisodeMember",
    recordModel: "Alert",
    kind: "ALERT_EPISODE_MEMBER_KIND",
    buttonTitle: "Add Alerts",
    removeTitle: "Remove Alert",
  },
  {
    name: "an incident episode's Incidents",
    file: ["Pages", "Incidents", "EpisodeView", "Incidents.tsx"],
    memberModel: "IncidentEpisodeMember",
    recordModel: "Incident",
    kind: "INCIDENT_EPISODE_MEMBER_KIND",
    buttonTitle: "Add Incidents",
    removeTitle: "Remove Incident",
  },
];

describe.each(EPISODE_PAGES)("$name page", (page: EpisodePage) => {
  const code: string = read(...page.file);

  test("adds through the several-at-once dialog, not the table's create form", () => {
    expect(code).toContain("isCreateable={false}");
    expect(code).not.toContain("isCreateable={true}");
    expect(code).not.toContain("formFields=");
    expect(code).toContain(
      `<AddEpisodeMembersModal config={${page.kind}} episodeId={modelId}`,
    );
  });

  test(`its ${page.buttonTitle} button is gated on adding to an episode and on reading what is added`, () => {
    expect(code).toContain(`title: "${page.buttonTitle}"`);
    /*
     * A member row is a part of the episode: on a private one, asked with
     * what the reader holds on it - a team of theirs that owns the episode
     * must be allowed to add to it (PrivateRecordScope).
     */
    expect(code).toContain(
      `new ${page.memberModel}(), ModelAction.Create, privateRecordGate(new ${page.memberModel}()), ), PermissionGate.check(new ${page.recordModel}(), ModelAction.Read), );`,
    );
    expect(code).toContain(
      "const privateRecordGate: ( model: BaseModel, ) => PermissionGateOptions | undefined = usePrivateRecordGate();",
    );
    expect(code).toContain("lockUnlessAllowed( PermissionGate.gateCardButton(");
  });

  test("an add refreshes the list", () => {
    expect(code).toContain("refreshToggle={refreshToggle.toString()}");
    expect(code).toMatch(/onAdded=\{\(\) => \{ setRefreshToggle\(/);
  });

  test("takes one out with Remove, saying the record itself is not deleted", () => {
    expect(code).toContain('deleteButtonText="Remove"');
    expect(code).toContain(`title: "${page.removeTitle}"`);
    expect(code).toContain('deleteVerb: "Remove"');
    expect(code).toMatch(/is not deleted, and it stays in any other episode/);
    expect(code).toMatch(/are not deleted, and they stay in any other episode/);
  });
});

interface ListTable {
  name: string;
  file: Array<string>;
  model: string;
  kind: string;
}

const LIST_TABLES: Array<ListTable> = [
  {
    name: "alerts",
    file: ["Components", "Alert", "AlertsTable.tsx"],
    model: "Alert",
    kind: "ALERT_EPISODE_MEMBER_KIND",
  },
  {
    name: "incidents",
    file: ["Components", "Incident", "IncidentsTable.tsx"],
    model: "Incident",
    kind: "INCIDENT_EPISODE_MEMBER_KIND",
  },
];

describe.each(LIST_TABLES)("the $name list", (table: ListTable) => {
  const code: string = read(...table.file);

  test("offers both episode actions, for its own kind", () => {
    expect(code).toContain(
      `useBulkAddToEpisodeActions<${table.model}>(${table.kind})`,
    );
  });

  test("lists them among its bulk actions, before Delete", () => {
    expect(code).toMatch(
      /\.\.\.episodeBulkActions, ModalTableBulkDefaultActions\.Delete, \]/,
    );
  });

  test("draws their dialogs", () => {
    expect(code).toContain("{episodeBulkActionModals}");
  });
});

describe("the add request", () => {
  const code: string = read(
    "Components",
    "EpisodeMembers",
    "EpisodeMembersApi.ts",
  );

  test("goes to the routes the server serves", () => {
    expect(code).toContain(`"${ALERT_EPISODE_MEMBERS_ADD_PATH}"`);
    expect(code).toContain(`"${INCIDENT_EPISODE_MEMBERS_ADD_PATH}"`);
    expect(code).toContain(
      `EpisodeMemberKind.Alert ? "${ALERT_EPISODE_MEMBERS_ADD_PATH}" : "${INCIDENT_EPISODE_MEMBERS_ADD_PATH}"`,
    );
  });
});
