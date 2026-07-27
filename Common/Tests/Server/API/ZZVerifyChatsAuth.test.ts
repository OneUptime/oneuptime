import { describe, expect, test } from "@jest/globals";
import express from "express";
import http from "http";
import { AddressInfo } from "net";

jest.mock("../../../Server/Services/WorkspaceProjectAuthTokenService", () => {
  return {
    __esModule: true,
    default: {
      getProjectAuth: jest.fn(async () => {
        return {
          miscData: {
            availableChats: {
              "19:chat-abc": {
                id: "19:chat-abc",
                name: "Jane Doe",
                chatType: "personal",
                addedAt: "2026-07-01T00:00:00.000Z",
              },
              "19:chat-def": {
                id: "19:chat-def",
                name: "Alice, Bob + 2 more",
                chatType: "group",
                addedAt: "2026-07-02T00:00:00.000Z",
              },
            },
          },
        };
      }),
    },
  };
});

jest.mock("../../../Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      updateLastActive: jest.fn(async () => {
        return undefined;
      }),
      getCurrentPlan: jest.fn(async () => {
        return { plan: null, isSubscriptionUnpaid: false };
      }),
      getRequireSsoForLogin: jest.fn(async () => {
        return true;
      }),
    },
  };
});

describe("ANON ACCESS PROBE /microsoft-teams/chats", () => {
  test("unauthenticated GET with only a tenantid header", async () => {
    const MicrosoftTeamsAPI: any = (
      await import("../../../Server/API/MicrosoftTeamsAPI")
    ).default;

    const app: express.Express = express();
    app.use("/api", new MicrosoftTeamsAPI().getRouter());

    const server: http.Server = http.createServer(app);
    await new Promise<void>((resolve: () => void) => {
      server.listen(0, resolve);
    });

    const port: number = (server.address() as AddressInfo).port;

    const res: Response = await fetch(
      `http://127.0.0.1:${port}/api/microsoft-teams/chats`,
      {
        method: "GET",
        headers: {
          tenantid: "6f4e4b2c-1111-4c2a-9e3d-abcdefabcdef",
        },
      },
    );

    const body: unknown = await res.json().catch(() => {
      return null;
    });

    // eslint-disable-next-line no-console
    console.log("STATUS:", res.status, "BODY:", JSON.stringify(body));

    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        return resolve();
      });
    });

    expect(res.status).toBe(200);
  }, 30000);
});
