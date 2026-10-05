import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import React, { ReactElement } from "react";
import McpOAuthGrant from "../../../Models/DatabaseModels/McpOAuthGrant";
import Route from "../../../Types/API/Route";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * Dashboard pages and page components rendered in a German test locale: each
 * sentence is looked up whole, its values (names, dates, counts) are filled
 * into the German wording, and the elements inside a sentence - code, links,
 * the store's name on a badge - land wherever the German sentence puts them.
 *
 * Every key is the English source text, exactly as Locales/en.json keys it.
 * The instance reaches the components through I18nextProvider only, so no
 * German leaks into another suite on the same worker.
 */

const GERMAN: Record<string, string> = {
  // Pages/Settings/MobileApps.tsx
  "Download on the {{store}}": "Laden im {{store}}",
  "Get it on {{store}}": "Jetzt bei {{store}}",
  "Download APK": "APK herunterladen",
  "Your on-call toolkit, in your pocket.":
    "Ihr Bereitschafts-Werkzeug für die Hosentasche.",
  "Critical alerts": "Kritische Alarme",
  "Override Do Not Disturb when a page fires.":
    "Übergeht „Nicht stören“, wenn ein Alarm eintrifft.",
  "Download for iPhone and iPad": "Für iPhone und iPad herunterladen",
  "Available on iOS & Android": "Für iOS und Android verfügbar",
  // Pages/StatusPages/View/StatusPagePreviewLink.tsx
  "Here's a link to preview your status page: {{link}}":
    "Mit diesem Link sehen Sie eine Vorschau Ihrer Statusseite: {{link}}",
  // Pages/Settings/McpServer.tsx
  "API key.": "API-Schlüssel.",
  "For an agent that runs unattended, send a OneUptime API key in the {{apiKeyHeader}} header (or {{bearerHeader}}). The key determines which project the agent operates on and what it may do. Create a scoped API key with least-privilege permissions in {{apiKeysLink}}. Never give an AI agent a master API key — it would grant instance-wide admin access across all projects.":
    "Ein Agent, der unbeaufsichtigt läuft, sendet einen OneUptime-API-Schlüssel im Header {{apiKeyHeader}} (oder {{bearerHeader}}). Erstellen Sie unter {{apiKeysLink}} einen Schlüssel mit möglichst wenigen Rechten. Geben Sie einem KI-Agenten nie einen Master-API-Schlüssel.",
  "Project Settings → API Keys": "Projekteinstellungen → API-Schlüssel",
  "Connected {{date}}": "Verbunden am {{date}}",
  'Disconnect "{{name}}"? It is signed out immediately and has to be connected again before it can work with this project. Nothing it created is deleted.':
    "„{{name}}“ trennen? Er wird sofort abgemeldet und muss neu verbunden werden. Nichts, was er erstellt hat, wird gelöscht.",
  "Add the server, then run {{command}} inside Claude Code and choose OneUptime to sign in:":
    "Fügen Sie den Server hinzu, führen Sie in Claude Code {{command}} aus und wählen Sie OneUptime zum Anmelden:",
  // Pages/DockerSwarm/View/Index.tsx (SwarmCountTile)
  Nodes: "Knoten",
  "View {{label}}": "{{label}} anzeigen",
  // Pages/Users/View/OnCall/Context.tsx (OnBehalfOfBanner)
  "You are editing on behalf of {{name}}":
    "Sie bearbeiten im Namen von {{name}}",
  "This decides how {{name}} is paged — not you. Every change is recorded in the audit log and {{name}} is notified of it.":
    "Hier wird festgelegt, wie {{name}} alarmiert wird — nicht Sie. Jede Änderung wird protokolliert und {{name}} wird darüber informiert.",
  "You are viewing another user": "Sie sehen einen anderen Benutzer",
};

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const protocolModule: { default: Record<string, unknown> } =
    jest.requireActual("../../../Types/API/Protocol") as {
      default: Record<string, unknown>;
    };

  return {
    ...actual,
    __esModule: true,
    HOST: "oneuptime.example.com",
    HTTP_PROTOCOL: protocolModule.default["HTTPS"],
  };
});

interface MockColumn {
  title: string;
  getElement?: ((item: McpOAuthGrant) => ReactElement) | undefined;
}

interface MockDeleteConfirmation {
  title?: string | undefined;
  description: string | ReactElement;
  submitButtonText?: string | undefined;
}

interface MockTableProps {
  id: string;
  columns: Array<MockColumn>;
  getDeleteConfirmation?:
    | ((item: McpOAuthGrant) => Promise<MockDeleteConfirmation>)
    | undefined;
}

let mockTableProps: MockTableProps | null = null;
let mockRows: Array<McpOAuthGrant> = [];

/*
 * The connected-clients table, reduced to its rows: each column's cell as the
 * page draws it, so the cells' sentences can be read.
 */
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  const MockModelTable: (props: MockTableProps) => ReactElement = (
    props: MockTableProps,
  ): ReactElement => {
    mockTableProps = props;

    return react.createElement(
      "table",
      { "data-testid": `model-table-${props.id}` },
      react.createElement(
        "tbody",
        null,
        mockRows.map((row: McpOAuthGrant, rowIndex: number): ReactElement => {
          return react.createElement(
            "tr",
            { key: rowIndex },
            props.columns.map((column: MockColumn): ReactElement => {
              return react.createElement(
                "td",
                { key: column.title, "data-column": column.title },
                column.getElement ? column.getElement(row) : null,
              );
            }),
          );
        }),
      ),
    );
  };

  return { __esModule: true, default: MockModelTable };
});

import MobileApps from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/MobileApps";
import StatusPagePreviewLink from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/StatusPagePreviewLink";
import McpServerPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/McpServer";
import { SwarmCountTile } from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Index";
import { OnBehalfOfBanner } from "../../../../App/FeatureSet/Dashboard/src/Pages/Users/View/OnCall/Context";

type CreateGermanFunction = () => Promise<i18n>;

const createGerman: CreateGermanFunction = async (): Promise<i18n> => {
  const instance: i18n = createInstance();

  await instance.init({
    lng: "de",
    fallbackLng: false,
    resources: { de: { translation: GERMAN } },
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
  });

  return instance;
};

let german: i18n;

beforeAll(async () => {
  german = await createGerman();
});

afterEach(() => {
  cleanup();
  mockTableProps = null;
  mockRows = [];
});

type RenderInGermanFunction = (element: ReactElement) => HTMLElement;

const renderInGerman: RenderInGermanFunction = (
  element: ReactElement,
): HTMLElement => {
  return render(<I18nextProvider i18n={german}>{element}</I18nextProvider>)
    .container;
};

type NormalizedTextFunction = (element: Element | null) => string;

const normalizedText: NormalizedTextFunction = (
  element: Element | null,
): string => {
  return (element?.textContent || "").replace(/\s+/g, " ").trim();
};

const PAGE_PROPS: {
  pageRoute: Route;
  currentProject: null;
  hasPaymentMethod: boolean;
} = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/settings`),
  currentProject: null,
  hasPaymentMethod: true,
};

describe("Settings > Mobile Apps in German", () => {
  test("the headline and the feature cards read in German", () => {
    renderInGerman(<MobileApps {...PAGE_PROPS} />);

    expect(
      screen.getByText("Ihr Bereitschafts-Werkzeug für die Hosentasche."),
    ).toBeInTheDocument();
    expect(screen.getByText("Kritische Alarme")).toBeInTheDocument();
    expect(
      screen.getByText("Übergeht „Nicht stören“, wenn ein Alarm eintrifft."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Für iPhone und iPad herunterladen"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Für iOS und Android verfügbar"),
    ).toBeInTheDocument();
    expect(screen.getByText("APK herunterladen")).toBeInTheDocument();
  });

  test("a store badge is one translated sentence with the store's name kept as it is", () => {
    const container: HTMLElement = renderInGerman(
      <MobileApps {...PAGE_PROPS} />,
    );

    type BadgeLinesFunction = (storeName: string) => Array<string>;

    // The badge's two lines, top to bottom.
    const badgeLines: BadgeLinesFunction = (
      storeName: string,
    ): Array<string> => {
      const badge: Element | null = screen.getByText(storeName).parentElement;

      return Array.from(badge?.children || []).map((line: Element): string => {
        return normalizedText(line);
      });
    };

    expect(badgeLines("App Store")).toEqual(["Laden im", "App Store"]);
    expect(badgeLines("Google Play")).toEqual(["Jetzt bei", "Google Play"]);
    // The words around the name keep the badge's small first line.
    expect(screen.getByText("Laden im").className).toContain("uppercase");
    expect(container.textContent).not.toContain("Download on the");
    expect(container.textContent).not.toContain("Get it on");
  });
});

describe("Status page preview link in German", () => {
  test("the sentence is German and the link inside it stays the page's URL", () => {
    const modelId: ObjectID = ObjectID.generate();
    const container: HTMLElement = renderInGerman(
      <StatusPagePreviewLink modelId={modelId} />,
    );

    const sentence: string = normalizedText(container);

    expect(sentence).toContain(
      "Mit diesem Link sehen Sie eine Vorschau Ihrer Statusseite:",
    );
    expect(sentence).not.toContain("Here's a link");

    const link: HTMLAnchorElement | null = container.querySelector("a");

    expect(link?.textContent).toContain(modelId.toString());
  });
});

describe("Settings > MCP Server in German", () => {
  const CONNECTED_ON: Date = new Date("2026-09-01T10:00:00.000Z");

  type ConnectedGrantFunction = () => McpOAuthGrant;

  const connectedGrant: ConnectedGrantFunction = (): McpOAuthGrant => {
    const row: McpOAuthGrant = new McpOAuthGrant();

    row._id = ObjectID.generate().toString();
    row.name = "Claude";
    row.activatedAt = CONNECTED_ON;

    return row;
  };

  type RenderPageFunction = () => HTMLElement;

  const renderPage: RenderPageFunction = (): HTMLElement => {
    const pagePath: string = `/dashboard/${PROJECT_ID}/settings/mcp-server`;

    window.history.pushState({}, "", pagePath);
    Navigation.setLocation(window.location as unknown as never);

    return renderInGerman(
      <McpServerPage
        pageRoute={new Route(pagePath)}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );
  };

  test("the API key paragraph is one German sentence with its code and link in place", () => {
    renderPage();

    const label: HTMLElement = screen.getByText("API-Schlüssel.");
    const paragraph: HTMLElement = label.closest("p") as HTMLElement;
    const text: string = normalizedText(paragraph);

    expect(text).toContain(
      "Ein Agent, der unbeaufsichtigt läuft, sendet einen OneUptime-API-Schlüssel im Header x-api-key (oder Authorization: Bearer).",
    );
    expect(text).toContain(
      "Erstellen Sie unter Projekteinstellungen → API-Schlüssel einen Schlüssel mit möglichst wenigen Rechten.",
    );

    // The slots are the page's own elements, not text.
    const codes: Array<string> = Array.from(
      paragraph.querySelectorAll("code"),
    ).map((code: Element): string => {
      return code.textContent || "";
    });

    expect(codes).toEqual(["x-api-key", "Authorization: Bearer"]);
    expect(
      Array.from(paragraph.querySelectorAll("a")).map(
        (link: Element): string => {
          return link.textContent || "";
        },
      ),
    ).toEqual(["Projekteinstellungen → API-Schlüssel"]);
  });

  test("the Claude Code step keeps the command inside the German sentence", () => {
    renderPage();

    const command: HTMLElement = screen.getByText("/mcp");

    expect(command.tagName).toBe("CODE");
    expect(normalizedText(command.closest("p"))).toBe(
      "Fügen Sie den Server hinzu, führen Sie in Claude Code /mcp aus und wählen Sie OneUptime zum Anmelden:",
    );
  });

  test("a connected client's cell fills the date into the German sentence", () => {
    mockRows = [connectedGrant()];
    renderPage();

    const expectedDate: string =
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        CONNECTED_ON,
        true,
      );

    expect(
      screen.getByText(`Verbunden am ${expectedDate}`),
    ).toBeInTheDocument();
  });

  test("the disconnect confirmation names the client inside the German sentence", async () => {
    renderPage();

    if (!mockTableProps?.getDeleteConfirmation) {
      throw new Error("The page passed no delete confirmation");
    }

    const confirmation: MockDeleteConfirmation =
      await mockTableProps.getDeleteConfirmation(connectedGrant());

    expect(confirmation.description).toBe(
      "„Claude“ trennen? Er wird sofort abgemeldet und muss neu verbunden werden. Nichts, was er erstellt hat, wird gelöscht.",
    );
  });

  test("a client with no name falls back to the English sentence that has no German yet", async () => {
    renderPage();

    // A client that never said what it is called.
    const unnamed: McpOAuthGrant = new McpOAuthGrant();

    unnamed._id = ObjectID.generate().toString();
    unnamed.activatedAt = CONNECTED_ON;

    const confirmation: MockDeleteConfirmation =
      await mockTableProps!.getDeleteConfirmation!(unnamed);

    expect(confirmation.description).toBe(
      "Disconnect this MCP client? It is signed out immediately and has to be connected again before it can work with this project. Nothing it created is deleted.",
    );
  });
});

describe("Docker Swarm count tile in German", () => {
  test("the label and the screen-reader name of its open control are German", () => {
    renderInGerman(
      <SwarmCountTile
        label="Nodes"
        value={3}
        subline={null}
        description="Nodes in the swarm."
        onOpen={() => {
          // not opened in this test
        }}
      />,
    );

    expect(screen.getAllByText("Knoten")[0]).toBeInTheDocument();
    expect(screen.getByText("Knoten anzeigen")).toBeInTheDocument();
    expect(screen.queryByText("View Nodes")).not.toBeInTheDocument();
  });
});

describe("the on-behalf-of banner in German", () => {
  test("names the person inside the German sentences, twice where the sentence needs it", () => {
    const container: HTMLElement = renderInGerman(
      <OnBehalfOfBanner
        isSelf={false}
        canEdit={true}
        displayName="Ada Lovelace"
        firstName="Ada"
      />,
    );
    const text: string = normalizedText(container);

    expect(text).toContain("Sie bearbeiten im Namen von Ada Lovelace");
    expect(text).toContain(
      "Hier wird festgelegt, wie Ada alarmiert wird — nicht Sie. Jede Änderung wird protokolliert und Ada wird darüber informiert.",
    );
  });

  test("a person with no name gets the whole sentence written for that case", () => {
    const container: HTMLElement = renderInGerman(
      <OnBehalfOfBanner
        isSelf={false}
        canEdit={false}
        displayName=""
        firstName="this user"
      />,
    );

    expect(normalizedText(container)).toContain(
      "Sie sehen einen anderen Benutzer",
    );
  });
});
