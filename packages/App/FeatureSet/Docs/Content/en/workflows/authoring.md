# Authoring a Workflow

To create a workflow, open **Workflows** and click **Create Workflow**. A wizard called **Create a workflow** walks you through it: first **Start from** — pick **Start from scratch** or one of the templates — then **Name**, and finally a **Configure** step, which only appears when the template you picked asks for settings of its own.

Once it's created, open **Builder** in the left menu. That's the canvas where you design the workflow.

## The canvas

A workflow from scratch opens with a single dashed block reading **Choose what starts this workflow**. That block is the starting point — click it to pick a trigger. A workflow created from a template opens with its blocks already in place.

Every workflow has exactly one **trigger** at the top. Everything else is a **component** that does something. Adding a second trigger replaces the first, and deleting the last one puts the dashed placeholder back.

Adding blocks:

- **The trigger** — click the dashed placeholder block. A panel titled **Add Trigger** opens.
- **Everything else** — click **Add Component** in the toolbar above the canvas. The same panel opens, titled **Add Component**.

Both panels open on the blocks most workflows use, under **Popular**, followed by the other built-in blocks. Under **OneUptime resources**, click a resource such as **Incident** to see what you can do with it; **Browse all resources** lists every one. Or search: type a few words, such as `create incident`, and the closest match comes first. Press `/` to jump to the search box, the arrow keys to move through the results, and **Enter** to add the highlighted block. Clicking a block adds it.

A new block lands below the lowest block on the canvas, and a new trigger takes the old one's place at the top. The new block is selected, and if it landed out of view, the canvas scrolls just far enough to show it. Its settings don't open by themselves: click the block when you're ready to set it up. Until its required settings are filled in, it says **Click to set up**. Drag blocks wherever you like; the canvas snaps to a grid as you go. Block positions are saved, so the next person sees the same arrangement you left behind.

Changes save automatically. A pill in the toolbar tracks it: **Saving…** while the change is in flight, then **Saved**, or **Could not save** if it didn't work. There is no Save button and no separate publish step.

## What's on a block

| Field                         | What it does                                                                                                                                                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identifier** (under **ID**) | The short id shown on the block, like `log-1`. This is how other blocks refer to this one, so renaming it breaks every `{{local.components.…}}` reference pointing at it. The block's heading is the component's own name and can't be changed. |
| **Settings**                  | What the block needs to do its job — a URL, a Slack channel, a message body. Optional fields are labelled **(Optional)**; everything else is required. An on/off switch carries neither, because it always holds a value. Less-used settings sit behind an **Advanced** disclosure. |
| **Input**                     | The dot on the top edge, where lines come in from earlier blocks. Triggers don't have one — nothing runs before them.                                                                                       |
| **Outputs**                   | The dots along the bottom edge, labelled just above them, where lines go out to the next blocks. Many blocks have separate **Success** and **Error** outputs so you can handle both cases.                  |

## Connecting blocks

Drag from a dot on the bottom of one block down to the dot on the top of the next. The line you draw decides what runs next.

- If you connect from **Success**, the next block only runs when the earlier one worked.
- If you connect from **Error**, the next block only runs when the earlier one failed.
- If you don't connect an output, that path just stops.

You can connect one output to several blocks. All of them run — but one after another, in a single queue, not in parallel. Don't rely on the order between branches, and don't count on them overlapping in time. Each block runs at most once per run, so a loop back to an earlier block won't run it twice.

## Configuring a block

Click a block to open its settings in a dialog, or move to it with **Tab** and press **Enter**. Each setting has the right kind of input. Anything you write in words — a message, a prompt, a value to log — gets a box that grows as you type, and **Enter** starts a new line. Short values such as a URL, an ID or a subject line stay on one line. Code and HTML get a code editor, JSON a JSON editor, and on/off settings a switch with its name beside it: click the switch or its name to turn it on or off. Fill it in and click **Save**.

The dialog opens on what you most likely came for. For a **Webhook** trigger that is its URL, with a **Copy URL** button, the methods it accepts and an example request. For a **Manual** trigger it is how the workflow gets started. Every other block opens on its settings. A block with no settings has no **Settings** section at all.

Below that, from top to bottom:

- **ID**, **Inputs** and **Outputs**, side by side — the block's identifier, where it is reached from, and what runs after it.
- **Returns** — the data this block hands to later steps. Each value shows the exact reference that reads it, with a button to copy it.
- **How to use** — what the block does in one sentence, the steps to set it up, an example to copy, and the mistakes people commonly make. The example is built from your workflow: it uses this block's ID, and the trigger's values where it puts data into a message. **Learn more** opens the longer explanation, and the links go to the full guide. Every block has one, and the **How to use** button at the top of the dialog jumps straight to it.

The footer holds:

- **Delete** — remove this block. It asks first, and names the block by its kind and identifier, such as **Send Email (send-email-2)**, so you know which of several alike blocks goes.
- **Run just this step** — run this one block on its own, without the rest of the workflow. Values it would have read from other steps come through empty, and anything it sends, writes or deletes really happens.

### Using values from earlier blocks

Most settings can use a value from an earlier block or a variable — that's how data flows from one block to the next. Every such setting has a **{ }** button at its end. It opens a list of the values you can use: each earlier block by its name, with every value it returns — what it's called, what it holds and its type — then your workflow's variables and your global ones. Search it, pick one with the mouse or the arrow keys and **Enter**, and the value goes where your cursor is.

In the setting, a value shows as a chip such as **Webhook › Request Body**. Hover it to see the reference it stands for, `{{local.components.webhook-1.returnValues.request-body}}`, which is what's saved. The cursor steps over a chip in one go, **Backspace** removes it whole, and copying it copies the reference. If you know the syntax, type `{{` instead: the same list opens under the setting, narrowed down as you type.

- **Only values that will exist are offered.** That's the trigger and the blocks that run before this one. A block that runs later has no output yet. Until a block is connected, only the trigger's values are listed, and the list says so.
- **A record opens to its fields.** A Find One or On Create block returns a whole record. Pick it to see its fields, starting with the ones the block's **Select Fields** reads. A JSON value or a set of headers opens to a box where you type a path, such as `title` or `alerts[0].status`.
- **Code editors have Insert value in their toolbar.** In JSON it adds the quotes a value needs inside a document. **Run Custom JavaScript** reads values through its **Arguments**, so its code has no picker.
- **Numbers, passwords, switches and dates keep their own control,** with **{ }** beside it. A picked value replaces the control, and **abc** goes back to typing one.

A chip turns amber when what it reads isn't there: a block that was renamed or deleted, a value the block doesn't return, a block that runs later, or a variable that doesn't exist. Its tooltip says which. See [Variables](/docs/workflows/variables) for the reference syntax.

## Checks as you build

The Builder checks the whole graph every time you change it, and reports what it finds in a pill in the toolbar. Click the pill to open **Problems with this workflow**, which lists each issue and jumps you to the block responsible. On the canvas, a block whose required settings are still empty says **Click to set up**, and a block with any other problem carries a badge in its corner: red for an error, amber for a warning. Hover the badge to read what's wrong.

It catches the mistakes that are otherwise invisible until a run goes wrong — no trigger, two blocks sharing an id, a dot inside an id, a block nothing connects to, a required setting left empty, malformed JSON, spaces inside `{{ }}`, and references to a step or return value that doesn't exist.

One thing it can't check: whether a variable name exists. A block's settings can — a reference to a variable that doesn't exist shows there as an amber chip. Anywhere else, a renamed variable only shows up in the run log.

## Your first workflow

The quickest way to feel out the canvas:

1. Click the dashed placeholder block, then click **Manual** in the **Add Trigger** panel.
2. Click **Add Component**, then click **Log** under **Popular**. The new block lands below the trigger. Connect the trigger's **Execute** dot down to the Log block's input dot.
3. Click the Log block, which says **Click to set up**, and type `Hello from ` in its **Value**. Click **{ }**, click the arrow beside **JSON** under **Manual**, type `name` and click **Insert**. The setting shows **Manual › JSON › name**, and saves `{{local.components.manual-1.returnValues.value.name}}`. `manual-1` is the trigger's **Identifier**, shown on the trigger block.
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
- [Runs](/docs/workflows/runs-and-logs) — checking what happened.
