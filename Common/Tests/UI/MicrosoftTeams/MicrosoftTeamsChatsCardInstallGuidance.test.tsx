import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "@jest/globals";
import * as React from "react";
import { JSONObject } from "../../../Types/JSON";

/*
 * The regression under test lives in the empty state of the chats card.
 *
 * teams.microsoft.com/l/app/<id> only resolves for an app that is published to
 * the Microsoft Teams store. A self-hosted deployment sideloads a manifest
 * built from its own Entra registration, so that id has no store listing and
 * the button sent admins to a 404 - from the exact screen where they were
 * already stuck. Worse, it nudged them toward the store's OneUptime app, which
 * carries a bot that reports to OneUptime Cloud and can never register a chat
 * against a self-hosted install.
 *
 * So: the store button is now gated on BILLING_ENABLED (SaaS only), and
 * self-hosted gets a paragraph naming the deployment's own bot id instead.
 *
 * BILLING_ENABLED and MicrosoftTeamsAppClientId are module-level consts in
 * Common/UI/Config. Rather than jest.resetModules() + a dynamic require (which
 * would hand the component a second copy of React and break its hooks), the
 * Config module is mocked with getters over mutable test state. TypeScript
 * compiles every read in the component to a property access on the module
 * object, so flipping the state between renders is enough.
 */

let billingEnabled: boolean = false;
let microsoftTeamsAppClientId: string | null = null;

jest.mock("../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mockedConfig: Record<string, unknown> = { ...actualConfig };

  /*
   * Object.defineProperty, not a getter in an object literal: this file is
   * down-levelled, so `{ ...actual, get X() {} }` becomes Object.assign, which
   * would read the getter once and freeze the value at module-load time.
   */
  Object.defineProperty(mockedConfig, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabled;
    },
  });

  Object.defineProperty(mockedConfig, "MicrosoftTeamsAppClientId", {
    get: (): string | null => {
      return microsoftTeamsAppClientId;
    },
  });

  return mockedConfig;
});

type ApiGetFunction = () => Promise<{ data: JSONObject }>;

let apiGet: ApiGetFunction = async (): Promise<{ data: JSONObject }> => {
  return { data: { chats: [] } };
};

jest.mock("../../../Utils/API", () => {
  return {
    __esModule: true,
    default: {
      get: (): Promise<{ data: JSONObject }> => {
        return apiGet();
      },
      getFriendlyErrorMessage: (): string => {
        return "Something went wrong.";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import MicrosoftTeamsChatsCard from "../../../../App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsChatsCard";

const SELF_HOSTED_BOT_ID: string = "9f6a2c31-self-hosted-registration";
const SAAS_BOT_ID: string = "cbe1a1f7-oneuptime-cloud";

const STORE_BUTTON_NAME: RegExp = /Open OneUptime in Microsoft Teams/i;
const SELF_HOSTED_GUIDANCE: RegExp =
  /it reports to OneUptime Cloud and will never appear here/i;

interface RenderOptions {
  billingEnabled: boolean;
  clientId: string | null;
  chats?: Array<JSONObject>;
}

async function renderCard(options: RenderOptions): Promise<void> {
  billingEnabled = options.billingEnabled;
  microsoftTeamsAppClientId = options.clientId;

  const chats: Array<JSONObject> = options.chats || [];

  apiGet = async (): Promise<{ data: JSONObject }> => {
    return { data: { chats: chats } };
  };

  // The card fetches /microsoft-teams/chats on mount; settle that inside act.
  await act(async (): Promise<void> => {
    render(<MicrosoftTeamsChatsCard />);
  });

  await waitFor(() => {
    expect(screen.getByText("Microsoft Teams Chats")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Refresh Chats/i }),
    ).toBeInTheDocument();
  });
}

function queryStoreButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: STORE_BUTTON_NAME });
}

beforeEach(() => {
  billingEnabled = false;
  microsoftTeamsAppClientId = null;
  apiGet = async (): Promise<{ data: JSONObject }> => {
    return { data: { chats: [] } };
  };
});

describe("MicrosoftTeamsChatsCard empty-state install guidance", () => {
  describe("self-hosted (BILLING_ENABLED false)", () => {
    test("does not offer the Teams store button, which 404s for a sideloaded app id", async () => {
      await renderCard({
        billingEnabled: false,
        clientId: SELF_HOSTED_BOT_ID,
      });

      await waitFor(() => {
        expect(screen.getByText("No chats connected yet")).toBeInTheDocument();
      });

      expect(queryStoreButton()).not.toBeInTheDocument();
    });

    test("explains that the store app reports to OneUptime Cloud and names the deployment's own bot id", async () => {
      await renderCard({
        billingEnabled: false,
        clientId: SELF_HOSTED_BOT_ID,
      });

      await waitFor(() => {
        expect(screen.getByText("No chats connected yet")).toBeInTheDocument();
      });

      const guidance: HTMLElement = screen.getByText(SELF_HOSTED_GUIDANCE);

      expect(guidance).toBeInTheDocument();
      expect(guidance).toHaveTextContent(SELF_HOSTED_BOT_ID);
      expect(guidance).toHaveTextContent(
        /Chats only register for the app package built for this deployment/i,
      );
      // It must point at the manifest upload, not at the store.
      expect(guidance).toHaveTextContent(
        /upload the manifest from Project Settings > Workspace > Microsoft Teams/i,
      );
    });

    test("withholds the guidance when no client id is configured yet", async () => {
      /*
       * The guidance exists to give the admin a bot id to compare against the
       * installed package. With nothing configured there is nothing to compare,
       * and rendering it anyway produced the literal text "(bot id )." — an
       * empty parenthetical that reads as a bug and helps no one. The setup
       * guide is the right destination at that point, not this note.
       */
      await renderCard({ billingEnabled: false, clientId: null });

      await waitFor(() => {
        expect(screen.getByText("No chats connected yet")).toBeInTheDocument();
      });

      expect(screen.queryByText(SELF_HOSTED_GUIDANCE)).not.toBeInTheDocument();
      expect(queryStoreButton()).not.toBeInTheDocument();
    });
  });

  describe("SaaS (BILLING_ENABLED true)", () => {
    test("offers the Teams store button and withholds the self-hosted guidance", async () => {
      await renderCard({ billingEnabled: true, clientId: SAAS_BOT_ID });

      await waitFor(() => {
        expect(screen.getByText("No chats connected yet")).toBeInTheDocument();
      });

      expect(queryStoreButton()).toBeInTheDocument();
      expect(screen.queryByText(SELF_HOSTED_GUIDANCE)).not.toBeInTheDocument();
    });

    test.each([
      ["null", null],
      ["empty string", ""],
    ])(
      "withholds the store button when the client id is %s",
      async (_label: string, clientId: string | null) => {
        await renderCard({ billingEnabled: true, clientId: clientId });

        await waitFor(() => {
          expect(
            screen.getByText("No chats connected yet"),
          ).toBeInTheDocument();
        });

        expect(queryStoreButton()).not.toBeInTheDocument();
        // Not self-hosted, so the self-hosted paragraph stays away too.
        expect(
          screen.queryByText(SELF_HOSTED_GUIDANCE),
        ).not.toBeInTheDocument();
      },
    );
  });

  describe("copy shared by both deployment modes", () => {
    test.each([
      ["self-hosted", false, SELF_HOSTED_BOT_ID],
      ["SaaS", true, SAAS_BOT_ID],
    ])(
      "renders the empty state and its three numbered steps on %s",
      async (
        _label: string,
        isBillingEnabled: boolean,
        clientId: string | null,
      ) => {
        await renderCard({
          billingEnabled: isBillingEnabled,
          clientId: clientId,
        });

        await waitFor(() => {
          expect(
            screen.getByText("No chats connected yet"),
          ).toBeInTheDocument();
        });

        expect(
          screen.getByText(
            /Add the OneUptime app to a chat in Microsoft Teams and it will appear here/i,
          ),
        ).toBeInTheDocument();

        expect(
          screen.getByText(
            /Open Microsoft Teams and go to the group chat or one-on-one chat you want to notify/i,
          ),
        ).toBeInTheDocument();
        expect(
          screen.getByText(
            /Click the \+ \(Add an app\) button at the top of the chat/i,
          ),
        ).toBeInTheDocument();
        expect(
          screen.getByText(/Come back here and click Refresh Chats/i),
        ).toBeInTheDocument();

        expect(
          screen.getByText(/Already have the OneUptime app in a chat\?/i),
        ).toBeInTheDocument();
      },
    );
  });

  describe("with connected chats", () => {
    const CHATS: Array<JSONObject> = [
      {
        id: "19:groupchat-1",
        name: "Incident War Room",
        chatType: "groupChat",
        addedAt: null,
      },
      {
        id: "19:personal-1",
        name: "Jane Doe",
        chatType: "personal",
        addedAt: null,
      },
    ];

    test.each([
      ["self-hosted", false, SELF_HOSTED_BOT_ID],
      ["SaaS", true, SAAS_BOT_ID],
    ])(
      "lists the chats and drops every piece of empty-state guidance on %s",
      async (
        _label: string,
        isBillingEnabled: boolean,
        clientId: string | null,
      ) => {
        await renderCard({
          billingEnabled: isBillingEnabled,
          clientId: clientId,
          chats: CHATS,
        });

        await waitFor(() => {
          expect(screen.getByText("Incident War Room")).toBeInTheDocument();
        });

        expect(screen.getByText("Jane Doe")).toBeInTheDocument();
        expect(screen.getByText("Connected chats (2)")).toBeInTheDocument();
        expect(screen.getByText("Group chat")).toBeInTheDocument();
        expect(screen.getByText("1:1 chat")).toBeInTheDocument();

        expect(
          screen.queryByText("No chats connected yet"),
        ).not.toBeInTheDocument();
        expect(queryStoreButton()).not.toBeInTheDocument();
        expect(
          screen.queryByText(SELF_HOSTED_GUIDANCE),
        ).not.toBeInTheDocument();
      },
    );
  });
});
