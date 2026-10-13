import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import WorkspaceOnCallNow from "../../../../Server/Utils/Workspace/WorkspaceOnCallNow";
import { WorkspaceAnswer } from "../../../../Server/Utils/Workspace/WorkspaceActionAnswers";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import ProductBrandingText from "../../../../Server/Utils/ProductBrandingText";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceMessageTime from "../../../../Server/Utils/Workspace/WorkspaceMessageTime";
import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import User from "../../../../Models/DatabaseModels/User";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../../Types/JSON";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";

/*
 * `/oneuptime oncall` in Slack, "oncall" to the Microsoft Teams bot: who is
 * on call right now in each on-call schedule the asker may read - from the
 * roster OneUptime keeps (the schedules list's On Call Now), read once with
 * the asker's own permissions. These pin every line it can say, the read it
 * makes, and the refusals.
 */

const DASHBOARD: string = "https://oneuptime.test/dashboard";
const PROJECT_ID: ObjectID = new ObjectID(
  "e0000000-0000-4000-8000-000000000001",
);
const ASKER: ObjectID = new ObjectID("e0000000-0000-4000-8000-0000000000a1");
const SIMON: ObjectID = new ObjectID("e0000000-0000-4000-8000-0000000000b1");
const ANA: ObjectID = new ObjectID("e0000000-0000-4000-8000-0000000000b2");

const HANDOFF: Date = new Date("2026-10-17T09:00:00.000Z");
const NEXT_START: Date = new Date("2026-10-20T09:00:00.000Z");

const PROPS: DatabaseCommonInteractionProps = {
  userId: ASKER,
  tenantId: PROJECT_ID,
};

function person(id: ObjectID, name: string | null, email?: string): User {
  const user: User = new User();
  user.id = id;

  if (name !== null) {
    user.name = new Name(name);
  }

  if (email) {
    user.email = email as never;
  }

  return user;
}

let scheduleNumber: number = 0;

function schedule(data: {
  name: string;
  current?: User | undefined;
  next?: User | undefined;
  handoffAt?: Date | undefined;
  nextStartAt?: Date | undefined;
}): OnCallDutyPolicySchedule {
  scheduleNumber++;
  const row: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  row.id = new ObjectID(
    `e0000000-0000-4000-8000-${String(scheduleNumber).padStart(12, "0")}`,
  );
  row.name = data.name;

  if (data.current) {
    row.currentUserOnRoster = data.current;
  }

  if (data.next) {
    row.nextUserOnRoster = data.next;
  }

  if (data.handoffAt) {
    row.rosterHandoffAt = data.handoffAt;
  }

  if (data.nextStartAt) {
    row.rosterNextStartAt = data.nextStartAt;
  }

  return row;
}

function linkOf(row: OnCallDutyPolicySchedule): string {
  return `${DASHBOARD}/${PROJECT_ID.toString()}/on-call-duty/schedules/${row.id!.toString()}`;
}

const SCHEDULES_LINK: string = `${DASHBOARD}/${PROJECT_ID.toString()}/on-call-duty/schedules`;

function until(date: Date): string {
  return WorkspaceMessageTime.dateAndTime(date).toString();
}

let findBy: SpyInstance<typeof OnCallDutyPolicyScheduleService.findBy>;

function returnSchedules(rows: Array<OnCallDutyPolicySchedule>): void {
  findBy.mockResolvedValue(rows);
}

async function answer(): Promise<WorkspaceAnswer> {
  return await WorkspaceOnCallNow.getOnCallNowAnswer({
    projectId: PROJECT_ID,
    props: PROPS,
  });
}

beforeEach(() => {
  scheduleNumber = 0;
  findBy = jest.spyOn(OnCallDutyPolicyScheduleService, "findBy");
  findBy.mockResolvedValue([]);
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString(DASHBOARD));
  jest
    .spyOn(ProductBrandingText, "getProductName")
    .mockReturnValue("OneUptime");
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("WorkspaceOnCallNow: who is on call, schedule by schedule", () => {
  test("the asker's schedules, read once with their own permissions, in name order, one more than it lists", async () => {
    await answer();

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(findBy.mock.calls[0]![0]).toEqual({
      query: { projectId: PROJECT_ID },
      select: {
        _id: true,
        name: true,
        currentUserOnRoster: { _id: true, name: true, email: true },
        nextUserOnRoster: { _id: true, name: true, email: true },
        rosterHandoffAt: true,
        rosterNextStartAt: true,
      },
      sort: { name: SortOrder.Ascending },
      limit: 21,
      skip: 0,
      props: PROPS,
    });
  });

  test("each schedule's line: who is on call until when and who is next, nobody, or who starts next and when", async () => {
    const primary: OnCallDutyPolicySchedule = schedule({
      name: "Primary",
      current: person(SIMON, "Simon Lee"),
      next: person(ANA, "Ana Ruiz"),
      handoffAt: HANDOFF,
      nextStartAt: HANDOFF,
    });
    const database: OnCallDutyPolicySchedule = schedule({
      name: "Database",
      next: person(ANA, "Ana Ruiz"),
      nextStartAt: NEXT_START,
    });
    const weekend: OnCallDutyPolicySchedule = schedule({ name: "Weekend" });
    const solo: OnCallDutyPolicySchedule = schedule({
      name: "Solo",
      current: person(SIMON, "Simon Lee"),
      next: person(SIMON, "Simon Lee"),
      handoffAt: HANDOFF,
    });
    const unscheduled: OnCallDutyPolicySchedule = schedule({
      name: "Escalations",
      current: person(ANA, "Ana Ruiz"),
    });
    returnSchedules([database, unscheduled, primary, solo, weekend]);

    expect(await answer()).toEqual({
      markdown: [
        "👥 **On call now**",
        `- [Database](${linkOf(database)}): nobody right now. **Ana Ruiz** is next, from ${until(NEXT_START)}.`,
        `- [Escalations](${linkOf(unscheduled)}): **Ana Ruiz**.`,
        `- [Primary](${linkOf(primary)}): **Simon Lee** until ${until(HANDOFF)}, then Ana Ruiz.`,
        `- [Solo](${linkOf(solo)}): **Simon Lee** until ${until(HANDOFF)}.`,
        `- [Weekend](${linkOf(weekend)}): nobody right now.`,
        // A blank line, or the link would be read as part of the last item.
        "",
        `[Open the on-call schedules in OneUptime](${SCHEDULES_LINK})`,
      ].join("\n"),
      text: "On call now: nobody (Database), Ana Ruiz (Escalations), Simon Lee (Primary), Simon Lee (Solo), nobody (Weekend)",
    });
  });

  test("the asker is marked (you), on call or next", async () => {
    const primary: OnCallDutyPolicySchedule = schedule({
      name: "Primary",
      current: person(ASKER, "Nitin Bharathy"),
      next: person(SIMON, "Simon Lee"),
      handoffAt: HANDOFF,
    });
    const secondary: OnCallDutyPolicySchedule = schedule({
      name: "Secondary",
      current: person(SIMON, "Simon Lee"),
      next: person(ASKER, "Nitin Bharathy"),
      handoffAt: HANDOFF,
    });
    const database: OnCallDutyPolicySchedule = schedule({
      name: "Database",
      next: person(ASKER, "Nitin Bharathy"),
      nextStartAt: NEXT_START,
    });
    returnSchedules([database, primary, secondary]);

    const lines: Array<string> = (await answer()).markdown.split("\n");

    expect(lines[1]).toBe(
      `- [Database](${linkOf(database)}): nobody right now. **Nitin Bharathy** (you) is next, from ${until(NEXT_START)}.`,
    );
    expect(lines[2]).toBe(
      `- [Primary](${linkOf(primary)}): **Nitin Bharathy** (you) until ${until(HANDOFF)}, then Simon Lee.`,
    );
    expect(lines[3]).toBe(
      `- [Secondary](${linkOf(secondary)}): **Simon Lee** until ${until(HANDOFF)}, then Nitin Bharathy (you).`,
    );
  });

  test("a person with no name is named by their email, else 'Someone'; a schedule with no name is 'Unnamed schedule'", async () => {
    const byEmail: OnCallDutyPolicySchedule = schedule({
      name: "Primary",
      current: person(SIMON, null, "simon@example.com"),
    });
    const nameless: OnCallDutyPolicySchedule = schedule({
      name: "  ",
      current: person(ANA, null),
    });
    returnSchedules([byEmail, nameless]);

    const lines: Array<string> = (await answer()).markdown.split("\n");

    expect(lines[1]).toBe(
      `- [Primary](${linkOf(byEmail)}): **simon@example.com**.`,
    );
    expect(lines[2]).toBe(
      `- [Unnamed schedule](${linkOf(nameless)}): **Someone**.`,
    );
  });

  test("names are text: a schedule or a person named in Markdown cannot become a link, an image or a mention", async () => {
    const tricky: OnCallDutyPolicySchedule = schedule({
      name: "On-call](https://evil.example)",
      current: person(SIMON, "<!channel> **Simon** [x](https://evil.example)"),
    });
    returnSchedules([tricky]);

    const result: WorkspaceAnswer = await answer();
    const line: string = result.markdown.split("\n")[1]!;

    /*
     * The schedule's name is the link's text, every bracket and parenthesis
     * in it escaped; the person's name is text in bold, its mention broken
     * by a word joiner.
     */
    expect(line).toBe(
      String.raw`- [On-call\]\(https://evil.example\)](` +
        linkOf(tricky) +
        String.raw`): **\<` +
        "\u{2060}" +
        String.raw`!channel> \*\*Simon\*\* \[x\](https://evil.example)**.`,
    );

    // In Slack, nobody is notified and nothing links elsewhere.
    const slack: string = (
      SlackUtil.getMarkdownBlocks({
        payloadMarkdownBlock: {
          _type: "WorkspacePayloadMarkdown",
          text: result.markdown,
        },
      })[0]!["text"] as JSONObject
    )["text"] as string;

    expect(slack).not.toContain("<!channel>");
    expect(slack).not.toContain("<https://evil.example");
  });

  test("past twenty schedules, it lists the first twenty and links to the rest", async () => {
    const rows: Array<OnCallDutyPolicySchedule> = [];

    for (let index: number = 1; index <= 21; index++) {
      rows.push(
        schedule({
          name: `Schedule ${String(index).padStart(2, "0")}`,
          current: person(SIMON, "Simon Lee"),
        }),
      );
    }

    returnSchedules(rows);

    const lines: Array<string> = (await answer()).markdown.split("\n");

    // The heading, twenty schedules, a blank line and the note.
    expect(lines).toHaveLength(23);
    expect(lines[20]).toBe(
      `- [Schedule 20](${linkOf(rows[19]!)}): **Simon Lee**.`,
    );
    expect(lines[21]).toBe("");
    expect(lines[22]).toBe(
      `These are the first 20 schedules. [See them all in OneUptime](${SCHEDULES_LINK}).`,
    );
  });

  test("no dashboard address: no links, and the way there in words", async () => {
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockRejectedValue(new Error("No host is configured."));
    const rows: Array<OnCallDutyPolicySchedule> = [];

    for (let index: number = 1; index <= 21; index++) {
      rows.push(schedule({ name: `S${index}` }));
    }

    returnSchedules(rows);

    const lines: Array<string> = (await answer()).markdown.split("\n");

    expect(lines[1]).toBe("- S1: nobody right now.");
    expect(lines[21]).toBe("");
    expect(lines[22]).toBe(
      "These are the first 20 schedules. See them all in OneUptime, under On-Call Duty → Schedules.",
    );

    returnSchedules([schedule({ name: "Primary" })]);

    expect((await answer()).markdown).toBe(
      ["👥 **On call now**", "- Primary: nobody right now."].join("\n"),
    );
  });

  test("no schedule the asker may read: said so, with where to add one", async () => {
    expect(await answer()).toEqual({
      markdown: `👥 **No on-call schedules yet.** There are no on-call schedules in this project that you can see. [Add one in OneUptime](${SCHEDULES_LINK}) under On-Call Duty → Schedules.`,
      text: "There are no on-call schedules in this project that you can see",
    });

    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockRejectedValue(new Error("No host is configured."));

    expect((await answer()).markdown).toBe(
      "👥 **No on-call schedules yet.** There are no on-call schedules in this project that you can see. Add one in OneUptime under On-Call Duty → Schedules.",
    );
  });

  test.each([
    [
      "no permission",
      new NotAuthorizedException(
        "You do not have permission to read schedules",
      ),
    ],
    ["not on the plan", new PaymentRequiredException("Please upgrade.")],
  ])(
    "a read refused (%s): told so, and how to get access",
    async (_why: string, refusal: Error) => {
      findBy.mockRejectedValue(refusal);

      expect(await answer()).toEqual({
        markdown:
          "You do not have permission to see the on-call schedules in this project. Ask a project admin for access to them.",
        text: "You do not have permission to see the on-call schedules in this project. Ask a project admin for access to them.",
      });
    },
  );

  test("any other failure is thrown, for the caller to answer", async () => {
    const outage: Error = new Error("connection reset");
    findBy.mockRejectedValue(outage);

    await expect(answer()).rejects.toBe(outage);
  });

  test("the product's name is the one the installation goes by", async () => {
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Ops");
    returnSchedules([schedule({ name: "Primary" })]);

    expect((await answer()).markdown).toContain(
      `[Open the on-call schedules in Acme Ops](${SCHEDULES_LINK})`,
    );
  });
});
