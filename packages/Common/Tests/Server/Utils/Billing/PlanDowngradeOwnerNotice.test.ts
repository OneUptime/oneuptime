import PlanDowngradeOwnerNotice, {
  PlanDowngradeNoticeOutcome,
  PROJECT_BILLING_SETTINGS_PATH,
  StoppedByPlanChange,
} from "../../../../Server/Utils/Billing/PlanDowngradeOwnerNotice";
import ApiKeyService from "../../../../Server/Services/ApiKeyService";
import ProjectSCIMService from "../../../../Server/Services/ProjectSCIMService";
import ProjectService from "../../../../Server/Services/ProjectService";
import StatusPageSCIMService from "../../../../Server/Services/StatusPageSCIMService";
import logger from "../../../../Server/Utils/Logger";
import Project from "../../../../Models/DatabaseModels/Project";
import { PlanCutoffCredential } from "../../../../Types/Billing/PlanCutoffCredentials";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { getJestSpyOn } from "../../../Spy";
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

type MockGlobal = typeof globalThis & {
  __planDowngradeNoticeDashboardUrl: string;
};

jest.mock("../../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const urlModule: { default: { fromString: (url: string) => unknown } } =
    jest.requireActual("../../../../Types/API/URL");
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: MockGlobal = globalThis as MockGlobal;
  mockGlobal.__planDowngradeNoticeDashboardUrl =
    "https://oneuptime.example.com/dashboard";

  Object.defineProperty(mocked, "DashboardClientUrl", {
    configurable: true,
    enumerable: true,
    get: (): unknown => {
      return urlModule.default.fromString(
        mockGlobal.__planDowngradeNoticeDashboardUrl,
      );
    },
  });

  return mocked;
});

/*
 * The project's owners hear it once, when a plan change stops the project's
 * API keys or SCIM connections: what moved, what stopped and what that
 * means, that nothing was deleted, and where to upgrade. A change that stops
 * nothing - an upgrade, a move between two plans that both lack them, a
 * project with none to stop - sends nothing. It is the owners' billing email
 * (ProjectService.sendEmailToProjectOwners), and it never throws.
 */

const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

const PLAN_ID: Record<PlanType, string> = {
  [PlanType.Free]: "price_free_month",
  [PlanType.Growth]: "price_growth_month",
  [PlanType.Scale]: "price_scale_year",
  [PlanType.Enterprise]: "price_enterprise_month",
};

const PROJECT_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000001",
);

const SETTINGS_LINK: string = `https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/settings/billing`;

const savedPlanEnvironment: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("SUBSCRIPTION_PLAN_")) {
      savedPlanEnvironment[key] = process.env[key];
      delete process.env[key];
    }
  }

  Object.assign(process.env, PLAN_ENVIRONMENT);
});

afterAll(() => {
  for (const key of Object.keys(PLAN_ENVIRONMENT)) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(savedPlanEnvironment)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
});

let apiKeyCount: ReturnType<typeof getJestSpyOn>;
let projectScimCount: ReturnType<typeof getJestSpyOn>;
let statusPageScimCount: ReturnType<typeof getJestSpyOn>;
let findProject: ReturnType<typeof getJestSpyOn>;
let sendEmail: ReturnType<typeof getJestSpyOn>;
let loggedErrors: ReturnType<typeof getJestSpyOn>;

const has: (counts: {
  apiKeys?: number;
  projectScim?: number;
  statusPageScim?: number;
}) => void = (counts: {
  apiKeys?: number;
  projectScim?: number;
  statusPageScim?: number;
}): void => {
  apiKeyCount.mockResolvedValue(new PositiveNumber(counts.apiKeys || 0));
  projectScimCount.mockResolvedValue(
    new PositiveNumber(counts.projectScim || 0),
  );
  statusPageScimCount.mockResolvedValue(
    new PositiveNumber(counts.statusPageScim || 0),
  );
};

beforeEach(() => {
  (globalThis as MockGlobal).__planDowngradeNoticeDashboardUrl =
    "https://oneuptime.example.com/dashboard";

  apiKeyCount = getJestSpyOn(ApiKeyService, "countBy");
  projectScimCount = getJestSpyOn(ProjectSCIMService, "countBy");
  statusPageScimCount = getJestSpyOn(StatusPageSCIMService, "countBy");
  has({});

  const project: Project = new Project();
  project.name = "Acme Production";
  findProject = getJestSpyOn(ProjectService, "findOneById").mockResolvedValue(
    project,
  );
  sendEmail = getJestSpyOn(
    ProjectService,
    "sendEmailToProjectOwners",
  ).mockResolvedValue(undefined);
  loggedErrors = getJestSpyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

const move: (
  from: PlanType | null,
  to: PlanType,
) => Promise<PlanDowngradeNoticeOutcome> = async (
  from: PlanType | null,
  to: PlanType,
): Promise<PlanDowngradeNoticeOutcome> => {
  return await PlanDowngradeOwnerNotice.notifyIfStopped({
    projectId: PROJECT_ID,
    fromPlanId: from ? PLAN_ID[from] : undefined,
    toPlanId: PLAN_ID[to],
  });
};

const sentHtml: () => string = (): string => {
  return sendEmail.mock.calls[0]![2] as string;
};

const sentSubject: () => string = (): string => {
  return sendEmail.mock.calls[0]![1] as string;
};

describe("what a move stops", () => {
  test.each([
    [
      PlanType.Scale,
      PlanType.Free,
      [
        PlanCutoffCredential.ApiKey,
        PlanCutoffCredential.ProjectSCIM,
        PlanCutoffCredential.StatusPageSCIM,
      ],
    ],
    [
      PlanType.Enterprise,
      PlanType.Free,
      [
        PlanCutoffCredential.ApiKey,
        PlanCutoffCredential.ProjectSCIM,
        PlanCutoffCredential.StatusPageSCIM,
      ],
    ],
    [
      PlanType.Scale,
      PlanType.Growth,
      [PlanCutoffCredential.ProjectSCIM, PlanCutoffCredential.StatusPageSCIM],
    ],
    [
      PlanType.Enterprise,
      PlanType.Growth,
      [PlanCutoffCredential.ProjectSCIM, PlanCutoffCredential.StatusPageSCIM],
    ],
    [PlanType.Growth, PlanType.Free, [PlanCutoffCredential.ApiKey]],
    [PlanType.Enterprise, PlanType.Scale, []],
    [PlanType.Free, PlanType.Growth, []],
    [PlanType.Growth, PlanType.Scale, []],
    [PlanType.Free, PlanType.Enterprise, []],
    [PlanType.Growth, PlanType.Growth, []],
    [PlanType.Free, PlanType.Free, []],
  ])(
    "%s to %s stops %j",
    (
      from: PlanType,
      to: PlanType,
      expected: Array<PlanCutoffCredential>,
    ) => {
      expect(
        PlanDowngradeOwnerNotice.getCredentialsStoppedByMove({
          fromPlan: from,
          toPlan: to,
        }),
      ).toEqual(expected);
    },
  );

  test("from no plan, nothing worked, so nothing stops", () => {
    expect(
      PlanDowngradeOwnerNotice.getCredentialsStoppedByMove({
        fromPlan: null,
        toPlan: PlanType.Free,
      }),
    ).toEqual([]);
  });
});

describe("what is counted", () => {
  test("the project's API keys that have not expired", async () => {
    has({ apiKeys: 3 });

    const stopped: StoppedByPlanChange =
      await PlanDowngradeOwnerNotice.countStopped({
        projectId: PROJECT_ID,
        credentials: [PlanCutoffCredential.ApiKey],
      });

    expect(stopped).toEqual({ apiKeys: 3, scimConnections: 0 });

    const countBy: { query: Record<string, unknown>; props: unknown } =
      apiKeyCount.mock.calls[0]![0] as {
        query: Record<string, unknown>;
        props: unknown;
      };

    expect(String(countBy.query["projectId"])).toBe(PROJECT_ID.toString());
    expect(countBy.query["expiresAt"]).toBeDefined();
    expect(countBy.props).toEqual({ isRoot: true });
    expect(projectScimCount).not.toHaveBeenCalled();
    expect(statusPageScimCount).not.toHaveBeenCalled();
  });

  test("the project's SCIM connections and its status pages', together", async () => {
    has({ projectScim: 1, statusPageScim: 2 });

    const stopped: StoppedByPlanChange =
      await PlanDowngradeOwnerNotice.countStopped({
        projectId: PROJECT_ID,
        credentials: [
          PlanCutoffCredential.ProjectSCIM,
          PlanCutoffCredential.StatusPageSCIM,
        ],
      });

    expect(stopped).toEqual({ apiKeys: 0, scimConnections: 3 });
    expect(apiKeyCount).not.toHaveBeenCalled();

    for (const spy of [projectScimCount, statusPageScimCount]) {
      const countBy: { query: Record<string, unknown> } = spy.mock
        .calls[0]![0] as { query: Record<string, unknown> };

      expect(String(countBy.query["projectId"])).toBe(PROJECT_ID.toString());
    }
  });
});

describe("a downgrade that stops API keys", () => {
  test("emails the owners once: what moved, what stopped, and where to upgrade", async () => {
    has({ apiKeys: 3 });

    expect(await move(PlanType.Growth, PlanType.Free)).toBe(
      PlanDowngradeNoticeOutcome.Told,
    );

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(String(sendEmail.mock.calls[0]![0])).toBe(PROJECT_ID.toString());
    expect(sentSubject()).toBe("API keys stopped working in Acme Production");

    const html: string = sentHtml();

    expect(html).toContain(
      "Acme Production moved from the Growth plan to the Free plan.",
    );
    expect(html).toContain(
      "The project&#39;s 3 API keys stopped working: API keys need the Growth plan.",
    );
    expect(html).toContain("Terraform, the CLI, an MCP client");
    expect(html).toContain(
      "Nothing was deleted. Upgrade the project in Project Settings &gt; Billing and they work again as they are: there are no new keys to make.",
    );
    expect(html).toContain(`<a href="${SETTINGS_LINK}">${SETTINGS_LINK}</a>`);
    expect(html).not.toContain("SCIM needs");
    expect(html).not.toContain("identity provider");
  });

  test("says 'the API key' for one", async () => {
    has({ apiKeys: 1 });

    await move(PlanType.Scale, PlanType.Free);

    expect(sentHtml()).toContain(
      "The project&#39;s API key stopped working: API keys need the Growth plan.",
    );
  });
});

describe("a downgrade that stops SCIM", () => {
  test("tells the owners that provisioning and deprovisioning stopped", async () => {
    has({ projectScim: 1, statusPageScim: 1 });

    expect(await move(PlanType.Scale, PlanType.Growth)).toBe(
      PlanDowngradeNoticeOutcome.Told,
    );

    expect(sentSubject()).toBe("SCIM provisioning stopped in Acme Production");

    const html: string = sentHtml();

    expect(html).toContain(
      "The project&#39;s 2 SCIM connections stopped working: SCIM needs the Scale plan.",
    );
    expect(html).toContain(
      "Your identity provider can no longer add people to the project or remove them, so remove anyone who leaves by hand",
    );
    expect(html).toContain(
      "they work again as they are: nothing needs setting up again in your identity provider.",
    );
    expect(html).not.toContain("API keys need");
    expect(html).not.toContain("new keys");
    expect(apiKeyCount).not.toHaveBeenCalled();
  });

  test("says 'the SCIM connection' for one", async () => {
    has({ statusPageScim: 1 });

    await move(PlanType.Enterprise, PlanType.Growth);

    expect(sentHtml()).toContain(
      "The project&#39;s SCIM connection stopped working",
    );
  });
});

describe("a downgrade that stops both", () => {
  test("is one email naming both", async () => {
    has({ apiKeys: 2, projectScim: 1 });

    await move(PlanType.Scale, PlanType.Free);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sentSubject()).toBe(
      "API keys and SCIM stopped working in Acme Production",
    );
    expect(sentHtml()).toContain("2 API keys stopped working");
    expect(sentHtml()).toContain("SCIM connection stopped working");
    expect(sentHtml()).toContain(
      "no new keys to make, and nothing to set up again in your identity provider.",
    );
  });
});

describe("a plan change that stops nothing sends nothing", () => {
  test("an upgrade", async () => {
    has({ apiKeys: 5, projectScim: 5 });

    expect(await move(PlanType.Free, PlanType.Scale)).toBe(
      PlanDowngradeNoticeOutcome.NothingStopped,
    );
    expect(sendEmail).not.toHaveBeenCalled();
    expect(apiKeyCount).not.toHaveBeenCalled();
  });

  test("a move within the plan, monthly to yearly", async () => {
    has({ apiKeys: 5 });

    expect(
      await PlanDowngradeOwnerNotice.notifyIfStopped({
        projectId: PROJECT_ID,
        fromPlanId: "price_growth_month",
        toPlanId: "price_growth_year",
      }),
    ).toBe(PlanDowngradeNoticeOutcome.NothingStopped);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test("a downgrade of a project with nothing to stop", async () => {
    has({});

    expect(await move(PlanType.Scale, PlanType.Free)).toBe(
      PlanDowngradeNoticeOutcome.NothingStopped,
    );
    expect(sendEmail).not.toHaveBeenCalled();
    expect(findProject).not.toHaveBeenCalled();
  });

  test("a move from no known plan", async () => {
    has({ apiKeys: 5 });

    expect(await move(null, PlanType.Free)).toBe(
      PlanDowngradeNoticeOutcome.NothingStopped,
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test("a move to a plan that is not configured", async () => {
    has({ apiKeys: 5 });

    expect(
      await PlanDowngradeOwnerNotice.notifyIfStopped({
        projectId: PROJECT_ID,
        fromPlanId: PLAN_ID[PlanType.Growth],
        toPlanId: "price_unknown",
      }),
    ).toBe(PlanDowngradeNoticeOutcome.NothingStopped);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("it never throws", () => {
  test("a count that fails is logged, and the plan change stands", async () => {
    apiKeyCount.mockRejectedValue(new Error("connection reset"));

    expect(await move(PlanType.Growth, PlanType.Free)).toBe(
      PlanDowngradeNoticeOutcome.Failed,
    );
    expect(sendEmail).not.toHaveBeenCalled();
    expect(loggedErrors).toHaveBeenCalledTimes(1);
    expect(String(loggedErrors.mock.calls[0]![0])).toContain(
      PROJECT_ID.toString(),
    );
  });

  test("an email that cannot be queued is logged", async () => {
    has({ apiKeys: 1 });
    sendEmail.mockRejectedValue(new Error("mail queue down"));

    expect(await move(PlanType.Growth, PlanType.Free)).toBe(
      PlanDowngradeNoticeOutcome.Failed,
    );
    expect(loggedErrors).toHaveBeenCalledTimes(1);
  });
});

describe("what the email holds", () => {
  test("escapes the project's name, which its owners chose", async () => {
    const project: Project = new Project();
    project.name = '<img src=x onerror="alert(1)">';
    findProject.mockResolvedValue(project);
    has({ apiKeys: 1 });

    await move(PlanType.Growth, PlanType.Free);

    expect(sentHtml()).not.toContain("<img");
    expect(sentHtml()).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  test("names 'your project' when the project has no name", async () => {
    findProject.mockResolvedValue(null);
    has({ apiKeys: 1 });

    await move(PlanType.Growth, PlanType.Free);

    expect(sentSubject()).toBe("API keys stopped working in your project");
    expect(sentHtml()).toContain(
      "Your project moved from the Growth plan to the Free plan.",
    );
  });

  test("links to the project's Billing settings", () => {
    expect(
      PlanDowngradeOwnerNotice.getSettingsLink(PROJECT_ID)?.toString(),
    ).toBe(SETTINGS_LINK);
    expect(PROJECT_BILLING_SETTINGS_PATH).toBe("settings/billing");
  });

  test("without a configured dashboard address, says where Billing is instead of linking", async () => {
    (globalThis as MockGlobal).__planDowngradeNoticeDashboardUrl = "http:///";
    has({ apiKeys: 1 });

    await move(PlanType.Growth, PlanType.Free);

    expect(sentHtml()).not.toContain("<a href");
    expect(sentHtml()).toContain(
      "Upgrade the project in Project Settings &gt; Billing and they work again as they are: there are no new keys to make.",
    );
  });

  test("says when owners get it", async () => {
    has({ apiKeys: 1 });

    await move(PlanType.Growth, PlanType.Free);

    expect(sentHtml()).toContain(
      "Project owners get this email when a plan change stops the project&#39;s API keys or SCIM connections.",
    );
  });
});
