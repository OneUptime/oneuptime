import LlmProviderService from "../../../Server/Services/LlmProviderService";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import ObjectID from "../../../Types/ObjectID";
import Query from "../../../Server/Types/Database/Query";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * getProjectOwnedLlmProvider is the project-preference leg of the agent
 * provider resolution (getLlmProviderForMeteredAgentPath). The invariant
 * these tests lock in: this resolver only ever queries providers owned by
 * the given project — the global-provider fallback is layered on top by
 * its caller, never here.
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
 * getLlmProviderForMeteredAgentPath backs the SERVER-MEDIATED completion
 * endpoint (B4 Tier 0), whose calls run through AIService.executeWithLogging
 * — metered, logged, budgeted. Because metering is universal there, the
 * global provider is a legitimate fallback ON CLOUD TOO (usage is billed as
 * metered AI tokens). This is the only agent provider resolution — the
 * raw-key path (get-llm-config / getLlmProviderForAgentTasks) is removed.
 */
describe("LlmProviderService.getLlmProviderForMeteredAgentPath", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a project-owned provider always wins, without a global query", async () => {
    const owned: LlmProvider = fakeProvider("owned");
    jest
      .spyOn(LlmProviderService, "getProjectOwnedLlmProvider")
      .mockResolvedValue(owned);
    const findSpy: jest.SpiedFunction<typeof LlmProviderService.findOneBy> =
      jest.spyOn(LlmProviderService, "findOneBy");

    const result: LlmProvider | null =
      await LlmProviderService.getLlmProviderForMeteredAgentPath(projectId);

    expect(result).toBe(owned);
    expect(findSpy).not.toHaveBeenCalled();
  });

  test("falls back to the global provider when the project owns none — cloud included", async () => {
    const globalProvider: LlmProvider = fakeProvider("global");
    jest
      .spyOn(LlmProviderService, "getProjectOwnedLlmProvider")
      .mockResolvedValue(null);
    const findSpy: jest.SpiedFunction<typeof LlmProviderService.findOneBy> =
      jest
        .spyOn(LlmProviderService, "findOneBy")
        .mockResolvedValue(globalProvider);

    const result: LlmProvider | null =
      await LlmProviderService.getLlmProviderForMeteredAgentPath(projectId);

    expect(result).toBe(globalProvider);
    expect(findSpy).toHaveBeenCalledTimes(1);
    const query: Query<LlmProvider> = findSpy.mock.calls[0]![0]!.query;
    expect(query["isGlobalLlm"]).toBe(true);
    // Global rows have no projectId — the query must target the null tenant.
    expect(query["projectId"]).not.toBe(projectId);
  });

  test("returns null when neither a project-owned nor a global provider exists", async () => {
    jest
      .spyOn(LlmProviderService, "getProjectOwnedLlmProvider")
      .mockResolvedValue(null);
    jest.spyOn(LlmProviderService, "findOneBy").mockResolvedValue(null);

    expect(
      await LlmProviderService.getLlmProviderForMeteredAgentPath(projectId),
    ).toBeNull();
  });
});
