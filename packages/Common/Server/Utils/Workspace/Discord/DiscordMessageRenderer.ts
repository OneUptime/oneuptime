import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadButtons,
  WorkspacePayloadHeader,
  WorkspacePayloadImage,
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";

/** Render shared workspace blocks into Discord's legacy message components. */
export default class DiscordMessageRenderer {
  public static render(data: {
    messageBlocks: Array<WorkspaceMessageBlock>;
  }): Array<JSONObject> {
    const messages: Array<JSONObject> = [];
    const highSurrogate: RegExp = /[\uD800-\uDBFF]/;
    let current: JSONObject = this.emptyMessage();
    let actionIds: Set<string> = new Set<string>();

    const flush: () => void = (): void => {
      if (
        current["content"] ||
        (current["components"] as Array<JSONObject>).length ||
        (current["embeds"] as Array<JSONObject>).length
      ) {
        messages.push(current);
        current = this.emptyMessage();
        actionIds = new Set<string>();
      }
    };

    const addText: (text: string) => void = (text: string): void => {
      /*
       * Split rather than discard an incident description. Avoid splitting a
       * surrogate pair, which otherwise replaces emoji with invalid text.
       */
      let remaining: string = text;
      while (remaining) {
        const prefix: string = current["content"] ? "\n\n" : "";
        const available: number =
          2000 - String(current["content"] || "").length - prefix.length;
        if (available <= 0) {
          flush();
          continue;
        }
        let take: number = Math.min(available, remaining.length);
        if (
          take < remaining.length &&
          highSurrogate.test(remaining.charAt(take - 1))
        ) {
          take--;
        }
        if (!take) {
          flush();
          continue;
        }
        current["content"] =
          String(current["content"] || "") + prefix + remaining.slice(0, take);
        remaining = remaining.slice(take);
        if (remaining) {
          flush();
        }
      }
    };

    for (const block of data.messageBlocks) {
      switch (block._type) {
        case "WorkspacePayloadHeader":
          addText(`## ${(block as WorkspacePayloadHeader).text}`);
          break;
        case "WorkspacePayloadMarkdown":
          addText((block as WorkspacePayloadMarkdown).text);
          break;
        case "WorkspacePayloadDivider":
          addText("──────────");
          break;
        case "WorkspacePayloadImage": {
          const image: WorkspacePayloadImage = block as WorkspacePayloadImage;
          const embeds: Array<JSONObject> = current[
            "embeds"
          ] as Array<JSONObject>;
          if (embeds.length === 10) {
            flush();
          }
          (current["embeds"] as Array<JSONObject>).push({
            image: { url: image.imageUrl.toString() },
            // Embed descriptions collectively stay below the 6000-character cap.
            description: image.altText.slice(0, 500),
          });
          break;
        }
        case "WorkspacePayloadButtons": {
          for (const button of (block as WorkspacePayloadButtons).buttons) {
            let rows: Array<JSONObject> = current[
              "components"
            ] as Array<JSONObject>;
            let row: JSONObject | undefined = rows[rows.length - 1];
            if (!row || (row["components"] as Array<JSONObject>).length === 5) {
              if (rows.length === 5) {
                flush();
                rows = current["components"] as Array<JSONObject>;
              }
              row = { type: 1, components: [] };
              rows.push(row);
            }
            const rendered: JSONObject = {
              type: 2,
              style: button.url ? 5 : 1,
              label: button.title.slice(0, 80),
            };
            if (!button.title.trim()) {
              throw new BadDataException("Discord buttons require a label.");
            }
            if (button.url) {
              rendered["url"] = button.url.toString();
            } else {
              const customId: string = `${button.actionId}:${button.value}`;
              if (!button.actionId || customId.length > 100) {
                throw new BadDataException(
                  "Discord button action IDs must contain 1–100 characters.",
                );
              }
              if (actionIds.has(customId)) {
                throw new BadDataException(
                  "Discord button action IDs must be unique within a message.",
                );
              }
              actionIds.add(customId);
              rendered["custom_id"] = customId;
            }
            (row["components"] as Array<JSONObject>).push(rendered);
          }
          break;
        }
        default:
          throw new BadDataException(
            `Unsupported Discord message block: ${block._type}`,
          );
      }
    }
    flush();
    if (!messages.length) {
      throw new BadDataException("Cannot send an empty Discord message.");
    }
    return messages;
  }

  private static emptyMessage(): JSONObject {
    /*
     * Incident text is untrusted. Never turn @everyone, roles or copied user
     * mentions into notifications as a side effect of rendering it.
     */
    return {
      content: "",
      embeds: [],
      components: [],
      allowed_mentions: { parse: [], replied_user: false },
    };
  }
}
