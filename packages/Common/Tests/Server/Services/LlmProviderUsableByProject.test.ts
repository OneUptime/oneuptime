import LlmProviderService from "../../../Server/Services/LlmProviderService";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import ObjectID from "../../../Types/ObjectID";
import Select from "../../../Server/Types/Database/Select";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * isProviderUsableByProject answers "may this project run against this
 * provider id?" for callers that hold a caller-supplied id — today the
 * runbook AI step's optional provider pin, whose id comes out of an
 * unvalidated JSON column.
 *
 * The invariant: a project may use a global provider or one it owns, and
 * nothing else. A provider carries an apiKey, so a yes here for another
 * project's row would hand project A the use of project B's key.
 */

const projectId: ObjectID = ObjectID.generate();
const otherProjectId: ObjectID = ObjectID.generate();
const providerId: ObjectID = ObjectID.generate();

function fakeProvider(overrides: Partial<LlmProvider> = {}): LlmProvider {
  return {
    id: providerId,
    ...overrides,
  } as unknown as LlmProvider;
}

describe("LlmProviderService.isProviderUsableByProject", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("accepts a provider the project owns", async () => {
    jest
      .spyOn(LlmProviderService, "findOneBy")
      .mockResolvedValue(fakeProvider({ projectId, isGlobalLlm: false }));

    await expect(
      LlmProviderService.isProviderUsableByProject({
        projectId,
        llmProviderId: providerId,
      }),
    ).resolves.toBe(true);
  });

  test("accepts a global provider, which is shared with every project", async () => {
    jest
      .spyOn(LlmProviderService, "findOneBy")
      .mockResolvedValue(fakeProvider({ isGlobalLlm: true }));

    await expect(
      LlmProviderService.isProviderUsableByProject({
        projectId,
        llmProviderId: providerId,
      }),
    ).resolves.toBe(true);
  });

  test("rejects a provider owned by a different project", async () => {
    jest.spyOn(LlmProviderService, "findOneBy").mockResolvedValue(
      fakeProvider({
        projectId: otherProjectId,
        isGlobalLlm: false,
      }),
    );

    await expect(
      LlmProviderService.isProviderUsableByProject({
        projectId,
        llmProviderId: providerId,
      }),
    ).resolves.toBe(false);
  });

  test("rejects a provider that no longer exists", async () => {
    jest.spyOn(LlmProviderService, "findOneBy").mockResolvedValue(null);

    await expect(
      LlmProviderService.isProviderUsableByProject({
        projectId,
        llmProviderId: providerId,
      }),
    ).resolves.toBe(false);
  });

  test("rejects a provider with no owner and no global flag", async () => {
    /*
     * A row that is neither global nor owned matches nobody. Treating an
     * absent projectId as a match would make an orphaned row usable by every
     * project at once.
     */
    jest
      .spyOn(LlmProviderService, "findOneBy")
      .mockResolvedValue(fakeProvider({ isGlobalLlm: false }));

    await expect(
      LlmProviderService.isProviderUsableByProject({
        projectId,
        llmProviderId: providerId,
      }),
    ).resolves.toBe(false);
  });

  test("rejects a non-uuid id without ever touching the database", async () => {
    /*
     * _id is a uuid column: querying it with garbage is a Postgres cast
     * error, not an empty result. The id arrives from an unvalidated JSON
     * config, so the shape check has to happen before the query — otherwise
     * a typo in a runbook surfaces as a driver error during an incident.
     */
    const findSpy: jest.SpiedFunction<typeof LlmProviderService.findOneBy> =
      jest.spyOn(LlmProviderService, "findOneBy");

    await expect(
      LlmProviderService.isProviderUsableByProject({
        projectId,
        llmProviderId: new ObjectID("not-a-uuid"),
      }),
    ).resolves.toBe(false);

    expect(findSpy).not.toHaveBeenCalled();
  });

  test("rejects an empty id without touching the database", async () => {
    const findSpy: jest.SpiedFunction<typeof LlmProviderService.findOneBy> =
      jest.spyOn(LlmProviderService, "findOneBy");

    await expect(
      LlmProviderService.isProviderUsableByProject({
        projectId,
        llmProviderId: new ObjectID(""),
      }),
    ).resolves.toBe(false);

    expect(findSpy).not.toHaveBeenCalled();
  });

  test("never selects the apiKey — a yes/no must not load secrets", async () => {
    const findSpy: jest.SpiedFunction<typeof LlmProviderService.findOneBy> =
      jest
        .spyOn(LlmProviderService, "findOneBy")
        .mockResolvedValue(fakeProvider({ projectId }));

    await LlmProviderService.isProviderUsableByProject({
      projectId,
      llmProviderId: providerId,
    });

    const select: Select<LlmProvider> = findSpy.mock.calls[0]![0]!
      .select as Select<LlmProvider>;
    expect(select["apiKey"]).toBeUndefined();
    expect(select["projectId"]).toBe(true);
    expect(select["isGlobalLlm"]).toBe(true);
  });

  test("looks the provider up by id alone, so a global row is reachable", async () => {
    /*
     * Scoping the query by projectId would silently exclude global
     * providers (their projectId is NULL) — the tenant decision belongs in
     * the check on the loaded row, not in the query.
     */
    const findSpy: jest.SpiedFunction<typeof LlmProviderService.findOneBy> =
      jest
        .spyOn(LlmProviderService, "findOneBy")
        .mockResolvedValue(fakeProvider({ isGlobalLlm: true }));

    await LlmProviderService.isProviderUsableByProject({
      projectId,
      llmProviderId: providerId,
    });

    const query: Record<string, unknown> = findSpy.mock.calls[0]![0]!
      .query as Record<string, unknown>;
    expect(query["_id"]).toBe(providerId.toString());
    expect(query["projectId"]).toBeUndefined();
  });
});

/*
 * getProviderForChat shares the same usability predicate. Its contract is the
 * opposite of the runbook step's on failure — a human is watching a chat, so
 * an unusable id falls back to the default instead of erroring — and these
 * tests pin that difference down so a future refactor of the shared predicate
 * cannot quietly swap one behaviour for the other.
 */
describe("LlmProviderService.getProviderForChat", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("uses an explicitly chosen provider the project owns", async () => {
    const chosen: LlmProvider = fakeProvider({ projectId });
    const findSpy: jest.SpiedFunction<typeof LlmProviderService.findOneBy> =
      jest.spyOn(LlmProviderService, "findOneBy").mockResolvedValue(chosen);

    const result: LlmProvider | null =
      await LlmProviderService.getProviderForChat({
        projectId,
        llmProviderId: providerId,
      });

    expect(result).toBe(chosen);
    expect(findSpy).toHaveBeenCalledTimes(1);
  });

  test("uses an explicitly chosen global provider", async () => {
    const chosen: LlmProvider = fakeProvider({ isGlobalLlm: true });
    jest.spyOn(LlmProviderService, "findOneBy").mockResolvedValue(chosen);

    await expect(
      LlmProviderService.getProviderForChat({
        projectId,
        llmProviderId: providerId,
      }),
    ).resolves.toBe(chosen);
  });

  test("falls back to the project default when the chosen provider belongs to another project", async () => {
    const foreign: LlmProvider = fakeProvider({ projectId: otherProjectId });
    const projectDefault: LlmProvider = fakeProvider({ projectId });
    jest
      .spyOn(LlmProviderService, "findOneBy")
      .mockResolvedValueOnce(foreign)
      .mockResolvedValueOnce(projectDefault);

    const result: LlmProvider | null =
      await LlmProviderService.getProviderForChat({
        projectId,
        llmProviderId: providerId,
      });

    expect(result).toBe(projectDefault);
  });

  test("falls back when the chosen provider no longer exists", async () => {
    const projectDefault: LlmProvider = fakeProvider({ projectId });
    jest
      .spyOn(LlmProviderService, "findOneBy")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(projectDefault);

    await expect(
      LlmProviderService.getProviderForChat({
        projectId,
        llmProviderId: providerId,
      }),
    ).resolves.toBe(projectDefault);
  });

  test("a non-uuid choice falls back instead of hitting the database with it", async () => {
    /*
     * Without the shape check this query is a Postgres cast error rather
     * than a miss, so a stale or hand-edited id would break a whole
     * conversation instead of quietly resolving to the default.
     */
    const projectDefault: LlmProvider = fakeProvider({ projectId });
    const findSpy: jest.SpiedFunction<typeof LlmProviderService.findOneBy> =
      jest
        .spyOn(LlmProviderService, "findOneBy")
        .mockResolvedValue(projectDefault);

    const result: LlmProvider | null =
      await LlmProviderService.getProviderForChat({
        projectId,
        llmProviderId: new ObjectID("not-a-uuid"),
      });

    expect(result).toBe(projectDefault);
    // Only the default-resolution query ran — never one keyed on the garbage id.
    for (const call of findSpy.mock.calls) {
      expect(
        (call[0]!.query as Record<string, unknown>)["_id"],
      ).toBeUndefined();
    }
  });

  test("with no choice at all it goes straight to default resolution", async () => {
    const projectDefault: LlmProvider = fakeProvider({ projectId });
    const findSpy: jest.SpiedFunction<typeof LlmProviderService.findOneBy> =
      jest
        .spyOn(LlmProviderService, "findOneBy")
        .mockResolvedValue(projectDefault);

    await expect(
      LlmProviderService.getProviderForChat({ projectId }),
    ).resolves.toBe(projectDefault);

    const query: Record<string, unknown> = findSpy.mock.calls[0]![0]!
      .query as Record<string, unknown>;
    expect(query["isDefault"]).toBe(true);
  });
});
