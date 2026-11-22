import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import { Token, Tokens, marked } from "marked";
import path from "path";
import OwnerNotificationFeedText, {
  OwnerNotificationRecordNoun,
} from "../../../../Server/Utils/Notification/OwnerNotificationFeedText";
import FeedMarkdown, {
  MarkdownText,
} from "../../../../Utils/Markdown/FeedMarkdown";

/*
 * The feed entry that says a record's owners were told something: one
 * sentence about "this" record - the feed is the record's own - with who was
 * notified as a list behind the entry's details.
 */

const NOUNS: Array<OwnerNotificationRecordNoun> = [
  "incident",
  "alert",
  "incident episode",
  "alert episode",
  "maintenance event",
];

describe("what owners were told", () => {
  test.each(NOUNS)(
    "that this %s was created",
    (noun: OwnerNotificationRecordNoun) => {
      expect(OwnerNotificationFeedText.created(noun)).toBe(
        `Owners were notified that this ${noun} was created.`,
      );
    },
  );

  test.each(NOUNS)(
    "that this %s is now in a new state",
    (noun: OwnerNotificationRecordNoun) => {
      expect(
        OwnerNotificationFeedText.stateChanged({
          recordNoun: noun,
          stateName: "Acknowledged",
        }),
      ).toBe(`Owners were notified that this ${noun} is now **Acknowledged**.`);
    },
  );

  test("a state without a name still makes a sentence", () => {
    expect(
      OwnerNotificationFeedText.stateChanged({
        recordNoun: "incident",
        stateName: " ",
      }),
    ).toBe("Owners were notified that this incident changed state.");
  });

  test.each<[boolean, string]>([
    [true, "Owners were notified of the new private note."],
    [false, "Owners were notified of the new public note."],
  ])("a note (private: %p)", (isPrivateNote: boolean, expected: string) => {
    expect(OwnerNotificationFeedText.notePosted({ isPrivateNote })).toBe(
      expected,
    );
  });

  test("how long a record has been open", () => {
    expect(
      OwnerNotificationFeedText.reminder({
        recordNoun: "incident",
        stateName: "Investigating",
        openDuration: "2 hours",
      }),
    ).toBe(
      "Owners were reminded that this incident is still **Investigating**, open for **2 hours**.",
    );
    expect(
      OwnerNotificationFeedText.reminder({
        recordNoun: "alert",
        stateName: undefined,
        openDuration: undefined,
      }),
    ).toBe("Owners were reminded that this alert is still open.");
  });

  test.each<["incident" | "alert", number, string]>([
    [
      "incident",
      1,
      "Owners were notified that 1 incident was added to this episode.",
    ],
    [
      "incident",
      3,
      "Owners were notified that 3 incidents were added to this episode.",
    ],
    [
      "alert",
      1,
      "Owners were notified that 1 alert was added to this episode.",
    ],
    [
      "alert",
      12,
      "Owners were notified that 12 alerts were added to this episode.",
    ],
  ])(
    "members added to an episode: %s x%p",
    (memberNoun: "incident" | "alert", count: number, expected: string) => {
      expect(
        OwnerNotificationFeedText.membersAdded({ memberNoun, count }),
      ).toBe(expected);
    },
  );

  test("a state name is text, not Markdown", () => {
    const sentence: string = OwnerNotificationFeedText.stateChanged({
      recordNoun: "incident",
      stateName: "[Resolved](https://evil.example)",
    });

    expect(sentence).not.toContain("[Resolved](https://evil.example)");
    expect(sentence).toContain("\\[Resolved\\]");
  });
});

describe("who was notified", () => {
  test("is a list, one person per line - not lines run into one paragraph", () => {
    const details: string =
      OwnerNotificationFeedText.notifiedLineMarkdown(
        OwnerNotificationFeedText.personName({
          name: "Nitin Kumar",
          email: "nitin@example.com",
        }),
      ) +
      OwnerNotificationFeedText.notifiedLineMarkdown(
        FeedMarkdown.link("Aidil Rahman", "https://oneuptime.com/u/a"),
      );

    expect(details).toBe(
      "- Nitin Kumar\n- [Aidil Rahman](https://oneuptime.com/u/a)\n",
    );
  });

  /*
   * The feed is read beyond the project, through workflows and the API, so
   * nobody's address is in it: a person without a name is the part of their
   * address before the "@" (FeedPersonName, #10669).
   */
  test("a person without a name is the part of their address before the @, and without either 'Unknown user'", () => {
    expect(
      OwnerNotificationFeedText.personName({
        name: undefined,
        email: "ops@example.com",
      }).toString(),
    ).toBe("ops");
    expect(
      OwnerNotificationFeedText.personName({
        name: "ops@example.com",
        email: "ops@example.com",
      }).toString(),
    ).toBe("ops");
    expect(
      OwnerNotificationFeedText.personName({
        name: "",
        email: "",
      }).toString(),
    ).toBe("Unknown user");
    expect(OwnerNotificationFeedText.personName(null).toString()).toBe(
      "Unknown user",
    );
  });

  test("a person with a name is their name alone: no address after it", () => {
    expect(
      OwnerNotificationFeedText.personName({
        name: "Nitin Kumar",
        email: "nitin@example.com",
      }).toString(),
    ).toBe("Nitin Kumar");
  });

  test("a name cannot start a list or a heading of its own", () => {
    const line: string = OwnerNotificationFeedText.notifiedLineMarkdown(
      OwnerNotificationFeedText.personName({
        name: "# Heading\n- injected",
        email: "x@example.com",
      }),
    );

    expect(line.split("\n").filter(Boolean)).toHaveLength(1);
    expect(line.startsWith("- ")).toBe(true);
  });
});

/*
 * ONE NOTIFICATION FOR A NEW ALERT, NOT TWO (#7987). A record's "created"
 * notification leaves out the owners its on-call page reached already, and
 * its entry says who they were after those it notified - never among them.
 */
describe("who was not notified again, as the on-call page reached them", () => {
  const ANA: MarkdownText = OwnerNotificationFeedText.personName({
    name: "Ana Lopez",
    email: "ana@example.com",
  });
  const BO: MarkdownText = OwnerNotificationFeedText.personName({
    name: "Bo Chen",
    email: "bo@example.com",
  });

  test("nobody left out adds nothing", () => {
    expect(OwnerNotificationFeedText.reachedByPageMarkdown([])).toBe("");
  });

  test("names each person left out, in one sentence", () => {
    expect(OwnerNotificationFeedText.reachedByPageMarkdown([ANA])).toBe(
      "\nNot notified again, as the on-call page reached them: Ana Lopez.\n",
    );
    expect(OwnerNotificationFeedText.reachedByPageMarkdown([ANA, BO])).toBe(
      "\nNot notified again, as the on-call page reached them: Ana Lopez, Bo Chen.\n",
    );
  });

  test("after the list of who was notified, it is a paragraph of its own - not one more person on the list", () => {
    const details: string =
      OwnerNotificationFeedText.notifiedLineMarkdown(BO) +
      OwnerNotificationFeedText.reachedByPageMarkdown([ANA]);

    expect(details).toBe(
      "- Bo Chen\n\nNot notified again, as the on-call page reached them: Ana Lopez.\n",
    );

    const blocks: Array<Token> = marked
      .lexer(details)
      .filter((token: Token): boolean => {
        return token.type !== "space";
      });

    expect(
      blocks.map((token: Token): string => {
        return token.type;
      }),
    ).toEqual(["list", "paragraph"]);
    expect((blocks[0] as Tokens.List).items).toHaveLength(1);
    expect((blocks[0] as Tokens.List).items[0]!.text).toBe("Bo Chen");
  });

  test("a name is text, not Markdown", () => {
    const sentence: string = OwnerNotificationFeedText.reachedByPageMarkdown([
      OwnerNotificationFeedText.personName({
        name: "[Ana](https://evil.example)",
        email: "ana@example.com",
      }),
      "**Bo**",
    ]);

    expect(sentence).not.toContain("[Ana](https://evil.example)");
    expect(sentence).toContain("\\[Ana\\]");
    expect(sentence).not.toContain("**Bo**");
    expect(sentence.split("\n").filter(Boolean)).toHaveLength(1);
  });
});

/*
 * A record with no owners of its own is told to the project's owners
 * (ProjectService.getOwners) - which is how a new project's first incident
 * reaches the person who made the project. The entry says who, and why:
 * "Owners were notified" beside an Owners field reading "Add" left the
 * reader guessing.
 */
describe("when the project's owners stood in for a record nobody owns", () => {
  const PROJECT_OWNERS: { isProjectOwners: boolean } = {
    isProjectOwners: true,
  };

  test.each(NOUNS)(
    "this %s was created",
    (noun: OwnerNotificationRecordNoun) => {
      expect(OwnerNotificationFeedText.created(noun, PROJECT_OWNERS)).toBe(
        `The Project Owners were notified that this ${noun} was created, as it has no owners yet.`,
      );
    },
  );

  test.each(NOUNS)(
    "this %s is now in a new state",
    (noun: OwnerNotificationRecordNoun) => {
      expect(
        OwnerNotificationFeedText.stateChanged({
          recordNoun: noun,
          stateName: "Acknowledged",
          ...PROJECT_OWNERS,
        }),
      ).toBe(
        `The Project Owners were notified that this ${noun} is now **Acknowledged**, as it has no owners yet.`,
      );
    },
  );

  test("a state without a name", () => {
    expect(
      OwnerNotificationFeedText.stateChanged({
        recordNoun: "alert",
        stateName: undefined,
        ...PROJECT_OWNERS,
      }),
    ).toBe(
      "The Project Owners were notified that this alert changed state, as it has no owners yet.",
    );
  });

  test.each(NOUNS)(
    "a note names the record, which the sentence does not",
    (noun: OwnerNotificationRecordNoun) => {
      expect(
        OwnerNotificationFeedText.notePosted({
          isPrivateNote: true,
          recordNoun: noun,
          ...PROJECT_OWNERS,
        }),
      ).toBe(
        `The Project Owners were notified of the new private note, as this ${noun} has no owners yet.`,
      );
    },
  );

  test("a note with no record noun still makes a sentence", () => {
    expect(
      OwnerNotificationFeedText.notePosted({
        isPrivateNote: false,
        ...PROJECT_OWNERS,
      }),
    ).toBe(
      "The Project Owners were notified of the new public note, as it has no owners yet.",
    );
  });

  test("a reminder", () => {
    expect(
      OwnerNotificationFeedText.reminder({
        recordNoun: "incident",
        stateName: "Investigating",
        openDuration: "2 hours",
        ...PROJECT_OWNERS,
      }),
    ).toBe(
      "The Project Owners were reminded that this incident is still **Investigating**, open for **2 hours**, as it has no owners yet.",
    );
  });

  test("members added to an episode", () => {
    expect(
      OwnerNotificationFeedText.membersAdded({
        memberNoun: "incident",
        count: 3,
        ...PROJECT_OWNERS,
      }),
    ).toBe(
      "The Project Owners were notified that 3 incidents were added to this episode, as it has no owners yet.",
    );
  });

  test("a record with owners of its own reads as it always did", () => {
    for (const audience of [undefined, {}, { isProjectOwners: false }]) {
      expect(OwnerNotificationFeedText.created("incident", audience)).toBe(
        "Owners were notified that this incident was created.",
      );
      expect(
        OwnerNotificationFeedText.notePosted({
          isPrivateNote: true,
          recordNoun: "incident",
          ...audience,
        }),
      ).toBe("Owners were notified of the new private note.");
    }
  });

  test("a state name is still text, not Markdown", () => {
    const sentence: string = OwnerNotificationFeedText.stateChanged({
      recordNoun: "incident",
      stateName: "[Resolved](https://evil.example)",
      ...PROJECT_OWNERS,
    });

    expect(sentence).not.toContain("[Resolved](https://evil.example)");
    expect(sentence).toContain("\\[Resolved\\]");
    expect(sentence.endsWith(", as it has no owners yet.")).toBe(true);
  });
});

/*
 * Every job that tells a record's owners says, in the feed, whether the
 * project's owners stood in: each passes isProjectOwners from the fallback it
 * takes (doesResourceHasOwners).
 */
describe("the jobs that write these entries", () => {
  const JOBS_DIR: string = path.resolve(
    __dirname,
    "../../../../../App/FeatureSet/Workers/Jobs",
  );

  const OWNER_JOBS: Array<string> = fs
    .readdirSync(JOBS_DIR)
    .filter((folder: string): boolean => {
      return folder.endsWith("Owners");
    })
    .flatMap((folder: string): Array<string> => {
      return fs
        .readdirSync(path.join(JOBS_DIR, folder))
        .map((file: string): string => {
          return `${folder}/${file}`;
        });
    });

  const FEED_TEXT_CALL: RegExp =
    /OwnerNotificationFeedText\.(created|stateChanged|notePosted|reminder|membersAdded)\(/g;

  const callsOf: (job: string) => Array<string> = (
    job: string,
  ): Array<string> => {
    const source: string = fs.readFileSync(path.join(JOBS_DIR, job), "utf8");
    const calls: Array<string> = [];

    for (const match of source.matchAll(FEED_TEXT_CALL)) {
      calls.push(source.slice(match.index!, source.indexOf(")", match.index!)));
    }

    return calls;
  };

  const jobsWithCalls: Array<string> = OWNER_JOBS.filter(
    (job: string): boolean => {
      return callsOf(job).length > 0;
    },
  );

  test("are found", () => {
    expect(jobsWithCalls.length).toBeGreaterThanOrEqual(17);
  });

  /*
   * Since #8611 most jobs plan whom to tell through
   * OwnerNotificationDeliveries.planForOwnersOf, which takes the fallback.
   */
  const DELIVERIES_SOURCE: string = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../Server/Utils/Notification/OwnerNotificationDeliveries.ts",
    ),
    "utf8",
  );

  test("planForOwnersOf falls back to the project's owners, and says so", () => {
    const planForOwnersOf: string = DELIVERIES_SOURCE.slice(
      DELIVERIES_SOURCE.indexOf("public static async planForOwnersOf("),
    );

    expect(planForOwnersOf).toContain("isProjectOwners = true;");
    expect(planForOwnersOf).toContain("ProjectService.getOwners(");
    expect(planForOwnersOf).toContain("isProjectOwners: isProjectOwners,");
  });

  test.each(jobsWithCalls)("%s says who was told", (job: string) => {
    const source: string = fs.readFileSync(path.join(JOBS_DIR, job), "utf8");

    // The job does fall back to the project's owners, itself or through planForOwnersOf...
    expect([
      job,
      source.includes("ProjectService.getOwners(") ||
        source.includes("OwnerNotificationDeliveries.planForOwnersOf("),
    ]).toEqual([job, true]);

    // ...and every entry it writes says whether they stood in.
    for (const call of callsOf(job)) {
      expect([job, call]).toEqual([
        job,
        expect.stringContaining("isProjectOwners: !doesResourceHasOwners"),
      ]);
    }
  });
});
