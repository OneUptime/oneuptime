import DatabaseService from "../../Services/DatabaseService";
import GlobalCache from "../../Infrastructure/GlobalCache";
import logger from "../Logger";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import Select from "../../Types/Database/Select";
import PartialEntity from "../../../Types/Database/PartialEntity";
import ObjectID from "../../../Types/ObjectID";
import crypto from "crypto";

/*
 * Telemetry resources (hosts, services, docker hosts, clusters, ...) get
 * Labels from `oneuptime.label.<dimension>` OTel resource attributes. Every
 * ingest batch re-declares the same attributes, so the attach step has to
 * decide, on each batch, whether a declared label still needs applying.
 *
 * That decision used to be "is it already on the resource?", guarded only by
 * a 60 second cache. Any label a user removed in the UI was therefore
 * re-attached on the next batch after the cache expired - bulk "Remove
 * Labels" reported success and the labels silently came back within a minute.
 *
 * The decision is now "has ingest already applied this label to this
 * resource?", recorded durably in `telemetryAppliedLabelIds`. Ingest applies
 * a telemetry label once; after that the label belongs to the user, and a
 * removal sticks for as long as telemetry keeps declaring the same set.
 */
export const TELEMETRY_AUTO_LABEL_CACHE_NAMESPACE: string =
  "telemetry-auto-labels-applied";

export const TELEMETRY_AUTO_LABEL_CACHE_TTL_SECONDS: number = 60;

/**
 * Every model that receives labels from telemetry carries the memo column.
 */
export interface TelemetryAutoLabelledModel extends BaseModel {
  telemetryAppliedLabelIds?: Array<string> | undefined;
}

export function fingerprintLabelIds(labelIds: Array<ObjectID>): string {
  const sorted: Array<string> = labelIds
    .map((id: ObjectID) => {
      return id.toString();
    })
    .sort();
  return crypto.createHash("sha1").update(sorted.join(",")).digest("hex");
}

function dedupeIds(labelIds: Array<ObjectID>): Array<string> {
  const seen: Set<string> = new Set<string>();
  const ids: Array<string> = [];

  for (const labelId of labelIds) {
    const idString: string = labelId.toString();
    if (!idString || seen.has(idString)) {
      continue;
    }
    seen.add(idString);
    ids.push(idString);
  }

  return ids;
}

function isSameIdSet(a: Array<string>, b: Array<string>): boolean {
  if (a.length !== b.length) {
    return false;
  }

  const setOfA: Set<string> = new Set<string>(a);

  for (const id of b) {
    if (!setOfA.has(id)) {
      return false;
    }
  }

  return true;
}

/**
 * Additively attach telemetry-declared labels to a resource.
 *
 * Only labels ingest has never applied before are attached, so:
 *
 *  - a brand new resource gets every label its telemetry declares;
 *  - a label the user removes stays removed while telemetry keeps declaring
 *    the same set;
 *  - a label newly added to the collector config is still picked up;
 *  - a label that telemetry stops declaring and later declares again counts
 *    as a fresh declaration and is attached again.
 *
 * Labels are never removed here - manual labels set via the UI survive
 * ingest, as before.
 */
export default async function attachTelemetryLabels<
  TBaseModel extends TelemetryAutoLabelledModel,
>(data: {
  service: DatabaseService<TBaseModel>;
  modelType: { new (): TBaseModel };
  resourceId: ObjectID;
  labelIds: Array<ObjectID>;
}): Promise<void> {
  if (!data.labelIds || data.labelIds.length === 0) {
    return;
  }

  const resourceIdString: string = data.resourceId.toString();
  const tableName: string = data.service.getRepository().metadata.tableName;
  const cacheKey: string = `${tableName}:${resourceIdString}`;
  const declaredIds: Array<string> = dedupeIds(data.labelIds);
  const fingerprint: string = fingerprintLabelIds(data.labelIds);

  /*
   * Fast path: the steady-state collector pushes the same declaration every
   * batch. When we have already processed this exact set recently there is
   * nothing to attach and nothing to persist, so skip the reads entirely.
   */
  let cached: string | null = null;
  try {
    cached = await GlobalCache.getString(
      TELEMETRY_AUTO_LABEL_CACHE_NAMESPACE,
      cacheKey,
    );
  } catch {
    // Cache unavailable - fall through to the durable memo below.
    cached = null;
  }

  if (cached === fingerprint) {
    return;
  }

  try {
    const resource: TBaseModel | null = await data.service.findOneById({
      id: data.resourceId,
      select: {
        _id: true,
        telemetryAppliedLabelIds: true,
      } as Select<TBaseModel>,
      props: {
        isRoot: true,
      },
    });

    if (!resource) {
      return;
    }

    /*
     * NULL means ingest has never applied telemetry labels to this resource -
     * it is either new, or it predates the memo column. Either way the whole
     * declaration is treated as newly declared: anything already on the
     * resource is filtered out below, so this batch attaches nothing that is
     * not genuinely missing, and it seeds the memo so later removals stick.
     */
    const previouslyApplied: Array<string> | null = Array.isArray(
      resource.telemetryAppliedLabelIds,
    )
      ? resource.telemetryAppliedLabelIds.map((id: string) => {
          return id.toString();
        })
      : null;

    const alreadyApplied: Set<string> = new Set<string>(
      previouslyApplied || [],
    );

    const newlyDeclaredIds: Array<string> = declaredIds.filter((id: string) => {
      return !alreadyApplied.has(id);
    });

    if (newlyDeclaredIds.length > 0) {
      const existingLabels: Array<Label> = await data.service
        .getRepository()
        .createQueryBuilder()
        .relation(data.modelType, "labels")
        .of(resourceIdString)
        .loadMany();

      const existingIds: Set<string> = new Set<string>();
      for (const label of existingLabels) {
        const idString: string | undefined = label._id?.toString();
        if (idString) {
          existingIds.add(idString);
        }
      }

      const toAddIds: Array<string> = newlyDeclaredIds.filter((id: string) => {
        return !existingIds.has(id);
      });

      if (toAddIds.length > 0) {
        await data.service
          .getRepository()
          .createQueryBuilder()
          .relation(data.modelType, "labels")
          .of(resourceIdString)
          .add(toAddIds);
      }
    }

    /*
     * Record what telemetry declared. Dropping a label out of the memo when
     * the collector stops declaring it is deliberate: re-adding it to the
     * collector later is a fresh declaration and should apply again.
     */
    if (!previouslyApplied || !isSameIdSet(previouslyApplied, declaredIds)) {
      await data.service.updateColumnsByIdWithoutHooks({
        id: data.resourceId,
        data: {
          telemetryAppliedLabelIds: declaredIds,
        } as unknown as PartialEntity<TBaseModel>,
      });
    }

    try {
      await GlobalCache.setString(
        TELEMETRY_AUTO_LABEL_CACHE_NAMESPACE,
        cacheKey,
        fingerprint,
        { expiresInSeconds: TELEMETRY_AUTO_LABEL_CACHE_TTL_SECONDS },
      );
    } catch {
      // Best-effort throttle write; the durable memo is the source of truth.
    }
  } catch (err) {
    /*
     * A concurrent ingest worker may have inserted the same join row between
     * our loadMany and add. Best-effort - surface as a warning so chronic
     * failures show up in logs without breaking ingest.
     */
    logger.warn(
      `attachTelemetryLabels failed for ${tableName} ${resourceIdString}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
