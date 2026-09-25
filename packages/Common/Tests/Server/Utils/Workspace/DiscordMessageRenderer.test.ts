import DiscordMessageRenderer from "../../../../Server/Utils/Workspace/Discord/DiscordMessageRenderer";
import { JSONObject } from "../../../../Types/JSON";
import {
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";

describe("Discord message rendering", () => {
  test("keeps long descriptions without exceeding content limits or enabling mentions", () => {
    const text: string = "@everyone <@123456789012345678> " + "🦊".repeat(3000);
    const messages: Array<JSONObject> = DiscordMessageRenderer.render({
      messageBlocks: [{ _type: "WorkspacePayloadMarkdown", text } as any],
    });
    expect(
      messages
        .map((message: JSONObject): string => {
          return message["content"] as string;
        })
        .join(""),
    ).toBe(text);
    for (const message of messages) {
      expect((message["content"] as string).length).toBeLessThanOrEqual(2000);
      expect(message["allowed_mentions"]).toEqual({
        parse: [],
        replied_user: false,
      });
      expect(message["content"]).not.toContain("�");
    }
  });

  test("splits buttons into five-button rows and five-row messages", () => {
    const buttons: Array<WorkspaceMessagePayloadButton> = Array.from(
      { length: 26 },
      (_: unknown, index: number): WorkspaceMessagePayloadButton => {
        return {
          _type: "WorkspaceMessagePayloadButton",
          title: "Acknowledge",
          actionId: "AcknowledgeIncident",
          value: String(index),
        };
      },
    );
    const messages: Array<JSONObject> = DiscordMessageRenderer.render({
      messageBlocks: [
        {
          _type: "WorkspacePayloadButtons",
          buttons,
        } as WorkspacePayloadButtons,
      ],
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]!["components"]).toHaveLength(5);
    expect(
      (messages[1]!["components"] as Array<JSONObject>)[0]!["components"],
    ).toHaveLength(1);
  });

  test("rejects overlong action IDs rather than truncating their identity", () => {
    expect((): void => {
      DiscordMessageRenderer.render({
        messageBlocks: [
          {
            _type: "WorkspacePayloadButtons",
            buttons: [
              { title: "Action", actionId: "x".repeat(101), value: "1" },
            ],
          } as WorkspacePayloadButtons,
        ],
      });
    }).toThrow("1–100");
  });

  test("rejects unsupported and empty payloads rather than reporting delivery", () => {
    expect((): unknown => {
      return DiscordMessageRenderer.render({ messageBlocks: [] });
    }).toThrow("empty");
    expect((): unknown => {
      return DiscordMessageRenderer.render({
        messageBlocks: [{ _type: "WorkspaceModalBlock" }],
      });
    }).toThrow("Unsupported");
  });
});
