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
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../../../../Server/Utils/TeamMember/PendingInviteeProfiles";
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
      // A notification names the first three: it reads as one line.
      text: "On call now: nobody (Database), Ana Ruiz (Escalations), Simon Lee (Primary) and 2 more",
    });
  });

  test("a notification names every schedule when there are three at most", async () => {
    returnSchedules([
      schedule({ name: "Database" }),
      schedule({ name: "Primary", current: person(SIMON, "Simon Lee") }),
      schedule({ name: "Secondary", current: person(ANA, "Ana Ruiz") }),
    ]);

    expect((await answer()).text).toBe(
      "On call now: nobody (Database), Simon Lee (Primary), Ana Ruiz (Secondary)",
    );

    returnSchedules([
      schedule({ name: "Primary", current: person(SIMON, "Simon Lee") }),
    ]);

    expect((await answer()).text).toBe("On call now: Simon Lee (Primary)");
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

  /*
   * Teams posts the answer in the conversation, a channel included: a
   * member with no name is named by the part of their address before the
   * "@", never the address itself (#10669).
   */
  test("a person with no name is named by the part of their email before the @, else 'Someone'; a schedule with no name is 'Unnamed schedule'", async () => {
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
      `- [Primary](${linkOf(byEmail)}): **simon**.`,
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
    // How many there are is not known: "and more".
    expect((await answer()).text).toBe(
      "On call now: Simon Lee (Schedule 01), Simon Lee (Schedule 02), Simon Lee (Schedule 03) and more",
    );
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
      "These are the first 20 schedules. See them all in OneUptime, under On-Call → On-Call Schedules.",
    );

    returnSchedules([schedule({ name: "Primary" })]);

    expect((await answer()).markdown).toBe(
      ["👥 **On call now**", "- Primary: nobody right now."].join("\n"),
    );
  });

  test("no schedule the asker may read: said so once, as the schedules list in OneUptime says it, with where to add one", async () => {
    expect(await answer()).toEqual({
      markdown: `👥 **No on-call schedules yet.** [Add one in OneUptime](${SCHEDULES_LINK}) under On-Call → On-Call Schedules.`,
      text: "No on-call schedules yet",
    });

    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockRejectedValue(new Error("No host is configured."));

    expect((await answer()).markdown).toBe(
      "👥 **No on-call schedules yet.** Add one in OneUptime under On-Call → On-Call Schedules.",
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
          "You do not have permission to see the on-call schedules in this project. Ask a Project Admin for access to them.",
        text: "You do not have permission to see the on-call schedules in this project. Ask a Project Admin for access to them.",
      });
    },
  );

  test("any other failure is thrown, for the caller to answer", async () => {
    const outage: Error = new Error("connection reset");
    findBy.mockRejectedValue(outage);

    await expect(answer()).rejects.toBe(outage);
  });

  /*
   * Someone only invited can be on a roster (#10412): the asker's own read
   * shows the address they were invited at (#10175), and Microsoft Teams
   * posts the answer where it was asked, a channel included (#10616).
   * Nothing pages them, so their turn is said as the gap it is (#10586).
   */
  describe("someone only invited to the project", () => {
    const IVY: ObjectID = new ObjectID("e0000000-0000-4000-8000-0000000000c1");

    // The name typed with Ivy's invitation; undefined: she has joined.
    let typed: string | null | undefined;

    beforeEach(() => {
      typed = "Ivy";
      jest
        .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
        .mockImplementation((async (data: {
          userIds: Array<string>;
        }): Promise<Map<string, WithheldProfile>> => {
          const withheld: Map<string, WithheldProfile> = new Map<
            string,
            WithheldProfile
          >();

          if (typed !== undefined && data.userIds.includes(IVY.toString())) {
            withheld.set(IVY.toString().toLowerCase(), {
              inviteeName: typed,
              inviteeEmail: "ivy@invited.test",
            });
          }

          return withheld;
        }) as never);
    });

    // As the asker's read shows her: the name typed, else her invited address.
    function ivy(): User {
      return person(IVY, typed || null, "ivy@invited.test");
    }

    test("REGRESSION: on call - nobody is paged until her turn ends, and who takes over then", async () => {
      const primary: OnCallDutyPolicySchedule = schedule({
        name: "Primary",
        current: ivy(),
        next: person(ANA, "Ana Ruiz"),
        handoffAt: HANDOFF,
        nextStartAt: HANDOFF,
      });
      returnSchedules([primary]);

      const result: WorkspaceAnswer = await answer();

      expect(result.markdown.split("\n")[1]).toBe(
        `- [Primary](${linkOf(primary)}): nobody is paged until ${until(HANDOFF)}, when **Ana Ruiz** takes over: **Ivy** is on call but hasn't joined the project yet.`,
      );
      // A notification says the same: nobody, not Ivy.
      expect(result.text).toBe("On call now: nobody (Primary)");
    });

    test("REGRESSION: on call with no name typed - never the address she was invited at", async () => {
      for (const name of [null, "ivy@invited.test"]) {
        typed = name;

        const primary: OnCallDutyPolicySchedule = schedule({
          name: "Primary",
          current: person(IVY, null, "ivy@invited.test"),
          next: person(ANA, "Ana Ruiz"),
          handoffAt: HANDOFF,
          nextStartAt: HANDOFF,
        });
        returnSchedules([primary]);

        const result: WorkspaceAnswer = await answer();

        expect(result.markdown.split("\n")[1]).toBe(
          `- [Primary](${linkOf(primary)}): nobody is paged until ${until(HANDOFF)}, when **Ana Ruiz** takes over: the person on call hasn't joined the project yet.`,
        );
        expect(result.markdown).not.toContain("invited.test");
        expect(result.text).not.toContain("invited.test");
      }
    });

    test("REGRESSION: next - then nobody, and why", async () => {
      const primary: OnCallDutyPolicySchedule = schedule({
        name: "Primary",
        current: person(SIMON, "Simon Lee"),
        next: ivy(),
        handoffAt: HANDOFF,
        nextStartAt: HANDOFF,
      });
      returnSchedules([primary]);

      const result: WorkspaceAnswer = await answer();

      expect(result.markdown.split("\n")[1]).toBe(
        `- [Primary](${linkOf(primary)}): **Simon Lee** until ${until(HANDOFF)}, then nobody: **Ivy** is next but hasn't joined the project yet.`,
      );
      expect(result.text).toBe("On call now: Simon Lee (Primary)");

      typed = null;
      returnSchedules([
        schedule({
          name: "Primary",
          current: person(SIMON, "Simon Lee"),
          next: person(IVY, null, "ivy@invited.test"),
          handoffAt: HANDOFF,
        }),
      ]);

      expect((await answer()).markdown).toContain(
        ", then nobody: the next person hasn't joined the project yet.",
      );
    });

    test("nobody on call and her next: nobody will be paged then either", async () => {
      const database: OnCallDutyPolicySchedule = schedule({
        name: "Database",
        next: ivy(),
        nextStartAt: NEXT_START,
      });
      returnSchedules([database]);

      expect((await answer()).markdown.split("\n")[1]).toBe(
        `- [Database](${linkOf(database)}): nobody right now, and nobody will be paged from ${until(NEXT_START)} either: **Ivy** is next but hasn't joined the project yet.`,
      );
    });

    test("on call with nobody after her, with no hand-off, or with her next too", async () => {
      const alone: OnCallDutyPolicySchedule = schedule({
        name: "Alone",
        current: ivy(),
        handoffAt: HANDOFF,
      });
      const endless: OnCallDutyPolicySchedule = schedule({
        name: "Endless",
        current: ivy(),
      });
      const twice: OnCallDutyPolicySchedule = schedule({
        name: "Twice",
        current: ivy(),
        next: ivy(),
        handoffAt: HANDOFF,
      });
      returnSchedules([alone, endless, twice]);

      const lines: Array<string> = (await answer()).markdown.split("\n");

      expect(lines[1]).toBe(
        `- [Alone](${linkOf(alone)}): nobody is paged until ${until(HANDOFF)}: **Ivy** is on call but hasn't joined the project yet.`,
      );
      expect(lines[2]).toBe(
        `- [Endless](${linkOf(endless)}): nobody is paged: **Ivy** is on call but hasn't joined the project yet.`,
      );
      expect(lines[3]).toBe(
        `- [Twice](${linkOf(twice)}): nobody is paged until ${until(HANDOFF)}: **Ivy** is on call but hasn't joined the project yet.`,
      );
    });

    test("who is only invited is read once, for every schedule listed", async () => {
      returnSchedules([
        schedule({ name: "A", current: ivy(), next: person(ANA, "Ana") }),
        schedule({ name: "B", current: person(ANA, "Ana"), next: ivy() }),
        schedule({ name: "C" }),
      ]);

      await answer();

      expect(
        PendingInviteeProfiles.readWithheldProfilesInProject,
      ).toHaveBeenCalledTimes(1);
      expect(
        PendingInviteeProfiles.readWithheldProfilesInProject,
      ).toHaveBeenCalledWith({
        userIds: [IVY.toString(), ANA.toString()],
        projectId: PROJECT_ID,
      });
    });

    test("no roster names anybody: nothing is read", async () => {
      returnSchedules([schedule({ name: "Weekend" })]);

      await answer();

      expect(
        PendingInviteeProfiles.readWithheldProfilesInProject,
      ).not.toHaveBeenCalled();
    });

    test("once she joins, she is on call as anyone is", async () => {
      typed = undefined;
      const primary: OnCallDutyPolicySchedule = schedule({
        name: "Primary",
        current: person(IVY, "Ivy Hart"),
        next: person(ANA, "Ana Ruiz"),
        handoffAt: HANDOFF,
      });
      returnSchedules([primary]);

      expect((await answer()).markdown.split("\n")[1]).toBe(
        `- [Primary](${linkOf(primary)}): **Ivy Hart** until ${until(HANDOFF)}, then Ana Ruiz.`,
      );
    });

    test("a read of who is only invited that fails is thrown, for the caller to answer: nobody is named by what it cannot tell apart", async () => {
      const outage: Error = new Error("connection reset");
      jest
        .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
        .mockRejectedValue(outage as never);
      returnSchedules([schedule({ name: "Primary", current: ivy() })]);

      await expect(answer()).rejects.toBe(outage);
    });
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
