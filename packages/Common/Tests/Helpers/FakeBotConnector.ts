import { expect } from "@jest/globals";
import http from "http";
import type { AddressInfo } from "net";
import MicrosoftTeamsUtil from "../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import { ExpressRequest, ExpressResponse } from "../../Server/Utils/Express";
import { JSONObject } from "../../Types/JSON";

/*
 * A FAKE MICROSOFT BOT CONNECTOR, FOR SUITES THAT RUN THE REAL BOTBUILDER.
 *
 * End-to-end suites of the Teams bot run what people type and press through
 * the real botbuilder stack (RealBotbuilder):
 *
 *   fake Express req -> MicrosoftTeamsUtil.processBotActivity
 *     -> real CloudAdapter -> real TeamsActivityHandler
 *     -> the bot's handlers -> real TurnContext (sends, updates, its hooks)
 *     -> real ConnectorClient -> HTTP -> this fake, on 127.0.0.1
 *
 * which records every activity the bot sends (POST), edits in place (PUT)
 * and removes (DELETE), and answers as the Bot Connector does: a new
 * message's id, "msg-<n>". Point an activity's serviceUrl at serviceUrl.
 */

const ACTIVITIES_PATH: RegExp =
  /^\/v3\/conversations\/([^/]+)\/activities(?:\/([^/]+))?$/;

export interface ConnectorCall {
  method: "POST" | "PUT" | "DELETE";
  conversationId: string;
  // A reply's activity, or the activity changed or removed.
  activityId: string | null;
  // The id the Bot Connector gave a new message.
  messageId: string | null;
  activity: JSONObject;
}

export interface FakeBotConnector {
  serviceUrl: string;
  calls: Array<ConnectorCall>;
  close: () => Promise<void>;
}

export async function startFakeBotConnector(): Promise<FakeBotConnector> {
  let messageNumber: number = 0;

  const fake: FakeBotConnector = {
    serviceUrl: "",
    calls: [],
    close: async (): Promise<void> => {
      return undefined;
    },
  };

  const server: http.Server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse) => {
      let bodyText: string = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => {
        bodyText += chunk;
      });
      req.on("end", () => {
        const path: string = (req.url || "/").split("?")[0] || "/";
        const match: RegExpExecArray | null = ACTIVITIES_PATH.exec(path);
        const method: string = req.method || "";

        if (
          !match ||
          (method !== "POST" && method !== "PUT" && method !== "DELETE")
        ) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { code: "NotFound" } }));
          return;
        }

        const messageId: string | null =
          method === "POST" ? `msg-${++messageNumber}` : null;

        fake.calls.push({
          method: method as ConnectorCall["method"],
          conversationId: decodeURIComponent(match[1] || ""),
          activityId: match[2] ? decodeURIComponent(match[2]) : null,
          messageId: messageId,
          activity: bodyText ? (JSON.parse(bodyText) as JSONObject) : {},
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: messageId || decodeURIComponent(match[2] || ""),
          }),
        );
      });
    },
  );

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  fake.serviceUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  fake.close = async (): Promise<void> => {
    server.closeAllConnections();
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  };

  return fake;
}

// What Teams gets back for the activity it posted.
class RecordingResponse {
  public statusCode: number | null = null;
  public headersSent: boolean = false;

  public status(code: number): this {
    this.statusCode = code;
    return this;
  }

  public send(): this {
    this.headersSent = true;
    return this;
  }

  public json(): this {
    this.headersSent = true;
    return this;
  }

  public end(): this {
    this.headersSent = true;
    return this;
  }

  public header(): this {
    return this;
  }

  public setHeader(): this {
    return this;
  }
}

export interface Delivery {
  httpStatus: number | null;
  calls: Array<ConnectorCall>;
}

// An activity, delivered as Teams posts it; what the bot sent for it.
export async function deliverToBot(
  connector: FakeBotConnector,
  activity: JSONObject,
): Promise<Delivery> {
  const first: number = connector.calls.length;
  const res: RecordingResponse = new RecordingResponse();

  await MicrosoftTeamsUtil.processBotActivity(
    {
      method: "POST",
      headers: {},
      body: JSON.parse(JSON.stringify(activity)),
    } as unknown as ExpressRequest,
    res as unknown as ExpressResponse,
  );

  return { httpStatus: res.statusCode, calls: connector.calls.slice(first) };
}

export function postsOf(delivery: Delivery): Array<ConnectorCall> {
  return delivery.calls.filter((call: ConnectorCall): boolean => {
    return call.method === "POST";
  });
}

// The Adaptive Card a call carries.
export function cardOf(call: ConnectorCall | undefined): JSONObject {
  const attachment: JSONObject | undefined = (
    call?.activity["attachments"] as Array<JSONObject> | undefined
  )?.[0];

  expect(attachment?.["contentType"]).toBe(
    "application/vnd.microsoft.card.adaptive",
  );

  return attachment!["content"] as JSONObject;
}

// A card's text blocks, one a line.
export function textOfCard(call: ConnectorCall | undefined): string {
  return ((cardOf(call)["body"] as Array<JSONObject>) || [])
    .filter((element: JSONObject): boolean => {
      return element["type"] === "TextBlock";
    })
    .map((element: JSONObject): string => {
      return String(element["text"]);
    })
    .join("\n");
}

// Every element of a type, wherever it is on a card.
export function elementsOf(element: unknown, type: string): Array<JSONObject> {
  if (Array.isArray(element)) {
    return element.flatMap((item: unknown): Array<JSONObject> => {
      return elementsOf(item, type);
    });
  }

  if (!element || typeof element !== "object") {
    return [];
  }

  const object: JSONObject = element as JSONObject;

  return [
    ...(object["type"] === type ? [object] : []),
    ...Object.values(object).flatMap((child: unknown): Array<JSONObject> => {
      return elementsOf(child, type);
    }),
  ];
}

// Every Action.Submit of a card, wherever it is on it.
export function submitsOf(element: unknown): Array<JSONObject> {
  return elementsOf(element, "Action.Submit");
}
