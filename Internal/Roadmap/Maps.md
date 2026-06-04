# Plan: Maps — Interactive Service & Network Topology Maps for OneUptime

## Context

Customers coming from SolarWinds, Datadog, and Dynatrace repeatedly ask: *"How do I build a map like the SolarWinds map in OneUptime?"* Today the honest answer is "you can't." This plan changes that.

SolarWinds ships three map experiences that set the customer's expectation:
- **Network Atlas** — hand-drawn maps with custom backgrounds (floor plans, rack diagrams, world maps), device icons, connectors, and nested sub-maps.
- **Orion Maps** — auto-generated topology derived from discovered dependencies, with real-time status and link-utilization coloring.
- **Worldwide Map / NetPath** — geographic placement and hop-by-hop path visualization.

What OneUptime has **today** (verified against the codebase):
- **Trace Service Map** (`App/FeatureSet/Dashboard/src/Components/Traces/TraceServiceMap.tsx`) — a per-trace, auto-generated directed graph using a hand-rolled Kahn's topological sort and SVG curved edges. It is read-only, non-interactive, trace-scoped, and not persistable.
- **Dashboards** (`App/FeatureSet/Dashboard/src/Components/Dashboard/`) — a 12-column grid of *independent* tiles. No edges/connectors between tiles. Config persists as a single JSON column (`Dashboard.dashboardViewConfig`).
- **Status Page Groups** (`Common/Models/DatabaseModels/StatusPageGroup.ts`) — list/grid grouping of resources. Not a topology.
- **SNMP monitoring** (`MonitorType.SNMP`) — collects data from switches/routers/firewalls but has no visualization.
- **Global probes** — exist, but `Probe` has no latitude/longitude, so there is no geographic view.
- **`reactflow@^11.11.2`** — already a dependency in `App/FeatureSet/Dashboard/package.json`, already used for the interactive node/edge canvas in the Workflow Builder (`Common/UI/Components/Workflow/Workflow.tsx`, `App/FeatureSet/Dashboard/src/Pages/Workflow/View/Builder.tsx`).

The key insight: **we already own a production-grade interactive graph canvas (reactflow) and a real-time model-event bus.** Maps is mostly a composition of capabilities we already have — not a from-scratch build.

This plan proposes **Maps**: a first-class OneUptime product for interactive, persistent, live-status topology maps that can be both **hand-drawn** and **auto-generated**, and embedded into **dashboards** and **public/private status pages**. The goal is parity with SolarWinds/Datadog/Dynatrace and then beyond — leveraging OneUptime's unique all-in-one position (monitors + incidents + on-call + status pages + telemetry in one place).

## Design Principles (What "Polished" Means Here)

We are **not** shipping a thin MVP. A map that only places monitor dots and draws lines is a toy. The bar for a polished product:

1. **One canvas, many node kinds.** A real map mixes live monitors, grouping containers, free shapes, device icons, annotations, background images, and links to other maps. (See "Recommended Node Model" below.)
2. **Live by default.** Every status-bearing node reflects real-time state without a refresh, via our Socket.IO model-event bus. Groups roll up to worst-of-children. Active incidents/alerts badge their nodes.
3. **Hand-drawn AND auto-generated, reconcilable.** Users can auto-seed a map from traces / Kubernetes / labels, then hand-edit it, and re-sync without losing their manual annotations. This is the feature SolarWinds users actually live in.
4. **Distribution is a first-class feature, not an afterthought.** Maps must embed as a dashboard widget, render on public status pages, and run on a NOC wall (TV/kiosk, auto-rotating). A map nobody can put on a screen is half a product.
5. **It composes with the rest of OneUptime.** Click a node → its monitor page, recent incidents, on-call, metrics. Drill into a sub-map. Maps are connective tissue, not an island.

## Recommended Node / Entity Model

This is the core product decision. Recommended set for the polished product (curated, not a kitchen sink):

| Node kind | Purpose | Live status? |
|-----------|---------|--------------|
| **Monitor node** | Bound to any monitor (website, API, ping, port, SNMP device, server/host, Kubernetes, incoming-request, etc.). Shows status dot, name, type icon, and one configurable metric (e.g. response time, CPU). | Yes (real-time) |
| **Group / container** | Visual boundary (Data Center, Region, AWS account, rack, namespace). Collapsible. Rolls up child status (worst-of). | Yes (derived) |
| **Sub-map link** | A node that represents and drills into another map (nested maps, à la Network Atlas). | Yes (rolled up) |
| **External dependency** | A 3rd party not monitored as a OneUptime monitor (e.g. "Stripe", "Okta"). Status entered manually or pulled from a status-page/3rd-party-status integration. | Yes (external) |
| **Status page node** | Surfaces the overall state of one of your status pages. | Yes |
| **Metric / chart embed** | A sparkline/value tile reusing Dashboard widget rendering — bridges Maps ↔ Dashboards. | Live data |
| **Text / annotation** | Markdown labels and notes. | No |
| **Shape** | Rectangle/ellipse/zone for visual structure. | No |
| **Icon / image** | Device clip-art (router, switch, firewall, server, cloud, DB) + custom uploaded images. | No |

**Edges / links** are first-class, not just lines:
- **Plain connector** — visual only.
- **Status-aware link** — bound to a connectivity monitor (e.g. a synthetic that tests A→B) or derived from its endpoints; colors green/degraded/down.
- **Utilization link** — for SNMP interface monitors, width/color encode bandwidth utilization (SolarWinds' signature link coloring).
- Styles: straight / smoothstep / bezier, arrowheads, animated flow direction, labels (latency, bandwidth).

**Background**: per-map background image (floor plan, world map, rack diagram) with opacity/lock — the Network Atlas signature.

**My recommendation:** build the full set above, but sequence it (Phase 1 ships Monitor + Group + Text + Shape + status-aware links + background image, which already beats "list of dots"; later phases add sub-maps, external deps, metric embeds, utilization links). Every phase is independently polished and shippable — none is a throwaway.

## Gap Analysis Summary

| Capability | OneUptime (today) | SolarWinds | Datadog | Dynatrace | Grafana | Priority |
|---|---|---|---|---|---|---|
| Interactive map canvas (pan/zoom/drag) | None (reactflow only in Workflow) | Network Atlas | Service/Host/Network Map | Smartscape | Canvas / Node Graph | **P0** |
| Persistent, named, multi-map | None | Yes | Yes | Yes | Yes (panels) | **P0** |
| Monitor nodes with live status | None | Yes | Yes | Yes | Partial | **P0** |
| Status-aware links | None | Yes (+ utilization) | Yes (NPM) | Yes | Limited | **P0** |
| Grouping / containers w/ rollup | Status page groups (list only) | Yes | Yes (host map groups) | Yes (layers) | Rows only | **P0** |
| Background images | None | Yes | No | No | Canvas bg | **P1** |
| Auto-generate from observed deps | Trace map (read-only, per-trace) | Orion Maps | Service Map (APM) | Smartscape | Service Graph | **P0** |
| Auto-generate from Kubernetes | None | Limited | Yes | Yes | Limited | **P1** |
| Auto + manual reconcile / re-sync | None | Partial | Partial | Auto-only | No | **P1** |
| Auto-layout (dagre/elk) | Hand-rolled (trace map) | Yes | Yes | Yes | Yes | **P1** |
| Embed map in dashboards | None | No | Yes (widgets) | Yes | Yes | **P1** |
| Maps on public status pages | None | No | No | No | No | **P0 (differentiator)** |
| NOC / TV / kiosk wall mode | Dashboard full-screen only | Yes | Yes | Yes | Kiosk | **P1** |
| Geographic / world map | None (probes have no lat/long) | Worldwide Map / NetPath | Yes | Yes | Geomap | **P2** |
| Export PNG/SVG/PDF + JSON import/export | None | Yes | Partial | No | Partial | **P2** |
| Versioning / history | None | No | No | No | No | **P2** |
| Templates / starter maps | None | Yes | No | N/A (auto) | Yes | **P2** |
| Terraform / API / SDK / AI generation | None | No | Partial | No | Foundation SDK | **P2** |

OneUptime's unique winning angle (no competitor does this well): **live topology maps on a public status page**, and **maps stitched into incidents/on-call/status pages** in one platform.

---

## Architecture

### Data model

Follow the proven Dashboard precedent: the entire map definition is one JSON column, plus a few typed columns for filtering/automation/multi-tenancy.

**New model:** `Common/Models/DatabaseModels/TopologyMap.ts` (named `TopologyMap` to avoid colliding with JS `Map`; nav label is "Maps").

```typescript
@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.CreateProjectTopologyMap],
  read:   [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember, Permission.Viewer, Permission.ReadProjectTopologyMap],
  update: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.EditProjectTopologyMap],
  delete: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.DeleteProjectTopologyMap],
})
@CrudApiEndpoint(new Route("/topology-map"))
@SlugifyColumn("name", "slug")
@TableMetadata({ tableName: "TopologyMap", singularName: "Map", pluralName: "Maps", icon: IconProp.Map })
@Entity({ name: "TopologyMap" })
export default class TopologyMap extends BaseModel {
  // standard: projectId, name, description, slug, labels, createdByUser ...

  // mapType drives how the canvas behaves and how/whether it auto-syncs.
  @Column({ type: ColumnType.ShortText, nullable: false })
  public mapType?: TopologyMapType = undefined; // Manual | AutoTraces | AutoKubernetes | AutoLabels | Geographic

  // The whole canvas (nodes, edges, viewport, background) as one JSON blob.
  @Column({ type: ColumnType.JSON, nullable: true,
            transformer: TopologyMapConfig.getDatabaseTransformer() })
  public mapConfig?: TopologyMapConfig = undefined;

  // Automation
  @Column({ type: ColumnType.Boolean, nullable: false, default: false })
  public autoSyncEnabled?: boolean = undefined;

  @Column({ type: ColumnType.JSON, nullable: true })
  public autoSyncConfig?: JSONObject = undefined; // e.g. { labelIds, namespace, lookbackHours }
}
```

**Config types:** `Common/Types/TopologyMap/`

```typescript
export interface TopologyMapConfig {
  _type: ObjectType.TopologyMapConfig;
  nodes: TopologyMapNode[];
  edges: TopologyMapEdge[];
  viewport?: { x: number; y: number; zoom: number };
  background?: { imageFileId?: ObjectID; opacity?: number; locked?: boolean };
}

export interface TopologyMapNode {
  id: string;                  // stable client id
  type: TopologyMapNodeType;   // Monitor | Group | SubMap | External | StatusPage | Metric | Text | Shape | Icon
  position: { x: number; y: number };
  size?: { width: number; height: number };
  parentNodeId?: string;       // for nesting inside a Group
  // bindings (only the relevant one is set per type)
  monitorId?: ObjectID;
  subMapId?: ObjectID;
  statusPageId?: ObjectID;
  // presentation
  label?: string;
  icon?: string;
  style?: JSONObject;          // colors, shape, font, etc.
  // provenance — critical for auto+manual reconcile
  origin?: "manual" | "auto";
  externalKey?: string;        // stable key from the auto source (serviceId, k8s uid…)
  isPinned?: boolean;          // manual edits survive re-sync
}

export interface TopologyMapEdge {
  id: string;
  source: string;              // node id
  target: string;              // node id
  type?: "plain" | "status" | "utilization";
  monitorId?: ObjectID;        // for status/utilization links
  label?: string;
  style?: JSONObject;
  origin?: "manual" | "auto";
  externalKey?: string;
}
```

**Why JSON blob, not normalized node/edge tables:** atomic save (one API call), matches `Dashboard.dashboardViewConfig` exactly, and the editor owns the canvas as a unit. Trade-off: no DB-level referential integrity to monitors — handled at load time by resolving `monitorId`s and rendering missing ones as a "deleted" state. If per-node querying or cascade-delete is ever needed, nodes/edges can be promoted to tables without changing the UX. (For the polished product this trade-off is the right call; Dashboards prove it scales.)

### Rendering

- **reactflow** (already a dependency) for the interactive canvas: pan/zoom, drag, connect, `MiniMap`, `Controls`, `Background`, multi-select. Start from `Common/UI/Components/Workflow/Workflow.tsx`.
- **Custom node components** per node kind (`MonitorMapNode`, `GroupMapNode`, etc.), registered via reactflow's `nodeTypes` map.
- Reuse the trace map's edge-styling and Kahn's-sort layout ideas (`TraceServiceMap.tsx`) as the seed for auto-layout, but prefer **dagre/elk** for production auto-layout (new dependency).

### Live status

- On load, resolve all bound `monitorId`s in one `ModelAPI.getList(Monitor, { _id: in[...] }, select currentMonitorStatus)`.
- Subscribe with `Realtime.listenToModelEvent(Monitor, ModelEventType.Update, { tenantId })` (`Common/UI/Utils/Realtime.ts`); on each event, refetch the changed monitor's `currentMonitorStatus` and recolor its node. No page refresh.
- Group/sub-map nodes compute worst-of-children locally. Incident/alert badges come from listening on `Incident`/`Alert` model events for bound monitors.

### Auto-generation pipeline

A server-side resolver per `mapType` produces a `TopologyMapConfig` (nodes/edges with `origin: "auto"` and stable `externalKey`s). Re-sync merges the freshly generated graph with the stored one: auto nodes are replaced, **manual and pinned nodes/edges are preserved**, and positions of previously-placed auto nodes are kept (match by `externalKey`).

### Permissions & tenancy

New permissions in `Common/Types/Permission.ts` (`Create/Read/Edit/DeleteProjectTopologyMap` + a `TopologyMap` group). `@TenantColumn("projectId")` enforces multi-tenant isolation. Public status-page embedding uses the existing status-page public read path (no auth), scoped to explicitly published maps only.

### New dependencies

- `dagre` or `elkjs` — auto-layout (Phase 2).
- A geo map renderer — `maplibre-gl` (vector, self-hostable) or `react-simple-maps` (lightweight SVG) — for Phase 4.
- Add `latitude`/`longitude` to `Probe` (Phase 4) for the probe world map.

---

## Phase 1: Core Map Builder + Live Status (P0)

The foundation. End state of Phase 1 is already a coherent, polished product: named maps with monitor/group/text/shape nodes, status-aware links, a background image, live status, and a read-only viewer with drill-down.

### 1.1 Data model, service, API, permissions

**Target**: persistent maps with auto-generated CRUD REST API and RBAC.

**Implementation**: create the `TopologyMap` model + `TopologyMapConfig` types; create `TopologyMapService` (`extends DatabaseService<TopologyMap>`); add permissions; write the migration.

**Files to modify**:
- `Common/Models/DatabaseModels/TopologyMap.ts` (new)
- `Common/Models/DatabaseModels/Index.ts` (register in `AllModelTypes`)
- `Common/Types/TopologyMap/TopologyMapConfig.ts`, `TopologyMapNode.ts`, `TopologyMapEdge.ts`, `TopologyMapType.ts` (new)
- `Common/Server/Services/TopologyMapService.ts` (new)
- `Common/Types/Permission.ts` (new permissions + group)
- `Common/Server/Infrastructure/Postgres/SchemaMigrations/<ts>-AddTopologyMap.ts` (new) + register in that folder's `Index.ts`
- `App/FeatureSet/BaseAPI/Index.ts` (register API)

### 1.2 reactflow editor canvas

**Target**: pan/zoom/drag/connect canvas with minimap, controls, snap-to-grid, multi-select, undo/redo, and debounced autosave.

**Implementation**: build `MapEditor.tsx` from the Workflow reactflow pattern; serialize reactflow state ↔ `TopologyMapConfig`; save via `ModelAPI.updateById(TopologyMap, { mapConfig })`.

**Files to modify**:
- `App/FeatureSet/Dashboard/src/Components/Map/MapEditor.tsx` (new)
- `App/FeatureSet/Dashboard/src/Components/Map/MapCanvas.tsx` (new)
- reference: `Common/UI/Components/Workflow/Workflow.tsx`

### 1.3 Node kinds: Monitor, Group, Text, Shape (+ background image)

**Target**: the Phase-1 node set, each a custom reactflow node; per-map background image with opacity/lock.

**Implementation**: `nodeTypes` registry; a node palette/toolbar; a monitor picker; a settings side panel (reuse the Dashboard `ArgumentsForm` pattern for node config).

**Files to modify**:
- `App/FeatureSet/Dashboard/src/Components/Map/Nodes/MonitorMapNode.tsx`, `GroupMapNode.tsx`, `TextMapNode.tsx`, `ShapeMapNode.tsx` (new)
- `App/FeatureSet/Dashboard/src/Components/Map/MapToolbar.tsx`, `NodeSettingsPanel.tsx` (new)

### 1.4 Status-aware links

**Target**: edges that color by a bound connectivity monitor or by endpoint status; styles + arrowheads + labels.

**Files to modify**:
- `App/FeatureSet/Dashboard/src/Components/Map/Edges/StatusEdge.tsx` (new)

### 1.5 Live status via realtime

**Target**: nodes/edges/groups reflect status in real time; incident/alert badges.

**Files to modify**:
- `App/FeatureSet/Dashboard/src/Components/Map/Hooks/useMapLiveStatus.ts` (new) — wraps `Realtime.listenToModelEvent`
- reference: `Common/UI/Utils/Realtime.ts`

### 1.6 Read-only viewer + drill-down

**Target**: a non-editing viewer; click node → side panel (status, last check, metrics sparkline, recent incidents, link to monitor page); double-click sub-map → navigate.

**Files to modify**:
- `App/FeatureSet/Dashboard/src/Components/Map/MapViewer.tsx`, `NodeDetailPanel.tsx` (new)

### 1.7 Pages, routes, nav

**Target**: a "Maps" section with a list/CRUD page and a map detail/editor page.

**Files to modify**:
- `App/FeatureSet/Dashboard/src/Utils/PageMap.ts` (`MAPS_ROOT`, `MAPS`, `MAP_VIEW`)
- `App/FeatureSet/Dashboard/src/Utils/RouteMap.ts`
- `App/FeatureSet/Dashboard/src/Routes/MapRoutes.tsx` (new) + export from `Routes/AllRoutes.tsx`
- `App/FeatureSet/Dashboard/src/App.tsx` (lazy-mount)
- `App/FeatureSet/Dashboard/src/Components/NavBar/NavBar.tsx` (nav item under *observability*)
- `App/FeatureSet/Dashboard/src/Pages/Maps/Layout.tsx`, `Index.tsx` (list), `View/Index.tsx` (editor/viewer) (new)

---

## Phase 2: Auto-Generation (P0/P1)

The Orion/Smartscape parity that makes maps maintainable at scale.

### 2.1 Auto-seed from traces (P0)

**Current**: trace map is per-trace, read-only, ephemeral.
**Target**: "Generate map from service dependencies" — promote observed cross-service calls (over a lookback window) into a persistent, editable map.

**Implementation**: server resolver aggregates spans into a service graph (reuse the `TraceServiceMap.tsx` adjacency logic, moved server-side onto `SpanService`); emit `TopologyMapConfig` with `origin: "auto"` and `externalKey = serviceId`.

**Files to modify**:
- `Common/Server/Services/SpanService.ts` (service-graph aggregation)
- `Common/Server/Services/TopologyMapService.ts` (`generateFromTraces()`)
- `Common/Server/API/TopologyMapAPI.ts` (new — custom `generate` endpoint, extends `BaseAPI`)

### 2.2 Auto-generate from Kubernetes topology (P1)

**Target**: namespace → workload → pod hierarchy as a map, bound to existing k8s monitors.

**Files to modify**: `Common/Server/Services/TopologyMapService.ts` (`generateFromKubernetes()`), k8s resource services.

### 2.3 Auto-group from labels / monitor groups (P1)

**Target**: build a map (or group containers) from monitors selected by label or monitor group.

### 2.4 Hybrid sync: auto base + manual annotations (P1)

**Target**: re-sync an auto map without clobbering manual edits — match by `externalKey`, preserve `isPinned`/manual nodes and saved positions.

**Files to modify**: `Common/Server/Services/TopologyMapService.ts` (`reconcile()`); optional `Worker/Jobs/TopologyMap/AutoSync.ts` for scheduled re-sync.

### 2.5 Auto-layout (P1)

**Target**: one-click arrange (dagre/elk) + manual override.

**Files to modify**: add `dagre`/`elkjs`; `App/FeatureSet/Dashboard/src/Components/Map/Utils/AutoLayout.ts` (new).

---

## Phase 3: Distribution & NOC (P1)

A map you can't put on a screen is half a product.

### 3.1 Embed a map as a Dashboard widget

**Target**: new `DashboardComponentType.Map` that renders a (read-only, live) map inside the dashboard grid.

**Files to modify**:
- `Common/Types/Dashboard/DashboardComponentType.ts`
- `App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardMapComponent.tsx` (new) + register in `DashboardBaseComponent.tsx` and `AddWidgetModal.tsx`

### 3.2 Maps on Status Pages (P0 differentiator)

**Target**: publish a live topology map as a status-page element (public or private). No competitor does this well.

**Files to modify**:
- status-page resource/element models (`Common/Models/DatabaseModels/StatusPage*.ts`)
- status-page public read path + renderer in the StatusPage FeatureSet

### 3.3 NOC / TV / kiosk wall mode

**Target**: full-screen, chrome-free, auto-rotating playlist of maps for a wall display.

**Files to modify**: `App/FeatureSet/Dashboard/src/Pages/Maps/Kiosk.tsx` (new); reuse dashboard full-screen patterns.

### 3.4 Share & export

**Target**: shareable links, export PNG/SVG/PDF, import/export map JSON.

---

## Phase 4: Geographic Maps (P2)

SolarWinds Worldwide Map / NetPath parity.

### 4.1 Geo map mode
Place nodes by lat/long on a world/region basemap. New `mapType = Geographic`; add a geo renderer dependency.

### 4.2 Probe world map
Show where checks run from. **Requires adding `latitude`/`longitude` to `Probe`** (`Common/Models/DatabaseModels/Probe.ts` + migration).

### 4.3 NetPath-style path viz (stretch)
Hop-by-hop path/latency from probe → target (depends on probe-side traceroute support; larger effort).

---

## Phase 5: Polish & Power Features (P2)

- **Templates / starter maps** — "3-tier web app", "Kubernetes cluster", "multi-region".
- **Versioning / history** — snapshot `mapConfig` on save; diff & revert.
- **Link utilization coloring** — width/color from SNMP interface counters (SolarWinds signature).
- **Alerting overlays** — animate/badge nodes with active incidents; jump to incident/on-call.
- **Theming & icon library** — curated device icons (router/switch/firewall/server/cloud/DB) + custom uploads.
- **Terraform provider + API/SDK** — maps-as-code.
- **AI map generation** — "describe your architecture" → draft map; or infer from telemetry. (No competitor does this.)

---

## Effort Summary (rough, one engineer)

| Phase | Scope | Est. |
|---|---|---|
| 1 | Core builder, node set, status-aware links, live status, viewer, pages | ~2–3 weeks |
| 2 | Auto-seed from traces + k8s + labels, reconcile, auto-layout | ~2 weeks |
| 3 | Dashboard widget, status-page embed, NOC mode, export | ~1.5–2 weeks |
| 4 | Geographic maps + probe geo (+ Probe lat/long migration) | ~1.5 weeks |
| 5 | Templates, versioning, utilization links, AI, Terraform | ongoing |

**Phases 1–3 (~6 weeks)** deliver a polished, demoable product that answers the customer's question with a confident "yes" — including the status-page embedding that no competitor offers.

## Open Decisions

1. **Naming**: model `TopologyMap`, product/nav label "Maps". Alternative: "Service Maps" (aligns with existing trace Service Map) vs "Network Maps" (aligns with SolarWinds/SNMP framing). Recommend neutral **"Maps"**.
2. **Auto-sync cadence**: on-demand only vs scheduled background re-sync (Phase 2.4). Recommend on-demand first, scheduled as a toggle.
3. **Status-page maps billing/visibility**: which plan tier; public vs private only.
4. **Geo renderer**: `maplibre-gl` (richer, heavier) vs `react-simple-maps` (lighter, SVG). Recommend `react-simple-maps` unless we need real tiles.
