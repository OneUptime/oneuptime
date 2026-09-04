import CustomFieldMappingSourceResource from "../../Types/CustomField/CustomFieldMappingSourceResource";
import CustomFieldType from "../../Types/CustomField/CustomFieldType";
import {
  isCustomFieldValueEmpty,
  mergeMappedCustomFieldValues,
  MergedCustomFields,
  ResolvedCustomFieldValue,
  resolveMappedCustomFieldValue,
} from "../../Types/CustomField/CustomFieldValueMapping";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import QueryHelper from "../Types/Database/QueryHelper";
import {
  CustomFieldMappingSourceEntry,
  CustomFieldMappingTargetEntry,
  getCustomFieldMappingTarget,
  getCustomFieldMappingTargetsForSource,
} from "../Utils/CustomField/CustomFieldMappingRegistry";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import logger, { LogAttributes } from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * CUSTOM FIELD VALUE MAPPING (OneUptime/oneuptime#3549).
 *
 * A custom field defined on Alert can be configured to take its value from
 * the same-shaped custom field on the Monitor the alert belongs to, instead of
 * being typed in again by hand. The configuration lives on the definition row
 * (`mapFromResourceType` + `mapFromCustomFieldName`); this service is
 * everything that happens as a result.
 *
 * THE INVARIANT. Mapping only ever writes a value that exists on a source. It
 * has no code path that clears a key:
 *
 *   - target has no source record       -> write nothing
 *   - source definition does not exist  -> write nothing
 *   - source value is empty             -> write nothing
 *   - sources disagree (and the field holds one value) -> write nothing
 *
 * That is not timidity, it is the difference between a safe feature and a
 * destructive one. The natural first action after this ships is "turn the
 * mapping on for Vendor" on a project that has been filling Vendor in by hand
 * for a year and whose monitors have no Vendor at all. Any rule that treated
 * "source is empty" as "clear the target" would erase every one of those
 * values, through a hook-free write that leaves no audit row. The cost of the
 * invariant is stated plainly in the settings help text: clearing the source
 * does not clear the copies.
 *
 * WHERE IT RUNS, and why each is the only place that works:
 *
 *   1. `applyMappingsToCreate` from the target's `onBeforeCreate`. Every
 *      creation path in the product — monitor criteria, the REST API, Slack,
 *      Teams, the AI toolbox, workflows — funnels through DatabaseService
 *      .create, so one hook covers all of them. It cannot be onCreateSuccess:
 *      that chain is un-awaited and runs after the response, and customFields
 *      is a column on the row the caller is handed back.
 *
 *   2. `applyMappingsToUpdate` from the target's `onBeforeUpdate`. Covers two
 *      cases at once: the Custom Fields modal saving the WHOLE bag back (which
 *      would otherwise clobber a mapped value), and the record being re-pointed
 *      at a different monitor. Doing it in the before-hook makes it one atomic
 *      write with a correct audit row, workflow payload and realtime event —
 *      repairing it afterwards would publish the wrong value first.
 *
 *   3. `propagateFromSourceRecord` from `MonitorService.onUpdateSuccess`. The
 *      "stays in sync" half of the issue.
 *
 *   4. `backfillProject` from the definition service's create/update hooks, so
 *      turning a mapping on fills in records that already exist.
 *
 * KNOWN LIMITS, deliberately not solved here. There is no reconcile cron: a
 * fan-out lost to a pod restart, or truncated at LIMIT_PER_PROJECT, leaves
 * some records holding an older value until the source is edited again.
 * Because of the invariant that is always a stale copy and never a lost value.
 * Deleting the source monitor freezes the value rather than clearing it, for
 * the same reason. And the ClickHouse metric attributes derived from
 * `customFields` are refreshed on their existing triggers only — the same gap
 * a manual custom field edit has today.
 */

/** One configured mapping, resolved against the registry. */
export interface CustomFieldMapping {
  targetFieldName: string;
  sourceFieldName: string;
  targetFieldType?: CustomFieldType | undefined;
  source: CustomFieldMappingSourceEntry;
}

/*
 * How many target records one fan-out reads at a time. Small enough that a
 * page of rows and their sources sits comfortably in memory, large enough
 * that a monitor with a few thousand alerts is a handful of round trips.
 */
const FAN_OUT_PAGE_SIZE: number = 500;

/*
 * Ceiling on how many target records one source change or one backfill
 * rewrites. Same bound and the same reasoning as the rule engines: it is a
 * ceiling rather than a page size, and crossing it is logged rather than
 * silently swallowed.
 */
const MAX_RECORDS_RESTAMPED: number = LIMIT_PER_PROJECT;

export class CustomFieldMappingServiceClass {
  /**
   * The mappings configured on one target's definition table for one project.
   * Empty — the overwhelmingly common answer — costs a single indexed read.
   */
  @CaptureSpan()
  public async getMappings(data: {
    target: CustomFieldMappingTargetEntry;
    projectId: ObjectID;
  }): Promise<Array<CustomFieldMapping>> {
    const definitions: Array<BaseModel> = await data.target
      .getDefinitionService()
      .findBy({
        query: {
          projectId: data.projectId,
        },
        select: {
          name: true,
          customFieldType: true,
          mapFromResourceType: true,
          mapFromCustomFieldName: true,
        },
        limit: MAX_RULES_EVALUATED_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    logIfRuleReadWasTruncated({
      ruleKind: data.target.definitionTableName,
      projectId: data.projectId,
      rulesRead: definitions.length,
    });

    const mappings: Array<CustomFieldMapping> = [];

    for (const definition of definitions) {
      const targetFieldName: string | undefined = (definition as any)["name"];
      const resource: string | undefined = (definition as any)[
        "mapFromResourceType"
      ];
      const sourceFieldName: string | undefined = (definition as any)[
        "mapFromCustomFieldName"
      ];

      if (!targetFieldName || !resource || !sourceFieldName) {
        continue;
      }

      const source: CustomFieldMappingSourceEntry | undefined =
        data.target.sources.find((entry: CustomFieldMappingSourceEntry) => {
          return entry.info.resource === resource;
        });

      /*
       * A row can name a resource this target cannot reach if the catalog
       * shrinks after the mapping was saved. Skipping is the same behaviour as
       * a dangling source field: the field simply goes back to being manual.
       */
      if (!source) {
        continue;
      }

      mappings.push({
        targetFieldName: targetFieldName,
        sourceFieldName: sourceFieldName,
        targetFieldType: (definition as any)["customFieldType"],
        source: source,
      });
    }

    /* Stable order so log lines and tests do not depend on row order. */
    return mappings.sort((a: CustomFieldMapping, b: CustomFieldMapping) => {
      return a.targetFieldName.localeCompare(b.targetFieldName);
    });
  }

  /**
   * Resolve every mapping for ONE target record.
   *
   * `sourceBagsById` is a cache shared across a fan-out page so a monitor
   * attached to fifty incidents is read once.
   */
  private async resolveValuesForRecord(data: {
    mappings: Array<CustomFieldMapping>;
    sourceIdsBySource: Map<CustomFieldMappingSourceEntry, Array<ObjectID>>;
    sourceBagsById: Map<string, JSONObject>;
  }): Promise<JSONObject> {
    await this.loadMissingSourceBags({
      sourceIdsBySource: data.sourceIdsBySource,
      sourceBagsById: data.sourceBagsById,
    });

    const resolved: JSONObject = {};

    for (const mapping of data.mappings) {
      const sourceIds: Array<ObjectID> =
        data.sourceIdsBySource.get(mapping.source) || [];

      const sourceValues: Array<unknown> = sourceIds.map((id: ObjectID) => {
        const bag: JSONObject | undefined = data.sourceBagsById.get(
          id.toString(),
        );

        return bag ? bag[mapping.sourceFieldName] : undefined;
      });

      const resolution: ResolvedCustomFieldValue =
        resolveMappedCustomFieldValue({
          sourceValues: sourceValues,
          targetFieldType: mapping.targetFieldType,
        });

      if (!resolution.hasValue) {
        continue;
      }

      resolved[mapping.targetFieldName] =
        resolution.value as JSONObject[string];
    }

    return resolved;
  }

  private async loadMissingSourceBags(data: {
    sourceIdsBySource: Map<CustomFieldMappingSourceEntry, Array<ObjectID>>;
    sourceBagsById: Map<string, JSONObject>;
  }): Promise<void> {
    for (const [source, ids] of data.sourceIdsBySource.entries()) {
      const missing: Array<ObjectID> = ids.filter((id: ObjectID) => {
        return !data.sourceBagsById.has(id.toString());
      });

      if (missing.length === 0) {
        continue;
      }

      const records: Array<BaseModel> = await source.getSourceService().findBy({
        query: {
          _id: QueryHelper.any(
            missing.map((id: ObjectID) => {
              return id.toString();
            }),
          ),
        },
        select: {
          _id: true,
          customFields: true,
        },
        limit: missing.length,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      for (const record of records) {
        data.sourceBagsById.set(
          record.id!.toString(),
          ((record as any)["customFields"] || {}) as JSONObject,
        );
      }

      /*
       * A source that could not be read — deleted between the two queries, or
       * simply gone — is cached as an empty bag rather than retried on every
       * record in the page. An empty bag resolves to "write nothing", which is
       * the intended behaviour for a missing source.
       */
      for (const id of missing) {
        if (!data.sourceBagsById.has(id.toString())) {
          data.sourceBagsById.set(id.toString(), {});
        }
      }
    }
  }

  /**
   * Stamp mapped values onto a record being created.
   *
   * Never throws: this runs on the alert/incident ingest path, where a failure
   * to inherit a custom field must not stop the alert from being opened.
   */
  @CaptureSpan()
  public async applyMappingsToCreate(data: {
    definitionModelType: { new (): BaseModel };
    createBy: CreateBy<any>;
  }): Promise<void> {
    try {
      const target: CustomFieldMappingTargetEntry | undefined =
        getCustomFieldMappingTarget(new data.definitionModelType().tableName!);

      if (!target) {
        return;
      }

      const projectId: ObjectID | undefined =
        (data.createBy.props.tenantId as ObjectID | undefined) ||
        (data.createBy.data as any)["projectId"];

      if (!projectId) {
        return;
      }

      const mappings: Array<CustomFieldMapping> = await this.getMappings({
        target: target,
        projectId: projectId,
      });

      if (mappings.length === 0) {
        return;
      }

      const sourceIdsBySource: Map<
        CustomFieldMappingSourceEntry,
        Array<ObjectID>
      > = new Map<CustomFieldMappingSourceEntry, Array<ObjectID>>();
      const sourceBagsById: Map<string, JSONObject> = new Map<
        string,
        JSONObject
      >();

      for (const source of target.sources) {
        sourceIdsBySource.set(
          source,
          source.readSourceIdsFromPayload(data.createBy.data) || [],
        );

        /*
         * Monitor criteria hand us the whole Monitor, already read with its
         * customFields (MonitorResource selects them for metric attributes).
         * Taking the bag from the payload keeps the hottest creation path in
         * the product free of an extra query.
         */
        for (const [id, bag] of Object.entries(
          source.readHydratedSourcesFromPayload(data.createBy.data),
        )) {
          sourceBagsById.set(id, bag);
        }
      }

      const resolved: JSONObject = await this.resolveValuesForRecord({
        mappings: mappings,
        sourceIdsBySource: sourceIdsBySource,
        sourceBagsById: sourceBagsById,
      });

      if (Object.keys(resolved).length === 0) {
        return;
      }

      const merged: MergedCustomFields = mergeMappedCustomFieldValues({
        existingCustomFields: (data.createBy.data as any)["customFields"],
        resolvedValues: resolved,
      });

      if (!merged.hasChanged) {
        return;
      }

      (data.createBy.data as any)["customFields"] = merged.customFields;
    } catch (error) {
      logger.error("Custom field value mapping failed on create.");
      logger.error(error as Error);
    }
  }

  /**
   * Re-stamp mapped values into an update payload.
   *
   * Only the single-row case is folded into the payload, because `updateBy`
   * carries ONE payload for every row its query matches and two records can
   * have different monitors. Multi-row updates are handled after the fact by
   * `restampRecordsByIds`, which resolves per row.
   */
  @CaptureSpan()
  public async applyMappingsToUpdate(data: {
    definitionModelType: { new (): BaseModel };
    updateBy: UpdateBy<any>;
  }): Promise<void> {
    try {
      const target: CustomFieldMappingTargetEntry | undefined =
        getCustomFieldMappingTarget(new data.definitionModelType().tableName!);

      if (!target) {
        return;
      }

      if (
        !this.doesUpdateAffectMappedValues({ target, updateBy: data.updateBy })
      ) {
        return;
      }

      /*
       * Limit 2 rather than 1: the answer needed is "exactly one row or more
       * than one", and asking for two is how you tell those apart without
       * counting the whole match.
       */
      const affected: Array<BaseModel> = await this.findTargetRecords({
        target: target,
        query: data.updateBy.query as JSONObject,
        limit: 2,
        skip: 0,
      });

      if (affected.length !== 1) {
        return;
      }

      const record: BaseModel = affected[0]!;
      const projectId: ObjectID | undefined = (record as any)["projectId"];

      if (!projectId) {
        return;
      }

      const mappings: Array<CustomFieldMapping> = await this.getMappings({
        target: target,
        projectId: projectId,
      });

      if (mappings.length === 0) {
        return;
      }

      const sourceIdsBySource: Map<
        CustomFieldMappingSourceEntry,
        Array<ObjectID>
      > = new Map<CustomFieldMappingSourceEntry, Array<ObjectID>>();

      for (const source of target.sources) {
        /*
         * The payload wins when it writes the relation — that is the
         * re-pointing case, and the record still holds the OLD monitor.
         */
        const fromPayload: Array<ObjectID> | null =
          source.readSourceIdsFromPayload(data.updateBy.data);

        sourceIdsBySource.set(
          source,
          fromPayload === null
            ? source.readSourceIdsFromRecord(record)
            : fromPayload,
        );
      }

      const resolved: JSONObject = await this.resolveValuesForRecord({
        mappings: mappings,
        sourceIdsBySource: sourceIdsBySource,
        sourceBagsById: new Map<string, JSONObject>(),
      });

      if (Object.keys(resolved).length === 0) {
        return;
      }

      /*
       * When the payload replaces the whole bag, that replacement is the base
       * to merge into. When it does not (a pure re-point), the stored bag is.
       */
      const base: JSONObject =
        (data.updateBy.data as any)["customFields"] !== undefined
          ? ((data.updateBy.data as any)["customFields"] as JSONObject)
          : (((record as any)["customFields"] || {}) as JSONObject);

      const merged: MergedCustomFields = mergeMappedCustomFieldValues({
        existingCustomFields: base,
        resolvedValues: resolved,
      });

      if (!merged.hasChanged) {
        return;
      }

      (data.updateBy.data as any)["customFields"] = merged.customFields;
    } catch (error) {
      logger.error("Custom field value mapping failed on update.");
      logger.error(error as Error);
    }
  }

  /**
   * The multi-row half of `applyMappingsToUpdate`.
   *
   * `updateBy` carries ONE payload for every row its query matched, so a
   * query-based update touching several records cannot have per-record values
   * folded into it. Those rows are re-resolved individually here instead —
   * after the fact, but a query-based write of `customFields` across many rows
   * is not something any UI in the product does, so this is a backstop for the
   * raw API rather than the path anyone takes.
   *
   * Fire-and-forget: the single-row case has already been handled atomically,
   * and this must not add its cost to the caller's request.
   */
  @CaptureSpan()
  public restampAfterMultiRowUpdate(data: {
    definitionModelType: { new (): BaseModel };
    updateBy: UpdateBy<any>;
    updatedItemIds: Array<ObjectID>;
  }): void {
    if (data.updatedItemIds.length < 2) {
      return;
    }

    const target: CustomFieldMappingTargetEntry | undefined =
      getCustomFieldMappingTarget(new data.definitionModelType().tableName!);

    if (!target) {
      return;
    }

    if (
      !this.doesUpdateAffectMappedValues({
        target: target,
        updateBy: data.updateBy,
      })
    ) {
      return;
    }

    const projectId: ObjectID | undefined = data.updateBy.props.tenantId as
      | ObjectID
      | undefined;

    if (!projectId) {
      return;
    }

    this.restampRecordsByIds({
      target: target,
      projectId: projectId,
      recordIds: data.updatedItemIds,
    }).catch((error: Error) => {
      logger.error(
        `Custom field value mapping: could not re-apply mappings after a multi-row ${target.targetName} update.`,
      );
      logger.error(error);
    });
  }

  /**
   * True when this update could change what a mapped field should hold: it
   * either rewrites the bag, or it moves the record to another source.
   */
  public doesUpdateAffectMappedValues(data: {
    target: CustomFieldMappingTargetEntry;
    updateBy: UpdateBy<any>;
  }): boolean {
    if ((data.updateBy.data as any)["customFields"] !== undefined) {
      return true;
    }

    const dataKeys: Array<string> = Object.keys(data.updateBy.data || {});

    return data.target.sources.some((source: CustomFieldMappingSourceEntry) => {
      return source.relationDataKeys.some((key: string) => {
        return dataKeys.includes(key);
      });
    });
  }

  /**
   * Re-resolve and re-write mapped values for specific target records.
   *
   * Writes go through `updateColumnsByIdWithoutHooks` because this is derived
   * data: the full update pipeline would fire a workflow POST, a realtime
   * emit and an audit-log insert per row, none of which a value the system
   * computed for itself should produce. `expectedData` makes each write a
   * compare-and-set on the bag it was resolved from, so a concurrent save
   * through the Custom Fields modal is left alone rather than half-overwritten,
   * and `skipUpdateDateColumn` keeps one monitor edit from restamping
   * `updatedAt` across years of resolved alerts.
   */
  @CaptureSpan()
  public async restampRecordsByIds(data: {
    target: CustomFieldMappingTargetEntry;
    projectId: ObjectID;
    recordIds: Array<ObjectID>;
  }): Promise<number> {
    if (data.recordIds.length === 0) {
      return 0;
    }

    const mappings: Array<CustomFieldMapping> = await this.getMappings({
      target: data.target,
      projectId: data.projectId,
    });

    if (mappings.length === 0) {
      return 0;
    }

    const records: Array<BaseModel> = await this.findTargetRecords({
      target: data.target,
      query: {
        _id: QueryHelper.any(
          data.recordIds.map((id: ObjectID) => {
            return id.toString();
          }),
        ),
      } as JSONObject,
      limit: data.recordIds.length,
      skip: 0,
    });

    return this.restampRecords({
      target: data.target,
      mappings: mappings,
      records: records,
      sourceBagsById: new Map<string, JSONObject>(),
    });
  }

  private async restampRecords(data: {
    target: CustomFieldMappingTargetEntry;
    mappings: Array<CustomFieldMapping>;
    records: Array<BaseModel>;
    sourceBagsById: Map<string, JSONObject>;
  }): Promise<number> {
    let updatedCount: number = 0;

    for (const record of data.records) {
      const sourceIdsBySource: Map<
        CustomFieldMappingSourceEntry,
        Array<ObjectID>
      > = new Map<CustomFieldMappingSourceEntry, Array<ObjectID>>();

      for (const source of data.target.sources) {
        sourceIdsBySource.set(source, source.readSourceIdsFromRecord(record));
      }

      const resolved: JSONObject = await this.resolveValuesForRecord({
        mappings: data.mappings,
        sourceIdsBySource: sourceIdsBySource,
        sourceBagsById: data.sourceBagsById,
      });

      if (Object.keys(resolved).length === 0) {
        continue;
      }

      const existing: JSONObject | null =
        ((record as any)["customFields"] as JSONObject) ?? null;

      const merged: MergedCustomFields = mergeMappedCustomFieldValues({
        existingCustomFields: existing,
        resolvedValues: resolved,
      });

      if (!merged.hasChanged) {
        continue;
      }

      await data.target.getTargetService().updateColumnsByIdWithoutHooks({
        id: record.id!,
        data: {
          customFields: merged.customFields,
        },
        expectedData: {
          customFields: existing,
        },
        skipUpdateDateColumn: true,
      });

      updatedCount++;
    }

    return updatedCount;
  }

  /**
   * A source record's custom fields changed — bring every target attached to
   * it back in line.
   *
   * Note that for a many-source target the changed source is not enough to
   * recompute with: an incident spanning three monitors resolves from all
   * three, so each record is re-read with its full relation.
   */
  @CaptureSpan()
  public async propagateFromSourceRecord(data: {
    resource: CustomFieldMappingSourceResource;
    sourceId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    const pairs: Array<{
      target: CustomFieldMappingTargetEntry;
      source: CustomFieldMappingSourceEntry;
    }> = getCustomFieldMappingTargetsForSource(data.resource);

    for (const pair of pairs) {
      try {
        const mappings: Array<CustomFieldMapping> = await this.getMappings({
          target: pair.target,
          projectId: data.projectId,
        });

        const mappingsForSource: Array<CustomFieldMapping> = mappings.filter(
          (mapping: CustomFieldMapping) => {
            return mapping.source === pair.source;
          },
        );

        if (mappingsForSource.length === 0) {
          continue;
        }

        await this.restampMatchingRecords({
          target: pair.target,
          mappings: mappings,
          query: {
            projectId: data.projectId,
            ...pair.source.buildTargetQueryForSourceId(data.sourceId),
          } as JSONObject,
          reason: `${pair.source.info.title} ${data.sourceId.toString()} custom fields changed`,
        });
      } catch (error) {
        logger.error(
          `Custom field value mapping: could not propagate ${pair.source.info.title} changes to ${pair.target.targetName}.`,
          {
            projectId: data.projectId.toString(),
          } as LogAttributes,
        );
        logger.error(error as Error);
      }
    }
  }

  /**
   * A mapping was created or changed — fill in the records that already exist.
   */
  @CaptureSpan()
  public async backfillProject(data: {
    definitionModelType: { new (): BaseModel };
    projectId: ObjectID;
  }): Promise<void> {
    const target: CustomFieldMappingTargetEntry | undefined =
      getCustomFieldMappingTarget(new data.definitionModelType().tableName!);

    if (!target) {
      return;
    }

    try {
      const mappings: Array<CustomFieldMapping> = await this.getMappings({
        target: target,
        projectId: data.projectId,
      });

      if (mappings.length === 0) {
        return;
      }

      await this.restampMatchingRecords({
        target: target,
        mappings: mappings,
        query: { projectId: data.projectId } as JSONObject,
        reason: `${target.definitionTableName} mapping configuration changed`,
      });
    } catch (error) {
      logger.error(
        `Custom field value mapping: backfill of ${target.targetName} records failed.`,
        {
          projectId: data.projectId.toString(),
        } as LogAttributes,
      );
      logger.error(error as Error);
    }
  }

  private async restampMatchingRecords(data: {
    target: CustomFieldMappingTargetEntry;
    mappings: Array<CustomFieldMapping>;
    query: JSONObject;
    reason: string;
  }): Promise<void> {
    /*
     * Sources are cached for the whole sweep, not per page: a project-wide
     * backfill of ten thousand alerts across two hundred monitors reads each
     * monitor once.
     */
    const sourceBagsById: Map<string, JSONObject> = new Map<
      string,
      JSONObject
    >();

    let skip: number = 0;
    let updatedCount: number = 0;
    let readCount: number = 0;

    /*
     * Newest first. If a project is large enough to reach the ceiling, the
     * records people are actually looking at are the ones that get the value.
     */
    while (skip < MAX_RECORDS_RESTAMPED) {
      const page: Array<BaseModel> = await this.findTargetRecords({
        target: data.target,
        query: data.query,
        limit: Math.min(FAN_OUT_PAGE_SIZE, MAX_RECORDS_RESTAMPED - skip),
        skip: skip,
        sortNewestFirst: true,
      });

      if (page.length === 0) {
        break;
      }

      readCount += page.length;

      updatedCount += await this.restampRecords({
        target: data.target,
        mappings: data.mappings,
        records: page,
        sourceBagsById: sourceBagsById,
      });

      if (page.length < FAN_OUT_PAGE_SIZE) {
        break;
      }

      skip += page.length;
    }

    if (readCount >= MAX_RECORDS_RESTAMPED) {
      logger.error(
        `Custom field value mapping: stopped after ${MAX_RECORDS_RESTAMPED} ${data.target.targetName} records (${data.reason}). Older records keep their previous values until their source changes again.`,
      );
    }

    if (updatedCount > 0) {
      logger.debug(
        `Custom field value mapping: updated ${updatedCount} ${data.target.targetName} records (${data.reason}).`,
      );
    }
  }

  private async findTargetRecords(data: {
    target: CustomFieldMappingTargetEntry;
    query: JSONObject;
    limit: number;
    skip: number;
    sortNewestFirst?: boolean | undefined;
  }): Promise<Array<BaseModel>> {
    const select: JSONObject = {
      _id: true,
      projectId: true,
      customFields: true,
    };

    for (const source of data.target.sources) {
      Object.assign(select, source.targetRelationSelect);
    }

    return data.target.getTargetService().findBy({
      query: data.query,
      select: select,
      limit: data.limit,
      skip: data.skip,
      sort: data.sortNewestFirst ? { createdAt: SortOrder.Descending } : {},
      props: {
        isRoot: true,
      },
    });
  }
}

export { isCustomFieldValueEmpty };

export default new CustomFieldMappingServiceClass();
