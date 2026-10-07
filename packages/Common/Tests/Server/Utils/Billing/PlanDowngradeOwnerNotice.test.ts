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
import { setTestBillingEnabled } from "../../Enterprise/TestBillingFlag";
import ApiKey from "../../../../Models/DatabaseModels/ApiKey";
import ProjectSCIM from "../../../../Models/DatabaseModels/ProjectSCIM";
import StatusPageSCIM from "../../../../Models/DatabaseModels/StatusPageSCIM";
import BadDataException from "../../../../Types/Exception/BadDataException";
import User from "../../../../Models/DatabaseModels/User";
import Email from "../../../../Types/Email";
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
  const billingFlag: typeof import("../../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../../Enterprise/TestBillingFlag",
    ) as typeof import("../../Enterprise/TestBillingFlag");
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const urlModule: { default: { fromString: (url: string) => unknown } } =
    jest.requireActual("../../../../Types/API/URL") as {
      default: { fromString: (url: string) => unknown };
    };
  const mocked: Record<string, unknown> =
    billingFlag.withLiveBillingFlag(actual);
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
 * The project's owners hear it when a plan change stops the project's API
 * keys or limits its SCIM connections: what moved, what stopped and what
 * that means - SCIM still removes people - that nothing was deleted, and
 * where to upgrade. A change that stops nothing - an upgrade, a move between
 * two plans that both lack them, a project with none to stop - sends
 * nothing. A plan change that tells them records it (planCutoffNoticeSentAt)
 * so the one-time notice does not tell them again.
 *
 * And once, the owners of projects that were already below those plans
 * when the cut-off shipped (notifyProjectsAlreadyBelowPlan, the data
 * migration NotifyOwnersOfStoppedApiKeysAndScim): told what the plan the
 * project is on stops, in the same words; claimed by one conditional
 * UPDATE, so never twice; nothing at all with billing off.
 *
 * It is the owners' billing email (ProjectService.sendEmailToProjectOwners;
 * the one-time notice waits for it, sendEmailToOwnersAndWait, as the migrate
 * Job exits when it is done), and it never throws.
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
let markTold: ReturnType<typeof getJestSpyOn>;

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
  markTold = getJestSpyOn(
    ProjectService,
    "markPlanCutoffNoticeSent",
  ).mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  setTestBillingEnabled(false);
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
    (from: PlanType, to: PlanType, expected: Array<PlanCutoffCredential>) => {
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
      "Nothing was deleted. Upgrade the project in Project Settings &gt; Billing and they work fully again as they are: there are no new keys to make.",
    );
    expect(html).toContain(`<a href="${SETTINGS_LINK}">${SETTINGS_LINK}</a>`);
    expect(html).toContain("until the project is back on Growth.");
    expect(html).not.toContain("SCIM needs");
    expect(html).not.toContain("identity provider");
  });

  test("records that the owners were told, so the one-time notice does not tell them again", async () => {
    has({ apiKeys: 3 });

    await move(PlanType.Growth, PlanType.Free);

    expect(markTold).toHaveBeenCalledTimes(1);
    expect(
      String((markTold.mock.calls[0]![0] as { projectId: ObjectID }).projectId),
    ).toBe(PROJECT_ID.toString());
    expect((markTold.mock.calls[0]![0] as { now: unknown }).now).toBeInstanceOf(
      Date,
    );
    // After the email: a record of what was sent.
    expect(markTold.mock.invocationCallOrder[0]!).toBeGreaterThan(
      sendEmail.mock.invocationCallOrder[0]!,
    );
  });

  test("a record that cannot be written is logged; the owners were still told", async () => {
    has({ apiKeys: 3 });
    markTold.mockRejectedValue(new Error("connection reset"));

    expect(await move(PlanType.Growth, PlanType.Free)).toBe(
      PlanDowngradeNoticeOutcome.Told,
    );
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(loggedErrors).toHaveBeenCalledTimes(1);
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
  test("tells the owners that adding people stopped, and that removing people still works", async () => {
    has({ projectScim: 1, statusPageScim: 1 });

    expect(await move(PlanType.Scale, PlanType.Growth)).toBe(
      PlanDowngradeNoticeOutcome.Told,
    );

    expect(sentSubject()).toBe("SCIM stopped adding people in Acme Production");

    const html: string = sentHtml();

    expect(html).toContain(
      "The project&#39;s 2 SCIM connections stopped adding people: SCIM needs the Scale plan.",
    );
    expect(html).toContain(
      "Your identity provider can still remove people from the project, so anyone who leaves loses their access as before, but it can no longer add people or change them until the project is back on Scale.",
    );
    expect(html).toContain(
      "they work fully again as they are: nothing needs setting up again in your identity provider.",
    );
    // No longer the advice of #4481: removing people by hand.
    expect(html).not.toContain("by hand");
    expect(html).not.toContain("API keys need");
    expect(html).not.toContain("new keys");
    expect(apiKeyCount).not.toHaveBeenCalled();
  });

  test("says 'the SCIM connection' for one", async () => {
    has({ statusPageScim: 1 });

    await move(PlanType.Enterprise, PlanType.Growth);

    expect(sentHtml()).toContain(
      "The project&#39;s SCIM connection stopped adding people",
    );
  });
});

describe("a downgrade that stops both", () => {
  test("is one email naming both", async () => {
    has({ apiKeys: 2, projectScim: 1 });

    await move(PlanType.Scale, PlanType.Free);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sentSubject()).toBe(
      "API keys stopped working and SCIM stopped adding people in Acme Production",
    );
    expect(sentHtml()).toContain("2 API keys stopped working");
    expect(sentHtml()).toContain("SCIM connection stopped adding people");
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
    expect(markTold).not.toHaveBeenCalled();
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
    expect(sentHtml()).toContain(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
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
      "Upgrade the project in Project Settings &gt; Billing and they work fully again as they are: there are no new keys to make.",
    );
  });

  test("says when owners get it", async () => {
    has({ apiKeys: 1 });

    await move(PlanType.Growth, PlanType.Free);

    expect(sentHtml()).toContain(
      "Project owners get this email when a plan change stops the project&#39;s API keys or SCIM provisioning.",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * The one-time notice: projects already below the plans when the cut-off
 * shipped.
 * ---------------------------------------------------------------------------
 */

const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000002",
);

describe("the one-time notice to a project already below the plan", () => {
  let getCurrentPlan: ReturnType<typeof getJestSpyOn>;
  let claim: ReturnType<typeof getJestSpyOn>;
  let release: ReturnType<typeof getJestSpyOn>;
  let getOwners: ReturnType<typeof getJestSpyOn>;
  let sendAndWait: ReturnType<typeof getJestSpyOn>;

  // The plan getCurrentPlan answers with.
  let plan: PlanType | null = PlanType.Free;

  const owner: (email: string) => User = (email: string): User => {
    const user: User = new User(ObjectID.generate());
    user.email = new Email(email);
    return user;
  };

  const OWNERS: Array<User> = [
    owner("owner@acme.example"),
    owner("cto@acme.example"),
  ];

  // What the waited send was given, for the one email it sends.
  const sent: () => {
    projectId: ObjectID;
    owners: Array<User>;
    subject: string;
    message: string;
  } = () => {
    return sendAndWait.mock.calls[0]![0] as {
      projectId: ObjectID;
      owners: Array<User>;
      subject: string;
      message: string;
    };
  };

  beforeEach(() => {
    plan = PlanType.Free;
    getCurrentPlan = getJestSpyOn(
      ProjectService,
      "getCurrentPlan",
    ).mockImplementation(async () => {
      return { plan, isSubscriptionUnpaid: false };
    });
    claim = getJestSpyOn(
      ProjectService,
      "claimPlanCutoffNotice",
    ).mockResolvedValue(true);
    release = getJestSpyOn(
      ProjectService,
      "releasePlanCutoffNotice",
    ).mockResolvedValue(undefined);
    getOwners = getJestSpyOn(ProjectService, "getOwners").mockResolvedValue(
      OWNERS,
    );
    sendAndWait = getJestSpyOn(
      ProjectService,
      "sendEmailToOwnersAndWait",
    ).mockImplementation(async (data: unknown) => {
      return (data as { owners: Array<User> }).owners.length;
    });
  });

  const notify: () => Promise<PlanDowngradeNoticeOutcome> = async () => {
    return await PlanDowngradeOwnerNotice.notifyIfAlreadyBelowPlan({
      projectId: PROJECT_ID,
    });
  };

  test.each([
    [
      PlanType.Free,
      [
        PlanCutoffCredential.ApiKey,
        PlanCutoffCredential.ProjectSCIM,
        PlanCutoffCredential.StatusPageSCIM,
      ],
    ],
    [
      PlanType.Growth,
      [PlanCutoffCredential.ProjectSCIM, PlanCutoffCredential.StatusPageSCIM],
    ],
    [PlanType.Scale, []],
    [PlanType.Enterprise, []],
  ])(
    "on %s, what stopped is %j",
    (onPlan: PlanType, expected: Array<PlanCutoffCredential>) => {
      expect(
        PlanDowngradeOwnerNotice.getCredentialsStoppedOnPlan(onPlan),
      ).toEqual(expected);
    },
  );

  test("on Free with live API keys: the owners are told what the plan the project is on stops", async () => {
    has({ apiKeys: 2 });

    expect(await notify()).toBe(PlanDowngradeNoticeOutcome.Told);

    expect(sendAndWait).toHaveBeenCalledTimes(1);
    expect(String(sent().projectId)).toBe(PROJECT_ID.toString());
    expect(sent().owners).toBe(OWNERS);
    expect(sent().subject).toBe("API keys stopped working in Acme Production");

    const html: string = sent().message;

    expect(html).toContain(
      "API keys and SCIM provisioning now work only on the plans that include them, and Acme Production is on the Free plan.",
    );
    expect(html).toContain(
      "The project&#39;s 2 API keys stopped working: API keys need the Growth plan.",
    );
    // Not "back on": the project may never have been on Growth.
    expect(html).toContain("until the project is on Growth.");
    expect(html).not.toContain("moved from");
    expect(html).toContain(`<a href="${SETTINGS_LINK}">${SETTINGS_LINK}</a>`);
    expect(html).toContain(
      "Project owners get this email once, because the project was already below these plans when API keys and SCIM provisioning started to need them.",
    );
  });

  test("never through the email that does not wait: the migrate Job would exit before it left", async () => {
    has({ apiKeys: 2 });

    await notify();

    expect(sendEmail).not.toHaveBeenCalled();
  });

  test("on Growth with SCIM connections: told SCIM only removes people now", async () => {
    plan = PlanType.Growth;
    has({ apiKeys: 4, projectScim: 1 });

    expect(await notify()).toBe(PlanDowngradeNoticeOutcome.Told);

    expect(sent().subject).toBe(
      "SCIM stopped adding people in Acme Production",
    );
    expect(sent().message).toContain("Acme Production is on the Growth plan.");
    expect(sent().message).toContain(
      "Your identity provider can still remove people from the project, so anyone who leaves loses their access as before, but it can no longer add people or change them until the project is on Scale.",
    );
    // Growth includes API keys: they are neither counted nor named.
    expect(apiKeyCount).not.toHaveBeenCalled();
    expect(sent().message).not.toContain("API keys need");
  });

  test("on Free with both: one email names both", async () => {
    has({ apiKeys: 1, statusPageScim: 2 });

    expect(await notify()).toBe(PlanDowngradeNoticeOutcome.Told);

    expect(sendAndWait).toHaveBeenCalledTimes(1);
    expect(sent().subject).toBe(
      "API keys stopped working and SCIM stopped adding people in Acme Production",
    );
  });

  test("the owners are read before the claim, and the claim comes before the email, for this project, now", async () => {
    has({ apiKeys: 1 });

    await notify();

    expect(claim).toHaveBeenCalledTimes(1);
    const claimed: { projectId: ObjectID; now: Date } = claim.mock
      .calls[0]![0] as { projectId: ObjectID; now: Date };

    expect(String(claimed.projectId)).toBe(PROJECT_ID.toString());
    expect(claimed.now).toBeInstanceOf(Date);
    expect(String(getOwners.mock.calls[0]![0])).toBe(PROJECT_ID.toString());
    expect(getOwners.mock.invocationCallOrder[0]!).toBeLessThan(
      claim.mock.invocationCallOrder[0]!,
    );
    expect(claim.mock.invocationCallOrder[0]!).toBeLessThan(
      sendAndWait.mock.invocationCallOrder[0]!,
    );
  });

  test("waits until the mail service has taken the emails before it answers", async () => {
    has({ apiKeys: 1 });

    let handOver: (delivered: number) => void = (): void => {
      return undefined;
    };
    sendAndWait.mockImplementation(() => {
      return new Promise<number>((resolve: (delivered: number) => void) => {
        handOver = resolve;
      });
    });

    let answered: boolean = false;
    const outcome: Promise<PlanDowngradeNoticeOutcome> = notify().then(
      (result: PlanDowngradeNoticeOutcome) => {
        answered = true;
        return result;
      },
    );

    // Let every step before the send run.
    for (let i: number = 0; i < 20; i++) {
      await Promise.resolve();
    }

    expect(sendAndWait).toHaveBeenCalledTimes(1);
    expect(answered).toBe(false);

    handOver(2);

    expect(await outcome).toBe(PlanDowngradeNoticeOutcome.Told);
  });

  test("a project with no owners - no accepted member of an owner team - is not claimed, and not told", async () => {
    has({ apiKeys: 1 });
    getOwners.mockResolvedValue([]);

    expect(await notify()).toBe(PlanDowngradeNoticeOutcome.NoOwners);
    expect(claim).not.toHaveBeenCalled();
    expect(sendAndWait).not.toHaveBeenCalled();
    expect(loggedErrors).not.toHaveBeenCalled();
  });

  test("owners told already - by a plan change, or an earlier run - are not told again", async () => {
    has({ apiKeys: 1 });
    claim.mockResolvedValue(false);

    expect(await notify()).toBe(PlanDowngradeNoticeOutcome.AlreadyTold);
    expect(sendAndWait).not.toHaveBeenCalled();
  });

  test("a project on the plans its credentials need is not told, and not claimed", async () => {
    plan = PlanType.Scale;
    has({ apiKeys: 9, projectScim: 9 });

    expect(await notify()).toBe(PlanDowngradeNoticeOutcome.NothingStopped);
    expect(claim).not.toHaveBeenCalled();
    expect(getOwners).not.toHaveBeenCalled();
    expect(sendAndWait).not.toHaveBeenCalled();
  });

  test("a project below the plans with nothing left to stop - only expired keys - is not told", async () => {
    has({});

    expect(await notify()).toBe(PlanDowngradeNoticeOutcome.NothingStopped);
    expect(claim).not.toHaveBeenCalled();
    expect(sendAndWait).not.toHaveBeenCalled();
  });

  test("a project with no plan to read - gone, or never given one - is below no plan", async () => {
    getCurrentPlan.mockRejectedValue(
      new BadDataException("Project does not have any plans"),
    );
    has({ apiKeys: 1 });

    expect(await notify()).toBe(PlanDowngradeNoticeOutcome.NoPlan);
    expect(claim).not.toHaveBeenCalled();
    expect(loggedErrors).not.toHaveBeenCalled();
  });

  test("a plan that cannot be read for another reason is a failure, logged", async () => {
    getCurrentPlan.mockRejectedValue(new Error("connection reset"));

    expect(await notify()).toBe(PlanDowngradeNoticeOutcome.Failed);
    expect(claim).not.toHaveBeenCalled();
    expect(loggedErrors).toHaveBeenCalledTimes(1);
  });

  test("billing off has no plan: nothing is claimed or sent", async () => {
    plan = null;
    has({ apiKeys: 1 });

    expect(await notify()).toBe(PlanDowngradeNoticeOutcome.NoPlan);
    expect(claim).not.toHaveBeenCalled();
    expect(sendAndWait).not.toHaveBeenCalled();
  });

  test("when the mail service took none of the emails, the claim is given back, so running it again tells them", async () => {
    has({ apiKeys: 1 });
    sendAndWait.mockResolvedValue(0);

    expect(await notify()).toBe(PlanDowngradeNoticeOutcome.Failed);

    expect(release).toHaveBeenCalledTimes(1);
    const released: { projectId: ObjectID; claimedAt: Date } = release.mock
      .calls[0]![0] as { projectId: ObjectID; claimedAt: Date };
    const claimed: { now: Date } = claim.mock.calls[0]![0] as { now: Date };

    expect(String(released.projectId)).toBe(PROJECT_ID.toString());
    // Exactly the claim that was made.
    expect(released.claimedAt).toBe(claimed.now);
    expect(loggedErrors).toHaveBeenCalledTimes(1);
  });

  test("when it took some of them, the owners were told: the claim stays", async () => {
    has({ apiKeys: 1 });
    sendAndWait.mockResolvedValue(1);

    expect(await notify()).toBe(PlanDowngradeNoticeOutcome.Told);
    expect(release).not.toHaveBeenCalled();
  });

  test("a step that fails after the claim - the project's name - gives the claim back", async () => {
    has({ apiKeys: 1 });
    findProject.mockRejectedValue(new Error("connection reset"));

    expect(await notify()).toBe(PlanDowngradeNoticeOutcome.Failed);
    expect(sendAndWait).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  test("a claim that cannot be given back is logged too, and never throws", async () => {
    has({ apiKeys: 1 });
    sendAndWait.mockResolvedValue(0);
    release.mockRejectedValue(new Error("connection reset"));

    expect(await notify()).toBe(PlanDowngradeNoticeOutcome.Failed);
    expect(loggedErrors).toHaveBeenCalledTimes(2);
  });

  test("an owner lookup that fails is a failure, before anything is claimed", async () => {
    has({ apiKeys: 1 });
    getOwners.mockRejectedValue(new Error("connection reset"));

    expect(await notify()).toBe(PlanDowngradeNoticeOutcome.Failed);
    expect(claim).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  test("a count that fails is a failure, before anything is claimed", async () => {
    apiKeyCount.mockRejectedValue(new Error("connection reset"));

    expect(await notify()).toBe(PlanDowngradeNoticeOutcome.Failed);
    expect(claim).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  test("escapes the project's name, which its owners chose", async () => {
    const project: Project = new Project();
    project.name = "<b>Acme</b>";
    findProject.mockResolvedValue(project);
    has({ apiKeys: 1 });

    await notify();

    expect(sent().message).not.toContain("<b>");
    expect(sent().message).toContain(
      "&lt;b&gt;Acme&lt;/b&gt; is on the Free plan.",
    );
  });
});

describe("the one-time notice, for every project that may be below the plan", () => {
  let notifyOne: ReturnType<typeof getJestSpyOn>;
  let apiKeysFound: ReturnType<typeof getJestSpyOn>;
  let projectScimFound: ReturnType<typeof getJestSpyOn>;
  let statusPageScimFound: ReturnType<typeof getJestSpyOn>;

  const withProject: <T extends { projectId?: ObjectID | undefined }>(
    row: T,
    projectId: ObjectID,
  ) => T = <T extends { projectId?: ObjectID | undefined }>(
    row: T,
    projectId: ObjectID,
  ): T => {
    row.projectId = projectId;
    return row;
  };

  beforeEach(() => {
    apiKeysFound = getJestSpyOn(ApiKeyService, "findAllBy").mockResolvedValue([
      withProject(new ApiKey(), PROJECT_ID),
      withProject(new ApiKey(), PROJECT_ID),
    ]);
    projectScimFound = getJestSpyOn(
      ProjectSCIMService,
      "findAllBy",
    ).mockResolvedValue([withProject(new ProjectSCIM(), OTHER_PROJECT_ID)]);
    // The same project again, in another case: one project.
    statusPageScimFound = getJestSpyOn(
      StatusPageSCIMService,
      "findAllBy",
    ).mockResolvedValue([
      withProject(
        new StatusPageSCIM(),
        new ObjectID(OTHER_PROJECT_ID.toString().toUpperCase()),
      ),
    ]);
    notifyOne = getJestSpyOn(
      PlanDowngradeOwnerNotice,
      "notifyIfAlreadyBelowPlan",
    ).mockResolvedValue(PlanDowngradeNoticeOutcome.Told);
  });

  test("billing off (self-hosted): nothing is read and nothing is sent", async () => {
    setTestBillingEnabled(false);

    expect(
      await PlanDowngradeOwnerNotice.notifyProjectsAlreadyBelowPlan(),
    ).toEqual({
      projects: 0,
      told: 0,
      alreadyTold: 0,
      nothingStopped: 0,
      noPlan: 0,
      noOwners: 0,
      failed: 0,
    });
    expect(apiKeysFound).not.toHaveBeenCalled();
    expect(projectScimFound).not.toHaveBeenCalled();
    expect(statusPageScimFound).not.toHaveBeenCalled();
    expect(notifyOne).not.toHaveBeenCalled();
  });

  test("billing on: each project with live API keys or SCIM connections, once", async () => {
    setTestBillingEnabled(true);

    await PlanDowngradeOwnerNotice.notifyProjectsAlreadyBelowPlan();

    expect(
      notifyOne.mock.calls.map((call: Array<unknown>): string => {
        return String(
          (call[0] as { projectId: ObjectID }).projectId,
        ).toLowerCase();
      }),
    ).toEqual([
      PROJECT_ID.toString().toLowerCase(),
      OTHER_PROJECT_ID.toString().toLowerCase(),
    ]);
  });

  test("only API keys that have not expired, read as OneUptime itself", async () => {
    setTestBillingEnabled(true);

    await PlanDowngradeOwnerNotice.notifyProjectsAlreadyBelowPlan();

    const findAllBy: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: unknown;
    } = apiKeysFound.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: unknown;
    };

    expect(findAllBy.query["expiresAt"]).toBeDefined();
    expect(findAllBy.select).toEqual({ projectId: true });
    expect(findAllBy.props).toEqual({ isRoot: true });

    for (const spy of [projectScimFound, statusPageScimFound]) {
      expect((spy.mock.calls[0]![0] as { props: unknown }).props).toEqual({
        isRoot: true,
      });
    }
  });

  test("says what it did, project by project, and goes on past a failure", async () => {
    setTestBillingEnabled(true);
    notifyOne
      .mockResolvedValueOnce(PlanDowngradeNoticeOutcome.Failed)
      .mockResolvedValueOnce(PlanDowngradeNoticeOutcome.AlreadyTold);

    expect(
      await PlanDowngradeOwnerNotice.notifyProjectsAlreadyBelowPlan(),
    ).toEqual({
      projects: 2,
      told: 0,
      alreadyTold: 1,
      nothingStopped: 0,
      noPlan: 0,
      noOwners: 0,
      failed: 1,
    });
  });

  test.each([
    [PlanDowngradeNoticeOutcome.Told, "told"],
    [PlanDowngradeNoticeOutcome.AlreadyTold, "alreadyTold"],
    [PlanDowngradeNoticeOutcome.NothingStopped, "nothingStopped"],
    [PlanDowngradeNoticeOutcome.NoPlan, "noPlan"],
    [PlanDowngradeNoticeOutcome.NoOwners, "noOwners"],
    [PlanDowngradeNoticeOutcome.Failed, "failed"],
  ])(
    "an outcome of %s is counted as %s",
    async (outcome: PlanDowngradeNoticeOutcome, key: string) => {
      setTestBillingEnabled(true);
      notifyOne.mockResolvedValue(outcome);

      const summary: Record<string, number> =
        (await PlanDowngradeOwnerNotice.notifyProjectsAlreadyBelowPlan()) as unknown as Record<
          string,
          number
        >;

      expect(summary[key]).toBe(2);
    },
  );

  test("a project with no credentials is not looked at", async () => {
    setTestBillingEnabled(true);
    apiKeysFound.mockResolvedValue([]);
    projectScimFound.mockResolvedValue([]);
    statusPageScimFound.mockResolvedValue([]);

    expect(
      (await PlanDowngradeOwnerNotice.notifyProjectsAlreadyBelowPlan())
        .projects,
    ).toBe(0);
    expect(notifyOne).not.toHaveBeenCalled();
  });

  test("a read that fails stops the run, which the migration runner retries", async () => {
    setTestBillingEnabled(true);
    apiKeysFound.mockRejectedValue(new Error("connection reset"));

    await expect(
      PlanDowngradeOwnerNotice.notifyProjectsAlreadyBelowPlan(),
    ).rejects.toThrow("connection reset");
    expect(notifyOne).not.toHaveBeenCalled();
  });
});
