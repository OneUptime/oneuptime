import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * An incident's Postmortem page, rendered for real: the card, its Edit
 * dialog, Apply Template's picker and the editor a template or an AI draft
 * opens in. Only the network is stubbed (and the AI dialog, which has its
 * own tests: here it hands the page a draft).
 *
 * What the maintainer asked for, and what each test pins:
 *
 *   - Apply Template is offered only when the project has a postmortem
 *     template. With none it opened a dialog that said so and sent people to
 *     "Project Settings > Incident > Postmortem Templates", a page that does
 *     not exist.
 *   - The Status Page step asks Publish on Status Page first; Notify
 *     Subscribers and Published At follow, and only while it is on.
 *     Published At starts at now once it is switched on.
 *   - A template or an AI draft changes the note and nothing else: the
 *     editor it opens in starts from the incident's stored postmortem.
 *   - The card says where the postmortem stands - its status, which moves
 *     from a pill - and who owns it (the incident's owners).
 *   - Nothing written yet, Write Postmortem is the one obvious next step,
 *     with a template and an AI draft beside it; written, Edit Postmortem
 *     Note is the card's button and the two fold into its ⋯.
 */

const INCIDENT_ID: string = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
      // An owner added from the Add owners list (AddOwners.addOwner).
      create: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

let permissionsForTest: Array<string> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): {
        permissions: Array<Record<string, unknown>>;
      } => {
        return {
          permissions: permissionsForTest.map(
            (permission: string): Record<string, unknown> => {
              return {
                permission,
                labelIds: [],
                _type: "UserPermission",
              };
            },
          ),
        };
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: permissionsForTest };
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
      getUserId: (): null => {
        return null;
      },
    },
  };
});

// The AI dialog has its own tests; here it hands the page what AI wrote.
jest.mock("../../../UI/Components/AI/GenerateFromAIModal", () => {
  return {
    __esModule: true,
    default: (props: {
      templates: Array<{ id: string; name: string }>;
      onSuccess: (content: string) => void;
      onClose: () => void;
    }): ReactElement => {
      return (
        <div data-testid="ai-modal">
          <ul>
            {props.templates.map((template: { id: string; name: string }) => {
              return (
                <li key={template.id} data-testid="ai-template">
                  {template.name}
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => {
              props.onSuccess("## What AI wrote");
            }}
          >
            Use the AI draft
          </button>
        </div>
      );
    },
  };
});

import IncidentPostmortem from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/Postmortem";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentPostmortemTemplate from "../../../Models/DatabaseModels/IncidentPostmortemTemplate";
import IncidentPostmortemStatus from "../../../Models/DatabaseModels/IncidentPostmortemStatus";
import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../Models/DatabaseModels/IncidentOwnerUser";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Color from "../../../Types/Color";
import File from "../../../Models/DatabaseModels/File";
import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import IncidentPostmortemPublication from "../../../Types/StatusPage/IncidentPostmortemPublication";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const WAIT: { timeout: number } = { timeout: 20000 };

// The ids the owner rows below name their first person and team with.
const ALICE_USER_ID: string = "66666666-6666-4666-8666-666666666660";
const DATABASE_TEAM_ID: string = "88888888-8888-4888-8888-888888888880";
// Who else the Add owners list offers.
const BOB_USER_ID: string = "99999999-9999-4999-8999-999999999991";
const SRE_TEAM_ID: string = "99999999-9999-4999-8999-999999999992";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard"),
  currentProject: null,
  hasPaymentMethod: false,
};

const OWNER: Array<string> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectOwner,
];

const VIEWER: Array<string> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.Viewer,
];

const POSTED_AT: Date = new Date("2026-09-01T10:00:00.000Z");

// The project's postmortem statuses, as a project starts with them.
const NOT_STARTED_ID: string = "44444444-4444-4444-8444-444444444441";
const DRAFT_ID: string = "44444444-4444-4444-8444-444444444442";
const COMPLETED_ID: string = "44444444-4444-4444-8444-444444444443";
const NOT_NEEDED_ID: string = "44444444-4444-4444-8444-444444444444";
const ARCHIVED_ID: string = "44444444-4444-4444-8444-444444444445";

function postmortemStatus(
  id: string,
  name: string,
  order: number,
  flags: Record<string, boolean> = {},
): IncidentPostmortemStatus {
  const status: IncidentPostmortemStatus = new IncidentPostmortemStatus();
  status._id = id;
  status.name = name;
  status.order = order;
  status.color = new Color("#6b7280");
  status.isNotStartedStatus = Boolean(flags["isNotStartedStatus"]);
  status.isDraftStatus = Boolean(flags["isDraftStatus"]);
  status.isCompletedStatus = Boolean(flags["isCompletedStatus"]);
  status.isArchived = Boolean(flags["isArchived"]);
  return status;
}

const STATUSES: Array<IncidentPostmortemStatus> = [
  postmortemStatus(NOT_STARTED_ID, "Not Started", 1, {
    isNotStartedStatus: true,
  }),
  postmortemStatus(DRAFT_ID, "Draft", 2, { isDraftStatus: true }),
  postmortemStatus(COMPLETED_ID, "Completed", 3, { isCompletedStatus: true }),
  postmortemStatus(NOT_NEEDED_ID, "Not Needed", 4),
  postmortemStatus(ARCHIVED_ID, "Old Process", 5, { isArchived: true }),
];

interface StoredOwners {
  users: Array<string>;
  teams: Array<string>;
}

let owners: StoredOwners = { users: [], teams: [] };

interface StoredPostmortem {
  // The status the postmortem is in: Draft, unless said.
  statusId?: string | null;
  note: string;
  isPublished: boolean;
  notifySubscribers: boolean;
  postedAt: Date | null;
  attachments: Array<{ id: string; name: string }>;
  // Where the subscriber notification stands, and why: sent, unless said.
  notificationStatus?: StatusPageSubscriberNotificationStatus;
  notificationMessage?: string;
  // The incident's Visible on Status Page: visible, unless said.
  isIncidentVisible?: boolean;
  // Whether the incident is private: not, unless said.
  isIncidentPrivate?: boolean;
}

const UNPUBLISHED: StoredPostmortem = {
  note: "## Stored note",
  isPublished: false,
  notifySubscribers: true,
  postedAt: null,
  attachments: [],
};

const PUBLISHED: StoredPostmortem = {
  note: "## Stored note",
  isPublished: true,
  notifySubscribers: true,
  postedAt: POSTED_AT,
  attachments: [
    { id: "33333333-3333-4333-8333-333333333333", name: "timeline.png" },
  ],
};

let stored: StoredPostmortem = UNPUBLISHED;
let templates: Array<{ id: string; name: string; note: string }> = [];
let templatesFail: boolean = false;

function storedIncident(): Incident {
  const incident: Incident = new Incident();
  incident._id = INCIDENT_ID;
  incident.postmortemNote = stored.note;

  const statusId: string | null =
    stored.statusId === undefined ? DRAFT_ID : stored.statusId;

  if (statusId) {
    incident.postmortemStatusId = new ObjectID(statusId);
  }

  incident.showPostmortemOnStatusPage = stored.isPublished;
  incident.notifySubscribersOnPostmortemPublished = stored.notifySubscribers;
  incident.postmortemPostedAt = stored.postedAt as Date;
  incident.subscriberNotificationStatusOnPostmortemPublished =
    stored.notificationStatus || StatusPageSubscriberNotificationStatus.Success;

  if (stored.notificationMessage) {
    incident.subscriberNotificationStatusMessageOnPostmortemPublished =
      stored.notificationMessage;
  }

  incident.isVisibleOnStatusPage = stored.isIncidentVisible ?? true;
  incident.isPrivate = stored.isIncidentPrivate ?? false;
  incident.postmortemAttachments = stored.attachments.map(
    (attachment: { id: string; name: string }): File => {
      const file: File = new File();
      file._id = attachment.id;
      file.name = attachment.name;
      return file;
    },
  );
  return incident;
}

beforeEach(() => {
  permissionsForTest = OWNER;
  stored = UNPUBLISHED;
  templates = [];
  templatesFail = false;
  owners = { users: [], teams: [] };
  PermissionGate.clearPermissionPropsCache();

  getListMock.mockReset();
  getListMock.mockImplementation(
    async (...args: Array<unknown>): Promise<unknown> => {
      const modelType: unknown = (args[0] as { modelType: unknown }).modelType;

      // The project's postmortem statuses, archived ones too.
      if (modelType === IncidentPostmortemStatus) {
        return { data: STATUSES, count: STATUSES.length, skip: 0, limit: 100 };
      }

      // The incident's owners: people, then teams.
      if (modelType === IncidentOwnerUser) {
        const rows: Array<IncidentOwnerUser> = owners.users.map(
          (name: string, index: number): IncidentOwnerUser => {
            const row: IncidentOwnerUser = new IncidentOwnerUser();
            row._id = `55555555-5555-4555-8555-55555555555${index}`;
            const user: User = new User();
            user._id = `66666666-6666-4666-8666-66666666666${index}`;
            user.name = name as never;
            row.user = user;
            return row;
          },
        );
        return { data: rows, count: rows.length, skip: 0, limit: 100 };
      }

      if (modelType === IncidentOwnerTeam) {
        const rows: Array<IncidentOwnerTeam> = owners.teams.map(
          (name: string, index: number): IncidentOwnerTeam => {
            const row: IncidentOwnerTeam = new IncidentOwnerTeam();
            row._id = `77777777-7777-4777-8777-77777777777${index}`;
            const team: Team = new Team();
            team._id = `88888888-8888-4888-8888-88888888888${index}`;
            team.name = name;
            row.team = team;
            return row;
          },
        );
        return { data: rows, count: rows.length, skip: 0, limit: 100 };
      }

      /*
       * What the Add owners list offers: the project's people (through
       * their team memberships) and its teams - Alice Smith and the
       * Database Team are the ids the owners above are read with.
       */
      if (modelType === TeamMember) {
        const members: Array<TeamMember> = [
          { id: ALICE_USER_ID, name: "Alice Smith" },
          { id: BOB_USER_ID, name: "Bob Jones" },
        ].map((person: { id: string; name: string }): TeamMember => {
          const user: User = new User();
          user._id = person.id;
          user.name = person.name as never;
          const member: TeamMember = new TeamMember();
          member.user = user;
          return member;
        });
        return { data: members, count: members.length, skip: 0, limit: 25 };
      }

      if (modelType === Team) {
        const teams: Array<Team> = [
          { id: DATABASE_TEAM_ID, name: "Database Team" },
          { id: SRE_TEAM_ID, name: "SRE" },
        ].map((entry: { id: string; name: string }): Team => {
          const team: Team = new Team();
          team._id = entry.id;
          team.name = entry.name;
          return team;
        });
        return { data: teams, count: teams.length, skip: 0, limit: 25 };
      }

      if (templatesFail) {
        throw new Error("You do not have permission to read templates.");
      }

      return {
        data: templates.map(
          (template: {
            id: string;
            name: string;
            note: string;
          }): IncidentPostmortemTemplate => {
            const model: IncidentPostmortemTemplate =
              new IncidentPostmortemTemplate();
            model._id = template.id;
            model.templateName = template.name;
            model.postmortemNote = template.note;
            return model;
          },
        ),
        count: templates.length,
        skip: 0,
        limit: 100,
      };
    },
  );

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<Incident> => {
    return storedIncident();
  });

  createOrUpdateMock.mockReset();
  createOrUpdateMock.mockResolvedValue({ data: {} });
  updateByIdMock.mockReset();
  updateByIdMock.mockResolvedValue({});

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(INCIDENT_ID));
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderPage(): Promise<void> {
  await act(async () => {
    render(<IncidentPostmortem {...PAGE_PROPS} />);
  });

  /*
   * The card has loaded the incident - its note, or the empty state while
   * nothing is written - and the templates have answered.
   */
  if (stored.note.trim()) {
    await screen.findByText("Postmortem visible on Status Page?", {}, WAIT);
  } else {
    await screen.findByText("No postmortem yet", {}, WAIT);
  }

  await waitFor(() => {
    expect(
      getListMock.mock.calls.some((call: Array<unknown>): boolean => {
        return (
          (call[0] as { modelType: unknown }).modelType ===
          IncidentPostmortemTemplate
        );
      }),
    ).toBe(true);
  }, WAIT);
  await act(async () => {
    await Promise.resolve();
  });
}

function cardButton(name: string): HTMLElement | null {
  return screen.queryByRole("button", { name: name });
}

/*
 * The ⋯ beside Edit Postmortem Note on a written postmortem, opened: the
 * items it holds, by name.
 */
async function openMoreMenu(): Promise<void> {
  fireEvent.click(
    await screen.findByRole(
      "button",
      { name: "More postmortem options" },
      WAIT,
    ),
  );

  await screen.findByRole("menu", {}, WAIT);
}

function menuItem(name: string): HTMLElement | null {
  return screen.queryByRole("menuitem", { name: name });
}

function dialog(): HTMLElement {
  return screen.getByTestId("modal");
}

// The request the editor saved: the incident as it was sent.
async function savedIncident(): Promise<Record<string, unknown>> {
  await waitFor(() => {
    expect(createOrUpdateMock).toHaveBeenCalled();
  }, WAIT);

  return (createOrUpdateMock.mock.calls[0]![0] as { model: Incident })
    .model as unknown as Record<string, unknown>;
}

// The editor opens on the write-up; Next goes on to the Status Page step.
async function goToStatusPageStep(): Promise<void> {
  // The editor has read the incident and drawn its first step.
  await within(dialog()).findByText("Postmortem Attachments", {}, WAIT);

  fireEvent.click(
    await within(dialog()).findByTestId("modal-footer-next-button", {}, WAIT),
  );

  await within(dialog()).findByRole(
    "switch",
    { name: "Publish on Status Page" },
    WAIT,
  );
}

function publishSwitch(): HTMLElement {
  return within(dialog()).getByRole("switch", {
    name: "Publish on Status Page",
  });
}

function publishedAtInput(): HTMLInputElement | null {
  return dialog().querySelector<HTMLInputElement>(
    'input[type="datetime-local"]',
  );
}

describe("Apply Template", () => {
  test("is not offered when the project has no postmortem templates", async () => {
    templates = [];

    await renderPage();

    expect(cardButton("Edit Postmortem Note")).toBeInTheDocument();

    await openMoreMenu();

    expect(menuItem("Generate with AI")).toBeInTheDocument();
    expect(menuItem("Apply Template")).toBeNull();

    // Nothing to open, and no dialog pointing at a settings page.
    expect(screen.queryByText("No Postmortem Templates")).toBeNull();
    expect(screen.queryByText(/Project Settings/)).toBeNull();
  });

  test("is offered once the project has a postmortem template", async () => {
    templates = [{ id: "t-1", name: "Standard review", note: "## Impact" }];

    await renderPage();
    await openMoreMenu();

    expect(menuItem("Apply Template")).toBeInTheDocument();
    // Folded away: no button of its own beside Edit.
    expect(cardButton("Apply Template")).toBeNull();
  });

  test("templates that cannot be read leave the button out, with no error over the page", async () => {
    templatesFail = true;

    await renderPage();
    await openMoreMenu();

    expect(menuItem("Apply Template")).toBeNull();
    expect(screen.queryByText("Error")).toBeNull();
    expect(
      screen.queryByText("You do not have permission to read templates."),
    ).toBeNull();
  });

  test("the templates are read once, when the page opens, by name", async () => {
    templates = [{ id: "t-1", name: "Standard review", note: "## Impact" }];

    await renderPage();

    const templateRequests: Array<Array<unknown>> =
      getListMock.mock.calls.filter((call: Array<unknown>): boolean => {
        return (
          (call[0] as { modelType: unknown }).modelType ===
          IncidentPostmortemTemplate
        );
      });

    expect(templateRequests).toHaveLength(1);
    expect(
      (templateRequests[0]![0] as { sort: Record<string, unknown> }).sort,
    ).toEqual({ templateName: SortOrder.Ascending });
  });

  test("with one template it is picked already, and applying it opens the editor on it", async () => {
    templates = [
      { id: "t-1", name: "Standard review", note: "## From the template" },
    ];

    await renderPage();
    await openMoreMenu();

    fireEvent.click(menuItem("Apply Template")!);

    const picker: HTMLElement = await screen.findByTestId("modal", {}, WAIT);

    expect(
      within(picker).getByText("Apply Postmortem Template"),
    ).toBeInTheDocument();
    expect(within(picker).getByText("Standard review")).toBeInTheDocument();

    fireEvent.click(within(picker).getByTestId("modal-footer-submit-button"));

    await screen.findByText("Edit Postmortem Note", { selector: "h3" }, WAIT);
    await goToStatusPageStep();

    fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));

    const saved: Record<string, unknown> = await savedIncident();

    expect(saved["postmortemNote"]).toBe("## From the template");
  });

  test("with several templates the reader picks one", async () => {
    templates = [
      { id: "t-1", name: "Customer-facing", note: "## For customers" },
      { id: "t-2", name: "Internal review", note: "## For the team" },
    ];

    await renderPage();
    await openMoreMenu();

    fireEvent.click(menuItem("Apply Template")!);

    const picker: HTMLElement = await screen.findByTestId("modal", {}, WAIT);

    // Nothing is picked for them: Apply Template asks for a pick first.
    fireEvent.click(within(picker).getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(
        within(picker).getByText("Select Template is required."),
      ).toBeInTheDocument();
    }, WAIT);

    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("a template applied to a published postmortem keeps it published, with its time and attachments", async () => {
    stored = PUBLISHED;
    templates = [
      { id: "t-1", name: "Standard review", note: "## From the template" },
    ];

    await renderPage();
    await openMoreMenu();

    fireEvent.click(menuItem("Apply Template")!);
    fireEvent.click(
      within(await screen.findByTestId("modal", {}, WAIT)).getByTestId(
        "modal-footer-submit-button",
      ),
    );

    await screen.findByText("Edit Postmortem Note", { selector: "h3" }, WAIT);
    await goToStatusPageStep();

    // The stored postmortem, not a blank one.
    expect(publishSwitch()).toHaveAttribute("aria-checked", "true");

    fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));

    const saved: Record<string, unknown> = await savedIncident();

    expect(saved["postmortemNote"]).toBe("## From the template");
    // It used to be saved as false: applying a template unpublished it.
    expect(saved["showPostmortemOnStatusPage"]).toBe(true);
    expect(saved["notifySubscribersOnPostmortemPublished"]).toBe(true);
    expect(new Date(saved["postmortemPostedAt"] as Date).toISOString()).toBe(
      POSTED_AT.toISOString(),
    );
    expect(
      (saved["postmortemAttachments"] as Array<File>).map(
        (file: File): string => {
          return file._id!.toString();
        },
      ),
    ).toEqual([PUBLISHED.attachments[0]!.id]);
  });
});

describe("Generate with AI", () => {
  test("offers the project's templates after the built-in outlines", async () => {
    templates = [{ id: "t-1", name: "Standard review", note: "## Impact" }];

    await renderPage();
    await openMoreMenu();

    fireEvent.click(menuItem("Generate with AI")!);

    const names: Array<string> = (
      await screen.findAllByTestId("ai-template", {}, WAIT)
    ).map((item: HTMLElement): string => {
      return item.textContent || "";
    });

    expect(names[names.length - 1]).toBe("Standard review");
    expect(names.length).toBeGreaterThan(1);
  });

  test("what AI wrote opens in the editor, and the rest of the postmortem stays as stored", async () => {
    stored = PUBLISHED;

    await renderPage();
    await openMoreMenu();

    fireEvent.click(menuItem("Generate with AI")!);
    fireEvent.click(await screen.findByText("Use the AI draft", {}, WAIT));

    await screen.findByText("Edit Postmortem Note", { selector: "h3" }, WAIT);
    await goToStatusPageStep();

    expect(publishSwitch()).toHaveAttribute("aria-checked", "true");

    fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));

    const saved: Record<string, unknown> = await savedIncident();

    expect(saved["postmortemNote"]).toBe("## What AI wrote");
    expect(saved["showPostmortemOnStatusPage"]).toBe(true);
    expect(new Date(saved["postmortemPostedAt"] as Date).toISOString()).toBe(
      POSTED_AT.toISOString(),
    );
  });
});

describe("for someone who may not edit the incident", () => {
  test("Generate with AI and Apply Template are locked, like Edit", async () => {
    permissionsForTest = VIEWER;
    templates = [{ id: "t-1", name: "Standard review", note: "## Impact" }];

    await renderPage();

    expect(cardButton("Edit Postmortem Note")).toBeDisabled();

    await openMoreMenu();

    const applyTemplate: HTMLElement = menuItem("Apply Template")!;
    const generate: HTMLElement = menuItem("Generate with AI")!;

    expect(applyTemplate).toHaveAttribute("aria-disabled", "true");
    expect(generate).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(generate);
    fireEvent.click(applyTemplate);

    expect(screen.queryByTestId("ai-modal")).toBeNull();
    expect(screen.queryByTestId("modal")).toBeNull();
  });

  test("the status is drawn without its menu: they can read where it stands", async () => {
    permissionsForTest = VIEWER;

    await renderPage();

    const pill: HTMLElement = await screen.findByTestId(
      "postmortem-status-pill",
      {},
      WAIT,
    );

    await waitFor(() => {
      expect(pill).toHaveTextContent("Draft");
    }, WAIT);
    expect(
      screen.queryByRole("button", { name: /Postmortem status: Draft/ }),
    ).toBeNull();
  });
});

describe("the Status Page step of Edit Postmortem Note", () => {
  async function openEditor(): Promise<void> {
    await renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Edit Postmortem Note" }, WAIT),
    );

    await screen.findByText("Edit Postmortem Note", { selector: "h3" }, WAIT);
    await goToStatusPageStep();
  }

  test("asks Publish on Status Page first, and nothing else while it is off", async () => {
    await openEditor();

    expect(publishSwitch()).toHaveAttribute("aria-checked", "false");
    expect(
      within(dialog()).queryByRole("checkbox", { name: /Notify Subscribers/ }),
    ).toBeNull();
    expect(publishedAtInput()).toBeNull();
  });

  test("switched on, it asks Notify Subscribers, then Published At, set to now", async () => {
    await openEditor();

    const before: number = Date.now();

    fireEvent.click(publishSwitch());

    const notify: HTMLElement = await within(dialog()).findByRole(
      "checkbox",
      { name: /Notify Subscribers/ },
      WAIT,
    );

    expect(notify).toBeChecked();

    const publishedAt: HTMLInputElement | null = publishedAtInput();

    expect(publishedAt).not.toBeNull();
    expect(publishedAt!.value).not.toBe("");

    // In the order asked: the switch, Notify Subscribers, Published At.
    expect(
      publishSwitch().compareDocumentPosition(notify) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      notify.compareDocumentPosition(publishedAt!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));

    const saved: Record<string, unknown> = await savedIncident();

    expect(saved["showPostmortemOnStatusPage"]).toBe(true);
    expect(saved["notifySubscribersOnPostmortemPublished"]).toBe(true);

    const postedAt: number = new Date(
      saved["postmortemPostedAt"] as Date,
    ).getTime();

    // The minute it was switched on (the field holds minutes).
    expect(postedAt).toBeGreaterThan(before - 2 * 60 * 1000);
    expect(postedAt).toBeLessThanOrEqual(Date.now() + 60 * 1000);
  });

  test("switched on and off again, nothing about publishing is saved", async () => {
    await openEditor();

    fireEvent.click(publishSwitch());
    await within(dialog()).findByRole(
      "checkbox",
      { name: /Notify Subscribers/ },
      WAIT,
    );

    fireEvent.click(publishSwitch());

    await waitFor(() => {
      expect(publishedAtInput()).toBeNull();
    }, WAIT);

    fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));

    const saved: Record<string, unknown> = await savedIncident();

    expect(saved["showPostmortemOnStatusPage"]).toBe(false);
    // Not the time it was switched on for a moment.
    expect(saved["postmortemPostedAt"] ?? null).toBeNull();
  });

  test("a published postmortem shows its own time, and switching it off keeps that time stored", async () => {
    stored = PUBLISHED;

    await openEditor();

    expect(publishSwitch()).toHaveAttribute("aria-checked", "true");
    expect(publishedAtInput()!.value).not.toBe("");

    fireEvent.click(publishSwitch());

    await waitFor(() => {
      expect(publishedAtInput()).toBeNull();
    }, WAIT);

    fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));

    const saved: Record<string, unknown> = await savedIncident();

    expect(saved["showPostmortemOnStatusPage"]).toBe(false);
    expect(new Date(saved["postmortemPostedAt"] as Date).toISOString()).toBe(
      POSTED_AT.toISOString(),
    );
  });
});

describe("the Postmortem card", () => {
  test("an unpublished postmortem shows no publishing details", async () => {
    stored = UNPUBLISHED;

    await renderPage();

    expect(
      screen.getByText("Postmortem visible on Status Page?"),
    ).toBeVisible();
    expect(screen.queryByText("Postmortem Published At")).toBeNull();
    expect(screen.queryByText("Notify Subscribers")).toBeNull();
    expect(screen.queryByText("Subscriber Notification Status")).toBeNull();
  });

  test("a published postmortem shows whether subscribers heard of it, then its time", async () => {
    stored = PUBLISHED;

    await renderPage();

    const visible: HTMLElement = screen.getByText(
      "Postmortem visible on Status Page?",
    );
    const notify: HTMLElement = await screen.findByText(
      "Notify Subscribers",
      {},
      WAIT,
    );
    const status: HTMLElement = screen.getByText(
      "Subscriber Notification Status",
    );
    const postedAt: HTMLElement = screen.getByText("Postmortem Published At");

    expect(
      visible.compareDocumentPosition(notify) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      notify.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      status.compareDocumentPosition(postedAt) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("published without notifying subscribers, it shows no notification status", async () => {
    stored = { ...PUBLISHED, notifySubscribers: false };

    await renderPage();

    await screen.findByText("Postmortem Published At", {}, WAIT);

    expect(screen.queryByText("Subscriber Notification Status")).toBeNull();
  });

  /*
   * A postmortem published while its incident is hidden is not skipped for
   * good: it is sent when the incident is made visible on status pages
   * (IncidentPostmortemPublication.isShownByUpdate). Its status says so,
   * rather than "Notifications skipped.", and its details say why.
   */
  describe("published while the incident is hidden", () => {
    const WAITING: StoredPostmortem = {
      ...PUBLISHED,
      isIncidentVisible: false,
      notificationStatus: StatusPageSubscriberNotificationStatus.Skipped,
      notificationMessage: IncidentPostmortemPublication.hiddenIncidentMessage,
    };

    test("reads as not sent yet, waiting for the incident, and its details say it is sent when the incident is made visible", async () => {
      stored = WAITING;

      await renderPage();

      expect(
        await screen.findByText(
          IncidentPostmortemPublication.hiddenIncidentLabel,
          {},
          WAIT,
        ),
      ).toBeVisible();
      expect(screen.queryByText("Notifications skipped.")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "more details" }));

      expect(
        await screen.findByText(
          IncidentPostmortemPublication.hiddenIncidentMessage,
          {},
          WAIT,
        ),
      ).toBeVisible();
    });

    test("a private incident is hidden whatever its switch says: switched on, its postmortem still reads as not sent yet", async () => {
      stored = { ...WAITING, isIncidentVisible: true, isIncidentPrivate: true };

      await renderPage();

      expect(
        await screen.findByText(
          IncidentPostmortemPublication.hiddenIncidentLabel,
          {},
          WAIT,
        ),
      ).toBeVisible();
      expect(screen.queryByText("Notifications skipped.")).toBeNull();
    });

    /*
     * The words an earlier release skipped it with. The upgrade
     * (MarkPostmortemsWaitingForHiddenIncidents) gave every one whose
     * incident was still hidden the words of a postmortem that waits; the
     * ones it left were on incidents shown since without anyone being told,
     * and they stay skipped.
     */
    test("the words an earlier release skipped it with read as skipped", async () => {
      stored = {
        ...WAITING,
        notificationMessage:
          "Incident is not visible on status page. Skipping notifications to subscribers.",
      };

      await renderPage();

      expect(
        await screen.findByText("Notifications skipped.", {}, WAIT),
      ).toBeVisible();
      expect(
        screen.queryByText(IncidentPostmortemPublication.hiddenIncidentLabel),
      ).toBeNull();
    });

    test("once the incident is visible - and not private - it reads as skipped: making it visible is what would have sent it", async () => {
      stored = { ...WAITING, isIncidentVisible: true };

      await renderPage();

      expect(
        await screen.findByText("Notifications skipped.", {}, WAIT),
      ).toBeVisible();
      expect(
        screen.queryByText(IncidentPostmortemPublication.hiddenIncidentLabel),
      ).toBeNull();
    });

    test("a skip for another reason reads as skipped", async () => {
      stored = {
        ...WAITING,
        notificationMessage: IncidentPostmortemPublication.notShownMessage,
      };

      await renderPage();

      expect(
        await screen.findByText("Notifications skipped.", {}, WAIT),
      ).toBeVisible();
      expect(
        screen.queryByText(IncidentPostmortemPublication.hiddenIncidentLabel),
      ).toBeNull();
    });

    test("one queued once the incident was shown reads as sending soon", async () => {
      stored = {
        ...WAITING,
        isIncidentVisible: true,
        notificationStatus: StatusPageSubscriberNotificationStatus.Pending,
        notificationMessage: IncidentPostmortemPublication.shownQueuedMessage,
      };

      await renderPage();

      expect(await screen.findByText("Sending Soon", {}, WAIT)).toBeVisible();
    });

    test("the card reads the incident's visibility and whether it is private along with the notification", async () => {
      stored = WAITING;

      await renderPage();

      const select: Record<string, unknown> = (
        getItemMock.mock.calls[0]![0] as { select: Record<string, unknown> }
      ).select;

      expect(select["isVisibleOnStatusPage"]).toBe(true);
      expect(select["isPrivate"]).toBe(true);
      expect(
        select["subscriberNotificationStatusMessageOnPostmortemPublished"],
      ).toBe(true);
    });
  });

  test("the attachments come right after the write-up", async () => {
    stored = UNPUBLISHED;

    await renderPage();

    const attachments: HTMLElement = screen.getByText(
      "No postmortem attachments uploaded for this incident.",
    );
    const visible: HTMLElement = screen.getByText(
      "Postmortem visible on Status Page?",
    );

    expect(
      attachments.compareDocumentPosition(visible) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("where the postmortem stands, and who owns it", () => {
  test("its status is a pill in the card, read from the incident", async () => {
    stored = { ...UNPUBLISHED, statusId: DRAFT_ID };

    await renderPage();

    const summary: HTMLElement = await screen.findByTestId(
      "postmortem-summary",
      {},
      WAIT,
    );

    expect(within(summary).getByText("Status")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        within(summary).getByTestId("postmortem-status-pill"),
      ).toHaveTextContent("Draft");
    }, WAIT);

    // The incident is read with its status.
    const select: Record<string, unknown> = (
      getItemMock.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;

    expect(select["postmortemStatusId"]).toBe(true);
  });

  test("an incident with no status yet reads as not started", async () => {
    stored = { ...UNPUBLISHED, statusId: null };

    await renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("postmortem-status-pill")).toHaveTextContent(
        "Not Started",
      );
    }, WAIT);
  });

  test("its menu offers every status not archived, the current one ticked, and moves it at once", async () => {
    await renderPage();

    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: /Postmortem status: Draft/ },
        WAIT,
      ),
    );

    const options: Array<HTMLElement> = await screen.findAllByTestId(
      "postmortem-status-option",
      {},
      WAIT,
    );

    expect(
      options.map((option: HTMLElement): string => {
        return option.textContent || "";
      }),
    ).toEqual(["Not Started", "Draft", "Completed", "Not Needed"]);
    expect(
      screen.getByRole("menuitemradio", { name: "Draft" }),
    ).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Completed" }));

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalled();
    }, WAIT);

    const update: {
      id: ObjectID;
      data: Record<string, unknown>;
      modelType: unknown;
    } = updateByIdMock.mock.calls[0]![0] as {
      id: ObjectID;
      data: Record<string, unknown>;
      modelType: unknown;
    };

    expect(update.modelType).toBe(Incident);
    expect(update.id.toString()).toBe(INCIDENT_ID);
    expect((update.data["postmortemStatusId"] as ObjectID).toString()).toBe(
      COMPLETED_ID,
    );
    // Nothing else is written: not the note, not the status page switch.
    expect(Object.keys(update.data)).toEqual(["postmortemStatusId"]);

    await waitFor(() => {
      expect(screen.getByTestId("postmortem-status-pill")).toHaveTextContent(
        "Completed",
      );
    }, WAIT);
  });

  test("a move the server refuses is put back, with the reason", async () => {
    updateByIdMock.mockRejectedValue(new Error("Not allowed to move it."));

    await renderPage();

    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: /Postmortem status: Draft/ },
        WAIT,
      ),
    );
    fireEvent.click(
      await screen.findByRole("menuitemradio", { name: "Not Needed" }, WAIT),
    );

    expect(
      await screen.findByTestId("postmortem-status-error", {}, WAIT),
    ).toHaveTextContent("Could not change the postmortem's status.");
    expect(screen.getByTestId("postmortem-status-pill")).toHaveTextContent(
      "Draft",
    );
  });

  test("its owners are the incident's, by name, with Add owners right there - no link away to the Owners page", async () => {
    owners = { users: ["Alice Smith"], teams: ["Database Team"] };

    await renderPage();

    const ownersElement: HTMLElement = await screen.findByTestId(
      "postmortem-owners",
      {},
      WAIT,
    );

    await waitFor(() => {
      expect(ownersElement).toHaveTextContent("Alice Smith, Database Team");
    }, WAIT);

    const summary: HTMLElement = screen.getByTestId("postmortem-summary");

    expect(within(summary).queryByRole("link")).toBeNull();
    expect(within(summary).queryByText("Change owners")).toBeNull();
    expect(
      within(summary).getByRole("button", { name: "Add owners" }),
    ).toHaveAttribute("data-testid", "postmortem-add-more-owners");

    // Read for this incident, in this project.
    const ownerRequest: Array<unknown> | undefined =
      getListMock.mock.calls.find((call: Array<unknown>): boolean => {
        return (
          (call[0] as { modelType: unknown }).modelType === IncidentOwnerUser
        );
      });

    expect(
      (
        (ownerRequest![0] as { query: Record<string, unknown> }).query[
          "incidentId"
        ] as ObjectID
      ).toString(),
    ).toBe(INCIDENT_ID);
  });

  test("someone who may not change the incident's owners sees them, with nothing to add or change them", async () => {
    owners = { users: ["Alice Smith"], teams: [] };
    permissionsForTest = VIEWER;

    await renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("postmortem-owners")).toHaveTextContent(
        "Alice Smith",
      );
    }, WAIT);

    const summary: HTMLElement = screen.getByTestId("postmortem-summary");

    expect(within(summary).queryByRole("link")).toBeNull();
    expect(
      within(summary).queryByRole("button", { name: "Add owners" }),
    ).toBeNull();
  });

  test("with no owners it says so, and offers to add them right there", async () => {
    owners = { users: [], teams: [] };

    await renderPage();

    expect(
      await screen.findByText("No owners yet.", {}, WAIT),
    ).toBeInTheDocument();

    const summary: HTMLElement = screen.getByTestId("postmortem-summary");

    expect(
      within(summary).getByRole("button", { name: "Add owners" }),
    ).toHaveAttribute("data-testid", "postmortem-add-owners");
    expect(within(summary).queryByRole("link")).toBeNull();
  });

  test("Add owners opens the Add owners list right there, and a pick makes them an owner of the incident", async () => {
    owners = { users: ["Alice Smith"], teams: ["Database Team"] };
    createOrUpdateMock.mockImplementation(
      async (...args: Array<unknown>): Promise<unknown> => {
        const request: { modelType: unknown } = args[0] as {
          modelType: unknown;
        };

        // The server adds the row; the page's next read names the team.
        if (request.modelType === IncidentOwnerTeam) {
          owners = { users: owners.users, teams: [...owners.teams, "SRE"] };
        }

        return { data: {} };
      },
    );

    await renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("postmortem-owners")).toHaveTextContent(
        "Alice Smith, Database Team",
      );
    }, WAIT);

    fireEvent.click(
      within(screen.getByTestId("postmortem-summary")).getByRole("button", {
        name: "Add owners",
      }),
    );

    const list: HTMLElement = await screen.findByRole(
      "dialog",
      { name: "Add owners" },
      WAIT,
    );

    // Alice Smith and the Database Team own it already: left out.
    await waitFor(() => {
      expect(
        within(list)
          .getAllByRole("option")
          .map((option: HTMLElement): string | null => {
            return option.getAttribute("data-id");
          }),
      ).toEqual([BOB_USER_ID, SRE_TEAM_ID]);
    }, WAIT);

    fireEvent.click(within(list).getByText("SRE"));

    await within(list).findByText("Added SRE.", {}, WAIT);

    const added: Array<unknown> | undefined =
      createOrUpdateMock.mock.calls.find((call: Array<unknown>): boolean => {
        return (
          (call[0] as { modelType: unknown }).modelType === IncidentOwnerTeam
        );
      });
    const row: IncidentOwnerTeam = (added![0] as { model: IncidentOwnerTeam })
      .model;

    expect(row.incidentId?.toString()).toBe(INCIDENT_ID);
    expect(row.projectId?.toString()).toBe(PROJECT_ID);
    expect(row.teamId?.toString()).toBe(SRE_TEAM_ID);
    // Nobody is told by the page: the server tells the new owner.
    expect(row.isOwnerNotified).toBeUndefined();

    // The page reads the incident's owners again, and names the team.
    await waitFor(() => {
      expect(screen.getByTestId("postmortem-owners")).toHaveTextContent(
        "Alice Smith, Database Team, SRE",
      );
    }, WAIT);
    // The list stays open for the next pick.
    expect(screen.getByRole("dialog", { name: "Add owners" })).toBe(list);
  });

  test("more than three owners are named three, and how many more", async () => {
    owners = {
      users: ["Alice Smith", "Bob Jones", "Carol White", "Dan Brown"],
      teams: ["SRE"],
    };

    await renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("postmortem-owners")).toHaveTextContent(
        "Alice Smith, Bob Jones, Carol White and 2 more owners",
      );
    }, WAIT);
  });
});

describe("nothing written yet", () => {
  const EMPTY: StoredPostmortem = {
    ...UNPUBLISHED,
    note: "",
    statusId: NOT_STARTED_ID,
  };

  test("Write Postmortem is the one obvious next step, with a template and AI beside it", async () => {
    stored = EMPTY;
    templates = [{ id: "t-1", name: "Standard review", note: "## Impact" }];

    await renderPage();

    const empty: HTMLElement = screen.getByTestId("postmortem-empty-state");

    expect(
      within(empty).getByText(
        "Write down what happened, its impact on your users, and what changes now.",
      ),
    ).toBeInTheDocument();
    expect(
      within(empty).getByRole("button", { name: "Write Postmortem" }),
    ).toBeEnabled();
    expect(
      within(empty).getByRole("button", { name: "Start from Template" }),
    ).toBeEnabled();
    expect(
      within(empty).getByRole("button", { name: "Generate with AI" }),
    ).toBeEnabled();

    // Not a second Edit in the header, nor a ⋯ holding the same two.
    expect(cardButton("Edit Postmortem Note")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "More postmortem options" }),
    ).toBeNull();
  });

  test("with no template, only Write Postmortem and Generate with AI", async () => {
    stored = EMPTY;
    templates = [];

    await renderPage();

    const empty: HTMLElement = screen.getByTestId("postmortem-empty-state");

    expect(
      within(empty).queryByRole("button", { name: "Start from Template" }),
    ).toBeNull();
    expect(
      within(empty).getByRole("button", { name: "Write Postmortem" }),
    ).toBeInTheDocument();
  });

  test("nothing about the status page is shown while there is nothing to publish", async () => {
    stored = EMPTY;

    await renderPage();

    expect(screen.queryByText("Postmortem visible on Status Page?")).toBeNull();
    expect(screen.queryByText("Postmortem Attachments")).toBeNull();
  });

  test("Write Postmortem opens the editor on the postmortem, publishing nothing by itself", async () => {
    stored = EMPTY;

    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Write Postmortem" }));

    await screen.findByText("Write Postmortem", { selector: "h3" }, WAIT);

    /*
     * What to write, said once, ending in one full stop: the Markdown
     * helper it came through added a second ("follow-up actions..") and
     * left it untranslated.
     */
    const hint: HTMLElement = await within(dialog()).findByText(
      "Capture what happened, impact, resolution, and follow-up actions.",
      {},
      WAIT,
    );

    expect(hint.textContent).not.toContain("..");
    await goToStatusPageStep();

    // Nothing published by writing it.
    expect(publishSwitch()).toHaveAttribute("aria-checked", "false");
  });

  test("Start from Template opens the picker, and the editor on what it picked", async () => {
    stored = EMPTY;
    templates = [
      { id: "t-1", name: "Standard review", note: "## From the template" },
    ];

    await renderPage();

    fireEvent.click(
      screen.getByRole("button", { name: "Start from Template" }),
    );

    const picker: HTMLElement = await screen.findByTestId("modal", {}, WAIT);

    fireEvent.click(within(picker).getByTestId("modal-footer-submit-button"));

    await screen.findByText("Edit Postmortem Note", { selector: "h3" }, WAIT);
    await goToStatusPageStep();

    fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));

    const saved: Record<string, unknown> = await savedIncident();

    expect(saved["postmortemNote"]).toBe("## From the template");
  });

  test("for a viewer, Write Postmortem alone, locked, with why under it - not three locked buttons", async () => {
    stored = EMPTY;
    permissionsForTest = VIEWER;
    templates = [{ id: "t-1", name: "Standard review", note: "## Impact" }];

    await renderPage();

    const empty: HTMLElement = screen.getByTestId("postmortem-empty-state");

    expect(
      within(empty).getByRole("button", { name: "Write Postmortem" }),
    ).toBeDisabled();

    // The other two are only other ways to do what they cannot.
    expect(
      within(empty).queryByRole("button", { name: "Start from Template" }),
    ).toBeNull();
    expect(
      within(empty).queryByRole("button", { name: "Generate with AI" }),
    ).toBeNull();

    // Why, in words under the button, as a list's locked Create says it.
    expect(
      within(empty).getByTestId("postmortem-empty-state-note"),
    ).toHaveTextContent("permission");
  });

  test("the ways to start from something are buttons beside Write Postmortem, never bare words", async () => {
    stored = EMPTY;
    templates = [{ id: "t-1", name: "Standard review", note: "## Impact" }];

    await renderPage();

    const empty: HTMLElement = screen.getByTestId("postmortem-empty-state");
    const write: HTMLElement = within(empty).getByRole("button", {
      name: "Write Postmortem",
    });

    // The one obvious next step is the primary button.
    expect(write.className).toContain("bg-indigo-600");

    for (const name of ["Start from Template", "Generate with AI"]) {
      const button: HTMLElement = within(empty).getByRole("button", {
        name: name,
      });

      /*
       * A white, bordered button: the outline style drew them as plain
       * words with an icon, which read as text beside the primary button.
       */
      expect(button.className).toContain("border-gray-300");
      expect(button.className).toContain("bg-white");
      expect(button.className).not.toContain("btn-outline-secondary");
    }

    // Nothing locked, so nothing to explain.
    expect(
      within(empty).queryByTestId("postmortem-empty-state-note"),
    ).toBeNull();

    /*
     * A column of full-width buttons on a phone, a row from sm up: the
     * buttons' own left margin (a dialog footer's) is cleared, so the gap
     * alone spaces them.
     */
    const actions: HTMLElement = within(empty).getByTestId(
      "postmortem-empty-state-actions",
    );

    expect(actions.className).toContain("flex-col");
    expect(actions.className).toContain("sm:flex-row");
    expect(actions.className).toContain("[&>div>button]:md:ml-0");
  });
});
