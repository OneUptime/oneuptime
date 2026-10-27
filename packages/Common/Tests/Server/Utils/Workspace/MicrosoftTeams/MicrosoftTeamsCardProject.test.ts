import fs from "fs";
import path from "path";
import { describe, expect, jest, test } from "@jest/globals";
import MicrosoftTeamsCardProject, {
  DRAWN_FOR_PROJECT_ID_FIELD,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCardProject";
import { MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE } from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsReplies";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import type { Activity, TurnContext } from "botbuilder";
import type { Mock } from "jest-mock";

/*
 * THE PROJECT A CARD WAS SENT FOR, ON ITS BUTTONS.
 *
 * In a Microsoft 365 organization connected to several OneUptime projects,
 * every card the bot sends in a turn read in one project carries it on its
 * own Action.Submit buttons, wherever on the card they are, so a press of a
 * form or a Home button - which names no record - is read in that project.
 * Links, other people's submits and a button that names a project already
 * are left alone, and the card the code built is never changed in place.
 */

const PROJECT: string = "f1000000-0000-4000-8000-000000000002";
const OTHER_PROJECT: string = "f1000000-0000-4000-8000-000000000001";

// A card with a button in every place a card can hold one.
function everyKindOfButton(): JSONObject {
  return {
    type: "AdaptiveCard",
    version: "1.5",
    body: [
      { type: "TextBlock", text: "Declare an incident", wrap: true },
      { type: "Input.Text", id: "incidentTitle", label: "Title" },
      {
        type: "ActionSet",
        actions: [
          {
            type: "Action.Submit",
            title: "In a set",
            data: { action: "home-refresh", actionValue: "" },
          },
        ],
      },
      {
        type: "Container",
        selectAction: {
          type: "Action.Submit",
          data: { action: "home-who-is-on-call" },
        },
        items: [
          {
            type: "ColumnSet",
            columns: [
              {
                type: "Column",
                items: [
                  {
                    type: "ActionSet",
                    actions: [
                      {
                        type: "Action.Submit",
                        title: "In a column",
                        data: { action: "AcknowledgeIncident", actionValue: "x" },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    actions: [
      {
        type: "Action.Submit",
        title: "Create Incident",
        data: { action: "SubmitNewIncident" },
      },
      {
        type: "Action.ShowCard",
        title: "More",
        card: {
          type: "AdaptiveCard",
          actions: [
            {
              type: "Action.Submit",
              title: "Shown",
              data: { action: "SubmitIncidentNote", actionValue: "y" },
            },
          ],
        },
      },
      { type: "Action.OpenUrl", title: "Open", url: "https://example.com" },
      // A submit whose data names no action of the bot's: left alone.
      { type: "Action.Submit", title: "Plain", data: "a string" },
      { type: "Action.Submit", title: "Inputs only" },
      {
        type: "Action.Submit",
        title: "Not ours",
        data: { msteams: { type: "imBack", value: "hi" } },
      },
      // A button that names a project already keeps it.
      {
        type: "Action.Submit",
        title: "Already",
        data: {
          action: "home-page-someone",
          [DRAWN_FOR_PROJECT_ID_FIELD]: OTHER_PROJECT,
        },
      },
    ],
  };
}

// Every Action.Submit of a card, wherever it is, in document order.
function submitsOf(element: unknown): Array<JSONObject> {
  if (Array.isArray(element)) {
    return element.flatMap(submitsOf);
  }

  if (!element || typeof element !== "object") {
    return [];
  }

  const object: JSONObject = element as JSONObject;
  const own: Array<JSONObject> =
    object["type"] === "Action.Submit" ? [object] : [];

  return [...own, ...Object.values(object).flatMap(submitsOf)];
}

function marksOf(card: JSONObject): Array<unknown> {
  return submitsOf(card).map((submit: JSONObject): unknown => {
    const data: unknown = submit["data"];

    return data && typeof data === "object"
      ? (data as JSONObject)[DRAWN_FOR_PROJECT_ID_FIELD]
      : undefined;
  });
}

describe("a card's buttons carry the project it was sent for", () => {
  test("every one of the bot's own submits, wherever it is; nothing else", () => {
    const marked: JSONObject = MicrosoftTeamsCardProject.markCard(
      everyKindOfButton(),
      PROJECT,
    );

    expect(
      submitsOf(marked).map((submit: JSONObject): unknown => {
        return submit["title"] || "(select action)";
      }),
    ).toEqual([
      "In a set",
      "(select action)",
      "In a column",
      "Create Incident",
      "Shown",
      "Plain",
      "Inputs only",
      "Not ours",
      "Already",
    ]);
    expect(marksOf(marked)).toEqual([
      PROJECT,
      PROJECT,
      PROJECT,
      PROJECT,
      PROJECT,
      undefined,
      undefined,
      undefined,
      OTHER_PROJECT,
    ]);
  });

  test("the rest of each button's data, and of the card, is as it was", () => {
    const card: JSONObject = everyKindOfButton();
    const marked: JSONObject = MicrosoftTeamsCardProject.markCard(
      card,
      PROJECT,
    );

    expect(((marked["actions"] as Array<JSONObject>)[0]!["data"] as JSONObject)).toEqual({
      action: "SubmitNewIncident",
      [DRAWN_FOR_PROJECT_ID_FIELD]: PROJECT,
    });

    // Take the marks away again: what is left is the card as it was built.
    const unmarked: JSONObject = JSON.parse(
      JSON.stringify(marked, (key: string, value: unknown): unknown => {
        return key === DRAWN_FOR_PROJECT_ID_FIELD && value === PROJECT
          ? undefined
          : value;
      }),
    );

    expect(unmarked).toEqual(card);
  });

  test("the card the code built is not changed: a copy is marked", () => {
    const card: JSONObject = everyKindOfButton();
    const before: string = JSON.stringify(card);

    MicrosoftTeamsCardProject.markCard(card, PROJECT);

    expect(JSON.stringify(card)).toBe(before);
  });

  test("a card with no buttons, or none of the bot's, is the same card", () => {
    const card: JSONObject = {
      type: "AdaptiveCard",
      body: [{ type: "TextBlock", text: "Going ahead in **IRM Non-Prod**." }],
      actions: [{ type: "Action.OpenUrl", title: "Open", url: "https://x.test" }],
    };

    expect(MicrosoftTeamsCardProject.markCard(card, PROJECT)).toEqual(card);
  });
});

describe("an activity's cards", () => {
  test("its Adaptive Cards are marked; any other attachment is left as it is", () => {
    const heroCard: JSONObject = {
      contentType: "application/vnd.microsoft.card.hero",
      content: { buttons: [{ type: "Action.Submit", data: { action: "x" } }] },
    };
    const activity: Partial<Activity> = {
      type: "message",
      attachments: [
        {
          contentType: MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE,
          content: everyKindOfButton(),
        },
        heroCard as never,
        {
          contentType: MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE,
          content: "not an object",
        },
      ],
    };

    MicrosoftTeamsCardProject.markActivity(activity, PROJECT);

    expect(marksOf(activity.attachments![0]!.content as JSONObject)[0]).toBe(
      PROJECT,
    );
    expect(activity.attachments![1]).toBe(heroCard);
    expect(activity.attachments![2]!.content).toBe("not an object");
  });

  test("an activity without attachments - text, typing - is left as it is", () => {
    const activity: Partial<Activity> = { type: "typing" };

    MicrosoftTeamsCardProject.markActivity(activity, PROJECT);

    expect(activity).toEqual({ type: "typing" });
  });
});

describe("reading the project a press's card was sent for", () => {
  test("in each shape Teams sends an Action.Submit in", () => {
    for (const value of [
      { action: "SubmitNewIncident", [DRAWN_FOR_PROJECT_ID_FIELD]: PROJECT },
      { data: { action: "x", [DRAWN_FOR_PROJECT_ID_FIELD]: PROJECT } },
      {
        action: {
          type: "Action.Submit",
          data: { action: "x", [DRAWN_FOR_PROJECT_ID_FIELD]: PROJECT },
        },
      },
    ]) {
      expect(MicrosoftTeamsCardProject.readDrawnForProjectId(value)).toBe(
        PROJECT,
      );
    }
  });

  test("nothing, or anything that is not a project id, is none", () => {
    for (const value of [
      undefined,
      null,
      "x",
      42,
      [],
      {},
      { action: "x" },
      { [DRAWN_FOR_PROJECT_ID_FIELD]: "not-a-project" },
      { [DRAWN_FOR_PROJECT_ID_FIELD]: 42 },
      { data: "x" },
      { action: { data: { [DRAWN_FOR_PROJECT_ID_FIELD]: "1; DROP TABLE" } } },
    ]) {
      expect(
        MicrosoftTeamsCardProject.readDrawnForProjectId(value),
      ).toBeUndefined();
    }
  });
});

describe("no form can write the project a card was sent for", () => {
  /*
   * Teams merges a form's inputs into the data of the button that submits
   * it: an input with this id would carry what was typed in it as the
   * project. Only MicrosoftTeamsCardProject names the field.
   */
  test("no Slack or Teams code but MicrosoftTeamsCardProject spells the field as a string", () => {
    const workspaceRoot: string = path.resolve(
      __dirname,
      "../../../../../Server/Utils/Workspace",
    );
    const spelled: Array<string> = [];

    const walk: (directory: string) => void = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full: string = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          walk(full);
          continue;
        }

        if (
          entry.name.endsWith(".ts") &&
          fs
            .readFileSync(full, "utf8")
            .includes(`"${DRAWN_FOR_PROJECT_ID_FIELD}"`)
        ) {
          spelled.push(path.relative(workspaceRoot, full));
        }
      }
    };

    walk(workspaceRoot);

    expect(spelled).toEqual([
      path.join("MicrosoftTeams", "MicrosoftTeamsCardProject.ts"),
    ]);
  });
});

describe("a turn whose cards carry its project", () => {
  type SendHandler = (
    context: TurnContext,
    activities: Array<Partial<Activity>>,
    next: () => Promise<Array<{ id: string }>>,
  ) => Promise<Array<{ id: string }>>;
  type UpdateHandler = (
    context: TurnContext,
    activity: Partial<Activity>,
    next: () => Promise<void>,
  ) => Promise<void>;

  interface HookedTurn {
    turnContext: TurnContext;
    sendHandlers: Array<SendHandler>;
    updateHandlers: Array<UpdateHandler>;
  }

  function hookedTurn(): HookedTurn {
    const sendHandlers: Array<SendHandler> = [];
    const updateHandlers: Array<UpdateHandler> = [];

    const turnContext: TurnContext = {
      turnState: new Map<unknown, unknown>(),
      onSendActivities: (handler: SendHandler) => {
        sendHandlers.push(handler);
      },
      onUpdateActivity: (handler: UpdateHandler) => {
        updateHandlers.push(handler);
      },
    } as unknown as TurnContext;

    return { turnContext, sendHandlers, updateHandlers };
  }

  function cardActivity(): Partial<Activity> {
    return {
      type: "message",
      attachments: [
        {
          contentType: MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE,
          content: everyKindOfButton(),
        },
      ],
    };
  }

  test("what it sends is marked before it is sent", async () => {
    const turn: HookedTurn = hookedTurn();

    MicrosoftTeamsCardProject.drawCardsFor({
      turnContext: turn.turnContext,
      projectId: new ObjectID(PROJECT),
    });

    expect(turn.sendHandlers).toHaveLength(1);

    const activities: Array<Partial<Activity>> = [cardActivity()];
    let markedWhenSent: unknown = undefined;
    const next: Mock<() => Promise<Array<{ id: string }>>> = jest.fn(
      async () => {
        markedWhenSent = marksOf(
          activities[0]!.attachments![0]!.content as JSONObject,
        )[0];
        return [{ id: "sent-1" }];
      },
    );

    expect(
      await turn.sendHandlers[0]!(turn.turnContext, activities, next),
    ).toEqual([{ id: "sent-1" }]);
    expect(next).toHaveBeenCalledTimes(1);
    expect(markedWhenSent).toBe(PROJECT);
  });

  test("a card drawn again in place is marked too", async () => {
    const turn: HookedTurn = hookedTurn();

    MicrosoftTeamsCardProject.drawCardsFor({
      turnContext: turn.turnContext,
      projectId: new ObjectID(PROJECT),
    });

    const activity: Partial<Activity> = cardActivity();
    const next: Mock<() => Promise<void>> = jest.fn(async (): Promise<void> => {
      return undefined;
    });

    await turn.updateHandlers[0]!(turn.turnContext, activity, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(marksOf(activity.attachments![0]!.content as JSONObject)[0]).toBe(
      PROJECT,
    );
  });

  test("once a turn: asked again, nothing more is hooked", () => {
    const turn: HookedTurn = hookedTurn();

    for (let time: number = 0; time < 3; time++) {
      MicrosoftTeamsCardProject.drawCardsFor({
        turnContext: turn.turnContext,
        projectId: new ObjectID(PROJECT),
      });
    }

    expect(turn.sendHandlers).toHaveLength(1);
    expect(turn.updateHandlers).toHaveLength(1);
  });

  test("a turn that cannot be hooked into - a test's stand-in - is left as it is", () => {
    for (const turnContext of [
      {},
      { sendActivity: jest.fn() },
      { turnState: new Map<unknown, unknown>() },
    ]) {
      expect(() => {
        MicrosoftTeamsCardProject.drawCardsFor({
          turnContext: turnContext as unknown as TurnContext,
          projectId: new ObjectID(PROJECT),
        });
      }).not.toThrow();
    }
  });
});
