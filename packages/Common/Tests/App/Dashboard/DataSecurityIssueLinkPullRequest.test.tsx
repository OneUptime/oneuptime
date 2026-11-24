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
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A person's own pull request, linked to a Data Security issue as its fix
 * (#10831), on the issue's How to Fix card: each link with where it stands
 * on its host - not merged yet, merged, closed - who linked it, and, once
 * production has something to say, the same verdict an AI fix of the issue
 * shows; a way to take it off for whoever may link one; and the Link Pull
 * Request dialog, one field, which sends the address with the issue and
 * says the server's refusal. A viewer sees the links, and takes none off.
 */

const getListMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();
const deleteMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
        i18n: { language: "en" },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      create: (...args: Array<unknown>) => {
        return createMock(...args);
      },
      deleteItem: (...args: Array<unknown>) => {
        return deleteMock(...args);
      },
    },
  };
});

import IssueLinkedPullRequests, {
  LinkIssuePullRequestModal,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueLinkedPullRequests";
import {
  ISSUE_LINKED_PULL_REQUESTS_TEST_ID,
  LINKED_PULL_REQUESTS_TITLE,
  LINK_ISSUE_PULL_REQUEST_DESCRIPTION,
  LINK_PULL_REQUEST,
  PULL_REQUEST_CLOSED,
  PULL_REQUEST_MERGED,
  PULL_REQUEST_OPEN,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueLinkedPullRequestsCopy";
import {
  canLinkIssuePullRequest,
  getLinkedPullRequestAuthor,
  getLinkedPullRequestName,
  getLinkedPullRequestProduction,
  getLinkedPullRequestState,
  LINKED_PULL_REQUEST_SELECT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueLinkedPullRequestsModel";
import DataSecurityIssuePullRequest from "../../../Models/DatabaseModels/DataSecurityIssuePullRequest";
import User from "../../../Models/DatabaseModels/User";
import FixProductionCheck from "../../../Types/AI/FixProductionCheck";
import FixProductionStatus from "../../../Types/AI/FixProductionStatus";
import URL from "../../../Types/API/URL";
import PullRequestState from "../../../Types/CodeRepository/PullRequestState";
import {
  DATA_SECURITY_ISSUE_PULL_REQUESTS_MAX,
  ISSUE_PULL_REQUEST_ALREADY_LINKED,
  PULL_REQUEST_LINK_NOT_CONNECTED,
} from "../../../Types/DataSecurity/DataSecurityIssuePullRequestLink";
import DataSecurityIssueStatus from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import Email from "../../../Types/Email";
import {
  getRefusalText,
  readRefusalValues,
} from "../../../Types/Exception/RefusalWithValues";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { PillTone } from "../../../UI/Components/Pill/PillTone";
import API from "../../../UI/Utils/API/API";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import Toast from "../../../UI/Utils/Toast";
import UserUtil from "../../../UI/Utils/User";

const PROJECT_ID: string = "8d8d8d8d-1111-4111-8111-111111111111";
const ISSUE_ID: string = "8d8d8d8d-2222-4222-8222-222222222222";
const ADDRESS: string = "https://github.com/acme/checkout/pull/482";

let permissions: Array<Permission>;
let linked: Array<DataSecurityIssuePullRequest>;

function link(
  id: string,
  overrides: Partial<DataSecurityIssuePullRequest> = {},
): DataSecurityIssuePullRequest {
  const row: DataSecurityIssuePullRequest = new DataSecurityIssuePullRequest();
  row._id = id;
  row.pullRequestUrl = URL.fromString(ADDRESS);
  row.repoOrganizationName = "acme";
  row.repoName = "checkout";
  row.pullRequestNumber = 482;
  row.pullRequestState = PullRequestState.Open;
  row.productionCheck = FixProductionCheck.TelemetryLeak;
  Object.assign(row, overrides);
  return row;
}

function maya(): User {
  const user: User = new User();
  user.name = new Name("Maya Patel");
  user.email = new Email("maya@acme-corp.io");
  return user;
}

async function drawList(onChanged?: () => void): Promise<void> {
  render(
    <MemoryRouter>
      <IssueLinkedPullRequests
        issueId={new ObjectID(ISSUE_ID)}
        refreshToggle="first"
        onChanged={onChanged}
      />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(getListMock).toHaveBeenCalled();
  });
}

function items(): Array<HTMLElement> {
  return screen.queryAllByTestId(`${ISSUE_LINKED_PULL_REQUESTS_TEST_ID}-item`);
}

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
  permissions = [Permission.SecurityMember];
  linked = [];

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(PermissionUtil, "getAllPermissions").mockImplementation(() => {
    return permissions;
  });
  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(Toast, "success").mockImplementation((() => {}) as never);
  jest.spyOn(Toast, "error").mockImplementation((() => {}) as never);

  getListMock.mockReset();
  getListMock.mockImplementation(async () => {
    return { data: linked, count: linked.length };
  });
  createMock.mockReset();
  createMock.mockResolvedValue({} as never);
  deleteMock.mockReset();
  deleteMock.mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a linked pull request, as the issue's card reads it", () => {
  test("named owner/repository#number, else by its address", () => {
    expect(getLinkedPullRequestName(link("1"))).toBe("acme/checkout#482");

    const bare: DataSecurityIssuePullRequest = link("2");
    delete bare.repoName;
    expect(getLinkedPullRequestName(bare)).toBe(ADDRESS);
  });

  test("where it stands on its host: not merged yet, merged, closed", () => {
    expect(getLinkedPullRequestState(link("1"))).toEqual({
      label: PULL_REQUEST_OPEN,
      tone: PillTone.Neutral,
    });
    expect(
      getLinkedPullRequestState(
        link("2", { pullRequestState: PullRequestState.Merged }),
      ),
    ).toEqual({ label: PULL_REQUEST_MERGED, tone: PillTone.Info });
    expect(
      getLinkedPullRequestState(
        link("3", { pullRequestState: PullRequestState.Closed }),
      ),
    ).toEqual({ label: PULL_REQUEST_CLOSED, tone: PillTone.Paused });
  });

  test("what production showed: none before it has a status, else the same report an AI fix's is", () => {
    expect(getLinkedPullRequestProduction(link("1"))).toBeUndefined();

    expect(
      getLinkedPullRequestProduction(
        link("2", {
          pullRequestState: PullRequestState.Merged,
          productionStatus: FixProductionStatus.Watching,
          productionSummary:
            "Version 2.4.1 shipped the fix, and has written none of the data since.",
          productionStatusAt: new Date("2026-11-20T12:30:00.000Z"),
          deployedAt: new Date("2026-11-20T12:00:00.000Z"),
          deployedVersion: "2.4.1",
        }),
      ),
    ).toEqual({
      status: FixProductionStatus.Watching,
      check: FixProductionCheck.TelemetryLeak,
      summary:
        "Version 2.4.1 shipped the fix, and has written none of the data since.",
      statusAt: "2026-11-20T12:30:00.000Z",
      deployedAt: "2026-11-20T12:00:00.000Z",
      deployedVersion: "2.4.1",
      deployedCommitSha: undefined,
    });

    // A status a newer server wrote, which this page does not know: nothing said.
    expect(
      getLinkedPullRequestProduction(
        link("3", { productionStatus: "Reconsidering" as never }),
      ),
    ).toBeUndefined();
  });

  test("who linked it: their name, else their email", () => {
    expect(getLinkedPullRequestAuthor(link("1"))).toBe("");
    expect(
      getLinkedPullRequestAuthor(link("2", { createdByUser: maya() })),
    ).toBe("Maya Patel");

    const nameless: User = maya();
    delete nameless.name;
    expect(
      getLinkedPullRequestAuthor(link("3", { createdByUser: nameless })),
    ).toBe("maya@acme-corp.io");
  });

  test("an open or a resolved issue offers Link Pull Request to who may link one; one set aside never does", () => {
    for (const status of [
      DataSecurityIssueStatus.Open,
      DataSecurityIssueStatus.Resolved,
    ]) {
      expect(canLinkIssuePullRequest({ status, isAllowed: true })).toBe(true);
      expect(canLinkIssuePullRequest({ status, isAllowed: false })).toBe(false);
    }

    for (const status of [
      DataSecurityIssueStatus.Accepted,
      DataSecurityIssueStatus.NotAnIssue,
    ]) {
      expect(canLinkIssuePullRequest({ status, isAllowed: true })).toBe(false);
    }
  });

  test("the card reads every link an issue can hold, with what production showed and who linked it", () => {
    expect(LINKED_PULL_REQUEST_SELECT).toMatchObject({
      productionStatus: true,
      productionSummary: true,
      deployedVersion: true,
      createdByUser: { name: true, email: true },
    });
    expect(LINKED_PULL_REQUEST_SELECT).not.toHaveProperty("productionBaseline");
    expect(DATA_SECURITY_ISSUE_PULL_REQUESTS_MAX).toBe(10);
  });
});

describe("the issue's linked pull requests", () => {
  test("an issue with none draws nothing", async () => {
    await drawList();

    expect(
      screen.queryByTestId(ISSUE_LINKED_PULL_REQUESTS_TEST_ID),
    ).not.toBeInTheDocument();
    expect(getListMock.mock.calls[0]![0]).toMatchObject({
      modelType: DataSecurityIssuePullRequest,
      query: { dataSecurityIssueId: new ObjectID(ISSUE_ID) },
      limit: DATA_SECURITY_ISSUE_PULL_REQUESTS_MAX,
    });
  });

  test("each link: its name to its page, where it stands, who linked it, and production's verdict once there is one", async () => {
    linked = [
      link("1", { createdByUser: maya() }),
      link("2", {
        pullRequestState: PullRequestState.Merged,
        productionStatus: FixProductionStatus.Verified,
        productionSummary:
          "In the 1 day since version 2.4.1 shipped the fix, none of its records held the data in 4,300 logs.",
        deployedVersion: "2.4.1",
      }),
      link("3", { pullRequestState: PullRequestState.Closed }),
    ];

    await drawList();
    await screen.findByTestId(ISSUE_LINKED_PULL_REQUESTS_TEST_ID);

    expect(screen.getByText(LINKED_PULL_REQUESTS_TITLE)).toBeInTheDocument();
    expect(items()).toHaveLength(3);

    const [open, verified, closed] = items() as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];

    expect(within(open).getByText(PULL_REQUEST_OPEN)).toBeInTheDocument();
    expect(within(open).getByText("Linked by Maya Patel.")).toBeInTheDocument();
    expect(
      within(open)
        .getByTestId(`${ISSUE_LINKED_PULL_REQUESTS_TEST_ID}-link`)
        .closest("a"),
    ).toHaveAttribute("href", ADDRESS);
    expect(
      within(open).queryByTestId(
        `${ISSUE_LINKED_PULL_REQUESTS_TEST_ID}-production`,
      ),
    ).not.toBeInTheDocument();

    expect(verified).toHaveAttribute(
      "data-production-status",
      FixProductionStatus.Verified,
    );
    expect(within(verified).getByText(PULL_REQUEST_MERGED)).toBeInTheDocument();
    expect(
      within(verified).getByTestId(
        `${ISSUE_LINKED_PULL_REQUESTS_TEST_ID}-production`,
      ),
    ).toHaveTextContent("Leak stopped in production");
    expect(
      within(verified).getByText(
        "In the 1 day since version 2.4.1 shipped the fix, none of its records held the data in 4,300 logs.",
      ),
    ).toBeInTheDocument();

    expect(within(closed).getByText(PULL_REQUEST_CLOSED)).toBeInTheDocument();
    expect(closed).toHaveAttribute("data-pull-request-state", "closed");
  });

  test("a leak nothing can tell about says so from the moment it is linked", async () => {
    linked = [
      link("1", {
        productionStatus: FixProductionStatus.Unverifiable,
        productionSummary:
          "A metric pipeline rule removes this data, or drops the metric's points, before they are stored.",
      }),
    ];

    await drawList();

    expect(
      await screen.findByTestId(
        `${ISSUE_LINKED_PULL_REQUESTS_TEST_ID}-production`,
      ),
    ).toHaveAttribute(
      "data-production-status",
      FixProductionStatus.Unverifiable,
    );
  });

  test("taken off by whoever may link one: deleted, said in a toast, read again", async () => {
    const changed: MockFunction = getJestMockFunction();

    linked = [link("1")];

    await drawList(changed as unknown as () => void);

    const remove: HTMLElement = await screen.findByTestId(
      `${ISSUE_LINKED_PULL_REQUESTS_TEST_ID}-remove`,
    );

    expect(remove).toHaveAttribute(
      "aria-label",
      "Take acme/checkout#482 off this issue",
    );

    linked = [];

    await act(async () => {
      fireEvent.click(remove);
    });

    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalledTimes(1);
    });
    expect(deleteMock.mock.calls[0]![0]).toMatchObject({
      modelType: DataSecurityIssuePullRequest,
      id: new ObjectID("1"),
    });
    expect(Toast.success).toHaveBeenCalledWith(
      "Took acme/checkout#482 off this issue.",
    );
    expect(changed).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
  });

  test("a viewer sees the links, and takes none off", async () => {
    permissions = [Permission.SecurityViewer];
    linked = [link("1")];

    await drawList();
    await screen.findByTestId(ISSUE_LINKED_PULL_REQUESTS_TEST_ID);

    expect(
      screen.queryByTestId(`${ISSUE_LINKED_PULL_REQUESTS_TEST_ID}-remove`),
    ).not.toBeInTheDocument();
  });

  test("a delete the server refuses is said in an error toast, and the link stays", async () => {
    linked = [link("1")];
    deleteMock.mockRejectedValue(new Error("no") as never);
    jest
      .spyOn(API, "getFriendlyMessage")
      .mockReturnValue("You may not do that.");

    await drawList();

    await act(async () => {
      fireEvent.click(
        await screen.findByTestId(
          `${ISSUE_LINKED_PULL_REQUESTS_TEST_ID}-remove`,
        ),
      );
    });

    await waitFor(() => {
      expect(Toast.error).toHaveBeenCalledWith("You may not do that.");
    });
    expect(items()).toHaveLength(1);
  });
});

describe("the Link Pull Request dialog", () => {
  async function drawDialog(onLinked: () => void): Promise<void> {
    render(
      <MemoryRouter>
        <LinkIssuePullRequestModal
          issueId={new ObjectID(ISSUE_ID)}
          onClose={(): void => {}}
          onLinked={onLinked}
        />
      </MemoryRouter>,
    );

    await screen.findByTestId("modal-footer-submit-button");
  }

  async function submit(address: string): Promise<void> {
    const field: HTMLElement = screen.getByPlaceholderText(
      "https://github.com/acme/checkout/pull/482",
    );

    await act(async () => {
      fireEvent.change(field, { target: { value: address } });
      fireEvent.blur(field);
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });
  }

  test("one field, the address; it says what OneUptime does with it", async () => {
    await drawDialog((): void => {});

    expect(screen.getAllByText(LINK_PULL_REQUEST).length).toBeGreaterThan(0);
    expect(
      screen.getByText(LINK_ISSUE_PULL_REQUEST_DESCRIPTION),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  test("sends the address with the issue - its scheme added when left off - and says it is followed", async () => {
    const linkedNow: MockFunction = getJestMockFunction();

    await drawDialog(linkedNow as unknown as () => void);
    await submit("github.com/acme/checkout/pull/482/files");

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    const sent: DataSecurityIssuePullRequest = (
      createMock.mock.calls[0]![0] as { model: DataSecurityIssuePullRequest }
    ).model;

    expect(sent.dataSecurityIssueId?.toString()).toBe(ISSUE_ID);
    expect(sent.pullRequestUrl?.toString()).toBe(
      "https://github.com/acme/checkout/pull/482/files",
    );
    expect(Toast.success).toHaveBeenCalledWith(
      "Linked acme/checkout#482. OneUptime follows it to production.",
    );
    expect(linkedNow).toHaveBeenCalledTimes(1);
  });

  test("a refusal is said in the dialog, in the server's words, and the dialog stays open", async () => {
    const refusal: string = getRefusalText(PULL_REQUEST_LINK_NOT_CONNECTED, {
      repository: "acme/checkout",
    });
    const linkedNow: MockFunction = getJestMockFunction();

    createMock.mockRejectedValue(new Error(refusal) as never);
    jest.spyOn(API, "getFriendlyMessage").mockReturnValue(refusal);

    await drawDialog(linkedNow as unknown as () => void);
    await submit(ADDRESS);

    await waitFor(() => {
      expect(screen.getByText(refusal)).toBeInTheDocument();
    });
    expect(linkedNow).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("modal-footer-submit-button"),
    ).toBeInTheDocument();
  });

  test("the issue's own refusal is read back with its pull request, to be said in the reader's language", () => {
    expect(
      readRefusalValues(
        ISSUE_PULL_REQUEST_ALREADY_LINKED,
        getRefusalText(ISSUE_PULL_REQUEST_ALREADY_LINKED, {
          pullRequest: "acme/checkout#482",
        }),
      ),
    ).toEqual({ pullRequest: "acme/checkout#482" });
  });
});
