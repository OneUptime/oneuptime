import { describe, expect, test } from "@jest/globals";
import MicrosoftTeamsPage from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsPage";
import { MicrosoftTeamsPageActionType } from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import {
  WORKSPACE_PAGE_FORM_TEXT,
  WorkspacePageChoice,
  WorkspacePageChoiceGroup,
  WorkspacePageFormPrefill,
  WorkspacePageTargetKind,
} from "../../../../../Server/Utils/Workspace/WorkspacePage";
import { JSONObject } from "../../../../../Types/JSON";

/*
 * THE PAGE SOMEONE CARD, AS MICROSOFT TEAMS IS SENT IT.
 *
 * "page" typed to the bot with nobody to page at once gets this card: a
 * title, a note for each person or group it could not pick, who to page -
 * one compact list, each choice led by its kind - with its hint and, when
 * the card could not hold every choice, how many it left out and how to page
 * them anyway; then the message with its hint, and the Page button. It is
 * the Slack modal's form in the same words (WORKSPACE_PAGE_FORM_TEXT).
 *
 * The notes are in the card's own text colour. Teams' light theme draws
 * "Warning" text as #f8d22a on white - about 1.5:1, which nobody can read
 * (its published host config, samples/HostConfig/microsoft-teams-light.json
 * in the Adaptive Cards repository) - so no text on the card may ask for it.
 */

function choice(
  kind: WorkspacePageTargetKind,
  name: string,
  index: number,
): WorkspacePageChoice {
  return {
    value: `${kind}:00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    name: name,
    label: name,
  };
}

function groups(
  people: number,
  notShownCount?: number,
): Array<WorkspacePageChoiceGroup> {
  return [
    {
      kind: WorkspacePageTargetKind.Schedule,
      label: "On-call schedules",
      choices: [
        {
          ...choice(WorkspacePageTargetKind.Schedule, "Primary", 1),
          label: "Primary (Nawaz Dhandala on call now)",
        },
      ],
    },
    {
      kind: WorkspacePageTargetKind.Person,
      label: "People",
      choices: Array.from({ length: people }, (_: unknown, index: number) => {
        return choice(
          WorkspacePageTargetKind.Person,
          `Person ${String(index).padStart(3, "0")} with a rather long name`,
          100 + index,
        );
      }),
      ...(notShownCount ? { notShownCount: notShownCount } : {}),
    },
    {
      kind: WorkspacePageTargetKind.Team,
      label: "Teams",
      choices: [choice(WorkspacePageTargetKind.Team, "Payments", 2)],
    },
    {
      kind: WorkspacePageTargetKind.Policy,
      label: "On-call policies",
      choices: [choice(WorkspacePageTargetKind.Policy, "DB Escalation", 3)],
    },
  ];
}

const NO_PREFILL: WorkspacePageFormPrefill = {
  values: [],
  message: "",
  notes: [],
};

function card(data: {
  choices: Array<WorkspacePageChoiceGroup>;
  prefill?: WorkspacePageFormPrefill | undefined;
  budgetInBytes?: number | undefined;
}): JSONObject {
  return MicrosoftTeamsPage.buildFormCard({
    choices: data.choices,
    prefill: data.prefill || NO_PREFILL,
    budgetInBytes: data.budgetInBytes || 40 * 1024,
  });
}

function body(built: JSONObject): Array<JSONObject> {
  return built["body"] as Array<JSONObject>;
}

function texts(built: JSONObject): Array<string> {
  return body(built).map((element: JSONObject): string => {
    return element["type"] === "TextBlock"
      ? String(element["text"])
      : `[${String(element["type"])} ${String(element["id"])}]`;
  });
}

describe("the Page someone card", () => {
  test("title, notes, who to page and its hint, the message and its hint, then Page - in that order", () => {
    const built: JSONObject = card({
      choices: groups(2),
      prefill: {
        values: [],
        message: "db down",
        notes: [
          "OneUptime can't tell who @Dana is: their Microsoft Teams account isn't connected to OneUptime. Pick them below.",
          "OneUptime can't page @On-call DBAs. Pick the on-call schedule, the team or the people below.",
        ],
      },
    });

    expect(texts(built)).toEqual([
      "Page someone",
      "⚠️ OneUptime can't tell who @Dana is: their Microsoft Teams account isn't connected to OneUptime. Pick them below.",
      "⚠️ OneUptime can't page @On-call DBAs. Pick the on-call schedule, the team or the people below.",
      "[Input.ChoiceSet pageTargets]",
      "A schedule pages whoever is on call in it now. Everybody you pick is paged at once.",
      "[Input.Text pageMessage]",
      "The people you page get this as the title of a new alert.",
    ]);
    expect(built["actions"]).toEqual([
      {
        type: "Action.Submit",
        title: "Page",
        style: "positive",
        data: { action: MicrosoftTeamsPageActionType.SubmitPageSomeone },
      },
    ]);
  });

  test("the title is large and bold, as every OneUptime card's", () => {
    expect(body(card({ choices: groups(1) }))[0]).toEqual({
      type: "TextBlock",
      text: WORKSPACE_PAGE_FORM_TEXT.title,
      size: "Large",
      weight: "Bolder",
    });
  });

  test("a note is in the card's own colour, wrapped: Teams' Warning yellow cannot be read on its light theme", () => {
    const note: JSONObject = body(
      card({
        choices: groups(1),
        prefill: {
          ...NO_PREFILL,
          notes: [
            "@olga isn't a member of this project, so OneUptime can't page them.",
          ],
        },
      }),
    )[1]!;

    expect(note).toEqual({
      type: "TextBlock",
      text: "⚠️ @olga isn't a member of this project, so OneUptime can't page them.",
      wrap: true,
    });
  });

  test("nothing on the card asks for a colour", () => {
    const serialized: string = JSON.stringify(
      card({
        choices: groups(120, 30),
        prefill: { values: [], message: "x", notes: ["a", "b"] },
        budgetInBytes: 6 * 1024,
      }),
    );

    expect(serialized).not.toContain('"color"');
  });

  test("who to page: one compact list, each choice led by its kind, with Slack's placeholder and the error under it", () => {
    const who: JSONObject = body(card({ choices: groups(1) })).find(
      (element: JSONObject): boolean => {
        return element["id"] === "pageTargets";
      },
    )!;

    expect(who).toMatchObject({
      type: "Input.ChoiceSet",
      label: "Who to page",
      placeholder: "Pick people, a team or a schedule",
      style: "compact",
      isMultiSelect: true,
      isRequired: true,
      errorMessage: "Pick who to page.",
    });
    expect(
      (who["choices"] as Array<JSONObject>).map((item: JSONObject) => {
        return item["title"];
      }),
    ).toEqual([
      "Schedule · Primary (Nawaz Dhandala on call now)",
      "Person · Person 000 with a rather long name",
      "Team · Payments",
      "Policy · DB Escalation",
    ]);
  });

  test("the message: what to write, as long as an alert's title, and the error under it", () => {
    const message: JSONObject = body(
      card({
        choices: groups(1),
        prefill: { ...NO_PREFILL, message: "x".repeat(800) },
      }),
    ).find((element: JSONObject): boolean => {
      return element["id"] === "pageMessage";
    })!;

    expect(message).toMatchObject({
      type: "Input.Text",
      label: "Message",
      placeholder: "What should they look at?",
      isMultiline: true,
      isRequired: true,
      errorMessage: "Write what the page is about.",
      maxLength: 500,
    });
    expect(String(message["value"])).toHaveLength(500);
  });

  test("what was picked as it opens: the offered values, as Teams takes a multi-select's - comma-separated", () => {
    const choices: Array<WorkspacePageChoiceGroup> = groups(2);
    const who: JSONObject = body(
      card({
        choices: choices,
        prefill: {
          ...NO_PREFILL,
          values: [
            choices[0]!.choices[0]!.value,
            choices[1]!.choices[1]!.value,
            "user:not-offered",
          ],
        },
      }),
    ).find((element: JSONObject): boolean => {
      return element["id"] === "pageTargets";
    })!;

    expect(who["value"]).toBe(
      `${choices[0]!.choices[0]!.value},${choices[1]!.choices[1]!.value}`,
    );
  });
});

describe("what a note names is text", () => {
  test("a tag's name cannot become a link or formatting on the card", () => {
    const note: string = String(
      body(
        card({
          choices: groups(1),
          prefill: {
            ...NO_PREFILL,
            notes: [
              "OneUptime can't page @[click](https://evil.example) **now**. Pick the on-call schedule, the team or the people below.",
            ],
          },
        }),
      )[1]!["text"],
    );

    expect(note).not.toContain("[click](https://evil.example)");
    expect(note).toContain("\\[click\\]");
    expect(note).toContain("\\*\\*now\\*\\*");
  });
});

describe("a card that cannot hold every choice", () => {
  test("is cut to fit, and says how many it left out under the list - not after the message", () => {
    const budgetInBytes: number = 6 * 1024;
    const built: JSONObject = card({
      choices: groups(100),
      budgetInBytes: budgetInBytes,
    });
    const all: Array<string> = texts(built);
    const who: JSONObject = body(built).find((element: JSONObject) => {
      return element["id"] === "pageTargets";
    })!;
    const shown: number = (who["choices"] as Array<JSONObject>).length;

    expect(JSON.stringify(built).length).toBeLessThanOrEqual(budgetInBytes);
    expect(shown).toBeLessThan(103);

    const noteAt: number = all.findIndex((text: string): boolean => {
      return text.indexOf("could not fit on this card") !== -1;
    });

    expect(all[noteAt]).toBe(
      `${103 - shown} more choices could not fit on this card. @mention a person to page them at once.`,
    );
    // Right under the list's own hint, before the message.
    expect(all[noteAt - 1]).toBe(WORKSPACE_PAGE_FORM_TEXT.whoHint);
    expect(all[noteAt + 1]).toBe("[Input.Text pageMessage]");
    expect(body(built)[noteAt]).toMatchObject({
      isSubtle: true,
      size: "Small",
    });
  });

  test("people past the hundred a list holds are counted too", () => {
    const built: JSONObject = card({ choices: groups(100, 52) });

    expect(texts(built)).toContain(
      "52 more choices could not fit on this card. @mention a person to page them at once.",
    );
  });

  test("one left out is one choice", () => {
    expect(texts(card({ choices: groups(1, 1) }))).toContain(
      "1 more choice could not fit on this card. @mention a person to page them at once.",
    );
  });

  test("a card that holds everything says nothing of it", () => {
    expect(
      texts(card({ choices: groups(3) })).some((text: string): boolean => {
        return text.indexOf("could not fit") !== -1;
      }),
    ).toBe(false);
  });
});
