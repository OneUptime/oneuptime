import DataMigrationBase from "./DataMigrationBase";
import Label from "Common/Models/DatabaseModels/Label";
import LabelService from "Common/Server/Services/LabelService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger from "Common/Server/Utils/Logger";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { getNaturalSortKey } from "Common/Utils/NaturalOrder";

/*
 * Writes the sort key of every label made before labels had one
 * (Label.nameSortKey, schema migration AddLabelNameSortKey).
 *
 * Labels are read in natural order by that key (Utils/LabelOrder,
 * LabelService): numbered labels first, by their numbers, then the others
 * alphabetically, as the Dashboard sorts a record's labels (OneUptime issue
 * #5183). Every create and rename writes the key from then on; until this
 * runs, a label without one is listed after those that have it.
 *
 * One plain UPDATE per label (compareAndSetColumnsByIdWithoutHooks): no
 * audit-log entry, workflow or realtime event for what is bookkeeping, and
 * the label's updatedAt and version left as they are. The write only lands
 * when the label still has the name the key was made from, so a rename
 * between the read and the write - which writes its own key - is never
 * overwritten.
 *
 * Keyset-paged by id, as a row it writes leaves the query. A label it could
 * not write is logged and left as it was - listed after the labels that have
 * a key, until its next rename writes one - rather than failing the run: a
 * failed data migration halts every migration after it, and an order is not
 * worth that. A failed read does fail it, so the runner tries again. Safe to
 * run twice at once: a label that has a key is never read, and two runs
 * write the same key.
 */
export default class BackfillLabelNameSortKeys extends DataMigrationBase {
  public constructor() {
    super("BackfillLabelNameSortKeys");
  }

  public override async migrate(): Promise<void> {
    let cursor: ObjectID | null = null;
    let written: number = 0;
    let renamedMeanwhile: number = 0;
    let failed: number = 0;

    while (true) {
      const query: Query<Label> = {
        nameSortKey: QueryHelper.isNull(),
      };

      if (cursor) {
        (query as unknown as Record<string, unknown>)["_id"] =
          QueryHelper.greaterThan(cursor);
      }

      const labels: Array<Label> = await LabelService.findBy({
        query: query,
        select: {
          _id: true,
          name: true,
        },
        sort: {
          _id: SortOrder.Ascending,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

      if (labels.length === 0) {
        break;
      }

      for (const label of labels) {
        if (!label.id) {
          continue;
        }

        cursor = label.id;

        // A label always has a name (NOT NULL); one read without is skipped.
        const name: string | undefined = label.name;

        if (typeof name !== "string") {
          continue;
        }

        try {
          const isWritten: boolean =
            await LabelService.compareAndSetColumnsByIdWithoutHooks({
              id: label.id,
              data: {
                nameSortKey: getNaturalSortKey(name),
              },
              expectedData: {
                name: name,
              },
              skipUpdateDateColumn: true,
            });

          if (isWritten) {
            written++;
          } else {
            renamedMeanwhile++;
          }
        } catch (err) {
          failed++;

          logger.error(
            `BackfillLabelNameSortKeys: could not write the sort key of label ${label.id.toString()}: ${(err as Error)?.message || err}`,
          );
        }
      }

      if (labels.length < LIMIT_MAX) {
        break;
      }
    }

    logger.info(
      `BackfillLabelNameSortKeys: wrote the sort key of ${written} label(s); ${renamedMeanwhile} renamed or deleted meanwhile; ${failed} could not be written.`,
    );
  }

  public override async rollback(): Promise<void> {
    // Nothing to undo: the keys are only an order, written from the names.
    return;
  }
}
