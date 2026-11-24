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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";

/*
 * SECURITY EVENTS -> AI -> SETTINGS: LET ONEUPTIME AI RESPOND FIRST
 * (#10353), through the real card: one switch saved as it is flipped, and,
 * once it is on, the priority cases are held below and for how long, with
 * what the choice holds and alerts at once in plain words, and what is
 * never held. Offered only while OneUptime AI may work cases; and, while
 * every containment asks first, it says most cases reach people as soon
 * as OneUptime AI asks. Only the project's read and write (ModelAPI) and
 * the priorities' read (ModelListCache) are stubbed.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
        i18n: { language: "en", resolvedLanguage: "en" },
      };
    },
  };
});

import SecurityCaseAiRespondFirstCard, {
  isAnySecurityCaseContainmentOnItsOwn,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/SecurityCaseAiRespondFirstCard";
import {
  SECURITY_CASE_AI_RESPOND_FIRST_TEST_ID,
  SecurityCaseAiRespondFirstCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/SecurityCaseAiRespondFirstCopy";
import Project from "../../../Models/DatabaseModels/Project";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  SECURITY_CASE_AI_MODE_COLUMNS,
  SECURITY_CASE_AI_STAMPS_COLUMN,
  SecurityCaseAiArea,
  SecurityCaseAiMode,
} from "../../../Types/SecurityCase/SecurityCaseAi";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ModelListCache from "../../../UI/Utils/ModelListCache";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";
import User from "../../../UI/Utils/User";
import { buildDefaultTestPriorities } from "../../Helpers/SecurityCaseValues";

const PROJECT_ID: ObjectID = new ObjectID(
  "c4510000-0000-4000-8000-000000000001",
);
const TEST_ID: string = SECURITY_CASE_AI_RESPOND_FIRST_TEST_ID;

let columns: Record<string, unknown>;
let writes: Array<Record<string, unknown>>;

function grant(permissions: Array<Permission>): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: PROJECT_ID,
    userId: ObjectID.generate(),
    permissions: permissions.map((permission: Permission) => {
      return {
        permission: permission,
        labelIds: [],
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);
}

beforeEach(() => {
  columns = {};
  writes = [];
  grant([Permission.ProjectOwner]);

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
    const project: Project = new Project(PROJECT_ID);
    Object.assign(project, columns);
    return project;
  }) as never);
  jest.spyOn(ModelListCache, "getList").mockImplementation((async (args: {
    modelType: unknown;
  }) => {
    const data: Array<SecurityCasePriority> =
      args.modelType === SecurityCasePriority
        ? buildDefaultTestPriorities(PROJECT_ID)
        : [];
    return { data, count: data.length, skip: 0, limit: 100 };
  }) as never);
  jest.spyOn(ModelAPI, "updateById").mockImplementation((async (args: {
    data: Record<string, unknown>;
  }) => {
    writes.push(args.data);
    return {};
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function renderCard(
  props: Partial<{
    isTriaging: boolean | null;
    isWorkingCases: boolean | null;
    limitsRevision: number;
  }> = {},
): void {
  render(
    <SecurityCaseAiRespondFirstCard
      isTriaging={props.isTriaging ?? true}
      isWorkingCases={props.isWorkingCases ?? true}
      limitsRevision={props.limitsRevision ?? 0}
    />,
  );
}

async function theSwitch(): Promise<HTMLElement> {
  return await screen.findByTestId(`${TEST_ID}-switch`);
}

describe("off, as every project starts", () => {
  test("one switch, off, and what is never held; nothing else to pick", async () => {
    renderCard();

    const toggle: HTMLElement = await theSwitch();

    expect(
      screen.getByText(SecurityCaseAiRespondFirstCopy.cardTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: /Respond first/ }),
    ).toHaveAttribute("aria-checked", "false");
    expect(toggle).toBeInTheDocument();
    expect(screen.queryByTestId(`${TEST_ID}-threshold-row`)).toBeNull();
    expect(screen.queryByTestId(`${TEST_ID}-minutes-row`)).toBeNull();
    expect(screen.getByTestId(`${TEST_ID}-never-held`)).toHaveTextContent(
      SecurityCaseAiRespondFirstCopy.neverHeld,
    );
  });

  test("flipping it on saves at once, and shows the two choices", async () => {
    renderCard();

    fireEvent.click(
      await screen.findByRole("switch", { name: /Respond first/ }),
    );

    await waitFor(() => {
      expect(writes).toEqual([{ enableSecurityCaseAiRespondsFirst: true }]);
    });
    expect(
      await screen.findByTestId(`${TEST_ID}-threshold-row`),
    ).toBeInTheDocument();
    expect(screen.getByTestId(`${TEST_ID}-minutes-row`)).toBeInTheDocument();
  });

  test("while OneUptime AI may not work cases, it is locked and says what to turn on", async () => {
    renderCard({ isWorkingCases: false });

    const toggle: HTMLElement = await screen.findByRole("switch", {
      name: /Respond first/,
    });

    expect(screen.getByTestId(`${TEST_ID}-needs-responder`)).toHaveTextContent(
      SecurityCaseAiRespondFirstCopy.needsResponder,
    );

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(writes).toEqual([]);
  });

  test("one already on can still be turned off when OneUptime AI may not work cases", async () => {
    columns = { enableSecurityCaseAiRespondsFirst: true };
    renderCard({ isTriaging: false });

    const toggle: HTMLElement = await screen.findByRole("switch", {
      name: /Respond first/,
    });

    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByTestId(`${TEST_ID}-needs-responder`)).toBeNull();

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(writes).toEqual([{ enableSecurityCaseAiRespondsFirst: false }]);
    });
  });
});

describe("who may change it", () => {
  test("a Security Admin, who does not run the project, sees it locked and why", async () => {
    grant([Permission.SecurityAdmin]);
    renderCard();

    const toggle: HTMLElement = await screen.findByRole("switch", {
      name: /Respond first/,
    });

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(writes).toEqual([]);
  });
});

describe("on", () => {
  test("holds cases below High until another is picked, saying which are held and which alert at once", async () => {
    columns = { enableSecurityCaseAiRespondsFirst: true };
    renderCard();

    const row: HTMLElement = await screen.findByTestId(
      `${TEST_ID}-threshold-row`,
    );

    expect(row).toHaveTextContent(
      SecurityCaseAiRespondFirstCopy.thresholdTitle,
    );
    expect(row).toHaveTextContent("High");
    expect(row).toHaveTextContent(
      "Held: Medium, Low, Informational. Alerted at once: Critical, High.",
    );
  });

  test("a hold of 10 minutes to start with", async () => {
    columns = { enableSecurityCaseAiRespondsFirst: true };
    renderCard();

    const row: HTMLElement = await screen.findByTestId(
      `${TEST_ID}-minutes-row`,
    );

    expect(row).toHaveTextContent(SecurityCaseAiRespondFirstCopy.holdTitle);
    expect(row).toHaveTextContent("10 minutes");
    expect(row).toHaveTextContent(
      SecurityCaseAiRespondFirstCopy.holdDescription,
    );
  });

  test("while every containment asks first, it says most cases reach people as soon as OneUptime AI asks", async () => {
    columns = { enableSecurityCaseAiRespondsFirst: true };
    renderCard();

    expect(
      await screen.findByTestId(`${TEST_ID}-asks-first`),
    ).toHaveTextContent(SecurityCaseAiRespondFirstCopy.asksFirstHint);
  });

  test("with a containment on its own, it says nothing of asking", async () => {
    columns = {
      enableSecurityCaseAiRespondsFirst: true,
      [SECURITY_CASE_AI_MODE_COLUMNS[SecurityCaseAiArea.Hosts]]:
        SecurityCaseAiMode.OnItsOwn,
    };
    renderCard();

    await screen.findByTestId(`${TEST_ID}-threshold-row`);

    expect(screen.queryByTestId(`${TEST_ID}-asks-first`)).toBeNull();
  });
});

describe("whether any containment runs on its own", () => {
  test("a user or a host, as soon as it is set so", () => {
    for (const area of [
      SecurityCaseAiArea.Accounts,
      SecurityCaseAiArea.Hosts,
    ]) {
      expect({
        area,
        isOnItsOwn: isAnySecurityCaseContainmentOnItsOwn({
          [SECURITY_CASE_AI_MODE_COLUMNS[area]]: SecurityCaseAiMode.OnItsOwn,
        }),
      }).toEqual({ area, isOnItsOwn: true });
    }
  });

  test("an address only once a Security Admin confirmed it", () => {
    expect(
      isAnySecurityCaseContainmentOnItsOwn({
        [SECURITY_CASE_AI_MODE_COLUMNS[SecurityCaseAiArea.Edge]]:
          SecurityCaseAiMode.OnItsOwn,
        [SECURITY_CASE_AI_STAMPS_COLUMN]: {},
      }),
    ).toBe(false);
  });

  test("nothing on its own, or Ask first everywhere: none", () => {
    expect(isAnySecurityCaseContainmentOnItsOwn({})).toBe(false);
    expect(
      isAnySecurityCaseContainmentOnItsOwn({
        [SECURITY_CASE_AI_MODE_COLUMNS[SecurityCaseAiArea.Accounts]]:
          SecurityCaseAiMode.Ask,
        [SECURITY_CASE_AI_MODE_COLUMNS[SecurityCaseAiArea.Hosts]]:
          SecurityCaseAiMode.Off,
      }),
    ).toBe(false);
  });
});
