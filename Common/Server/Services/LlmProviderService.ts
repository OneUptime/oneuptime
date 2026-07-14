import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/LlmProvider";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import ObjectID from "../../Types/ObjectID";
import UpdateBy from "../Types/Database/UpdateBy";
import QueryHelper from "../Types/Database/QueryHelper";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { IsBillingEnabled } from "../EnvironmentConfig";

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

    // If this provider is being set as default, unset other defaults in the same project
    if (createBy.data.isDefault && createBy.data.projectId) {
      await this.updateBy({
        query: {
          projectId: createBy.data.projectId,
          isDefault: true,
        },
        data: {
          isDefault: false,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
      });
    }

    return { createBy, carryForward: null };
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    // If setting isDefault to true, we need to unset other defaults in the same project
    if (updateBy.data.isDefault === true) {
      // Get the items being updated to find their project IDs
      const itemsToUpdate: Array<Model> = await this.findBy({
        query: updateBy.query,
        select: {
          _id: true,
          projectId: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
      });

      // Collect unique project IDs
      const projectIds: Set<string> = new Set();
      const itemIds: Set<string> = new Set();
      for (const item of itemsToUpdate) {
        if (item.projectId) {
          projectIds.add(item.projectId.toString());
        }
        if (item._id) {
          itemIds.add(item._id);
        }
      }

      // For each project, unset the default on other providers
      for (const projectIdStr of projectIds) {
        const projectId: ObjectID = new ObjectID(projectIdStr);
        await this.updateBy({
          query: {
            projectId: projectId,
            isDefault: true,
            _id: QueryHelper.notInOrNull(Array.from(itemIds)),
          },
          data: {
            isDefault: false,
          },
          props: {
            isRoot: true,
          },
          limit: LIMIT_MAX,
          skip: 0,
        });
      }
    }

    return { updateBy, carryForward: null };
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
   * Resolve a provider the project OWNS — never the global fallback. The AI
   * Agent path (via getLlmProviderForAgentTasks) hands the raw apiKey to an
   * external process whose LLM calls are not metered through AIService/
   * LlmLog, so the shared global (billed) provider must never be returned
   * here: its usage would be unbilled and uncapped. Prefers the project
   * default, else any project-owned provider.
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
   * DEPRECATED with the raw-key protocol (see
   * Internal/Roadmap/CodeFixSandboxDesign.md, Tier 0): this resolver backs
   * the legacy get-llm-config endpoint, which hands the raw apiKey to the
   * worker for UNMETERED direct LLM calls (the CODE_AGENT_TYPE=OpenCode
   * fallback, kept for one release). New code must use
   * getLlmProviderForMeteredAgentPath — the server-mediated completion
   * endpoint's resolution, where metering makes the global provider safe on
   * cloud. This method keeps the old restriction until it is removed.
   *
   * Resolve the provider handed to the AI Agent for a task. A project-owned
   * provider (getProjectOwnedLlmProvider) always wins. When the project owns
   * none, what happens next depends on where this instance runs:
   *
   * - Cloud (billing enabled): return null. The global provider there is
   *   OneUptime-billed and agent usage is not metered through AIService/
   *   LlmLog, so handing its key to the agent would be unbilled and uncapped.
   * - Self-host (billing disabled): fall back to the global provider — it is
   *   the operator's own key/endpoint (often seeded from the
   *   GLOBAL_LLM_PROVIDER_* env vars), so there is nothing to meter.
   *
   * options.billingEnabled overrides the IsBillingEnabled env flag — it
   * exists so tests can exercise both modes without mocking the module.
   */
  @CaptureSpan()
  public async getLlmProviderForAgentTasks(
    projectId: ObjectID,
    options?: { billingEnabled?: boolean },
  ): Promise<Model | null> {
    const projectOwnedProvider: Model | null =
      await this.getProjectOwnedLlmProvider(projectId);

    if (projectOwnedProvider) {
      return projectOwnedProvider;
    }

    const billingEnabled: boolean = options?.billingEnabled ?? IsBillingEnabled;

    if (billingEnabled) {
      return null;
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
   * Resolve the provider for the METERED agent path (B4 Tier 0): the
   * server-mediated /ai-agent-data/llm-completion endpoint, whose calls run
   * through AIService.executeWithLogging — logged to LlmLog, billed when the
   * global provider is costed, and inside the daily autonomous token budget.
   *
   * Because metering is universal on this path, the Workstream-A restriction
   * lifts THE RIGHT WAY: a project-owned provider still wins, but when the
   * project owns none the shared global provider is returned ON CLOUD TOO —
   * its usage here is billed as metered AI tokens, so the "unbilled and
   * uncapped" rationale that forbids it on the raw-key path does not apply.
   * Cloud zero-config completes: fix tasks work with no per-project provider.
   *
   * The OLD raw-key path (get-llm-config → getLlmProviderForAgentTasks)
   * keeps the project-owned-only cloud restriction until it is removed —
   * its calls bypass AIService/LlmLog entirely.
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
    if (data.llmProviderId) {
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

      if (provider) {
        const isGlobal: boolean = provider.isGlobalLlm === true;
        const belongsToProject: boolean =
          provider.projectId?.toString() === data.projectId.toString();

        if (isGlobal || belongsToProject) {
          return provider;
        }
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
