import IncidentFromAlerts, {
  SeverityForMapping,
} from "../Incident/IncidentFromAlerts";

/*
 * What "Add to New Episode" starts the new episode with, from the incidents
 * or alerts it is for. Kept free of React and of the database models so the
 * rules can be pinned by plain unit tests; the dashboard turns the records
 * it fetched into these shapes.
 *
 *   - Severity: the most severe of theirs (the lowest order, as the
 *     project's severity settings list them) - as a grouping rule raises an
 *     episode's severity to its most severe member. An episode's severity
 *     comes from the same list as its members', so it is taken as it is.
 *   - Title: the most severe one's title - the one a person would name the
 *     problem after - skipping a private one: the episode's title is read by
 *     everyone who can see the episode, and a private incident's or alert's
 *     title is never written where people who cannot see it read it (a
 *     grouping rule's episode names a private alert "Private alert" for the
 *     same reason). With every one private, no title: the person names it.
 *
 * Ties go to the one listed first, and one with no known severity never wins
 * over one that has one.
 */

export interface RecordForNewEpisode {
  id: string;
  title?: string | undefined;
  isPrivate?: boolean | undefined;
  severityId?: string | undefined;
}

export interface NewEpisodePrefill {
  title: string;
  severityId: string | undefined;
}

export default class EpisodeFromRecords {
  /*
   * The records, most severe first. Records with no known severity keep
   * their order after every record with one; ties keep their order too.
   */
  public static sortBySeverity<T extends RecordForNewEpisode>(data: {
    records: Array<T>;
    severities: Array<SeverityForMapping>;
  }): Array<T> {
    return data.records
      .map((record: T, index: number) => {
        return {
          record: record,
          index: index,
          rank: IncidentFromAlerts.getSeverityRank(
            record.severityId,
            data.severities,
          ),
        };
      })
      .sort(
        (
          a: { record: T; index: number; rank: number | null },
          b: { record: T; index: number; rank: number | null },
        ): number => {
          if (a.rank !== null && b.rank !== null && a.rank !== b.rank) {
            return a.rank - b.rank;
          }

          if ((a.rank === null) !== (b.rank === null)) {
            return a.rank === null ? 1 : -1;
          }

          return a.index - b.index;
        },
      )
      .map((entry: { record: T }): T => {
        return entry.record;
      });
  }

  public static getPrefill(data: {
    records: Array<RecordForNewEpisode>;
    severities: Array<SeverityForMapping>;
  }): NewEpisodePrefill {
    const sorted: Array<RecordForNewEpisode> = this.sortBySeverity(data);

    const mostSevere: RecordForNewEpisode | undefined = sorted[0];

    const titled: RecordForNewEpisode | undefined = sorted.find(
      (record: RecordForNewEpisode): boolean => {
        return record.isPrivate !== true && Boolean(record.title?.trim());
      },
    );

    const severityIsKnown: boolean =
      Boolean(mostSevere?.severityId) &&
      IncidentFromAlerts.getSeverityRank(
        mostSevere?.severityId,
        data.severities,
      ) !== null;

    return {
      title: titled?.title?.trim() || "",
      severityId: severityIsKnown ? mostSevere?.severityId : undefined,
    };
  }
}
