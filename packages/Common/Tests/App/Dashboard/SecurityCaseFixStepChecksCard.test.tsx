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
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Fix steps' checks on a case's Response Plan card (#10347): the route's
 * fix in each state OneUptime can find it in - checked once the attack is
 * turned away, "no attempts since" while it waits, not fixed, stopped
 * holding, cannot tell - with what else it saw under How We Know (what got
 * through before, how many it waits for, until when) and the fix's pull
 * request one click away; the password reset, and the accounts still
 * without MFA, named.
 */

const getListMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();

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
import { SECURITY_CASE_RESPONSE_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponseCopy";
import { writeCheckTime } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponseChecks";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseStepCheck from "../../../Models/DatabaseModels/SecurityCaseStepCheck";
import SecurityCaseTask from "../../../Models/DatabaseModels/SecurityCaseTask";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import Realtime from "../../../UI/Utils/Realtime";
import UserUtil from "../../../UI/Utils/User";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import {
  FIX_CASE_TECHNIQUES,
  FIX_PULL_REQUEST_URL,
  FIX_ROUTE,
  FIX_SHIPPED_AT,
  FIX_USER,
  ROUTE_FIX_EVIDENCE,
  accountFixRows,
  fixCaseMatches,
  fixStepCheckRow,
} from "../../Helpers/SecurityCaseFixStepChecks";
import {
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
  testStatusId,
} from "../../Helpers/SecurityCaseValues";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const CASE_ID: string = "22222222-2222-4222-8222-222222222222";
const ROUTE_KEY: string = "fix:public-app";

let permissions: Array<Permission>;
let stepChecks: Array<SecurityCaseStepCheck>;

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

function stepOf(key: string): HTMLElement {
  const step: HTMLElement | undefined = screen
    .queryAllByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.step)
    .find((candidate: HTMLElement): boolean => {
      return candidate.getAttribute("data-step-key") === key;
    });

  expect({ key, drawn: Boolean(step) }).toEqual({ key, drawn: true });

  return step!;
}

function routeCheck(name: string): SecurityCaseStepCheck {
  return fixStepCheckRow({ key: ROUTE_KEY, ...ROUTE_FIX_EVIDENCE[name]! });
}

async function openHowWeKnow(step: HTMLElement): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(
      within(step).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.howWeKnow),
    );
  });

  return within(step).getByTestId(
    SECURITY_CASE_RESPONSE_TEST_IDS.howWeKnowPanel,
  );
}

// A moment of the evidence as the card writes it, on the reader's clock.
function at(time: string): string {
  return writeCheckTime(new Date(time));
}

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
  permissions = [Permission.SecurityMember];
  stepChecks = [];

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

  getListMock.mockReset();
  getListMock.mockImplementation(async (args: unknown) => {
    const data: Array<unknown> =
      (args as { modelType: unknown }).modelType === SecurityCaseStepCheck
        ? stepChecks
        : [];

    return { data, count: data.length };
  });
  createMock.mockReset();
  createMock.mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the plan's Fix steps", () => {
  test("name the route the requests went to, and the account the attack went after", async () => {
    await drawn();

    expect(
      within(stepOf(ROUTE_KEY)).getByTestId(
        SECURITY_CASE_RESPONSE_TEST_IDS.stepText,
      ),
    ).toHaveTextContent(
      `Fix how ${FIX_ROUTE} handles what it is sent, and patch the software behind it.`,
    );
    expect(
      within(stepOf("fix:credentials")).getByTestId(
        SECURITY_CASE_RESPONSE_TEST_IDS.stepText,
      ),
    ).toHaveTextContent(
      `Reset ${FIX_USER}'s password, and revoke their keys and tokens.`,
    );
    expect(stepOf("fix:brute-force")).toBeInTheDocument();
  });
});

describe("the route's fix, in each state", () => {
  test("checked: the attack turned away since the fix shipped, what got through before, and the fix's pull request", async () => {
    stepChecks = [routeCheck("verified")];
    await drawn();

    const step: HTMLElement = stepOf(ROUTE_KEY);

    expect(step).toHaveAttribute("data-done", "true");
    expect(
      within(step).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.checkChip),
    ).toHaveTextContent("Checked by OneUptime");
    // "Since v2.4.1 shipped at 14:10, all 18 attack requests to /api/search were turned away."
    expect(
      within(step).getByText(
        `Since v2.4.1 shipped at ${at(FIX_SHIPPED_AT)}, all 18 attack requests to ${FIX_ROUTE} were turned away.`,
      ),
    ).toBeInTheDocument();

    const panel: HTMLElement = await openHowWeKnow(step);

    // "Before it, 6 reached the database."
    expect(panel).toHaveTextContent(
      "Before it, 6 of 24 attack requests reached the database.",
    );

    const link: HTMLElement = within(panel).getByTestId(
      SECURITY_CASE_RESPONSE_TEST_IDS.checkLink,
    );

    expect(link).toHaveTextContent("Open in GitHub");
    expect(link.closest("a")).toHaveAttribute("href", FIX_PULL_REQUEST_URL);
    expect(
      within(step).queryByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.confirm),
    ).toBeNull();
  });

  test("no attempts since the fix: says exactly that, never checked, with until when it watches and how many it waits for, and Confirm", async () => {
    stepChecks = [routeCheck("noAttempts")];
    await drawn();

    const step: HTMLElement = stepOf(ROUTE_KEY);

    expect(step).toHaveAttribute("data-done", "false");
    expect(
      within(step).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.checkChip),
    ).toHaveTextContent("Looks Done");
    expect(
      within(step).getByText(
        `No attempts on ${FIX_ROUTE} since v2.4.1 shipped at ${at(FIX_SHIPPED_AT)}.`,
      ),
    ).toBeInTheDocument();
    expect(step).not.toHaveTextContent(/verified|Checked by OneUptime/);

    const panel: HTMLElement = await openHowWeKnow(step);

    // How much evidence counts as proof, said where it is used.
    expect(panel).toHaveTextContent(
      `Watching ${FIX_ROUTE} until ${at("2026-11-24T20:00:00.000Z")}: verified once 11 attack requests are kept out of the database.`,
    );
    expect(
      within(step).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.confirm),
    ).toHaveTextContent("Confirm");
  });

  test("not fixed: the attack still reaches the database, with the requests that got through to open", async () => {
    stepChecks = [routeCheck("notFixed")];
    await drawn();

    const step: HTMLElement = stepOf(ROUTE_KEY);

    expect(
      within(step).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.checkChip),
    ).toHaveTextContent("Not Done Yet");
    expect(
      within(step).getByText(
        `3 of the 5 attack requests to ${FIX_ROUTE} since v2.4.1 shipped at ${at(FIX_SHIPPED_AT)} reached the database.`,
      ),
    ).toBeInTheDocument();

    const panel: HTMLElement = await openHowWeKnow(step);

    expect(
      within(panel).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.checkLink),
    ).toHaveTextContent("Open Traces");
  });

  test("stopped holding: said at the top of the card, and beside the step", async () => {
    stepChecks = [routeCheck("regressed")];
    await drawn();

    expect(
      screen.getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.regressed),
    ).toHaveTextContent(
      `An attack request to ${FIX_ROUTE} reached the database at ${at("2026-11-17T20:40:00.000Z")}, after v2.4.1 shipped: the fix is not holding.`,
    );
    expect(
      within(stepOf(ROUTE_KEY)).getByTestId(
        SECURITY_CASE_RESPONSE_TEST_IDS.checkChip,
      ),
    ).toHaveTextContent("Stopped Holding");
  });

  test("cannot tell: why at once, with how to let OneUptime check it", async () => {
    stepChecks = [routeCheck("cannotTell")];
    await drawn();

    const step: HTMLElement = stepOf(ROUTE_KEY);

    expect(
      within(step).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.checkChip),
    ).toHaveTextContent("OneUptime Cannot Tell");
    expect(
      within(step).getByText(
        "OneUptime records no deploys of search-api, so it cannot tell when a fix ships.",
      ),
    ).toBeInTheDocument();
    expect(
      within(step).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.docsLink),
    ).toHaveTextContent("How to let OneUptime check this");
  });
});

describe("the accounts' fixes", () => {
  test("the password reset is checked, and the accounts still without MFA are named", async () => {
    stepChecks = accountFixRows();
    await drawn();

    expect(
      within(stepOf("fix:credentials")).getByTestId(
        SECURITY_CASE_RESPONSE_TEST_IDS.checkChip,
      ),
    ).toHaveTextContent("Checked by OneUptime");
    expect(
      within(stepOf("fix:credentials")).getByText(
        `${FIX_USER}'s password was changed in Okta at ${at("2026-11-17T20:05:00.000Z")}, and their sessions were ended at ${at("2026-11-17T20:06:00.000Z")}.`,
      ),
    ).toBeInTheDocument();

    const mfa: HTMLElement = stepOf("fix:brute-force");

    expect(
      within(mfa).getByText(
        "bob@acme.com, 1 of the 2 accounts the attack went after, has no MFA set up.",
      ),
    ).toBeInTheDocument();

    const panel: HTMLElement = await openHowWeKnow(mfa);

    expect(panel).toHaveTextContent(
      "bob@acme.com has no MFA set up in Microsoft Entra ID.",
    );
    expect(panel).toHaveTextContent(`${FIX_USER} has MFA set up in Okta.`);
    // A step OneUptime does not see done is the person's to tick anyway.
    expect(
      within(mfa).getByTestId(SECURITY_CASE_RESPONSE_TEST_IDS.checkbox),
    ).not.toBeDisabled();
    expect(getListMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelType: SecurityCaseTask }),
    );
  });
});
