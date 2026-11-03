import { describe, expect, jest, test } from "@jest/globals";
import MicrosoftTeamsUtil, {
  MICROSOFT_TEAMS_MENU_INPUT_ID,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import MicrosoftTeamsHome, {
  MICROSOFT_TEAMS_HOME_ACTIONS,
  MicrosoftTeamsHomeActionType,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsHome";
import WorkspaceHome, {
  WorkspaceHomeView,
} from "../../../../../Server/Utils/Workspace/WorkspaceHome";
import { WorkspaceProjectChoice } from "../../../../../Server/Utils/Workspace/WorkspaceProjectResolution";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
  WorkspacePayloadMenu,
  WorkspacePayloadMenuOption,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceOpenRecordKind from "../../../../../Types/Workspace/WorkspaceOpenRecordKind";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";

/*
 * THE SWITCH PROJECT MENU OF THE MICROSOFT TEAMS HOME, AS A CARD DRAWS IT.
 *
 * The Home of somebody in two or more of an organization's projects has a
 * Switch project menu under the line that names the project (the same
 * WorkspacePayloadMenu Slack draws as a select beside it). A card's dropdown
 * cannot act by itself, so Teams draws:
 *
 *   - one other project: one button, "Switch to IRM Non-Prod", whose data
 *     names it;
 *   - more: a dropdown of them (checked before it is sent) and a Switch
 *     button beside it, which sends the option chosen as the press's
 *     actionValue - while the Home's own buttons neither check nor send it.
 *
 * These pin the card, within what a button shows, and what a press of it
 * sends.
 */

jest.mock("../../../../../Server/Utils/Logger");

const PLATFORM: ObjectID = new ObjectID("f7000000-0000-4000-8000-000000000001");
const NONPRD: ObjectID = new ObjectID("f7000000-0000-4000-8000-000000000002");
const SANDBOX: ObjectID = new ObjectID("f7000000-0000-4000-8000-000000000003");

const CHOICES: Array<WorkspaceProjectChoice> = [
  { projectId: PLATFORM, name: "IRM Platform" },
  { projectId: NONPRD, name: "IRM Non-Prod" },
  { projectId: SANDBOX, name: "IRM Sandbox" },
];

function menuOf(
  options: Array<WorkspacePayloadMenuOption>,
  extra: Partial<WorkspacePayloadMenu> = {},
): WorkspacePayloadMenu {
  return {
    actionId: MicrosoftTeamsHomeActionType.SwitchProject,
    placeholder: "Switch project",
    options: options,
    submitTitle: "Switch",
    requiredMessage: "Choose a project to switch to.",
    ...extra,
  };
}

function line(menu?: WorkspacePayloadMenu): WorkspacePayloadMarkdown {
  const block: WorkspacePayloadMarkdown = {
    _type: "WorkspacePayloadMarkdown",
    text: "Here's what is happening in **IRM Platform**.",
  };

  if (menu) {
    block.menu = menu;
  }

  return block;
}

function cardOf(blocks: Array<WorkspaceMessageBlock>): JSONObject {
  return MicrosoftTeamsUtil.buildAdaptiveCardFromMessageBlocks({
    messageBlocks: blocks,
  });
}

function view(projectName: string | null = "IRM Platform"): WorkspaceHomeView {
  return {
    projectName: projectName,
    firstName: "Deane",
    onCall: { now: [], next: null, isNowCut: false },
    incidents: {
      kind: WorkspaceOpenRecordKind.Incidents,
      list: {
        kind: WorkspaceOpenRecordKind.Incidents,
        records: [],
        isCut: false,
        listLink: null,
      },
      refused: false,
      failed: false,
    },
    alerts: {
      kind: WorkspaceOpenRecordKind.Alerts,
      list: {
        kind: WorkspaceOpenRecordKind.Alerts,
        records: [],
        isCut: false,
        listLink: null,
      },
      refused: false,
      failed: false,
    },
    dashboardLink: null,
    readAt: new Date("2026-11-03T09:00:00.000Z"),
  };
}

describe("the menu the Teams Home builds", () => {
  test("the person's projects other than the one shown, in the order they were connected, acting as the Home's Switch", () => {
    expect(
      MicrosoftTeamsHome.getProjectMenu({
        shownProjectId: NONPRD,
        choices: CHOICES,
      }),
    ).toEqual({
      actionId: "home-switch-project",
      placeholder: "Switch project",
      options: [
        { label: "IRM Platform", value: PLATFORM.toString() },
        { label: "IRM Sandbox", value: SANDBOX.toString() },
      ],
      submitTitle: "Switch",
      requiredMessage: "Choose a project to switch to.",
    });
  });

  test("its button is no button of the Home's actions: it is read before any project is", () => {
    expect(Object.values(MICROSOFT_TEAMS_HOME_ACTIONS)).not.toContain(
      MicrosoftTeamsHomeActionType.SwitchProject,
    );
    expect(
      MicrosoftTeamsHome.isSwitchProjectAction("home-switch-project"),
    ).toBe(true);
    expect(MicrosoftTeamsHome.isSwitchProjectAction("home-refresh")).toBe(
      false,
    );
    expect(MicrosoftTeamsHome.isSwitchProjectAction(undefined)).toBe(false);
  });

  test("no menu with no other project, or for a project that is not one of theirs", () => {
    expect(
      MicrosoftTeamsHome.getProjectMenu({
        shownProjectId: PLATFORM,
        choices: [CHOICES[0]!],
      }),
    ).toBeNull();
    expect(
      MicrosoftTeamsHome.getProjectMenu({
        shownProjectId: ObjectID.generate(),
        choices: CHOICES,
      }),
    ).toBeNull();
  });
});

describe("one other project: one button that names it", () => {
  test("under the line, as close as a row's buttons are: 'Switch to IRM Non-Prod', its data naming the project", () => {
    const body: Array<JSONObject> = cardOf([
      line(menuOf([{ label: "IRM Non-Prod", value: NONPRD.toString() }])),
    ])["body"] as Array<JSONObject>;

    expect(body).toHaveLength(2);
    expect(body[1]).toEqual({
      type: "ActionSet",
      spacing: "Small",
      actions: [
        {
          type: "Action.Submit",
          title: "Switch to IRM Non-Prod",
          data: {
            action: "home-switch-project",
            actionValue: NONPRD.toString(),
          },
        },
      ],
    });
  });

  test("no dropdown on the card, so its own buttons are left as they were drawn", () => {
    const card: JSONObject = cardOf([
      line(menuOf([{ label: "IRM Non-Prod", value: NONPRD.toString() }])),
      {
        _type: "WorkspacePayloadButtons",
        buttons: [
          {
            _type: "WorkspaceMessagePayloadButton",
            title: "Refresh",
            value: "",
            actionId: "home-refresh",
          },
        ],
      } as WorkspaceMessageBlock,
    ]);

    expect(JSON.stringify(card)).not.toContain("Input.ChoiceSet");
    expect(
      (card["actions"] as Array<JSONObject>)[0]!["associatedInputs"],
    ).toBeUndefined();
  });

  test("a menu with no submit title of its own names its placeholder on the button", () => {
    const body: Array<JSONObject> = cardOf([
      line(
        menuOf([{ label: "IRM Non-Prod", value: NONPRD.toString() }], {
          submitTitle: undefined,
        }),
      ),
    ])["body"] as Array<JSONObject>;

    expect(
      ((body[1]!["actions"] as Array<JSONObject>)[0] as JSONObject)["title"],
    ).toBe("Switch project to IRM Non-Prod");
  });
});

describe("more: a dropdown, and a Switch button that sends the option chosen", () => {
  const MENU: WorkspacePayloadMenu = menuOf([
    { label: "IRM Non-Prod", value: NONPRD.toString() },
    { label: "IRM Sandbox", value: SANDBOX.toString() },
  ]);

  test("the dropdown and its button side by side under the line, the dropdown checked before it is sent", () => {
    const body: Array<JSONObject> = cardOf([line(MENU)])[
      "body"
    ] as Array<JSONObject>;

    expect(body).toHaveLength(2);
    expect(body[1]).toEqual({
      type: "ColumnSet",
      spacing: "Small",
      columns: [
        {
          type: "Column",
          width: "stretch",
          verticalContentAlignment: "Center",
          items: [
            {
              type: "Input.ChoiceSet",
              id: MICROSOFT_TEAMS_MENU_INPUT_ID,
              style: "compact",
              placeholder: "Switch project",
              isRequired: true,
              errorMessage: "Choose a project to switch to.",
              choices: [
                { title: "IRM Non-Prod", value: NONPRD.toString() },
                { title: "IRM Sandbox", value: SANDBOX.toString() },
              ],
            },
          ],
        },
        {
          type: "Column",
          width: "auto",
          verticalContentAlignment: "Center",
          items: [
            {
              type: "ActionSet",
              actions: [
                {
                  type: "Action.Submit",
                  title: "Switch",
                  data: { action: "home-switch-project" },
                },
              ],
            },
          ],
        },
      ],
    });
  });

  test("the option chosen arrives as the press's actionValue: the dropdown's id, which the button's own data leaves free", () => {
    expect(MICROSOFT_TEAMS_MENU_INPUT_ID).toBe("actionValue");

    const button: JSONObject = (
      (
        (
          (cardOf([line(MENU)])["body"] as Array<JSONObject>)[1]![
            "columns"
          ] as Array<JSONObject>
        )[1]!["items"] as Array<JSONObject>
      )[0]!["actions"] as Array<JSONObject>
    )[0]!;

    expect(Object.keys(button["data"] as JSONObject)).toEqual(["action"]);
  });

  test("the card's own buttons neither check nor send the dropdown - the Home's Declare incident is never stopped by it", () => {
    const card: JSONObject = MicrosoftTeamsHome.getCard(
      WorkspaceHome.getBlocks({
        workspaceType: WorkspaceType.MicrosoftTeams,
        view: view(),
        actions: MICROSOFT_TEAMS_HOME_ACTIONS,
        projectMenu: MENU,
      }),
    );

    const actions: Array<JSONObject> = card["actions"] as Array<JSONObject>;

    expect(
      actions.map((action: JSONObject): unknown => {
        return [
          (action["data"] as JSONObject)["action"],
          action["associatedInputs"],
        ];
      }),
    ).toEqual([
      ["home-declare-incident", "none"],
      ["home-page-someone", "none"],
      ["home-who-is-on-call", "none"],
      ["home-refresh", "none"],
    ]);
  });

  test("links among the card's actions are left as they are: only a submit sends inputs", () => {
    const card: JSONObject = cardOf([
      line(MENU),
      {
        _type: "WorkspacePayloadButtons",
        buttons: [
          {
            _type: "WorkspaceMessagePayloadButton",
            title: "Open OneUptime",
            value: "",
            actionId: "open",
            url: {
              toString: (): string => {
                return "https://oneuptime.test";
              },
            },
          },
        ],
      } as unknown as WorkspaceMessageBlock,
    ]);

    expect((card["actions"] as Array<JSONObject>)[0]).toEqual({
      type: "Action.OpenUrl",
      title: "Open OneUptime",
      url: "https://oneuptime.test",
    });
  });
});

describe("what a card's menu lists", () => {
  function choicesOf(menu: WorkspacePayloadMenu): Array<JSONObject> {
    const body: Array<JSONObject> = cardOf([line(menu)])[
      "body"
    ] as Array<JSONObject>;
    const dropdown: JSONObject = (
      (body[1]!["columns"] as Array<JSONObject>)[0]![
        "items"
      ] as Array<JSONObject>
    )[0]!;

    return dropdown["choices"] as Array<JSONObject>;
  }

  test("a long name is cut to what a button shows, with '…', never between the halves of an emoji", () => {
    const longName: string = `IRM ${"Payments and Settlement ".repeat(5)}`;
    const emojiName: string = `${"x".repeat(73)}🚀 Platform`;

    const titles: Array<string> = choicesOf(
      menuOf([
        { label: longName, value: NONPRD.toString() },
        { label: emojiName, value: SANDBOX.toString() },
      ]),
    ).map((choice: JSONObject): string => {
      return String(choice["title"]);
    });

    expect(titles[0]!.length).toBe(75);
    expect(titles[0]!.endsWith("…")).toBe(true);
    expect(longName.startsWith(titles[0]!.slice(0, -1).trimEnd())).toBe(true);
    // No lone half of the rocket: the cut falls before it.
    expect(titles[1]).toBe(`${"x".repeat(73)}…`);

    const button: JSONObject = (
      (
        cardOf([line(menuOf([{ label: longName, value: NONPRD.toString() }]))])[
          "body"
        ] as Array<JSONObject>
      )[1]!["actions"] as Array<JSONObject>
    )[0]!;

    expect(button["title"]).toBe(`Switch to ${titles[0]}`);
  });

  test("a name over several lines is one line", () => {
    expect(
      choicesOf(
        menuOf([
          { label: "IRM\n  Non-Prod", value: NONPRD.toString() },
          { label: "IRM Sandbox", value: SANDBOX.toString() },
        ]),
      )[0]!["title"],
    ).toBe("IRM Non-Prod");
  });

  test("an option with no name or no value is left out, and a menu left with none draws nothing", () => {
    expect(
      choicesOf(
        menuOf([
          { label: "  ", value: NONPRD.toString() },
          { label: "IRM Platform", value: "" },
          { label: "IRM Sandbox", value: SANDBOX.toString() },
          { label: "IRM Non-Prod", value: NONPRD.toString() },
        ]),
      ),
    ).toEqual([
      { title: "IRM Sandbox", value: SANDBOX.toString() },
      { title: "IRM Non-Prod", value: NONPRD.toString() },
    ]);

    expect(
      MicrosoftTeamsUtil.getMenuElements(
        menuOf([{ label: " ", value: NONPRD.toString() }]),
      ),
    ).toEqual([]);
    expect(
      MicrosoftTeamsUtil.getMenuElements(
        menuOf([{ label: "IRM Platform", value: PLATFORM.toString() }], {
          actionId: "",
        }),
      ),
    ).toEqual([]);
    // The line itself still stands.
    expect(
      cardOf([line(menuOf([{ label: " ", value: NONPRD.toString() }]))])[
        "body"
      ],
    ).toEqual(cardOf([line()])["body"]);
  });

  test("a hundred options at most", () => {
    const options: Array<WorkspacePayloadMenuOption> = Array.from(
      { length: 120 },
      (_value: unknown, index: number): WorkspacePayloadMenuOption => {
        return {
          label: `Project ${index}`,
          value: ObjectID.generate().toString(),
        };
      },
    );

    expect(choicesOf(menuOf(options))).toHaveLength(100);
  });

  test("names are plain text in a choice's title: Markdown in a name is never read", () => {
    expect(
      choicesOf(
        menuOf([
          { label: "**Prod** [x](https://x.test)", value: NONPRD.toString() },
          { label: "IRM Sandbox", value: SANDBOX.toString() },
        ]),
      )[0]!["title"],
    ).toBe("**Prod** [x](https://x.test)");
  });
});

describe("the Home cards the menu goes on", () => {
  const MENU: WorkspacePayloadMenu = MicrosoftTeamsHome.getProjectMenu({
    shownProjectId: PLATFORM,
    choices: CHOICES,
  })!;

  test("the Home: right under the line that names the project, before the shifts and the lists", () => {
    const body: Array<JSONObject> = MicrosoftTeamsHome.getCard(
      WorkspaceHome.getBlocks({
        workspaceType: WorkspaceType.MicrosoftTeams,
        view: view(),
        actions: MICROSOFT_TEAMS_HOME_ACTIONS,
        projectMenu: MENU,
      }),
    )["body"] as Array<JSONObject>;

    const lineAt: number = body.findIndex((element: JSONObject): boolean => {
      return (
        element["text"] === "Here's what is happening in **IRM Platform**."
      );
    });

    expect(lineAt).toBe(1);
    expect(body[lineAt + 1]!["type"]).toBe("ColumnSet");
    expect(body[lineAt + 2]!["text"]).toBe(
      WorkspaceHome.ON_CALL_TITLE.toString(),
    );
  });

  test("a refused Home: the project's line, why, then the menu - and nothing else", () => {
    const body: Array<JSONObject> = MicrosoftTeamsHome.getCard(
      WorkspaceHome.getRefusedBlocks({
        message:
          "This project has been blocked. Please contact your administrator.",
        firstName: "Deane",
        projectName: "IRM Platform",
        projectMenu: MENU,
        workspaceType: WorkspaceType.MicrosoftTeams,
      }),
    )["body"] as Array<JSONObject>;

    expect(
      body.map((element: JSONObject): unknown => {
        return element["type"] === "TextBlock"
          ? element["text"]
          : element["type"];
      }),
    ).toEqual([
      "👋 Hi Deane",
      "Here's what is happening in **IRM Platform**.",
      "This project has been blocked. Please contact your administrator.",
      "ColumnSet",
    ]);
  });
});
