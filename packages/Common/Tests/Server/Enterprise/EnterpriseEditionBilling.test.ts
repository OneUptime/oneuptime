import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import {
  EnterpriseServerModuleShape,
  ProjectBillingHooks,
} from "../../../Server/Enterprise/EnterpriseServerModule";
import type BillingProvider from "../../../Server/Types/Billing/BillingProvider";
import logger from "../../../Server/Utils/Logger";
import FakeEnterpriseModule, {
  createProjectBillingHooksSpy,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "./FakeEnterpriseModule";

/*
 * EnterpriseEdition.getBillingProvider and getProjectBillingHooks: how core
 * reaches OneUptime Cloud's billing, which lives in the enterprise module.
 *
 * Core's BillingService asks for the provider on every payment-provider call
 * and ProjectService asks for the hooks on every delete and marketplace plan
 * change, so both answers are null - never an error - whenever there is
 * nothing to hand out:
 *   - the Community Edition;
 *   - a module without the hook (an older module);
 *   - a module that answers null (billing off);
 *   - a module that throws (logged).
 */

// Only what these tests compare: the very object the module hands out.
const PROVIDER: BillingProvider = {
  name: "the module's payment provider",
} as unknown as BillingProvider;

let errorSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  errorSpy = jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  uninstallEnterpriseModule();
  jest.restoreAllMocks();
});

describe("EnterpriseEdition.getBillingProvider", () => {
  test("is null on the Community Edition", () => {
    uninstallEnterpriseModule();

    expect(EnterpriseEdition.getBillingProvider()).toBeNull();
  });

  test("is null when the module answers null (billing off)", () => {
    installFakeEnterpriseModule({ billingProvider: null });

    expect(EnterpriseEdition.getBillingProvider()).toBeNull();
  });

  test("is null when the module has no say in it (an older module)", () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      billingProvider: PROVIDER,
    });
    (fake as unknown as Record<string, unknown>)["getBillingProvider"] =
      undefined;

    expect(EnterpriseEdition.getBillingProvider()).toBeNull();
  });

  test("is the very provider the module hands it", () => {
    installFakeEnterpriseModule({ billingProvider: PROVIDER });

    expect(EnterpriseEdition.getBillingProvider()).toBe(PROVIDER);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("is null, never an error, when the module throws, and the failure is logged", () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      billingProvider: PROVIDER,
    });
    fake.billingProviderError = new Error("the provider would not start");

    expect(EnterpriseEdition.getBillingProvider()).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      "EnterpriseEdition: the enterprise module failed to provide its billing provider.",
    );
    expect(errorSpy).toHaveBeenCalledWith(fake.billingProviderError);
  });

  test("follows the module at once: each ask is answered from what it says now", () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      billingProvider: PROVIDER,
    });

    expect(EnterpriseEdition.getBillingProvider()).toBe(PROVIDER);

    fake.billingProvider = null;

    expect(EnterpriseEdition.getBillingProvider()).toBeNull();
  });

  test("an answer that is not an object counts as none", () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule();
    fake.getBillingProvider = (): BillingProvider | null => {
      return undefined as unknown as null;
    };

    expect(EnterpriseEdition.getBillingProvider()).toBeNull();
  });
});

describe("EnterpriseEdition.getProjectBillingHooks", () => {
  test("is null on the Community Edition", () => {
    uninstallEnterpriseModule();

    expect(EnterpriseEdition.getProjectBillingHooks()).toBeNull();
  });

  test("is null when the module answers null (billing off)", () => {
    installFakeEnterpriseModule({ projectBillingHooks: null });

    expect(EnterpriseEdition.getProjectBillingHooks()).toBeNull();
  });

  test("is null when the module has no say in it (an older module)", () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      projectBillingHooks: createProjectBillingHooksSpy(),
    });
    (fake as unknown as Record<string, unknown>)["getProjectBillingHooks"] =
      undefined;

    expect(EnterpriseEdition.getProjectBillingHooks()).toBeNull();
  });

  test("is the very hooks object the module hands it", () => {
    const hooks: ProjectBillingHooks = createProjectBillingHooksSpy();

    installFakeEnterpriseModule({ projectBillingHooks: hooks });

    expect(EnterpriseEdition.getProjectBillingHooks()).toBe(hooks);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("is null, never an error, when the module throws, and the failure is logged", () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      projectBillingHooks: createProjectBillingHooksSpy(),
    });
    fake.projectBillingHooksError = new Error("the hooks would not load");

    expect(EnterpriseEdition.getProjectBillingHooks()).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      "EnterpriseEdition: the enterprise module failed to provide its project billing hooks.",
    );
    expect(errorSpy).toHaveBeenCalledWith(fake.projectBillingHooksError);
  });

  test("follows the module at once: each ask is answered from what it says now", () => {
    const hooks: ProjectBillingHooks = createProjectBillingHooksSpy();
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      projectBillingHooks: hooks,
    });

    expect(EnterpriseEdition.getProjectBillingHooks()).toBe(hooks);

    fake.projectBillingHooks = null;

    expect(EnterpriseEdition.getProjectBillingHooks()).toBeNull();
  });
});

describe("the module contract", () => {
  test.each(["getBillingProvider", "getProjectBillingHooks"])(
    "%s may be left out",
    (hookName: string) => {
      const fake: FakeEnterpriseModule = new FakeEnterpriseModule();
      (fake as unknown as Record<string, unknown>)[hookName] = undefined;

      expect(EnterpriseServerModuleShape.findProblems(fake)).toEqual([]);
    },
  );

  test.each(["getBillingProvider", "getProjectBillingHooks"])(
    "%s, when present, must be a function",
    (hookName: string) => {
      const fake: FakeEnterpriseModule = new FakeEnterpriseModule();
      (fake as unknown as Record<string, unknown>)[hookName] = {
        createCustomer: "not a function",
      };

      expect(EnterpriseServerModuleShape.findProblems(fake)).toEqual([
        `"${hookName}", when present, must be a function`,
      ]);
    },
  );

  test("the fake module implements both, answering null unless told otherwise", () => {
    const fake: FakeEnterpriseModule = new FakeEnterpriseModule();

    expect(fake.getBillingProvider()).toBeNull();
    expect(fake.getProjectBillingHooks()).toBeNull();
    expect(EnterpriseServerModuleShape.findProblems(fake)).toEqual([]);
  });
});
