import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  configure,
  render,
  screen,
} from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";

/*
 * WHAT OneUptime DID IN A WORKSPACE, IN THE READER'S LANGUAGE (#8078).
 *
 * A workspace's notification logs say in their Action column what
 * OneUptime did in Slack, Microsoft Teams or Mattermost: sent a message,
 * created a channel, invited a user, saw a button pressed, started a video
 * call. Three of those - and the word for an action a newer server added -
 * were English in fourteen of the Dashboard's languages: a Spanish log read
 * "Send Message" over "Invitar usuario". Each is worded in every language
 * now: "Enviar mensaje", "Nachricht senden", "Envoyer un message".
 *
 * The real table, in Spanish, German and French, over a fake ModelAPI;
 * then every language's file.
 */

configure({ asyncUtilTimeout: 15000 });

jest.setTimeout(120000);

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return ["ProjectOwner"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: ["Public", "User", "CurrentUser"] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): { toString: () => string } => {
        return {
          toString: () => {
            return "80780000-0000-4000-8000-000000000301";
          },
        };
      },
      getName: (): string => {
        return "Test User";
      },
      getEmail: (): string => {
        return "test@example.com";
      },
    },
  };
});

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import WorkspaceNotificationLog from "../../../Models/DatabaseModels/WorkspaceNotificationLog";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceNotificationActionType from "../../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceNotificationStatus from "../../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import WorkspaceLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/WorkspaceLogsTable";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { PROJECT_ID } from "./SideMenuHarness";

// Each action the Action column draws, by the channel its log was sent to.
const ACTIONS: ReadonlyArray<{
  action: string;
  channel: string;
  words: string;
}> = [
  {
    action: WorkspaceNotificationActionType.SendMessage,
    channel: "incident-war-room",
    words: "Send Message",
  },
  {
    action: WorkspaceNotificationActionType.CreateChannel,
    channel: "inc-4821-checkout",
    words: "Create Channel",
  },
  {
    action: WorkspaceNotificationActionType.InviteUser,
    channel: "inc-4821-invites",
    words: "Invite User",
  },
  {
    action: WorkspaceNotificationActionType.ButtonPressed,
    channel: "inc-4821-buttons",
    words: "Button Pressed",
  },
  {
    action: WorkspaceNotificationActionType.StartVideoCall,
    channel: "inc-4821-call",
    words: "Start Video Call",
  },
  // An action a newer server added, which this release has no words for.
  { action: "PinMessage", channel: "inc-4821-pins", words: "Unknown Action" },
];

// The words that were English in most languages.
const WERE_ENGLISH: ReadonlyArray<string> = [
  "Send Message",
  "Create Channel",
  "Button Pressed",
  "Unknown Action",
];

const LOGS: Array<WorkspaceNotificationLog> = ACTIONS.map(
  (entry: { action: string; channel: string }, index: number) => {
    return Object.assign(new WorkspaceNotificationLog(), {
      _id: `80780000-0000-4000-8000-00000000031${index}`,
      workspaceType: WorkspaceType.Slack,
      actionType: entry.action,
      status: WorkspaceNotificationStatus.Success,
      channelName: entry.channel,
      createdAt: new Date("2026-11-14T09:00:00Z"),
    });
  },
);

const EXPECTED: Record<string, Record<string, string>> = {
  es: {
    "Send Message": "Enviar mensaje",
    "Create Channel": "Crear canal",
    "Button Pressed": "Botón pulsado",
    "Unknown Action": "Acción desconocida",
  },
  de: {
    "Send Message": "Nachricht senden",
    "Create Channel": "Kanal erstellen",
    "Button Pressed": "Schaltfläche gedrückt",
    "Unknown Action": "Unbekannte Aktion",
  },
  fr: {
    "Send Message": "Envoyer un message",
    "Create Channel": "Créer un canal",
    "Button Pressed": "Bouton cliqué",
    "Unknown Action": "Action inconnue",
  },
};

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of ["en", ...Object.keys(EXPECTED)]) {
    resources[language] = { translation: readDashboardLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  window.history.replaceState(
    null,
    "",
    `/dashboard/${PROJECT_ID}/settings/workspace-connection-logs`,
  );

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(ModelAPI, "getItem").mockResolvedValue(null as never);
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(
      async (options: {
        modelType: { new (): BaseModel };
        skip?: number;
        limit?: number;
      }): Promise<ListResult<BaseModel>> => {
        const data: Array<BaseModel> =
          options.modelType === WorkspaceNotificationLog ? LOGS : [];

        return {
          data,
          count: data.length,
          skip: options.skip || 0,
          limit: options.limit || 10,
        } as ListResult<BaseModel>;
      },
    );
  jest
    .spyOn(ModelAPI, "count")
    .mockImplementation(
      async (options: {
        modelType: { new (): BaseModel };
      }): Promise<number> => {
        return options.modelType === WorkspaceNotificationLog ? LOGS.length : 0;
      },
    );
  jest.spyOn(API, "get").mockResolvedValue({ data: {} } as never);
  jest.spyOn(API, "post").mockResolvedValue({ data: {} } as never);
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await i18next.changeLanguage("en");
});

async function openLogs(language: string): Promise<void> {
  await i18next.changeLanguage(language);
  await act(async () => {
    render(
      <MemoryRouter>
        <WorkspaceLogsTable />
      </MemoryRouter>,
    );
  });

  for (let i: number = 0; i < 20; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }

  expect(await screen.findByText("incident-war-room")).toBeInTheDocument();
}

// The row a log's channel is drawn in.
function rowOf(channel: string): HTMLElement {
  return screen.getByText(channel).closest("tr") as HTMLElement;
}

describe.each(Object.keys(EXPECTED))(
  "a workspace's logs in %s",
  (language: string) => {
    test("say what OneUptime did in the reader's words, never the English", async () => {
      const words: Record<string, string> = readDashboardLocale(language);
      const expected: Record<string, string> = EXPECTED[language] || {};

      await openLogs(language);

      for (const entry of ACTIONS) {
        const drawn: string = expected[entry.words] || words[entry.words] || "";

        expect({ action: entry.action, drawn }).toEqual({
          action: entry.action,
          drawn: words[entry.words],
        });
        expect(rowOf(entry.channel)).toHaveTextContent(drawn);
      }

      for (const english of WERE_ENGLISH) {
        expect(document.body.textContent).not.toContain(english);
      }
    });
  },
);

describe("a workspace's logs in English", () => {
  test("say what OneUptime did", async () => {
    await openLogs("en");

    for (const entry of ACTIONS) {
      expect(rowOf(entry.channel)).toHaveTextContent(entry.words);
    }
  });
});

describe("every Dashboard language", () => {
  test("words each action of the Action column, and the one a newer server added", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const entry of ACTIONS) {
        expect({
          language,
          key: entry.words,
          worded:
            Boolean(words[entry.words]) && words[entry.words] !== entry.words,
        }).toEqual({ language, key: entry.words, worded: true });
      }
    }
  });
});
