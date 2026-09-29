import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "Remove Node" on the Proxmox node detail page.
 *
 * On the Proxmox VE native push every node reports only itself, and its
 * live siblings report a node that went quiet as down. A node taken out of
 * the Proxmox cluster for good looks exactly the same, so the page lets a
 * user remove a native-push node that has stopped reporting. An agent node
 * has no button: the Proxmox Agent lets a node go on its own once the
 * cluster no longer lists it. The server route is
 * POST /proxmox-resource/remove-node/:clusterId { nodeName } in
 * Common/Server/API/ProxmoxResourceAPI.ts.
 *
 * The App suite runs in plain Node with no renderer, so this pins the
 * wiring by reading the sources, like ProxmoxMetricTooltipsWiring.test.ts:
 * the button exists only for a node whose isUp is exactly false and whose
 * isNativePush is exactly true (and the inventory read selects that
 * column, which users may read), the page posts the node's Proxmox name
 * to the route the server mounts, a refusal stays in the dialog, and
 * success reloads the node list with a forced navigation. The overview
 * shows the last CPU / memory reading only while it is within
 * METRIC_STALE_MS, the node list's own cutoff. Comments are stripped and
 * whitespace squashed so Prettier reflows and rationale comments cannot
 * make a test pass or fail. The Common suite renders the page for real
 * (Tests/App/Dashboard/ProxmoxNodeRemove).
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMMON_ROOT: string = path.join(__dirname, "..", "..", "..", "Common");

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const WHITESPACE: RegExp = /\s+/g;

function readCode(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1")
    .replace(WHITESPACE, " ");
}

function between(source: string, from: string, to: string): string {
  const start: number = source.indexOf(from);

  if (start < 0) {
    throw new Error(`Expected the source to contain "${from}".`);
  }

  const end: number = source.indexOf(to, start + from.length);

  return end >= 0 ? source.slice(start, end) : source.slice(start);
}

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

const NODE_DETAIL: string = readCode(
  path.join(DASHBOARD_SRC, "Pages", "Proxmox", "View", "NodeDetail.tsx"),
);

const GUEST_DETAIL: string = readCode(
  path.join(DASHBOARD_SRC, "Pages", "Proxmox", "View", "GuestDetail.tsx"),
);

const STORAGE_DETAIL: string = readCode(
  path.join(DASHBOARD_SRC, "Pages", "Proxmox", "View", "StorageDetail.tsx"),
);

const SERVER_API: string = readCode(
  path.join(COMMON_ROOT, "Server", "API", "ProxmoxResourceAPI.ts"),
);

const RESOURCE_MODEL: string = readCode(
  path.join(COMMON_ROOT, "Models", "DatabaseModels", "ProxmoxResource.ts"),
);

const ROUTE_MAP: string = readCode(
  path.join(DASHBOARD_SRC, "Utils", "RouteMap.ts"),
);

const RESOURCE_UTILS: string = readCode(
  path.join(
    DASHBOARD_SRC,
    "Pages",
    "Proxmox",
    "Utils",
    "ProxmoxResourceUtils.ts",
  ),
);

describe("the page and the server agree on the route", () => {
  test("the server mounts POST <crud path>/remove-node/:clusterId behind the user middleware", () => {
    expect(SERVER_API).toContain(
      "this.router.post( `${new this.entityType() .getCrudApiPath() ?.toString()}/remove-node/:clusterId`, UserMiddleware.getUserMiddleware,",
    );
    expect(SERVER_API).toContain(
      "super(ProxmoxResource, ProxmoxResourceService);",
    );
    // ...and the inventory model's CRUD path is /proxmox-resource.
    expect(RESOURCE_MODEL).toContain(
      '@CrudApiEndpoint(new Route("/proxmox-resource"))',
    );
  });

  test("the page posts to /proxmox-resource/remove-node/<this cluster>", () => {
    const post: string = between(
      NODE_DETAIL,
      "await API.post<JSONObject>({",
      "});",
    );

    expect(post).toContain(
      'url: URL.fromString(APP_API_URL.toString()) .addRoute("/proxmox-resource/remove-node/") .addRoute(modelId.toString()),',
    );
    expect(post).toContain("headers: { ...ModelAPI.getCommonHeaders(), },");
    expect(count(NODE_DETAIL, "/proxmox-resource/remove-node/")).toBe(1);
  });

  test("the body is { nodeName } with the node's Proxmox name, which is what the server reads", () => {
    const post: string = between(
      NODE_DETAIL,
      "await API.post<JSONObject>({",
      "});",
    );

    expect(post).toContain("data: { nodeName: pveNodeName, },");
    expect(SERVER_API).toContain(
      'const rawNodeName: unknown = body["nodeName"];',
    );
  });

  test("the name comes from the node's id (node/<name>), not its display name", () => {
    expect(NODE_DETAIL).toContain(
      'const NODE_EXTERNAL_ID_PREFIX: string = "node/";',
    );
    expect(NODE_DETAIL).toContain(
      'const pveNodeName: string = externalId.startsWith(NODE_EXTERNAL_ID_PREFIX) ? externalId.substring(NODE_EXTERNAL_ID_PREFIX.length) : "";',
    );
    // The server rebuilds the same id from it.
    expect(SERVER_API).toContain(
      'const NODE_EXTERNAL_ID_PREFIX: string = "node/";',
    );
    expect(SERVER_API).toContain(
      "externalId: `${NODE_EXTERNAL_ID_PREFIX}${nodeName}`,",
    );
  });
});

describe("only a native-push node that has stopped reporting offers the button", () => {
  test("the condition is isUp === false and isNativePush === true exactly, on a loaded row naming a node", () => {
    expect(NODE_DETAIL).toContain(
      "const canRemoveNode: boolean = Boolean( row && row.isUp === false && row.isNativePush === true && pveNodeName, );",
    );
    expect(count(NODE_DETAIL, "const canRemoveNode")).toBe(1);
    // A missing or unknown status (null / undefined) must not count as down.
    expect(NODE_DETAIL).not.toMatch(/!\s*row\??\.isUp\s*&&/);
    expect(NODE_DETAIL).not.toMatch(/row\??\.isUp\s*!==\s*true/);
    /*
     * An agent node (false) and a row from before the column existed
     * (null) must not count as native push.
     */
    expect(NODE_DETAIL).not.toMatch(/row\??\.isNativePush\s*!==\s*false/);
    expect(NODE_DETAIL).not.toMatch(/row\??\.isNativePush\s*!=\s*false/);
    expect(NODE_DETAIL).not.toMatch(/row\??\.isNativePush\s*\?\?\s*true/);
  });

  test("the inventory read selects isNativePush, so the condition can ever hold", () => {
    const select: string = between(
      RESOURCE_UTILS,
      "const INVENTORY_SELECT: Record<string, boolean> = {",
      "};",
    );

    expect(select).toContain(" isUp: true,");
    expect(select).toContain(" isNativePush: true,");
    // The detail page reads its row through that select.
    expect(RESOURCE_UTILS).toContain(
      "export async function fetchProxmoxInventoryRow(",
    );
    expect(
      between(
        RESOURCE_UTILS,
        "export async function fetchProxmoxInventoryRow(",
        "return result.data[0] || null;",
      ),
    ).toContain("select: INVENTORY_SELECT,");
    expect(NODE_DETAIL).toContain("await fetchProxmoxInventoryRow({");
  });

  test("the model lets the users who read the inventory read isNativePush", () => {
    expect(RESOURCE_MODEL).toContain(
      '@ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [], }) @TableColumn({ required: false, type: TableColumnType.Boolean, canReadOnRelationQuery: true, title: "Is Native Push",',
    );
    expect(RESOURCE_MODEL).toContain(
      "public isNativePush?: boolean = undefined;",
    );
    // The same permissions as the table itself.
    expect(RESOURCE_MODEL).toMatch(
      /@TableAccessControl\(\{ create: \[\], read: READ_PERMISSIONS,/,
    );
  });

  test("the card with the button is rendered only under that condition, on the Overview tab", () => {
    const overview: string = between(
      NODE_DETAIL,
      'name: "Overview",',
      'name: "Metrics",',
    );

    const guarded: string = between(overview, "{canRemoveNode && (", ")}");
    expect(guarded).toContain('<Card title="Remove Node"');
    expect(guarded).toContain('title: "Remove Node",');
    expect(guarded).toContain("buttonStyle: ButtonStyleType.DANGER_OUTLINE,");
    expect(guarded).toContain("icon: IconProp.Trash,");
    expect(guarded).toContain("setShowRemoveModal(true);");

    // The only button that opens the dialog is the guarded one.
    expect(count(NODE_DETAIL, "setShowRemoveModal(true)")).toBe(1);
    expect(count(NODE_DETAIL, 'title: "Remove Node"')).toBe(1);
  });

  test("every label reads Remove Node, never Remove node", () => {
    expect(NODE_DETAIL).not.toContain("Remove node");
    // Card title, button, dialog title and dialog submit.
    expect(count(NODE_DETAIL, "Remove Node")).toBe(4);
  });

  test("the dialog itself is also guarded by the condition", () => {
    expect(NODE_DETAIL).toContain(
      "{showRemoveModal && canRemoveNode && ( <ConfirmModal",
    );
    expect(count(NODE_DETAIL, "<ConfirmModal")).toBe(1);
  });

  test("guests and storage have no Remove Node", () => {
    expect(GUEST_DETAIL).not.toContain("remove-node");
    expect(STORAGE_DETAIL).not.toContain("remove-node");
  });
});

describe("the confirm dialog", () => {
  const dialog: string = between(NODE_DETAIL, "<ConfirmModal", "/>");

  test("is a destructive confirmation with its own title and submit", () => {
    expect(NODE_DETAIL).toContain(
      'import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";',
    );
    expect(dialog).toContain('title="Remove Node"');
    expect(dialog).toContain('submitButtonText="Remove Node"');
    expect(dialog).toContain("submitButtonType={ButtonStyleType.DANGER}");
  });

  test("explains it is for a node removed from the cluster, that the alert resolves, and that the node can come back", () => {
    const description: string = between(dialog, "description={`", "`}");

    expect(description).toContain(
      "if it has been removed from the Proxmox cluster",
    );
    expect(description).toContain(
      "OneUptime cannot tell a node that was removed from one that is down",
    );
    expect(description).toContain("its Node Offline alert resolves");
    expect(description).toContain("reports again, it comes back");
  });

  test("shows progress and errors inline, and closing clears the error", () => {
    expect(dialog).toContain("isLoading={isRemoving}");
    expect(dialog).toContain("error={removeError}");
    expect(dialog).toContain(
      'onClose={() => { setShowRemoveModal(false); setRemoveError(""); }}',
    );
  });
});

describe("removing", () => {
  const remove: string = between(
    NODE_DETAIL,
    "const removeNode: PromiseVoidFunction = async (): Promise<void> => {",
    "if (isLoading) {",
  );

  test("an error response stays in the dialog and does not navigate", () => {
    const failure: string = between(
      remove,
      "if (response instanceof HTTPErrorResponse) {",
      "}",
    );

    expect(failure).toContain(
      "setRemoveError(API.getFriendlyMessage(response));",
    );
    expect(failure).toContain("setIsRemoving(false);");
    expect(failure).toContain("return;");
  });

  test("a thrown error (network) stays in the dialog and does not navigate", () => {
    const thrown: string = between(remove, "} catch (err) {", "}");

    expect(thrown).toContain("setRemoveError(API.getFriendlyMessage(err));");
    expect(thrown).toContain("return;");
  });

  test("success reloads this cluster's node list with a forced navigation", () => {
    const success: string = remove.slice(remove.lastIndexOf("} catch (err) {"));

    /*
     * forceNavigate: the cluster layout (and its sidebar node count)
     * stays mounted across in-app navigations and would keep counting
     * the removed node.
     */
    expect(success).toContain(
      "Navigation.navigate( RouteUtil.populateRouteParams( RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_NODES] as Route, { modelId: modelId }, ), { forceNavigate: true }, );",
    );
    expect(count(NODE_DETAIL, "Navigation.navigate(")).toBe(1);
    expect(count(NODE_DETAIL, "forceNavigate: true")).toBe(1);
  });

  test("the node list route is the cluster's Nodes page", () => {
    expect(ROUTE_MAP).toContain(
      "[PageMap.PROXMOX_CLUSTER_VIEW_NODES]: `${RouteParams.ModelID}/nodes`,",
    );
  });

  test("the page imports what the remove flow uses", () => {
    for (const line of [
      'import { ButtonStyleType } from "Common/UI/Components/Button/Button";',
      'import IconProp from "Common/Types/Icon/IconProp";',
      'import URL from "Common/Types/API/URL";',
      'import { APP_API_URL } from "Common/UI/Config";',
      'import HTTPResponse from "Common/Types/API/HTTPResponse";',
      'import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";',
      'import PageMap from "../../../Utils/PageMap";',
      'import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";',
    ]) {
      expect({ line, imported: NODE_DETAIL.includes(line) }).toEqual({
        line,
        imported: true,
      });
    }
  });
});

/*
 * A detail page keeps the last CPU and memory reading however old — the
 * node list shows N/A past METRIC_STALE_MS, the detail page does not, and
 * its tooltips say "the last value the agent sent" (pinned by
 * ProxmoxResourcePageTooltips). The Offline badge and Last Seen beside
 * them say how old that is. The remove flow must not change that.
 */
describe("the last CPU and memory reading stays on the page", () => {
  test("the page does not gate the reading on its age", () => {
    expect(NODE_DETAIL).not.toContain("METRIC_STALE_MS");
    expect(NODE_DETAIL).not.toContain("metricsAreFresh");
  });

  test("CPU and memory are each shown whenever the inventory has them", () => {
    const cpu: string = between(
      NODE_DETAIL,
      "if (row.latestCpuPercent !== null && row.latestCpuPercent !== undefined) {",
      "}",
    );
    expect(cpu).toContain('title: "CPU",');

    const memory: string = between(
      NODE_DETAIL,
      "if (row.latestMemoryBytes !== null && row.latestMemoryBytes !== undefined) {",
      "description:",
    );
    expect(memory).toContain('title: "Memory (Used / Total)",');

    expect(count(NODE_DETAIL, 'title: "CPU",')).toBe(1);
    expect(count(NODE_DETAIL, 'title: "Memory (Used / Total)",')).toBe(1);
  });
});
