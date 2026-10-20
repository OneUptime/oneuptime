import LlmModelPriceModel from "../../../Models/DatabaseModels/LlmModelPrice";
import LlmObservabilityConnection from "../../../Models/DatabaseModels/LlmObservabilityConnection";
import Project from "../../../Models/DatabaseModels/Project";
import Reseller from "../../../Models/DatabaseModels/Reseller";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import {
  LlmConnectionDefinition,
  LlmConnectionKind,
} from "../../../Types/LlmObservability/LlmConnectionCatalog";
import {
  LlmChatTurn,
  LlmConnectionPullState,
} from "../../../Types/LlmObservability/LlmConnectionRecords";
import { LlmConnectionFailureKind } from "../../../Types/LlmObservability/LlmConnectionTest";
import ObjectID from "../../../Types/ObjectID";
import { LlmModelPrice } from "../../../Types/Telemetry/LlmCostCatalog";
import { resolveTelemetryRetentionInDays } from "../../../Types/Telemetry/TelemetryRetentionConfig";
import {
  DbJSONResponse,
  Results,
} from "../../Services/AnalyticsDatabaseService";
import LlmModelPriceService from "../../Services/LlmModelPriceService";
import LlmObservabilityConnectionService, {
  Service as LlmObservabilityConnectionServiceClass,
} from "../../Services/LlmObservabilityConnectionService";
import OpenTelemetryIngestService, {
  TelemetryServiceMetadata,
} from "../../Services/OpenTelemetryIngestService";
import ProjectService from "../../Services/ProjectService";
import ResellerService from "../../Services/ResellerService";
import SpanService from "../../Services/SpanService";
import TelemetryIngestionDisabled from "../../Middleware/TelemetryIngestionDisabled";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import DataSourceHttpFetch from "../DataSource/HttpFetch";
import logger from "../Logger";
import LlmChatSpanPayload from "./LlmChatSpanPayload";
import LlmConnectorRegistry from "./LlmConnectorRegistry";
import {
  LlmChatFetchResult,
  LlmConnectionSettings,
  LlmConnector,
  LlmConnectorTransport,
  LlmUsageFetchResult,
  LlmUsageWindow,
  getSecretValues,
} from "./LlmConnectorTypes";
import LlmProviderError from "./LlmProviderError";
import LlmProviderUsageWriter, {
  LlmProviderUsageWriteResult,
} from "./LlmProviderUsageWriter";
import LlmUsageDays from "./LlmUsageDays";

/*
 * ONE READ OF ONE CONNECTION.
 *
 * The worker runs it for every connection that is due (Workers job
 * LlmObservability:PullConnection); "Read now" queues it at once. A read:
 *
 *   1. holds to the project's plan: a reseller plan without telemetry
 *      features reads nothing, and nor does an installation that turned
 *      telemetry ingestion off;
 *   2. makes sure the connection has its own telemetry service;
 *   3. reads the provider - a provider account's days since the last read
 *      (LlmUsageDays.nextWindow), or a company AI tool's chats since its
 *      cursor - through the SSRF-guarded fetch;
 *   4. keeps what it read - usage as daily metrics (LlmProviderUsageWriter),
 *      chats as AI calls through the trace ingest (the importer the App
 *      hands in), skipping the turns already imported;
 *   5. records the outcome on the connection: when it read, what it found,
 *      the error (secrets removed) and when it reads next.
 *
 * A failure never escapes as anything but a recorded outcome, and the
 * bookkeeping write itself is guarded, so one connection's trouble never
 * stops the others.
 */

// One read of a company AI tool stops after this many requests or this long.
export const LLM_CHAT_READ_MAX_REQUESTS: number = 400;
export const LLM_CHAT_READ_MAX_DURATION_MS: number = 4 * 60 * 1000;
// The newest chats are read this long after they happen.
export const LLM_CHAT_READ_DELAY_MS: number = 5 * 60 * 1000;
// Turns sent through the trace ingest in one batch.
export const LLM_CHAT_IMPORT_BATCH_SIZE: number = 200;
// After a failure the next read waits at least this long.
const RETRY_AFTER_FAILURE_MS: number = 15 * 60 * 1000;
// After a refused credential, the next read waits this long.
const RETRY_AFTER_REFUSED_CREDENTIAL_MS: number = 60 * 60 * 1000;
// A read that stopped part way continues this soon.
const CONTINUE_AFTER_MS: number = 60 * 1000;

const SPAN_TABLE: string = AnalyticsTableName.Span;
const DEDUPE_QUERY_SETTINGS: string = getQuerySettings({
  maxExecutionTimeInSeconds: 60,
  timeoutOverflowMode: "throw",
});

/*
 * Hands an OTLP/JSON trace export to the trace ingest of the project. The
 * App passes OtelTracesIngestService; tests pass a fake.
 */
export type LlmChatSpanImporter = (data: {
  projectId: ObjectID;
  payload: JSONObject;
}) => Promise<void>;

export interface LlmConnectionPullDependencies {
  importSpans: LlmChatSpanImporter;
  transport?: LlmConnectorTransport | undefined;
  now?: (() => Date) | undefined;
}

export type LlmConnectionPullStatus =
  | "success"
  | "partial"
  | "failed"
  | "skipped";

export interface LlmConnectionPullOutcome {
  status: LlmConnectionPullStatus;
  result: JSONObject;
  error?: string | undefined;
}

export default class LlmConnectionPullRunner {
  public static async isTelemetryAllowed(
    projectId: ObjectID,
  ): Promise<boolean> {
    if (TelemetryIngestionDisabled.isDisabled()) {
      return false;
    }

    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: { _id: true, resellerId: true },
      props: { isRoot: true },
    });

    if (!project) {
      return false;
    }

    if (!project.resellerId) {
      return true;
    }

    const reseller: Reseller | null = await ResellerService.findOneById({
      id: project.resellerId,
      select: { _id: true, enableTelemetryFeatures: true },
      props: { isRoot: true },
    });

    return Boolean(reseller?.enableTelemetryFeatures);
  }

  public static async loadProjectPrices(
    projectId: ObjectID,
  ): Promise<Array<LlmModelPrice>> {
    const rows: Array<LlmModelPriceModel> = await LlmModelPriceService.findBy({
      query: { projectId, isEnabled: true },
      select: {
        modelPrefix: true,
        inputPricePerMillionTokensInUSD: true,
        outputPricePerMillionTokensInUSD: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });

    return rows
      .filter((row: LlmModelPriceModel): boolean => {
        return Boolean(row.modelPrefix);
      })
      .map((row: LlmModelPriceModel): LlmModelPrice => {
        return {
          modelPrefix: row.modelPrefix!.trim().toLowerCase(),
          inputPricePerMillionTokensInUSD: Number(
            row.inputPricePerMillionTokensInUSD || 0,
          ),
          outputPricePerMillionTokensInUSD: Number(
            row.outputPricePerMillionTokensInUSD || 0,
          ),
        };
      });
  }

  public static readPullState(value: unknown): LlmConnectionPullState {
    const state: JSONObject =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as JSONObject)
        : {};
    const read: (key: string) => string | undefined = (
      key: string,
    ): string | undefined => {
      return typeof state[key] === "string" && state[key]
        ? (state[key] as string)
        : undefined;
    };

    const nextIndex: number = Number(state["nextIndex"]);

    return {
      cursor: read("cursor"),
      windowStart: read("windowStart"),
      windowEnd: read("windowEnd"),
      pageToken: read("pageToken"),
      nextIndex:
        Number.isInteger(nextIndex) && nextIndex >= 0 ? nextIndex : undefined,
    };
  }

  // When a connection that just read is read next.
  public static nextPullAt(data: {
    now: Date;
    intervalInMinutes: number;
    outcome: LlmConnectionPullStatus;
    failureKind?: LlmConnectionFailureKind | undefined;
  }): Date {
    if (data.outcome === "partial") {
      return new Date(data.now.getTime() + CONTINUE_AFTER_MS);
    }

    const interval: number = Math.max(1, data.intervalInMinutes) * 60 * 1000;

    if (data.outcome === "failed") {
      const wait: number =
        data.failureKind === LlmConnectionFailureKind.Authentication ||
        data.failureKind === LlmConnectionFailureKind.Permission
          ? RETRY_AFTER_REFUSED_CREDENTIAL_MS
          : Math.max(interval, RETRY_AFTER_FAILURE_MS);

      return new Date(data.now.getTime() + wait);
    }

    return new Date(data.now.getTime() + interval);
  }

  /*
   * The span ids, of the given ones, the connection's service already has:
   * the turns a read imported before.
   */
  public static async findExistingSpanIds(data: {
    projectId: ObjectID;
    serviceId: ObjectID;
    spanIds: Array<string>;
    from: Date;
    to: Date;
  }): Promise<Set<string>> {
    const existing: Set<string> = new Set<string>();

    for (let offset: number = 0; offset < data.spanIds.length; offset += 1000) {
      const batch: Array<string> = data.spanIds.slice(offset, offset + 1000);
      const statement: Statement = new Statement();
      statement.append(`SELECT spanId FROM ${SPAN_TABLE}`);
      statement.append(
        SQL` WHERE projectId = ${{
          type: TableColumnType.ObjectID,
          value: data.projectId,
        }} AND primaryEntityId = ${{
          type: TableColumnType.ObjectID,
          value: data.serviceId,
        }} AND startTime >= ${{
          type: TableColumnType.Date,
          value: data.from,
        }} AND startTime <= ${{
          type: TableColumnType.Date,
          value: data.to,
        }} AND spanId IN ${{
          type: TableColumnType.ArrayText,
          value: batch,
        }}`,
      );
      statement.append(DEDUPE_QUERY_SETTINGS);

      const result: Results = await SpanService.executeQuery(statement);
      const response: DbJSONResponse = await result.json<{
        data?: Array<JSONObject>;
      }>();

      for (const row of (response.data || []) as Array<JSONObject>) {
        if (typeof row["spanId"] === "string") {
          existing.add(row["spanId"].toLowerCase());
        }
      }
    }

    return existing;
  }

  public static async run(
    connectionId: ObjectID,
    dependencies: LlmConnectionPullDependencies,
  ): Promise<LlmConnectionPullOutcome> {
    const now: Date = dependencies.now ? dependencies.now() : new Date();
    const startedAt: number = Date.now();

    const connection: LlmObservabilityConnection | null =
      await LlmObservabilityConnectionService.findOneById({
        id: connectionId,
        select: {
          _id: true,
          projectId: true,
          name: true,
          provider: true,
          config: true,
          secrets: true,
          isEnabled: true,
          storeConversationText: true,
          serviceId: true,
          pullState: true,
        },
        props: { isRoot: true },
      });

    if (!connection || !connection.projectId || !connection.isEnabled) {
      return { status: "skipped", result: { reason: "not enabled" } };
    }

    const definition: LlmConnectionDefinition =
      LlmObservabilityConnectionServiceClass.getDefinitionOrThrow(
        connection.provider,
      );

    if (
      !(await LlmConnectionPullRunner.isTelemetryAllowed(connection.projectId))
    ) {
      const message: string =
        "AI connections are not part of this project's plan, or telemetry ingestion is turned off.";

      await LlmConnectionPullRunner.record(connection.id!, {
        lastPulledAt: now,
        lastError: message,
        nextPullAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      });

      return { status: "skipped", result: { reason: "plan" }, error: message };
    }

    let settings: LlmConnectionSettings | null = null;

    try {
      const service: { serviceId: ObjectID; serviceName: string } =
        await LlmObservabilityConnectionService.ensureTelemetryService(
          connection,
        );

      settings =
        await LlmObservabilityConnectionService.getConnectorSettings(
          connection,
        );

      const connector: LlmConnector = LlmConnectorRegistry.getConnector(
        definition.provider,
      );
      const transport: LlmConnectorTransport =
        dependencies.transport ||
        DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch);
      const state: LlmConnectionPullState =
        LlmConnectionPullRunner.readPullState(connection.pullState);

      let outcome: LlmConnectionPullOutcome;
      let nextState: LlmConnectionPullState;

      if (connector.kind === LlmConnectionKind.ProviderAccount) {
        const window: LlmUsageWindow = LlmUsageDays.nextWindow({
          now,
          state,
          backfillDays: definition.backfillDays,
        });
        const fetched: LlmUsageFetchResult = await connector.fetchUsage(
          settings,
          window,
          {
            transport,
            now: () => {
              return now;
            },
          },
        );

        const metadata: TelemetryServiceMetadata =
          await OpenTelemetryIngestService.telemetryServiceFromName({
            serviceName: service.serviceName,
            projectId: connection.projectId,
          });

        const written: LlmProviderUsageWriteResult =
          await LlmProviderUsageWriter.write({
            target: {
              projectId: connection.projectId,
              connectionId: connection.id!,
              connectionName: connection.name || definition.title,
              genAiProviderName: definition.genAiProviderName,
              serviceId: service.serviceId,
              serviceName: service.serviceName,
              retentionInDays: resolveTelemetryRetentionInDays({
                pillar: "metrics",
                serviceConfig: metadata.serviceRetentionConfig,
                serviceRetentionInDays: metadata.serviceRetentionInDays,
                projectConfig: metadata.projectRetentionConfig,
                projectRetentionInDays: metadata.projectRetentionInDays,
              }),
              costIsEstimated: definition.costIsEstimated,
              projectPriceOverrides:
                await LlmConnectionPullRunner.loadProjectPrices(
                  connection.projectId,
                ),
            },
            window,
            records: fetched.records,
            now,
          });

        nextState = { cursor: LlmUsageDays.startOfUtcDay(now).toISOString() };
        outcome = {
          status: "success",
          result: {
            kind: "usage",
            days: LlmUsageDays.daysBetween(window.startDay, window.endDay),
            daysWithUsage: written.daysWithUsage,
            series: written.seriesCount,
            pointsWritten: written.pointsWritten,
            inputTokens: written.inputTokens,
            outputTokens: written.outputTokens,
            requests: written.requests,
            costUsd: written.costUsd,
            requestCount: fetched.requestCount,
            warnings: fetched.warnings,
          },
        };
      } else {
        const fetched: LlmChatFetchResult = await connector.fetchChats(
          settings,
          {
            transport,
            now: () => {
              return now;
            },
            state,
            backfillStart: new Date(
              now.getTime() - definition.backfillDays * 24 * 60 * 60 * 1000,
            ),
            windowEnd: new Date(now.getTime() - LLM_CHAT_READ_DELAY_MS),
            maxRequests: LLM_CHAT_READ_MAX_REQUESTS,
            maxDurationMs: LLM_CHAT_READ_MAX_DURATION_MS,
          },
        );

        const imported: { turns: number; conversations: number } =
          await LlmConnectionPullRunner.importTurns({
            connection,
            definition,
            serviceId: service.serviceId,
            serviceName: service.serviceName,
            turns: fetched.turns,
            importSpans: dependencies.importSpans,
          });

        nextState = fetched.nextState;
        outcome = {
          status: fetched.complete ? "success" : "partial",
          result: {
            kind: "conversations",
            turnsRead: fetched.turns.length,
            turnsImported: imported.turns,
            conversationsImported: imported.conversations,
            deletedConversations: fetched.deletedConversationIds.length,
            complete: fetched.complete,
            requestCount: fetched.requestCount,
            warnings: fetched.warnings,
          },
        };
      }

      outcome.result["durationMs"] = Date.now() - startedAt;
      outcome.result["finishedAt"] = new Date().toISOString();
      outcome.result["status"] = outcome.status;

      await LlmConnectionPullRunner.record(connection.id!, {
        lastPulledAt: now,
        lastSuccessfulPullAt: now,
        lastError: null,
        lastPullResult: outcome.result,
        pullState: nextState as unknown as JSONObject,
        nextPullAt: LlmConnectionPullRunner.nextPullAt({
          now,
          intervalInMinutes: definition.pullIntervalInMinutes,
          outcome: outcome.status,
        }),
      });

      return outcome;
    } catch (error) {
      const failure: LlmProviderError = LlmProviderError.from({
        error,
        step: "read",
        providerTitle: definition.title,
        secretValues: settings ? getSecretValues(settings) : [],
      });

      const result: JSONObject = {
        status: "failed",
        failureKind: failure.kind,
        durationMs: Date.now() - startedAt,
        finishedAt: new Date().toISOString(),
      };

      await LlmConnectionPullRunner.record(connection.id!, {
        lastPulledAt: now,
        lastError: failure.message,
        lastPullResult: result,
        nextPullAt: LlmConnectionPullRunner.nextPullAt({
          now,
          intervalInMinutes: definition.pullIntervalInMinutes,
          outcome: "failed",
          failureKind: failure.kind,
        }),
      });

      return { status: "failed", result, error: failure.message };
    }
  }

  /*
   * The turns not imported before, through the trace ingest, in batches.
   * Returns how many turns and conversations were imported.
   */
  public static async importTurns(data: {
    connection: LlmObservabilityConnection;
    definition: LlmConnectionDefinition;
    serviceId: ObjectID;
    serviceName: string;
    turns: Array<LlmChatTurn>;
    importSpans: LlmChatSpanImporter;
  }): Promise<{ turns: number; conversations: number }> {
    if (data.turns.length === 0) {
      return { turns: 0, conversations: 0 };
    }

    const connectionId: string = data.connection.id!.toString();
    const times: Array<number> = data.turns.map((turn: LlmChatTurn): number => {
      return turn.startedAt.getTime();
    });
    const existing: Set<string> =
      await LlmConnectionPullRunner.findExistingSpanIds({
        projectId: data.connection.projectId!,
        serviceId: data.serviceId,
        spanIds: data.turns.map((turn: LlmChatTurn): string => {
          return LlmChatSpanPayload.spanIdOf(connectionId, turn.turnId);
        }),
        from: new Date(Math.min(...times) - 24 * 60 * 60 * 1000),
        to: new Date(Math.max(...times) + 24 * 60 * 60 * 1000),
      });

    // Each turn once: not imported before, and not twice in this read.
    const seen: Set<string> = new Set<string>();
    const fresh: Array<LlmChatTurn> = data.turns.filter(
      (turn: LlmChatTurn): boolean => {
        const spanId: string = LlmChatSpanPayload.spanIdOf(
          connectionId,
          turn.turnId,
        );

        if (existing.has(spanId) || seen.has(spanId)) {
          return false;
        }

        seen.add(spanId);
        return true;
      },
    );

    for (
      let offset: number = 0;
      offset < fresh.length;
      offset += LLM_CHAT_IMPORT_BATCH_SIZE
    ) {
      await data.importSpans({
        projectId: data.connection.projectId!,
        payload: LlmChatSpanPayload.build({
          turns: fresh.slice(offset, offset + LLM_CHAT_IMPORT_BATCH_SIZE),
          connectionId,
          connectionName: data.connection.name || data.definition.title,
          serviceName: data.serviceName,
          genAiProviderName: data.definition.genAiProviderName,
          keepText: data.connection.storeConversationText !== false,
        }),
      });
    }

    return {
      turns: fresh.length,
      conversations: new Set(
        fresh.map((turn: LlmChatTurn): string => {
          return turn.conversationId;
        }),
      ).size,
    };
  }

  // The bookkeeping write: guarded, so a failure to record never escapes.
  private static async record(
    connectionId: ObjectID,
    data: {
      lastPulledAt?: Date | undefined;
      lastSuccessfulPullAt?: Date | undefined;
      lastError?: string | null | undefined;
      lastPullResult?: JSONObject | undefined;
      pullState?: JSONObject | undefined;
      nextPullAt?: Date | undefined;
    },
  ): Promise<void> {
    try {
      await LlmObservabilityConnectionService.updateOneById({
        id: connectionId,
        // JSON columns make the typed partial too deep for TypeScript.
        data: data as never,
        props: { isRoot: true, ignoreHooks: true },
      });
    } catch (error) {
      logger.error(
        `AI connection ${connectionId.toString()}: the read's outcome could not be recorded: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
