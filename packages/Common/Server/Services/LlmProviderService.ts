import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/LlmProvider";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ProjectDefaultRow from "../Utils/Database/ProjectDefaultRow";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    // When creating a new LLM provider, set it as default by default
    if (createBy.data.isDefault === undefined) {
      createBy.data.isDefault = true;
    }

    return { createBy, carryForward: null };
  }

  /*
   * A provider saved as its project's default takes the default from the
   * project's other providers - only now that it exists, so a create that
   * is refused or fails leaves the project's default where it was.
   */
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    await ProjectDefaultRow.afterCreate({
      service: this,
      defaultColumn: "isDefault",
      createdItem: createdItem,
    });

    return createdItem;
  }

  // The same for a provider an update made the default.
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    await ProjectDefaultRow.afterUpdate({
      service: this,
      defaultColumn: "isDefault",
      updatedData: onUpdate.updateBy.data,
      updatedItemIds: updatedItemIds,
    });

    return onUpdate;
  }

  @CaptureSpan()
  public async getLLMProviderForProject(
    projectId: ObjectID,
  ): Promise<Model | null> {
    // First try to get the default provider for the project
    let provider: Model | null = await this.findOneBy({
      query: {
        projectId: projectId,
        isDefault: true,
      },
      select: {
        _id: true,
        name: true,
        llmType: true,
        apiKey: true,
        baseUrl: true,
        modelName: true,
        additionalParams: true,
        isGlobalLlm: true,
        // isUnownedGlobalProvider reads it.
        projectId: true,
        costPerMillionTokensInUSDCents: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (provider) {
      return provider;
    }

    // If no default provider, get any global provider for the project.
    provider = await this.findOneBy({
      query: {
        projectId: QueryHelper.isNull(),
        isGlobalLlm: true,
      },
      select: {
        _id: true,
        name: true,
        llmType: true,
        apiKey: true,
        baseUrl: true,
        modelName: true,
        additionalParams: true,
        isGlobalLlm: true,
        projectId: true,
        costPerMillionTokensInUSDCents: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (provider) {
      return provider;
    }

    return null;
  }

  /*
   * Is this a global provider that no project owns? Then no project member can
   * have chosen where it points: isGlobalLlm is writable by no project role,
   * and a project's writes are scoped to its own projectId, so its Base URL
   * comes from the operator's environment (SeedGlobalLlmProviderFromEnv, which
   * the Helm chart drives for the bundled vLLM) or a master admin. LLMService
   * lets such a provider reach private addresses where the deployment refuses
   * them to providers a project configures (LLMProviderConfig.isGlobalProvider).
   *
   * Both halves are required. isGlobalLlm alone would also cover a row that
   * carries a projectId, whose Base URL that project's members can edit. The
   * row must have been read with projectId selected.
   */
  public isUnownedGlobalProvider(provider: Model): boolean {
    return provider.isGlobalLlm === true && !provider.projectId;
  }

  /*
   * Resolve a provider the project OWNS — never the global fallback.
   * Callers that may also use the shared global provider layer that
   * fallback themselves (see getLlmProviderForMeteredAgentPath). Prefers
   * the project default, else any project-owned provider.
   */
  @CaptureSpan()
  public async getProjectOwnedLlmProvider(
    projectId: ObjectID,
  ): Promise<Model | null> {
    const select: {
      _id: boolean;
      name: boolean;
      llmType: boolean;
      apiKey: boolean;
      baseUrl: boolean;
      modelName: boolean;
      additionalParams: boolean;
      isGlobalLlm: boolean;
      costPerMillionTokensInUSDCents: boolean;
    } = {
      _id: true,
      name: true,
      llmType: true,
      apiKey: true,
      baseUrl: true,
      modelName: true,
      additionalParams: true,
      isGlobalLlm: true,
      costPerMillionTokensInUSDCents: true,
    };

    const defaultProvider: Model | null = await this.findOneBy({
      query: {
        projectId: projectId,
        isDefault: true,
      },
      select,
      props: {
        isRoot: true,
      },
    });

    if (defaultProvider) {
      return defaultProvider;
    }

    return this.findOneBy({
      query: {
        projectId: projectId,
      },
      sort: {
        createdAt: SortOrder.Ascending,
      },
      select,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * Resolve the provider for the METERED agent path (B4 Tier 0): the
   * server-mediated /ai-agent-data/llm-completion endpoint, whose calls run
   * through AIService.executeWithLogging — logged to LlmLog, billed when the
   * global provider is costed, and inside the daily autonomous token budget.
   *
   * Because metering is universal on this path, a project-owned provider
   * still wins, but when the project owns none the shared global provider
   * is returned ON CLOUD TOO — its usage is billed as metered AI tokens.
   * Cloud zero-config completes: fix tasks work with no per-project
   * provider. (The old raw-key path — get-llm-config handing the provider
   * apiKey to the worker for unmetered direct calls — is removed; this is
   * the only agent provider resolution left.)
   */
  @CaptureSpan()
  public async getLlmProviderForMeteredAgentPath(
    projectId: ObjectID,
  ): Promise<Model | null> {
    const projectOwnedProvider: Model | null =
      await this.getProjectOwnedLlmProvider(projectId);

    if (projectOwnedProvider) {
      return projectOwnedProvider;
    }

    return this.findOneBy({
      query: {
        projectId: QueryHelper.isNull(),
        isGlobalLlm: true,
      },
      select: {
        _id: true,
        name: true,
        llmType: true,
        apiKey: true,
        baseUrl: true,
        modelName: true,
        additionalParams: true,
        isGlobalLlm: true,
        costPerMillionTokensInUSDCents: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * THE rule for "may this project use this provider?": a global provider is
   * shared with everyone, and a project-owned provider belongs only to its
   * own project. Every caller that honours a caller-supplied llmProviderId
   * routes through this one predicate so the checks cannot drift apart —
   * a second, subtly different copy of this comparison is how one entry point
   * ends up accepting a provider another one rejects.
   */
  private isProviderUsableBy(provider: Model, projectId: ObjectID): boolean {
    if (provider.isGlobalLlm === true) {
      return true;
    }

    return Boolean(
      provider.projectId &&
        provider.projectId.toString() === projectId.toString(),
    );
  }

  /*
   * Can this project run against this provider id? Answers the question
   * without loading secrets — callers that only need a yes/no (the runbook AI
   * step validating a pinned provider before it runs) must not pull an apiKey
   * into memory to get it. A provider that does not exist, or belongs to
   * another project, is not usable.
   */
  @CaptureSpan()
  public async isProviderUsableByProject(data: {
    projectId: ObjectID;
    llmProviderId: ObjectID;
  }): Promise<boolean> {
    /*
     * _id is a uuid column: querying it with a non-uuid string is a Postgres
     * cast error, not an empty result. A caller-supplied id reaches us
     * straight from an unvalidated JSON config, so shape-check before the
     * query and report "not usable" rather than throwing a driver error.
     */
    if (!ObjectID.isValidUUID(data.llmProviderId.toString())) {
      return false;
    }

    const provider: Model | null = await this.findOneBy({
      query: {
        _id: data.llmProviderId.toString(),
      },
      select: {
        _id: true,
        projectId: true,
        isGlobalLlm: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!provider) {
      return false;
    }

    return this.isProviderUsableBy(provider, data.projectId);
  }

  /*
   * Resolve the provider to use for a chat turn. When the user has explicitly
   * chosen a provider (llmProviderId), use it — but only if it is actually
   * usable by this project: either a global provider, or one owned by the
   * project. Otherwise fall back to the project default / global provider.
   * A stale id (e.g. the chosen provider was deleted) also falls back, so a
   * conversation never breaks because its provider went away.
   */
  @CaptureSpan()
  public async getProviderForChat(data: {
    projectId: ObjectID;
    llmProviderId?: ObjectID | undefined;
  }): Promise<Model | null> {
    if (
      data.llmProviderId &&
      // A non-uuid id would be a Postgres cast error, not a miss. Fall back.
      ObjectID.isValidUUID(data.llmProviderId.toString())
    ) {
      const provider: Model | null = await this.findOneBy({
        query: {
          _id: data.llmProviderId.toString(),
        },
        select: {
          _id: true,
          name: true,
          llmType: true,
          apiKey: true,
          baseUrl: true,
          modelName: true,
          additionalParams: true,
          isGlobalLlm: true,
          projectId: true,
          costPerMillionTokensInUSDCents: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (provider && this.isProviderUsableBy(provider, data.projectId)) {
        return provider;
      }
      // Fall through to default resolution when the id is invalid/inaccessible.
    }

    return this.getLLMProviderForProject(data.projectId);
  }

  /*
   * The providers a project member can pick from in the chat provider switcher:
   * every provider configured for the project plus every global provider.
   * Secrets (apiKey) are never selected here — this only feeds the picker UI.
   */
  @CaptureSpan()
  public async getSelectableProvidersForProject(
    projectId: ObjectID,
  ): Promise<Array<Model>> {
    const [projectProviders, globalProviders]: [Array<Model>, Array<Model>] =
      await Promise.all([
        this.findBy({
          query: {
            projectId: projectId,
          },
          select: {
            _id: true,
            name: true,
            description: true,
            llmType: true,
            modelName: true,
            isDefault: true,
            isGlobalLlm: true,
          },
          sort: {
            isDefault: SortOrder.Descending,
            name: SortOrder.Ascending,
          },
          skip: 0,
          limit: LIMIT_MAX,
          props: {
            isRoot: true,
          },
        }),
        this.findBy({
          query: {
            projectId: QueryHelper.isNull(),
            isGlobalLlm: true,
          },
          select: {
            _id: true,
            name: true,
            description: true,
            llmType: true,
            modelName: true,
            isDefault: true,
            isGlobalLlm: true,
          },
          sort: {
            name: SortOrder.Ascending,
          },
          skip: 0,
          limit: LIMIT_MAX,
          props: {
            isRoot: true,
          },
        }),
      ]);

    return [...projectProviders, ...globalProviders];
  }
}

export default new Service();
