# Authoring a Workflow

To create a workflow, open **Workflows → Create Workflow**, give it a name, and click into the **Builder** tab. You'll see a blank canvas where you'll build the automation.

## The canvas

The Builder is a drag-and-drop canvas. You add blocks from the palette on the side, connect them together with lines, and click each block to configure what it does. Changes save automatically — you'll see an indicator at the top once they're saved.

Every workflow starts with one **trigger** at the beginning. Everything else is a **component** that does something.

## What's on a block

| Field | What it does |
| --- | --- |
| **Title** | The name shown on the canvas. Rename it to make complex workflows easier to read. |
| **Settings** | What the block needs to do its job — a URL, a Slack channel, a message body, etc. Required fields are marked with an asterisk. |
| **Input** | The dot on the left where lines come in from earlier blocks. |
| **Outputs** | The dots on the right where lines go out to the next blocks. Many blocks have separate **success** and **error** outputs so you can handle both cases. |

## Connecting blocks

Drag from a block's output dot to the next block's input dot. The line you draw decides what runs next.

- If you connect from **success**, the next block only runs when the earlier one worked.
- If you connect from **error**, the next block only runs when the earlier one failed.
- If you don't connect an output, that path just stops.

You can connect one output to multiple blocks. They all run at the same time from that point.

## Configuring a block

Click a block to open its settings on the side. Each setting has the right kind of input — text fields, dropdowns, code editors, toggles, and so on.

Most text fields accept variables — that's how data flows from one block to the next. See [Variables](/docs/workflows/variables) for the syntax.

## Your first workflow

The quickest way to feel out the canvas:

1. Drag a **Manual** trigger onto the canvas.
2. Drag a **Log** component (under **Utils**) next to it. Connect the trigger to the Log component.
3. In the Log block's message field, type `Hello from {{Manual.JSON.name}}`.
4. Save and turn the workflow on.
5. Click **Run Manually**, paste `{ "name": "Ada" }` as the input, and submit.
6. Open the **Logs** tab. The latest run shows `Hello from Ada`.

That cycle — drag, connect, configure, run, check the log — is how you'll build every workflow.

## Save and turn on

The canvas saves as you work. There's no separate "publish" step.

But a workflow only actually runs when **Enabled** is on in Settings. New workflows start disabled. Use that switch as your safety net — build it, test with **Run Manually**, check the logs, then turn it on.

To pause a workflow without deleting it, switch **Enabled** off. Runs already in progress finish; no new ones start.

## Tidying up

- Drag blocks to move them. The layout is saved so the next person sees the same arrangement.
- Right-click a line to delete it. Right-click a block to delete or duplicate it.
- For wide workflows, lay them out left to right so they read in the direction they run.

## Where to read next

- [Triggers](/docs/workflows/triggers) — the four ways a workflow can start.
- [Components](/docs/workflows/components) — every block you can add.
- [Variables](/docs/workflows/variables) — moving data between blocks.
- [Runs & Logs](/docs/workflows/runs-and-logs) — checking what happened.
