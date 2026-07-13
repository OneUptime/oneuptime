import LlmProviderService from "../../../Server/Services/LlmProviderService";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import ObjectID from "../../../Types/ObjectID";
import Query from "../../../Server/Types/Database/Query";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * getProjectOwnedLlmProvider (via getLlmProviderForAgentTasks) backs the AI
 * Agent path, where the raw apiKey is handed to an external process whose
 * LLM calls are NOT metered through AIService/LlmLog. The invariant these
 * tests lock in: the resolver only ever queries providers owned by the given
 * project — the shared global (billed) provider must never be reachable from
 * this path on Cloud, or its usage would be unbilled and exempt from budgets.
 */

const projectId: ObjectID = ObjectID.generate();

function fakeProvider(name: string): LlmProvider {
  return { id: ObjectID.generate(), name } as unknown as LlmProvider;
}

describe("LlmProviderService.getProjectOwnedLlmProvider", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns the project default when one exists", async () => {
    const defaultProvider: LlmProvider = fakeProvider("default");
    const spy: jest.SpiedFunction<typeof LlmProviderService.findOneBy> = jest
      .spyOn(LlmProviderService, "findOneBy")
      .mockResolvedValueOnce(defaultProvider);

    const result: LlmProvider | null =
      await LlmProviderService.getProjectOwnedLlmProvider(projectId);

    expect(result).toBe(defaultProvider);
    expect(spy).toHaveBeenCalledTimes(1);
    const query: Query<LlmProvider> = spy.mock.calls[0]![0]!.query;
    expect(query["projectId"]).toBe(projectId);
    expect(query["isDefault"]).toBe(true);
  });

  test("falls back to any project-owned provider, never the global one", async () => {
    const nonDefault: LlmProvider = fakeProvider("byo");
    const spy: jest.SpiedFunction<typeof LlmProviderService.findOneBy> = jest
      .spyOn(LlmProviderService, "findOneBy")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(nonDefault);

    const result: LlmProvider | null =
      await LlmProviderService.getProjectOwnedLlmProvider(projectId);

    expect(result).toBe(nonDefault);
    expect(spy).toHaveBeenCalledTimes(2);

    // Every query issued must be scoped to the project — no global fallback.
    for (const call of spy.mock.calls) {
      const query: Query<LlmProvider> = call[0]!.query;
      expect(query["projectId"]).toBe(projectId);
      expect(query["isGlobalLlm"]).toBeUndefined();
    }
  });

  test("returns null when the project owns no provider at all", async () => {
    jest.spyOn(LlmProviderService, "findOneBy").mockResolvedValue(null);

    const result: LlmProvider | null =
      await LlmProviderService.getProjectOwnedLlmProvider(projectId);

    expect(result).toBeNull();
  });
});

/*
 * getLlmProviderForAgentTasks relaxes the project-owned restriction ONLY on
 * self-host (billing disabled), where the global provider is the operator's
 * own key/endpoint. On Cloud (billing enabled) the invariant above still
 * holds: the shared global (billed) provider is never reachable. The
 * billingEnabled option pins the mode explicitly so these tests don't depend
 * on the BILLING_ENABLED env var of the test run.
 */
describe("LlmProviderService.getLlmProviderForAgentTasks", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a project-owned provider wins in both modes, without a global query", async () => {
    const owned: LlmProvider = fakeProvider("owned");
    jest
      .spyOn(LlmProviderService, "getProjectOwnedLlmProvider")
      .mockResolvedValue(owned);
    const findSpy: jest.SpiedFunction<typeof LlmProviderService.findOneBy> =
      jest.spyOn(LlmProviderService, "findOneBy");

    expect(
      await LlmProviderService.getLlmProviderForAgentTasks(projectId, {
        billingEnabled: true,
      }),
    ).toBe(owned);
    expect(
      await LlmProviderService.getLlmProviderForAgentTasks(projectId, {
        billingEnabled: false,
      }),
    ).toBe(owned);
    expect(findSpy).not.toHaveBeenCalled();
  });

  test("never falls back to the global provider when billing is enabled (cloud)", async () => {
    jest
      .spyOn(LlmProviderService, "getProjectOwnedLlmProvider")
      .mockResolvedValue(null);
    const findSpy: jest.SpiedFunction<typeof LlmProviderService.findOneBy> =
      jest.spyOn(LlmProviderService, "findOneBy");

    const result: LlmProvider | null =
      await LlmProviderService.getLlmProviderForAgentTasks(projectId, {
        billingEnabled: true,
      });

    expect(result).toBeNull();
    expect(findSpy).not.toHaveBeenCalled();
  });

  test("falls back to the global provider when billing is disabled (self-host)", async () => {
    const globalProvider: LlmProvider = fakeProvider("global");
    jest
      .spyOn(LlmProviderService, "getProjectOwnedLlmProvider")
      .mockResolvedValue(null);
    const findSpy: jest.SpiedFunction<typeof LlmProviderService.findOneBy> =
      jest
        .spyOn(LlmProviderService, "findOneBy")
        .mockResolvedValue(globalProvider);

    const result: LlmProvider | null =
      await LlmProviderService.getLlmProviderForAgentTasks(projectId, {
        billingEnabled: false,
      });

    expect(result).toBe(globalProvider);
    expect(findSpy).toHaveBeenCalledTimes(1);
    const query: Query<LlmProvider> = findSpy.mock.calls[0]![0]!.query;
    expect(query["isGlobalLlm"]).toBe(true);
    // Global rows have no projectId — the query must target the null tenant.
    expect(query["projectId"]).not.toBe(projectId);
  });
});
