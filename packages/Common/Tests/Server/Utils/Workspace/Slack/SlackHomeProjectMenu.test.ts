import { describe, expect, jest, test } from "@jest/globals";
import MicrosoftTeamsUtil from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackActionType from "../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import SlackHome, {
  SLACK_HOME_PROJECT_MENU,
} from "../../../../../Server/Utils/Workspace/Slack/SlackHome";
import { WorkspaceProjectChoice } from "../../../../../Server/Utils/Workspace/WorkspaceProjectResolution";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspacePayloadMarkdown,
  WorkspacePayloadMenu,
  WorkspacePayloadMenuOption,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";

/*
 * THE SWITCH PROJECT MENU OF THE SLACK HOME, AS SLACK IS SENT IT.
 *
 * Somebody connected as a member in two or more of the projects a Slack
 * workspace is connected to sees one project on the app's Home tab, with a
 * Switch project menu of their others beside the line that names it
 * (SlackHome). These pin the menu the Home builds - the other projects, by
 * name, in the order the projects were connected - the static select Slack
 * is sent for it, within what Slack takes, and what a press of it names,
 * which decides nothing by itself.
 */

jest.mock("../../../../../Server/Utils/Logger");

const PRODUCTION: ObjectID = new ObjectID(
  "f3000000-0000-4000-8000-000000000001",
);
const STAGING: ObjectID = new ObjectID("f3000000-0000-4000-8000-000000000002");
const SANDBOX: ObjectID = new ObjectID("f3000000-0000-4000-8000-000000000003");

const CHOICES: Array<WorkspaceProjectChoice> = [
  { projectId: PRODUCTION, name: "Acme Production" },
  { projectId: STAGING, name: "Acme Staging" },
  { projectId: SANDBOX, name: "Acme Sandbox" },
];

// Slack's Markdown sets bold apart with zero-width spaces.
function withoutZeroWidthSpaces(value: string): string {
  return value.split(String.fromCharCode(0x200b)).join("");
}

function menuOf(
  options: Array<WorkspacePayloadMenuOption>,
  extra: Partial<WorkspacePayloadMenu> = {},
): WorkspacePayloadMenu {
  return {
    actionId: SlackActionType.SwitchHomeProject,
    placeholder: SLACK_HOME_PROJECT_MENU.placeholder,
    options: options,
    ...extra,
  };
}

function line(menu?: WorkspacePayloadMenu): WorkspacePayloadMarkdown {
  const block: WorkspacePayloadMarkdown = {
    _type: "WorkspacePayloadMarkdown",
    text: "Here's what is happening in **Acme Production**.",
  };

  if (menu) {
    block.menu = menu;
  }

  return block;
}

function sectionsOf(block: WorkspacePayloadMarkdown): Array<JSONObject> {
  return SlackUtil.getBlocksFromWorkspaceMessagePayload({
    messageBlocks: [block],
  });
}

/*
 * What a menu's block id is made of: the menu's action, the project the
 * Home shows, and a name for this drawing of it (eight hex digits).
 */
function blockIdParts(blockId: string | undefined): {
  actionId: string;
  projectId: string;
  isDrawingNamed: boolean;
} {
  const parts: Array<string> = (blockId || "").split(":");
  const drawing: string = parts[2] || "";

  return {
    actionId: parts[0] || "",
    projectId: parts[1] || "",
    isDrawingNamed:
      parts.length === 3 &&
      drawing.length === 8 &&
      drawing.split("").every((character: string): boolean => {
        return "0123456789abcdef".includes(character);
      }),
  };
}

function optionTexts(section: JSONObject): Array<string> {
  return (
    (section["accessory"] as JSONObject)["options"] as Array<JSONObject>
  ).map((option: JSONObject): string => {
    return String((option["text"] as JSONObject)["text"]);
  });
}

describe("the menu the Home builds", () => {
  test("the person's projects other than the one shown, by name, in the order they were connected - each option's value its project's id", () => {
    const menu: WorkspacePayloadMenu | null = SlackHome.getProjectMenu({
      shownProjectId: STAGING,
      choices: CHOICES,
    });

    expect(menu).toEqual({
      actionId: SlackActionType.SwitchHomeProject,
      placeholder: "Switch project",
      options: [
        { label: "Acme Production", value: PRODUCTION.toString() },
        { label: "Acme Sandbox", value: SANDBOX.toString() },
      ],
      blockId: expect.any(String),
    });
    // The menu's block: named for the project shown, and for this drawing.
    expect(blockIdParts(menu!.blockId)).toEqual({
      actionId: "SwitchHomeProject",
      projectId: STAGING.toString(),
      isDrawingNamed: true,
    });
  });

  test("the first project shown: the others after it", () => {
    expect(
      SlackHome.getProjectMenu({
        shownProjectId: PRODUCTION,
        choices: CHOICES,
      })!.options.map((option: WorkspacePayloadMenuOption): string => {
        return option.label;
      }),
    ).toEqual(["Acme Staging", "Acme Sandbox"]);
  });

  test("one project: no menu - nobody with one project sees anything new", () => {
    expect(
      SlackHome.getProjectMenu({
        shownProjectId: PRODUCTION,
        choices: [CHOICES[0]!],
      }),
    ).toBeNull();
    expect(
      SlackHome.getProjectMenu({ shownProjectId: PRODUCTION, choices: [] }),
    ).toBeNull();
  });

  test("a Home of a project that is not one of the person's own: no menu", () => {
    expect(
      SlackHome.getProjectMenu({
        shownProjectId: ObjectID.generate(),
        choices: CHOICES,
      }),
    ).toBeNull();
  });

  test("an id written in capitals is the same project", () => {
    expect(
      SlackHome.getProjectMenu({
        shownProjectId: new ObjectID(STAGING.toString().toUpperCase()),
        choices: CHOICES,
      })!.options,
    ).toHaveLength(2);
  });

  test("each project's Home names its menu apart, so Slack keeps nothing chosen in another's", () => {
    expect(
      SlackHome.getProjectMenu({
        shownProjectId: PRODUCTION,
        choices: CHOICES,
      })!.blockId,
    ).not.toBe(
      SlackHome.getProjectMenu({ shownProjectId: STAGING, choices: CHOICES })!
        .blockId,
    );
  });

  /*
   * A switch the person may not make draws their Home again for the same
   * project: a menu named as before could go on showing the option they
   * chose, beside a line that names another project. Each drawing names
   * the menu afresh, so it always opens on "Switch project".
   */
  test("each drawing of the same project's Home names its menu afresh, so it always opens on Switch project", () => {
    const blockIds: Set<string> = new Set<string>();

    for (let drawing: number = 0; drawing < 20; drawing++) {
      const blockId: string = SlackHome.getProjectMenu({
        shownProjectId: PRODUCTION,
        choices: CHOICES,
      })!.blockId!;

      expect(blockIdParts(blockId)).toEqual({
        actionId: "SwitchHomeProject",
        projectId: PRODUCTION.toString(),
        isDrawingNamed: true,
      });
      // Within what Slack takes for a block's id.
      expect(blockId.length).toBeLessThanOrEqual(255);
      blockIds.add(blockId);
    }

    expect(blockIds.size).toBe(20);
  });
});

describe("the static select Slack is sent", () => {
  test("beside the line: the section's accessory, with its placeholder and an option per project", () => {
    const sections: Array<JSONObject> = sectionsOf(
      line(
        menuOf(
          [
            { label: "Acme Staging", value: STAGING.toString() },
            { label: "Acme Sandbox", value: SANDBOX.toString() },
          ],
          { blockId: `SwitchHomeProject:${PRODUCTION.toString()}` },
        ),
      ),
    );

    expect(sections).toHaveLength(1);
    expect(sections[0]!["type"]).toBe("section");
    expect(
      withoutZeroWidthSpaces(
        String((sections[0]!["text"] as JSONObject)["text"]),
      ),
    ).toContain("Here's what is happening in *Acme Production*.");
    expect(sections[0]!["block_id"]).toBe(
      `SwitchHomeProject:${PRODUCTION.toString()}`,
    );
    expect(sections[0]!["accessory"]).toEqual({
      type: "static_select",
      action_id: "SwitchHomeProject",
      placeholder: {
        type: "plain_text",
        text: "Switch project",
        emoji: true,
      },
      options: [
        {
          text: { type: "plain_text", text: "Acme Staging", emoji: true },
          value: STAGING.toString(),
        },
        {
          text: { type: "plain_text", text: "Acme Sandbox", emoji: true },
          value: SANDBOX.toString(),
        },
      ],
    });
  });

  test("a line with no menu is sent exactly as before: no accessory, no block id", () => {
    const sections: Array<JSONObject> = sectionsOf(line());

    expect(Object.keys(sections[0]!).sort()).toEqual(["text", "type"]);
  });

  test.each([
    // The cut falls between two emoji, and inside one.
    ["between two emoji", ""],
    ["inside an emoji", "x"],
  ])(
    "a name longer than an option holds is cut to 75 characters, ending with an ellipsis - never between the halves of an emoji (%s)",
    (_name: string, shift: string) => {
      const longName: string = `${"Acme ".repeat(14)}${shift}🚀🚀🚀🚀 Production`;

      const sections: Array<JSONObject> = sectionsOf(
        line(menuOf([{ label: longName, value: STAGING.toString() }])),
      );
      const text: string = optionTexts(sections[0]!)[0]!;

      expect(text.length).toBeLessThanOrEqual(75);
      expect(text.length).toBeGreaterThanOrEqual(73);
      expect(text.endsWith("…")).toBe(true);
      expect(longName.startsWith(text.slice(0, -1).trimEnd())).toBe(true);

      // Every emoji whole: no lone half of a surrogate pair.
      for (let index: number = 0; index < text.length; index++) {
        const code: number = text.charCodeAt(index);

        if (code >= 0xd800 && code <= 0xdbff) {
          const next: number = text.charCodeAt(index + 1);
          expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
          index++;
        } else {
          expect(code >= 0xdc00 && code <= 0xdfff).toBe(false);
        }
      }
    },
  );

  test("a name as long as an option holds is not cut", () => {
    const name: string = "A".repeat(75);

    expect(
      optionTexts(
        sectionsOf(
          line(menuOf([{ label: name, value: STAGING.toString() }])),
        )[0]!,
      ),
    ).toEqual([name]);
  });

  test("a name is plain text: Markdown, a link or a mention in it is shown as written", () => {
    const name: string = "*Prod* <!channel> [x](https://evil.example)";

    expect(
      optionTexts(
        sectionsOf(
          line(menuOf([{ label: name, value: STAGING.toString() }])),
        )[0]!,
      ),
    ).toEqual([name]);
  });

  test("at most the 100 options a static select takes, in order", () => {
    const options: Array<WorkspacePayloadMenuOption> = Array.from(
      { length: 130 },
      (_value: unknown, index: number): WorkspacePayloadMenuOption => {
        return {
          label: `Project ${index}`,
          value: ObjectID.generate().toString(),
        };
      },
    );

    const texts: Array<string> = optionTexts(
      sectionsOf(line(menuOf(options)))[0]!,
    );

    expect(texts).toHaveLength(SlackUtil.MAX_MENU_OPTIONS);
    expect(SlackUtil.MAX_MENU_OPTIONS).toBe(100);
    expect(texts[0]).toBe("Project 0");
    expect(texts[99]).toBe("Project 99");
  });

  test("an option Slack would refuse - no name, no value, a value over 150 characters - is left out", () => {
    const texts: Array<string> = optionTexts(
      sectionsOf(
        line(
          menuOf([
            { label: "  ", value: STAGING.toString() },
            { label: "No value", value: "" },
            { label: "Too long", value: "x".repeat(151) },
            { label: "Acme Sandbox", value: SANDBOX.toString() },
          ]),
        ),
      )[0]!,
    );

    expect(texts).toEqual(["Acme Sandbox"]);
  });

  test("a menu with nothing left to list is not drawn: the line stands on its own", () => {
    const sections: Array<JSONObject> = sectionsOf(
      line(menuOf([{ label: "", value: STAGING.toString() }])),
    );

    expect(sections[0]!["accessory"]).toBeUndefined();
    expect(sections[0]!["block_id"]).toBeUndefined();
  });

  test("a block id longer than Slack takes is left out, the menu kept", () => {
    const sections: Array<JSONObject> = sectionsOf(
      line(
        menuOf([{ label: "Acme Staging", value: STAGING.toString() }], {
          blockId: "b".repeat(256),
        }),
      ),
    );

    expect(sections[0]!["block_id"]).toBeUndefined();
    expect(sections[0]!["accessory"]).toBeDefined();
  });

  test("text long enough for several sections: the menu beside the first", () => {
    const block: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: Array.from({ length: 4 }, (_value: unknown, index: number) => {
        return `Paragraph ${index} ${"word ".repeat(300)}`;
      }).join("\n\n"),
      menu: menuOf([{ label: "Acme Staging", value: STAGING.toString() }]),
    };

    const sections: Array<JSONObject> = sectionsOf(block);

    expect(sections.length).toBeGreaterThan(1);
    expect(sections[0]!["accessory"]).toBeDefined();

    for (const section of sections.slice(1)) {
      expect(section["accessory"]).toBeUndefined();
    }
  });

  test("Microsoft Teams draws the line alone: no menu is drawn there, and nothing is lost of the line", () => {
    const card: JSONObject =
      MicrosoftTeamsUtil.buildAdaptiveCardFromMessageBlocks({
        messageBlocks: [
          line(menuOf([{ label: "Acme Staging", value: STAGING.toString() }])),
        ],
      });

    const withoutMenu: JSONObject =
      MicrosoftTeamsUtil.buildAdaptiveCardFromMessageBlocks({
        messageBlocks: [line()],
      });

    expect(card).toEqual(withoutMenu);
    expect(JSON.stringify(card)).not.toContain("Acme Staging");
    expect(JSON.stringify(card)).not.toContain("SwitchHomeProject");
  });
});

describe("what a press of the menu names", () => {
  function press(actions: unknown): JSONObject {
    return {
      type: "block_actions",
      user: { id: "U0ALICE" },
      team: { id: "T0ACME" },
      view: { type: "home", private_metadata: "" },
      actions: actions,
    } as JSONObject;
  }

  function chosen(value: unknown): JSONObject {
    // Any value a press may carry, as Slack would post it.
    const action: Record<string, unknown> = {
      type: "static_select",
      action_id: "SwitchHomeProject",
      block_id: `SwitchHomeProject:${PRODUCTION.toString()}`,
      selected_option: {
        text: { type: "plain_text", text: "Acme Staging" },
        value: value,
      },
      action_ts: "1760000001.000300",
    };

    return action as JSONObject;
  }

  test("the project its chosen option names", () => {
    expect(
      SlackHome.readProjectSwitch(
        press([chosen(STAGING.toString())]),
      )?.toString(),
    ).toBe(STAGING.toString());
  });

  test("found among the other actions of the press", () => {
    expect(
      SlackHome.readProjectSwitch(
        press([
          { action_id: "ShowOnCall", type: "button" },
          "not an action",
          chosen(SANDBOX.toString()),
        ]),
      )?.toString(),
    ).toBe(SANDBOX.toString());
  });

  test.each([
    ["a value that is not a project's id", [chosen("not-a-project")]],
    ["an empty value", [chosen("")]],
    ["a value that is not text", [chosen(42)]],
    ["a value that is an object", [chosen({ projectId: STAGING.toString() })]],
    [
      "no option chosen",
      [{ type: "static_select", action_id: "SwitchHomeProject" }],
    ],
    [
      "an option that is not an object",
      [
        {
          type: "static_select",
          action_id: "SwitchHomeProject",
          selected_option: STAGING.toString(),
        },
      ],
    ],
    [
      "another menu's option",
      [
        {
          type: "static_select",
          action_id: "SomethingElse",
          selected_option: { value: STAGING.toString() },
        },
      ],
    ],
    ["no actions", []],
    ["actions that are not a list", { action_id: "SwitchHomeProject" }],
  ])("nothing for %s", (_name: string, actions: unknown) => {
    expect(SlackHome.readProjectSwitch(press(actions))).toBeNull();
  });

  test("nothing for no press at all", () => {
    expect(SlackHome.readProjectSwitch(undefined)).toBeNull();
  });
});
