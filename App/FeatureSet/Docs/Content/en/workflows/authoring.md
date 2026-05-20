# Authoring a Workflow

Create a workflow under **Workflows → Create Workflow**, give it a name and an optional description, then open the **Builder** tab to start dropping nodes onto the canvas.

## The canvas

The Builder is a zoomable, pannable graph. You add nodes from a component palette, connect them with edges, and configure each node's arguments in a side panel. A save indicator in the header tells you whether your latest edit has been persisted.

A workflow always starts with exactly one **trigger** node. Triggers have no input port — they're where execution begins. Everything downstream is a **component**.

## Anatomy of a node

Every node has:

| Field | Purpose |
| --- | --- |
| **Title** | The label shown on the canvas. Defaults to the component name; override it to make complex workflows easier to read. |
| **Arguments** | The configuration the component needs to do its job — a URL, a Slack channel, a JavaScript snippet, etc. Required arguments are marked with an asterisk. |
| **Input ports** | Sockets on the left of the node where incoming edges land. Components have one input port called `in`; triggers have none. |
| **Output ports** | Sockets on the right where outgoing edges start. Components define ports like `success`, `error`, `yes`, `no`. |
| **Return values** | Data the node produces — its output ports' payloads. Downstream nodes reference these as `{{NodeId.fieldName}}`. |

## Connecting nodes

Drag from an output port to a downstream node's input port to create an edge. An edge from `success` runs that branch only when the upstream node succeeded; an edge from `error` runs only when it failed. If you don't connect a port, that branch simply ends.

You can fan out: one output port can feed multiple downstream nodes, and they all run in parallel from that point.

## Configuring arguments

Click a node to open its side panel. Each argument has a typed editor:

- **Text / URL / Email / Number / Password** — a single-line input.
- **JSON** — a JSON editor with syntax highlighting and a validation indicator.
- **JavaScript** — a code editor for snippets used by the **Custom Code** component.
- **Markdown / HTML** — rich-text bodies for email and message components.
- **CronTab** — a schedule expression (used by the Schedule trigger).
- **Boolean** — a toggle.
- **Select / Query** — drop-downs for fields that take a fixed set of values or a model-style query.

Any text field accepts variable interpolation — see [Variables](/docs/workflows/variables) for the rules.

## A minimal first workflow

The fastest way to feel out the canvas:

1. Drop a **Manual** trigger.
2. Drop a **Log** component (under **Utils**). Connect the trigger's output port to the Log component's input port.
3. In the Log component's argument, type `Hello from {{Manual.JSON.name}}`.
4. Save and enable the workflow.
5. Click **Run Manually**, paste `{ "name": "Ada" }` as the input, and submit.
6. Open the **Logs** tab. The latest run shows the Log node's captured output: `Hello from Ada`.

That round-trip — drag, wire, configure, run, inspect — is the rhythm of authoring every workflow.

## Save, enable, and test in production

Workflows are stored as a JSON graph on the `Workflow.graph` column. The Builder saves as you edit; the save indicator in the header shows when the latest change has hit the server. There is no separate "publish" step.

But: a workflow only fires its trigger when **isEnabled** is on. New workflows ship disabled. Treat that flag as your "ready for prod" switch — build, click **Run Manually** to dry-run with a sample payload, look at the **Logs**, and only then flip Enable on.

If you need to pause a workflow without deleting it (e.g., during an unrelated incident), toggle **isEnabled** off in **Settings**. Existing in-flight runs continue; no new ones start.

## Reordering and reorganizing

- Drag a node to reposition it. The position is stored in the graph so the next person to open the canvas sees the same layout.
- Right-click an edge to delete it; right-click a node for delete and duplicate options.
- For wide workflows, lay them out left-to-right so the execution direction matches your reading direction.

## Where to read next

- [Triggers](/docs/workflows/triggers) — the four trigger families and what each exposes as return values.
- [Components](/docs/workflows/components) — the full catalog and their arguments.
- [Variables](/docs/workflows/variables) — how to reference data between nodes and from global variables.
- [Runs & Logs](/docs/workflows/runs-and-logs) — how to debug a misbehaving workflow.
