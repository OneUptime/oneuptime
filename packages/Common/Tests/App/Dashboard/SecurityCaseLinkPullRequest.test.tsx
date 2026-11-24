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
 * A person's own pull request, linked to a case's Fix step (#10604): the
 * route's Fix step offers Link Pull Request, one action, to whoever may work
 * the case's tasks; its dialog takes the address and sends it with the case,
 * and says the server's refusal in its words; each link is drawn under the
 * step with where it stands - not merged yet, merged and waiting for its
 * deploy, shipped, closed - and can be taken off by whoever may link one.
 * A viewer sees the links, and neither action.
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
      updateById: async (): Promise<unknown> => {
        return {};
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleExceptions/AddRuleExceptionModal",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("div");
      },
    };
  },
);

import SecurityCaseResponsePlanCard from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponsePlanCard";
import {
  LINK_PULL_REQUEST,
  PULL_REQUEST_CLOSED,
  PULL_REQUEST_MERGED,
  PULL_REQUEST_OPEN,
  PULL_REQUEST_SHIPPED,
  SECURITY_CASE_RESPONSE_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponseCopy";
import {
  canLinkPullRequest,
  getFixPullRequestName,
  getFixPullRequestStanding,
  isRouteFixStep,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseFixPullRequestsModel";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityCasePullRequest from "../../../Models/DatabaseModels/SecurityCasePullRequest";
import URL from "../../../Types/API/URL";
import PullRequestState from "../../../Types/CodeRepository/PullRequestState";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { SECURITY_CASE_PULL_REQUESTS_MAX } from "../../../Types/SecurityCase/SecurityCasePullRequestLink";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import { PillTone } from "../../../UI/Components/Pill/PillTone";
import API from "../../../UI/Utils/API/API";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import Realtime from "../../../UI/Utils/Realtime";
import Toast from "../../../UI/Utils/Toast";
import UserUtil from "../../../UI/Utils/User";
import {
  FIX_CASE_TECHNIQUES,
  FIX_USER,
  fixCaseMatches,
} from "../../Helpers/SecurityCaseFixStepChecks";
import {
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
  testStatusId,
} from "../../Helpers/SecurityCaseValues";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const CASE_ID: string = "22222222-2222-4222-8222-222222222222";
const ROUTE_KEY: string = "fix:public-app";
const ADDRESS: string = "https://github.com/acme/search/pull/482";

let permissions: Array<Permission>;
let linked: Array<SecurityCasePullRequest>;

function link(
  id: string,
  overrides: Partial<SecurityCasePullRequest> = {},
): SecurityCasePullRequest {
  const row: SecurityCasePullRequest = new SecurityCasePullRequest();
  row._id = id;
  row.pullRequestUrl = URL.fromString(ADDRESS);
  row.repoOrganizationName = "acme";
  row.repoName = "search";
  row.pullRequestNumber = 482;
  row.pullRequestState = PullRequestState.Open;
  Object.assign(row, overrides);
  return row;
}

function buildCase(): SecurityCase {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase._id = CASE_ID;
  securityCase.securityCaseStatusId = testStatusId(SecurityCaseStage.New);
  securityCase.entities = [
    { type: SecurityEntityType.IpAddress, value: "35.196.249.14" },
    { type: SecurityEntityType.User, value: FIX_USER },
  ] as never;
  securityCase.mitreTactics = ["TA0001"];
  securityCase.mitreTechniques = FIX_CASE_TECHNIQUES;
  return securityCase;
}

async function drawn(): Promise<void> {
  render(
    <MemoryRouter>
      <SecurityCaseResponsePlanCard
        caseId={new ObjectID(CASE_ID)}
        securityCase={buildCase()}
        values={{
          priorities: buildDefaultTestPriorities(),
          statuses: buildDefaultTestStatuses(),
        }}
        matches={fixCaseMatches()}
        refreshToggle="first"
        isWorking={false}
        onAssignToMe={(): void => {}}
        onRunPlaybook={(): void => {}}
        onDeclareIncident={(): void => {}}
        onMarkContained={(): void => {}}
        onCloseCase={(): void => {}}
      />
    </MemoryRouter>,
  );
  await screen.findAllByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.step);
}

function steps(): Array<HTMLElement> {
  return screen.queryAllByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.step);
}

function routeStep(): HTMLElement {
  const step: HTMLElement | undefined = steps().find(
    (candidate: HTMLElement): boolean => {
      return candidate.getAttribute("data-step-key") === ROUTE_KEY;
    },
  );

  expect(step).toBeDefined();

  return step!;
}

async function openDialog(): Promise<void> {
  await act(async () => {
    fireEvent.click(
      within(routeStep()).getByTestId(
        SECURITY_CASE_RESPONSE_TEST_IDS.linkPullRequest,
      ),
    );
  });

  await screen.findByTestId("modal-footer-submit-button");
}

async function submit(address: string): Promise<void> {
  const field: HTMLElement = screen.getByPlaceholderText(ADDRESS);

  await act(async () => {
    fireEvent.change(field, { target: { value: address } });
    fireEvent.blur(field);
  });
  await act(async () => {
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
  });
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
  jest
    .spyOn(UserUtil, "getUserId")
    .mockReturnValue(new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-000000000001"));
  jest.spyOn(OneUptimeDate, "fromNow").mockReturnValue("5 minutes ago");
  jest
    .spyOn(Realtime, "listenToModelEvent")
    .mockImplementation(((): (() => void) => {
      return (): void => {};
    }) as never);
  jest
    .spyOn(GlobalEvents, "dispatchEvent")
    .mockImplementation((() => {}) as never);
  jest.spyOn(Toast, "success").mockImplementation((() => {}) as never);

  getListMock.mockReset();
  getListMock.mockImplementation(async (args: unknown) => {
    const data: Array<unknown> =
      (args as { modelType: unknown }).modelType === SecurityCasePullRequest
        ? linked
        : [];

    return { data, count: data.length };
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

describe("a linked pull request, as the card reads it", () => {
  test("named owner/repository#number, else by its address", () => {
    expect(getFixPullRequestName(link("1"))).toBe("acme/search#482");

    const bare: SecurityCasePullRequest = link("2");
    delete bare.repoName;
    expect(getFixPullRequestName(bare)).toBe(ADDRESS);
  });

  test("where it stands: not merged yet, merged and waiting for its deploy, shipped in its version, closed", () => {
    expect(getFixPullRequestStanding(link("1"))).toEqual({
      label: PULL_REQUEST_OPEN,
      tone: PillTone.Neutral,
    });
    expect(
      getFixPullRequestStanding(
        link("2", { pullRequestState: PullRequestState.Merged }),
      ),
    ).toMatchObject({ label: PULL_REQUEST_MERGED, tone: PillTone.Info });
    expect(
      getFixPullRequestStanding(
        link("3", {
          pullRequestState: PullRequestState.Merged,
          deployedAt: new Date("2026-11-17T20:00:00.000Z"),
          deployedVersion: "2.4.1",
        }),
      ),
    ).toMatchObject({
      label: PULL_REQUEST_SHIPPED,
      tone: PillTone.Success,
      tooltip: { values: { version: "2.4.1" } },
    });
    expect(
      getFixPullRequestStanding(
        link("4", { pullRequestState: PullRequestState.Closed }),
      ),
    ).toMatchObject({ label: PULL_REQUEST_CLOSED });
  });

  test("Link Pull Request is the route's Fix step's, while the case is open, the step to do, the reader allowed and the case not full", () => {
    const route: { key: string; isDone: boolean } = {
      key: ROUTE_KEY,
      isDone: false,
    };
    const allowed: {
      isClosed: boolean;
      isAllowed: boolean;
      linkedCount: number;
      max: number;
    } = {
      isClosed: false,
      isAllowed: true,
      linkedCount: 0,
      max: SECURITY_CASE_PULL_REQUESTS_MAX,
    };

    expect(isRouteFixStep(route)).toBe(true);
    expect(canLinkPullRequest({ step: route, ...allowed })).toBe(true);
    expect(
      canLinkPullRequest({
        step: { key: "fix:credentials", isDone: false },
        ...allowed,
      }),
    ).toBe(false);
    expect(
      canLinkPullRequest({ step: route, ...allowed, isClosed: true }),
    ).toBe(false);
    expect(
      canLinkPullRequest({ step: { ...route, isDone: true }, ...allowed }),
    ).toBe(false);
    expect(
      canLinkPullRequest({ step: route, ...allowed, isAllowed: false }),
    ).toBe(false);
    expect(
      canLinkPullRequest({
        step: route,
        ...allowed,
        linkedCount: SECURITY_CASE_PULL_REQUESTS_MAX,
      }),
    ).toBe(false);
  });
});

describe("on the case's Response Plan", () => {
  test("whoever works the case sees Link Pull Request on the route's Fix step, and on no other step", async () => {
    await drawn();

    expect(
      within(routeStep()).getByTestId(
        SECURITY_CASE_RESPONSE_TEST_IDS.linkPullRequest,
      ),
    ).toHaveTextContent(LINK_PULL_REQUEST);
    expect(
      screen.getAllByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.linkPullRequest),
    ).toHaveLength(1);
  });

  test("the dialog takes the address, sends it with the case, and the card reads the link back", async () => {
    await drawn();
    await openDialog();

    linked = [link("33333333-3333-4333-8333-333333333333")];
    await submit(`  ${ADDRESS}/files  `);

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    const sent: SecurityCasePullRequest = (
      createMock.mock.calls[0]![0] as { model: SecurityCasePullRequest }
    ).model;

    expect(sent.securityCaseId?.toString()).toBe(CASE_ID);
    // As pasted: the server reads the pull request out of it, and refuses what is none.
    expect(sent.pullRequestUrl?.toString()).toBe(`${ADDRESS}/files`);
    expect(Toast.success).toHaveBeenCalledWith(
      "Linked acme/search#482. OneUptime follows it to its deploy.",
    );

    await waitFor(() => {
      expect(
        within(routeStep()).getByTestId(
          SECURITY_CASE_RESPONSE_TEST_IDS.pullRequest,
        ),
      ).toHaveTextContent("acme/search#482");
    });
    // The dialog closed.
    expect(
      screen.queryByTestId("modal-footer-submit-button"),
    ).not.toBeInTheDocument();
  });

  test("an address with no scheme is sent as https", async () => {
    await drawn();
    await openDialog();
    await submit("github.com/acme/search/pull/482");

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    expect(
      (
        createMock.mock.calls[0]![0] as { model: SecurityCasePullRequest }
      ).model.pullRequestUrl?.toString(),
    ).toBe(ADDRESS);
  });

  test("a refusal is said in the dialog, in the server's words, and the dialog stays open", async () => {
    const refusal: string =
      "acme/search is not connected to this project. Connect it under Code, so OneUptime can follow its pull requests to their deploy.";

    createMock.mockRejectedValue(new Error(refusal) as never);
    jest.spyOn(API, "getFriendlyMessage").mockReturnValue(refusal);

    await drawn();
    await openDialog();
    await submit(ADDRESS);

    await waitFor(() => {
      expect(screen.getByText(refusal)).toBeInTheDocument();
    });
    expect(screen.getByTestId("modal-footer-submit-button")).toBeInTheDocument();
    expect(Toast.success).not.toHaveBeenCalled();
  });

  test("each link is drawn under the step with where it stands, and taken off by whoever may link one", async () => {
    linked = [
      link("33333333-3333-4333-8333-333333333331"),
      link("33333333-3333-4333-8333-333333333332", {
        pullRequestNumber: 483,
        pullRequestState: PullRequestState.Merged,
      }),
      link("33333333-3333-4333-8333-333333333333", {
        pullRequestNumber: 484,
        pullRequestState: PullRequestState.Merged,
        deployedAt: new Date("2026-11-17T20:00:00.000Z"),
        deployedVersion: "2.4.1",
      }),
    ];

    await drawn();

    const rows: Array<HTMLElement> = await within(routeStep()).findAllByTestId(
      SECURITY_CASE_RESPONSE_TEST_IDS.pullRequest,
    );

    expect(
      rows.map((row: HTMLElement): string => {
        return row.textContent || "";
      }),
    ).toEqual([
      `acme/search#482${PULL_REQUEST_OPEN}`,
      `acme/search#483${PULL_REQUEST_MERGED}`,
      `acme/search#484${PULL_REQUEST_SHIPPED}`,
    ]);

    await act(async () => {
      fireEvent.click(
        within(rows[0]!).getByTestId(
          SECURITY_CASE_RESPONSE_TEST_IDS.unlinkPullRequest,
        ),
      );
    });

    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalledTimes(1);
    });
    expect(
      (deleteMock.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
    ).toBe("33333333-3333-4333-8333-333333333331");
    expect(Toast.success).toHaveBeenCalledWith(
      "Took acme/search#482 off this case.",
    );
  });

  test("a Security Viewer sees the links, and neither Link Pull Request nor taking one off", async () => {
    permissions = [Permission.SecurityViewer];
    linked = [link("33333333-3333-4333-8333-333333333331")];

    await drawn();

    expect(
      await within(routeStep()).findByTestId(
        SECURITY_CASE_RESPONSE_TEST_IDS.pullRequest,
      ),
    ).toHaveTextContent("acme/search#482");
    expect(
      screen.queryByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.linkPullRequest),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.unlinkPullRequest),
    ).not.toBeInTheDocument();
  });
});
