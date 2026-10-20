import DataMigrationBase from "./DataMigrationBase";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import logger from "Common/Server/Utils/Logger";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import {
  CONTAINER_CPU_PERCENT_METRIC,
  CONTAINER_CPU_UTILIZATION_METRIC,
  CONTAINER_MEMORY_PERCENT_METRIC,
} from "Common/Utils/Metrics/ContainerStatsPercentUnit";

/*
 * The metric catalog's unit for the container stats receivers' percents, in
 * every project at once.
 *
 * The docker_stats receiver (the Docker, Podman and Docker Swarm agents) and
 * podman_stats send container.memory.percent and container.cpu.utilization
 * (container.cpu.percent for podman_stats) as a percent, 0-100, but declare
 * the unit "1", a 0-1 fraction - and the catalog row of each project said
 * "1", so every chart, the metrics explorer and a generic monitor's "%"
 * threshold read them 100 times too high: 4.36% of a memory limit drew as
 * 436.64%. Ingest now records "%" for them (ContainerStatsPercentUnit), and a
 * project's row moves to "%" with its next Docker or Podman batch. This
 * corrects every row now, including those of projects whose hosts no longer
 * report, so the memory percents they stored - always right in value - read
 * right everywhere from the moment the update is deployed.
 *
 * Which rows say "1" and become "%":
 *   - container.memory.percent and container.cpu.percent: only the
 *     docker_stats and podman_stats receivers send those names;
 *   - container.cpu.utilization only with docker_stats' own description.
 *     OneUptime's Kubernetes agent sends the same name as CPU cores, also
 *     declared "1" (described "Container CPU utilization"), and in a
 *     Kubernetes project "1" is right: those rows stay.
 *
 * A write is a compare-and-set on the unit, so a batch that changed the row
 * meanwhile keeps its write. Ids are collected before anything is written: a
 * corrected row drops out of the match, so paging the match while writing
 * would skip rows. Idempotent, and safe to run twice at once as the runner
 * requires (Workers/Utils/DataMigration.ts): a corrected row no longer
 * matches, and two passes writing "%" over "1" cannot disagree.
 */

// What docker_stats calls its own container.cpu.utilization.
export const DOCKER_STATS_CPU_UTILIZATION_DESCRIPTION: string =
  "Percent of CPU used by the container.";

const FRACTION_UNIT: string = "1";
const PERCENT_UNIT: string = "%";

export interface ContainerPercentRowQuery {
  name: string;
  description?: string | undefined;
}

export const CONTAINER_PERCENT_ROW_QUERIES: ReadonlyArray<ContainerPercentRowQuery> =
  [
    { name: CONTAINER_MEMORY_PERCENT_METRIC },
    { name: CONTAINER_CPU_PERCENT_METRIC },
    {
      name: CONTAINER_CPU_UTILIZATION_METRIC,
      description: DOCKER_STATS_CPU_UTILIZATION_DESCRIPTION,
    },
  ];

export default class RecordContainerPercentMetricUnits extends DataMigrationBase {
  public constructor() {
    super("RecordContainerPercentMetricUnits");
  }

  public override async migrate(): Promise<void> {
    let correctedCount: number = 0;

    for (const rowQuery of CONTAINER_PERCENT_ROW_QUERIES) {
      const ids: Array<ObjectID> = await this.findRowIds(rowQuery);

      for (const id of ids) {
        try {
          const written: boolean =
            await MetricTypeService.compareAndSetColumnsByIdWithoutHooks({
              id: id,
              data: { unit: PERCENT_UNIT },
              expectedData: { unit: FRACTION_UNIT },
            });
          if (written) {
            correctedCount++;
          }
        } catch (err) {
          /*
           * One row that cannot be written must not cost the others their
           * correction, nor halt every migration queued behind this one.
           */
          logger.error(
            `RecordContainerPercentMetricUnits: could not record the unit of metric type ${id.toString()} (${rowQuery.name}):`,
          );
          logger.error(err);
        }
      }
    }

    if (correctedCount > 0) {
      logger.info(
        `RecordContainerPercentMetricUnits: recorded "%" as the unit of ${correctedCount} container percent metric type(s) that said "1".`,
      );
    }
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to undo: the rows hold percents, and "1" read them 100 times
     * too high.
     */
  }

  private async findRowIds(
    rowQuery: ContainerPercentRowQuery,
  ): Promise<Array<ObjectID>> {
    const ids: Array<ObjectID> = [];
    let skip: number = 0;

    // Nothing is written while this pages, so the match stays put.
    while (true) {
      const rows: Array<MetricType> = await MetricTypeService.findBy({
        query: {
          name: rowQuery.name,
          unit: FRACTION_UNIT,
          ...(rowQuery.description !== undefined
            ? { description: rowQuery.description }
            : {}),
        },
        select: {
          _id: true,
        },
        sort: {
          _id: SortOrder.Ascending,
        },
        limit: LIMIT_MAX,
        skip: skip,
        props: {
          isRoot: true,
        },
      });

      for (const row of rows) {
        if (row.id) {
          ids.push(row.id);
        }
      }

      if (rows.length < LIMIT_MAX) {
        return ids;
      }
      skip += LIMIT_MAX;
    }
  }
}
