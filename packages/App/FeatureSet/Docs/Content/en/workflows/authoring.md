# Authoring a Workflow

To create a workflow, open **Workflows** and click **Create Workflow**. A wizard called **Create a workflow** walks you through it: first **Start from** — pick **Start from scratch** or one of the templates — then **Name**, and finally a **Configure** step, which only appears when the template you picked asks for settings of its own.

Once it's created, open **Builder** in the left menu. That's the canvas where you design the workflow.

## The canvas

A workflow from scratch opens with a single dashed block reading **Please click here to add trigger**. That block is the starting point — click it to pick a trigger. A workflow created from a template opens with its blocks already in place.

Every workflow has exactly one **trigger** at the top. Everything else is a **component** that does something. Adding a second trigger replaces the first, and deleting the last one puts the dashed placeholder back.

Adding blocks:

- **The trigger** — click the dashed placeholder block. A panel titled **Add Trigger** opens.
- **Everything else** — click **Add Component** in the toolbar above the canvas. The same panel opens, titled **Add Component**.

Both panels are searchable — press `/` to jump to the search box — and grouped by category. Select one block and click **Add to Workflow**.

New blocks always land in the same spot on the canvas, so a new one may drop on top of something you already placed. Drag it clear; the canvas snaps to a grid as you go. Block positions are saved, so the next person sees the same arrangement you left behind.

Changes save automatically. A pill in the toolbar tracks it: **Saving…** while the change is in flight, then **Saved**, or **Could not save** if it didn't work. There is no Save button and no separate publish step.

## What's on a block

| Field                         | What it does                                                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identifier** (under **ID**) | The short id shown on the block, like `log-1`. This is how other blocks refer to this one, so renaming it breaks every `{{local.components.…}}` reference pointing at it. The block's heading is the component's own name and can't be changed. |
| **Settings**                  | What the block needs to do its job — a URL, a Slack channel, a message body. Optional fields are labelled **(Optional)**; everything else is required. Less-used settings sit behind an **Advanced** disclosure. |
| **Input**                     | The dot on the top edge, where lines come in from earlier blocks. Triggers don't have one — nothing runs before them.                                                                                       |
| **Outputs**                   | The dots along the bottom edge, labelled just above them, where lines go out to the next blocks. Many blocks have separate **Success** and **Error** outputs so you can handle both cases.                  |

## Connecting blocks

Drag from a dot on the bottom of one block down to the dot on the top of the next. The line you draw decides what runs next.

- If you connect from **Success**, the next block only runs when the earlier one worked.
- If you connect from **Error**, the next block only runs when the earlier one failed.
- If you don't connect an output, that path just stops.

You can connect one output to several blocks. All of them run — but one after another, in a single queue, not in parallel. Don't rely on the order between branches, and don't count on them overlapping in time. Each block runs at most once per run, so a loop back to an earlier block won't run it twice.

## Configuring a block

Click a block to open its settings in a dialog. Each setting has the right kind of input — text fields, dropdowns, code editors, toggles, and so on. Fill it in and click **Save**.

The same dialog is where you find:

- **Delete** — remove this block.
- **Run just this step** — run this one block on its own, without the rest of the workflow. Values it would have read from other steps come through empty, and anything it sends, writes or deletes really happens.
- **Documentation**, **Inputs**, **Outputs** and **Returns** — reference cards for what this block expects and produces.

Most text fields accept variables — that's how data flows from one block to the next. Rather than typing the syntax by hand, use the value picker in the editor: it builds a correct reference from the block and field you choose. See [Variables](/docs/workflows/variables).

## Checks as you build

The Builder checks the whole graph every time you change it, and reports what it finds in a pill in the toolbar. Click the pill to open **Problems with this workflow**, which lists each issue and jumps you to the block responsible. Blocks with a problem also carry a red badge on the canvas.

It catches the mistakes that are otherwise invisible until a run goes wrong — no trigger, two blocks sharing an id, a dot inside an id, a block nothing connects to, a required setting left empty, malformed JSON, spaces inside `{{ }}`, and references to a step or return value that doesn't exist.

One thing it can't check: whether a variable name exists. A renamed variable only shows up in the run log.

## Your first workflow

The quickest way to feel out the canvas:

1. Click the dashed placeholder block, pick **Manual** in the **Add Trigger** panel, and click **Add to Workflow**.
2. Click **Add Component**, pick **Log** (under **Utils**), and click **Add to Workflow**. Drag the new block clear of the trigger, then connect the trigger's **Execute** dot down to the Log block's input dot.
3. Open the Log block and set its **Value** to `Hello from {{local.components.manual-1.returnValues.value.name}}`. `manual-1` is the trigger's **Identifier**, shown on the trigger block — check it matches.
4. Go to **Overview**, click **Edit Workflow** on the **Workflow Details** card, and switch **Enabled** on. A disabled workflow can't be run at all, not even by hand.
5. Back on the **Builder**, click **Run Workflow**, put `{ "name": "Ada" }` in the **JSON** field, click **Run Workflow Manually**, and confirm with **Run**.
6. A **Workflow Run** panel opens by itself and follows the run. The log shows `Value:` followed by `Hello from Ada`.

That cycle — add, connect, configure, run, read the log — is how you'll build every workflow.

## Turning it on

New workflows start disabled, and so does any workflow you duplicate or import.

The **Enabled** switch is on the workflow's **Overview** page, in the **Workflow Details** card — not on the Settings page. The same card shows the current state as a green **Enabled** or red **Disabled** pill.

A disabled workflow can't run at all. Manual runs are rejected with "This workflow is not enabled" exactly like triggered ones, so the order is: enable it, test it with **Run Workflow**, read the run log, and switch **Enabled** back off if you're not ready for its trigger to fire. To test a single block without running the whole thing, use **Run just this step** in that block's settings.

To pause a workflow without deleting it, switch **Enabled** off. No new runs start. A run that is mid-execution finishes, but one parked on a **Sleep** block is cancelled when it wakes and recorded as an error.

## Tidying up

- Drag blocks to move them. The layout is saved.
- To delete a line, drag either of its ends off the dot and drop it on empty canvas.
- To delete a block, click it and use **Delete** at the bottom of its settings dialog. Selecting a block or a line and pressing Backspace also removes it.
- There's no way to duplicate a single block. **Duplicate Workflow** on the workflow's **Settings** page copies the whole thing, and the copy lands disabled.
- Stack blocks top to bottom so they read in the direction they run — inputs are on the top edge, outputs on the bottom, so the flow naturally goes downward.

## Where to read next

- [Triggers](/docs/workflows/triggers) — the four ways a workflow can start.
- [Components](/docs/workflows/components) — every block you can add.
- [Variables](/docs/workflows/variables) — moving data between blocks.
- [Runs & Logs](/docs/workflows/runs-and-logs) — checking what happened.
