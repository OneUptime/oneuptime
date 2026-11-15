import { readPage } from "./DocsContentSupport";
import { POSTMORTEM_ACTION_ITEMS_COPY } from "../../../FeatureSet/Dashboard/src/Components/Postmortem/ActionItems/PostmortemActionItemsCopy";
import { ACTION_ITEM_MONITOR_QUERY_PARAM } from "../../../FeatureSet/Dashboard/src/Components/Postmortem/ActionItems/PostmortemActionItemsModel";
import IncidentPostmortemActionItem from "Common/Models/DatabaseModels/IncidentPostmortemActionItem";
import PostmortemActionItemStatus from "Common/Types/Incident/PostmortemActionItemStatus";
import Permission from "Common/Types/Permission";
import PostmortemNoteActionItems from "Common/Utils/Incident/PostmortemNoteActionItems";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The English docs for a postmortem's action items (#6801) and for saving a
 * verified fix as a runbook, held to what the product does: each sentence a
 * reader acts on is checked against the Dashboard, the models or the server
 * that make it true. The translations are held to these pages by their own
 * suites (CriteriaGroupsPostmortemsDocsTranslations, AiDocsTranslations,
 * RunbookDocsTranslations).
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..", "..", "..");

function readSource(relative: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relative), "utf8");
}

const DASHBOARD: string = "App/FeatureSet/Dashboard/src/";

const ACTION_ITEMS_CARD: string = readSource(
  `${DASHBOARD}Components/Postmortem/ActionItems/PostmortemActionItems.tsx`,
);
const ACTION_ITEMS_TABLE: string = readSource(
  `${DASHBOARD}Components/Postmortem/ActionItems/PostmortemActionItemsTable.tsx`,
);
const POSTMORTEM_PAGE: string = readSource(
  `${DASHBOARD}Pages/Incidents/View/Postmortem.tsx`,
);
const INCIDENTS_MENU: string = readSource(
  `${DASHBOARD}Pages/Incidents/SideMenu.tsx`,
);
const MONITOR_CREATE: string = readSource(
  `${DASHBOARD}Pages/Monitor/Create.tsx`,
);
const REMEDIATION_STEP: string = readSource(
  `${DASHBOARD}Components/AutoRemediation/RemediationStep.tsx`,
);
const ACTION_ITEM_SERVICE: string = readSource(
  "Common/Server/Services/IncidentPostmortemActionItemService.ts",
);
const INCIDENT_PRIVACY_FILTER: string = readSource(
  "Common/Server/Utils/Incident/IncidentPrivacyFilter.ts",
);
const CODE_TASKS: string = readSource(
  "Common/Server/Utils/Incident/PostmortemActionItemCodeTasks.ts",
);
const PULL_REQUEST_SYNC: string = readSource(
  "App/FeatureSet/Workers/Jobs/AIAgent/SyncPullRequestStates.ts",
);
const VERIFIED_FIX_RUNBOOK: string = readSource(
  "Common/Utils/AiRemediation/VerifiedFixRunbook.ts",
);
const VERIFIED_FIX_SAVE: string = readSource(
  "Common/Server/Utils/AutoRemediation/VerifiedFixRunbookSave.ts",
);

function section(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(`\n${heading}\n`);

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const level: number = (heading.match(/^(#+) /)?.[1] || "#").length;
  const rest: string = markdown.slice(start + heading.length + 2);
  const end: number = rest.search(new RegExp(`\\n#{1,${level}} `));

  return end === -1 ? rest : rest.slice(0, end);
}

// One line: a paragraph or a list item's words, without the line breaks between them.
function flat(markdown: string): string {
  return markdown.replace(/\s+/g, " ");
}

const POSTMORTEMS: string = readPage("en", "incidents/postmortems");
const ACTION_ITEMS: string = section(POSTMORTEMS, "## Track action items");

describe("the postmortem page's action items", () => {
  it("are listed among the page's cards, and are a section of their own", () => {
    expect(POSTMORTEMS).toContain(
      "- [Track action items](#track-action-items): What the team will do, who owns each, and what it became.",
    );
  });

  it("are a card under the Postmortem card, called Action Items", () => {
    expect(POSTMORTEM_ACTION_ITEMS_COPY.title).toBe("Action Items");
    expect(POSTMORTEM_PAGE).toContain("<PostmortemActionItems");
    // Under the postmortem's own card: drawn after it.
    expect(POSTMORTEM_PAGE.indexOf("<PostmortemActionItems")).toBeGreaterThan(
      POSTMORTEM_PAGE.indexOf("<CardModelDetail<Incident>"),
    );
    expect(flat(ACTION_ITEMS)).toContain(
      "The **Action Items** card is under the **Postmortem** card on the incident's **Postmortem** page.",
    );
  });

  it("are added from the line under the list, given an owner and a due date from the ⋯ menu", () => {
    expect(POSTMORTEM_ACTION_ITEMS_COPY.addButton).toBe("Add Action Item");
    expect(POSTMORTEM_ACTION_ITEMS_COPY.assignToMe).toBe("Assign to Me");
    expect(POSTMORTEM_ACTION_ITEMS_COPY.assignToSomeoneElse).toBe(
      "Assign to Someone Else",
    );
    expect(POSTMORTEM_ACTION_ITEMS_COPY.editActionItem).toBe(
      "Edit Action Item",
    );
    expect(POSTMORTEM_ACTION_ITEMS_COPY.dueDateField).toBe("Due Date");
    // The Edit dialog holds the due date.
    expect(ACTION_ITEMS_CARD).toContain(
      "title: POSTMORTEM_ACTION_ITEMS_COPY.dueDateField,",
    );

    const text: string = flat(ACTION_ITEMS);

    expect(text).toContain(
      "To add one, type it into the line under the list and click **Add Action Item**.",
    );
    expect(text).toContain(
      "To give one an owner, pick **Assign to Me** or **Assign to Someone Else** in its **⋯** menu.",
    );
    expect(text).toContain(
      "To give one a due date, pick **Edit Action Item** in its **⋯** menu and set its **Due Date**. An open action item past its due date says it is overdue, in red.",
    );
  });

  it("close as Done with the box, or Won't Do from the menu, and reopen; who closed them is said", () => {
    expect(Object.values(PostmortemActionItemStatus)).toEqual([
      "Open",
      "Done",
      "WontDo",
    ]);
    expect(POSTMORTEM_ACTION_ITEMS_COPY.markWontDo).toBe("Mark as Won't Do");
    expect(POSTMORTEM_ACTION_ITEMS_COPY.reopen).toBe("Reopen");
    expect(ACTION_ITEM_SERVICE).toContain(
      "closedAt: OneUptimeDate.getCurrentDate(),",
    );
    expect(flat(ACTION_ITEMS)).toContain(
      "To close one, tick its box when it is done. **Mark as Won't Do** in its **⋯** menu closes it when the team decides not to do it, and **Reopen** opens it again. Each says who closed it and when.",
    );
    expect(flat(ACTION_ITEMS)).toContain(
      "The card says how many are done, leaving out the ones marked **Won't Do**.",
    );
  });

  it("track what the note lists, by its action items heading, done when ticked, due when dated", () => {
    for (const heading of [
      "Action Items",
      "Follow-ups",
      "Next Steps",
      "How We Prevent It",
    ]) {
      expect(PostmortemNoteActionItems.isActionItemHeading(heading)).toBe(true);
    }

    expect(
      PostmortemNoteActionItems.read(
        "## Action Items\n| Action | Owner | Due Date |\n|---|---|---|\n| Alert on pool usage | Ana | 2026-11-20 |\n\n## Follow-ups\n- [x] Increase the pool",
      ),
    ).toEqual([
      {
        title: "Alert on pool usage",
        isDone: false,
        ownerText: "Ana",
        dueDay: "2026-11-20",
      },
      { title: "Increase the pool", isDone: true },
    ]);

    const tracking: string = flat(
      section(POSTMORTEMS, "### Track the action items your note lists"),
    );

    expect(tracking).toContain(
      "a due date the note writes as a date, such as 2026-11-20, becomes its due date, in your time zone;",
    );
    expect(tracking).toContain(
      "an item already tracked, by its title, is left out, so tracking again adds nothing.",
    );
    expect(tracking).toContain(
      "The section's heading can be `Action Items`, `Follow-ups`, `Next Steps` or `How We Prevent It`, or the same words in another of the Dashboard's languages.",
    );
  });

  it("become a pull request, a test or a monitor, from the menu", () => {
    expect(POSTMORTEM_ACTION_ITEMS_COPY.openPullRequest).toBe(
      "Open Pull Request with AI",
    );
    expect(POSTMORTEM_ACTION_ITEMS_COPY.writeTest).toBe("Write a Test with AI");
    expect(POSTMORTEM_ACTION_ITEMS_COPY.createMonitor).toBe("Create Monitor");
    expect(POSTMORTEM_ACTION_ITEMS_COPY.connectRepository).toBe(
      "Connect a Repository",
    );

    // Create Monitor carries the item, and the item is done once it exists.
    expect(ACTION_ITEM_MONITOR_QUERY_PARAM).not.toBe("");
    expect(MONITOR_CREATE).toContain("ACTION_ITEM_MONITOR_QUERY_PARAM");
    expect(MONITOR_CREATE).toContain(
      "status: PostmortemActionItemStatus.Done,",
    );

    // A merged pull request closes the item, and the feed says so.
    expect(PULL_REQUEST_SYNC).toContain(
      "PostmortemActionItemCodeTasks.onPullRequestMerged(",
    );
    expect(CODE_TASKS).toContain("actionItemDoneByPullRequestMarkdown(");

    // Asking needs AI on, Code's own gate, and the item's edit permission.
    expect(CODE_TASKS).toContain("await AIService.assertProjectAIEnabled(");
    expect(CODE_TASKS).toContain("await CodeTaskGate.assertCanStart(");
    expect(CODE_TASKS).toContain("POSTMORTEM_ACTION_ITEM_UPDATE_PERMISSIONS");

    const becoming: string = flat(
      section(
        POSTMORTEMS,
        "### Turn an action item into a pull request, a test or a monitor",
      ),
    );

    expect(becoming).toContain(
      "| **Create Monitor** | **Create Monitor** opens named after the action item. Once the monitor is created, the action item names it and is done. |",
    );
    expect(becoming).toContain(
      "When the pull request merges, the action item is done by itself, and the incident's feed says so.",
    );
    expect(becoming).toContain(
      "With none connected, the menu offers **Connect a Repository** instead.",
    );
  });

  it("are all listed under Incidents → Action Items, soonest due first, by status, owner and due date", () => {
    expect(INCIDENTS_MENU).toContain('title: "Action Items",');
    expect(ACTION_ITEMS_TABLE).toContain('sortBy="dueDate"');
    expect(ACTION_ITEMS_TABLE).toContain("sortOrder={SortOrder.Ascending}");
    expect(POSTMORTEM_ACTION_ITEMS_COPY.statusColumn).toBe("Status");
    expect(POSTMORTEM_ACTION_ITEMS_COPY.ownerField).toBe("Owner");
    expect(ACTION_ITEMS_TABLE).toContain('viewButtonText="View"');

    expect(flat(section(POSTMORTEMS, "### See every action item"))).toContain(
      "**Incidents → Action Items** lists every postmortem's action items across the project, soonest due first, with each one's incident, owner, due date and status. Filter it by **Status**, **Owner** and **Due Date**, and **View** on a row opens the incident's **Postmortem** page.",
    );
  });

  it("are read like the incident, and changed by the roles that work on incidents", () => {
    const model: IncidentPostmortemActionItem =
      new IncidentPostmortemActionItem();

    expect(model.getCreatePermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateIncidentPostmortemActionItem,
    ]);
    expect(model.canAccessIfCanReadOn).toBe("incident");

    // A private incident's items are read through the incident's own privacy rule.
    expect(ACTION_ITEM_SERVICE).toContain(
      "findBy.query = applyIncidentRelatedRecordPrivacyFilter(",
    );
    expect(INCIDENT_PRIVACY_FILTER).toContain('FROM "IncidentOwnerUser" iou');
    expect(INCIDENT_PRIVACY_FILTER).toContain(
      'FROM "IncidentOwnerTeam" iot INNER JOIN "TeamMember" tm',
    );
    /*
     * Project owners and admins, and root and master-admin contexts, see
     * every private incident: the incident's rule is the shared private
     * record rule (086658b4624).
     */
    expect(INCIDENT_PRIVACY_FILTER).toContain(
      "return shouldBypassRecordPrivacy(props);",
    );
    expect(flat(readSource("Common/Server/Utils/PrivacyFilterUtil.ts"))).toContain(
      "export const PRIVATE_RECORD_BYPASS_PERMISSIONS: ReadonlyArray<Permission> = [ Permission.ProjectOwner, Permission.ProjectAdmin, ];",
    );

    expect(flat(section(POSTMORTEMS, "### See every action item"))).toContain(
      "Adding, changing and deleting them takes the Project Owner, Project Admin, Project Member, Incident Admin or Incident Member role, or a custom role with the matching Postmortem Action Item permission. A private incident's action items, like the incident, are visible only to its owner users, the members of its owner teams, Project Admins and Project Owners.",
    );
  });

  it("are records of their own in the API, with workflows", () => {
    expect(
      new IncidentPostmortemActionItem().getCrudApiPath()?.toString(),
    ).toBe("/incident-postmortem-action-item");
    expect(flat(section(POSTMORTEMS, "## Through the API"))).toContain(
      "A postmortem's action items are records of their own, at `/api/incident-postmortem-action-item`: each with its `incidentId`, `title`, `description`, `ownerUserId`, `dueDate` and `status` (`Open`, `Done` or `WontDo`). Workflows can start when one is created, changed or deleted.",
    );
  });
});

describe("saving a fix that worked as a runbook", () => {
  const AI_SRE: string = readPage("en", "ai/ai-sre");
  const SAVING: string = flat(
    section(AI_SRE, "### Save a fix that worked as a runbook"),
  );

  it("is offered on a verified fix, as Save as Runbook", () => {
    expect(REMEDIATION_STEP).toContain('title="Save as Runbook"');
    expect(VERIFIED_FIX_RUNBOOK).toContain(
      "input.verificationStatus !== AutoRemediationVerificationStatus.Verified",
    );
    expect(SAVING).toContain("its card offers **Save as Runbook**.");
  });

  it("writes a Bash step for a Runner's command, keeping its approval, and a manual step for an agent's change", () => {
    expect(VERIFIED_FIX_RUNBOOK).toContain("type: RunbookStepType.Bash,");
    expect(VERIFIED_FIX_RUNBOOK).toContain(
      "AiRemediationCommandPolicyVerdict.RequiresApproval",
    );
    expect(VERIFIED_FIX_RUNBOOK).toContain("type: RunbookStepType.Manual,");
    expect(SAVING).toContain(
      "a command on a Runner becomes a Bash step on that Runner, as written, with the same time limit; one that needed approval waits for an approval in the runbook too;",
    );
  });

  it("starts the runbook turned off, created as the person, and the fix then names it", () => {
    expect(VERIFIED_FIX_SAVE).toContain("runbook.isEnabled = false;");
    expect(VERIFIED_FIX_SAVE).toContain("props: data.props,");
    expect(VERIFIED_FIX_SAVE).toContain("savedAsRunbookId: created.id,");
    expect(SAVING).toContain(
      "The runbook is named for the incident or alert it fixed, and starts turned off: nobody can run it, and OneUptime AI never picks it, until someone reviews its steps and turns it on.",
    );
  });

  it("is linked from the runbooks overview", () => {
    expect(readPage("en", "runbooks/index")).toContain(
      "- **[OneUptime AI](/docs/ai/ai-sre#save-a-fix-that-worked-as-a-runbook)** writes a runbook from a fix of its own that worked: **Save as Runbook** on a verified fix saves the steps that ran, turned off until you review them.",
    );
  });
});
