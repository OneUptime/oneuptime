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

interface StoredPostmortem {
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
  PermissionGate.clearPermissionPropsCache();

  getListMock.mockReset();
  getListMock.mockImplementation(async (): Promise<unknown> => {
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
  });

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

  // The card has loaded the incident, and the templates have answered.
  await screen.findByText("Postmortem visible on Status Page?", {}, WAIT);
  await waitFor(() => {
    expect(getListMock).toHaveBeenCalled();
  }, WAIT);
  await act(async () => {
    await Promise.resolve();
  });
}

function cardButton(name: string): HTMLElement | null {
  return screen.queryByRole("button", { name: name });
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

    expect(cardButton("Generate with AI")).toBeInTheDocument();
    expect(cardButton("Edit Postmortem Note")).toBeInTheDocument();
    expect(cardButton("Apply Template")).not.toBeInTheDocument();

    // Nothing to open, and no dialog pointing at a settings page.
    expect(screen.queryByText("No Postmortem Templates")).toBeNull();
    expect(screen.queryByText(/Project Settings/)).toBeNull();
  });

  test("is offered once the project has a postmortem template", async () => {
    templates = [{ id: "t-1", name: "Standard review", note: "## Impact" }];

    await renderPage();

    expect(
      await screen.findByRole("button", { name: "Apply Template" }, WAIT),
    ).toBeInTheDocument();
  });

  test("templates that cannot be read leave the button out, with no error over the page", async () => {
    templatesFail = true;

    await renderPage();

    expect(cardButton("Apply Template")).not.toBeInTheDocument();
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

    fireEvent.click(
      await screen.findByRole("button", { name: "Apply Template" }, WAIT),
    );

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

    fireEvent.click(
      await screen.findByRole("button", { name: "Apply Template" }, WAIT),
    );

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

    fireEvent.click(
      await screen.findByRole("button", { name: "Apply Template" }, WAIT),
    );
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

    fireEvent.click(
      await screen.findByRole("button", { name: "Generate with AI" }, WAIT),
    );

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

    fireEvent.click(
      await screen.findByRole("button", { name: "Generate with AI" }, WAIT),
    );
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

    const applyTemplate: HTMLElement = await screen.findByRole(
      "button",
      { name: "Apply Template" },
      WAIT,
    );

    expect(applyTemplate).toBeDisabled();
    expect(cardButton("Generate with AI")).toBeDisabled();
    expect(cardButton("Edit Postmortem Note")).toBeDisabled();

    fireEvent.click(cardButton("Generate with AI")!);
    fireEvent.click(applyTemplate);

    expect(screen.queryByTestId("ai-modal")).toBeNull();
    expect(screen.queryByTestId("modal")).toBeNull();
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

    test("the words an earlier release skipped it with read the same", async () => {
      stored = {
        ...WAITING,
        notificationMessage:
          IncidentPostmortemPublication.earlierHiddenIncidentMessage,
      };

      await renderPage();

      expect(
        await screen.findByText(
          IncidentPostmortemPublication.hiddenIncidentLabel,
          {},
          WAIT,
        ),
      ).toBeVisible();
    });

    test("once the incident is visible - an earlier release showed it without sending it - it reads as skipped", async () => {
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

    test("the card reads the incident's visibility along with the notification", async () => {
      stored = WAITING;

      await renderPage();

      const select: Record<string, unknown> = (
        getItemMock.mock.calls[0]![0] as { select: Record<string, unknown> }
      ).select;

      expect(select["isVisibleOnStatusPage"]).toBe(true);
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
