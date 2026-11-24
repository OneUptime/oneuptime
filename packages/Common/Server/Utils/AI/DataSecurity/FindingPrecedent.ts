import {
  DATA_STORE_FINDING_VERDICT_LIMITS,
  DataStoreFindingDecision,
  DataStoreFindingPrecedent,
  getPersonDecision,
} from "../../../../Types/DataSecurity/DataStoreFindingVerdict";
import {
  areFindingsSimilar,
  FindingSimilarityFacts,
  getFindingNameKey,
  getFindingNameWords,
} from "../../../../Utils/DataSecurity/FindingJudgement";
import MeaningSearch, {
  MeaningSearchCandidate,
  MeaningSearchMatch,
} from "../MeaningSearch";

export { getPersonDecision };

/*
 * THE TEAM'S OWN DECISIONS THAT A VERDICT RESTS ON (#10372).
 *
 * Precedent for a finding is what people decided about findings of the
 * same data type elsewhere in the project - Confirmed, or marked Not
 * Sensitive with their reason - found in two steps, at most
 * DATA_STORE_FINDING_VERDICT_LIMITS.maxPrecedent of them:
 *
 *   1. Deterministically: the findings alike it (FindingJudgement): the
 *      same data type in a field of the same name, on any store or at
 *      another place of its own - the same location first, then the newest
 *      decision first. A finding in free text has no name to be alike by;
 *      its precedent is the same location of the same kind on another
 *      store, as a log body's on another service.
 *   2. By meaning: the rest of the decided findings of the type, ranked by
 *      MeaningSearch on their field's name and the reason given, against
 *      this field's name - `order_ref` beside `order_number`. Only ranked,
 *      never applied: what a decision is applied to is only what step 1
 *      finds (Apply to similar).
 *
 * Only a person's decision is precedent: OneUptime AI's own confirmations
 * (isConfirmedByAi) never are, so its verdicts never rest on its own
 * earlier ones. A finding marked not sensitive that was confirmed too
 * counts as not sensitive: it no longer counts.
 *
 * Pure: the records are read by whoever asks (FindingVerdicts).
 */

// A decided finding, as precedent is chosen from it.
export interface PrecedentCandidate extends FindingSimilarityFacts {
  id: string;
  dataStoreId: string;
  isSuppressed?: boolean | null | undefined;
  isConfirmed?: boolean | null | undefined;
  isConfirmedByAi?: boolean | null | undefined;
  suppressedReason?: string | null | undefined;
  decidedAt?: Date | string | null | undefined;
}

// The finding precedent is chosen for.
export interface PrecedentSubject extends FindingSimilarityFacts {
  id: string;
  dataStoreId: string;
}

function timeOf(value: Date | string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const time: number = (
    value instanceof Date ? value : new Date(value)
  ).getTime();

  return Number.isNaN(time) ? 0 : time;
}

function isoOf(value: Date | string | null | undefined): string | undefined {
  const time: number = timeOf(value);

  return time > 0 ? new Date(time).toISOString() : undefined;
}

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
}

// Newest decision first; the same location before another; then by id, so a read is stable.
function compareDeterministic(
  subject: PrecedentSubject,
): (a: PrecedentCandidate, b: PrecedentCandidate) => number {
  return (a: PrecedentCandidate, b: PrecedentCandidate): number => {
    const sameA: number = sameText(a.location, subject.location) ? 1 : 0;
    const sameB: number = sameText(b.location, subject.location) ? 1 : 0;

    if (sameA !== sameB) {
      return sameB - sameA;
    }

    const byTime: number = timeOf(b.decidedAt) - timeOf(a.decidedAt);

    if (byTime !== 0) {
      return byTime;
    }

    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

function toPrecedent(
  candidate: PrecedentCandidate,
  decision: DataStoreFindingDecision,
  isSameName: boolean,
): DataStoreFindingPrecedent {
  const decidedAt: string | undefined = isoOf(candidate.decidedAt);

  return {
    findingId: candidate.id,
    dataStoreId: candidate.dataStoreId,
    location: (candidate.location || "").slice(
      0,
      DATA_STORE_FINDING_VERDICT_LIMITS.maxLocationLength,
    ),
    decision,
    reason:
      decision === DataStoreFindingDecision.NotSensitive
        ? (candidate.suppressedReason || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, DATA_STORE_FINDING_VERDICT_LIMITS.maxPrecedentReasonLength)
        : "",
    isSameName,
    ...(decidedAt ? { decidedAt } : {}),
  };
}

/*
 * The precedent for one finding, from the decided findings given (see the
 * module comment): the deterministic ones first, then MeaningSearch's.
 */
export function selectFindingPrecedent(data: {
  finding: PrecedentSubject;
  candidates: ReadonlyArray<PrecedentCandidate>;
  limit?: number | undefined;
}): Array<DataStoreFindingPrecedent> {
  const limit: number = Math.max(
    0,
    Math.min(
      data.limit ?? DATA_STORE_FINDING_VERDICT_LIMITS.maxPrecedent,
      DATA_STORE_FINDING_VERDICT_LIMITS.maxPrecedent,
    ),
  );
  const subject: PrecedentSubject = data.finding;
  const decided: Array<{
    candidate: PrecedentCandidate;
    decision: DataStoreFindingDecision;
  }> = [];
  const seen: Set<string> = new Set();

  for (const candidate of data.candidates) {
    const decision: DataStoreFindingDecision | null =
      getPersonDecision(candidate);

    if (
      !decision ||
      !candidate.id ||
      candidate.id === subject.id ||
      seen.has(candidate.id) ||
      !subject.dataTypeId ||
      candidate.dataTypeId !== subject.dataTypeId
    ) {
      continue;
    }

    seen.add(candidate.id);
    decided.push({ candidate, decision });
  }

  if (limit === 0 || decided.length === 0) {
    return [];
  }

  const hasName: boolean = getFindingNameKey(subject) !== null;

  // 1. The findings alike it, or for free text the same place on another store.
  const alike: Array<{
    candidate: PrecedentCandidate;
    decision: DataStoreFindingDecision;
  }> = decided
    .filter(
      (entry: {
        candidate: PrecedentCandidate;
        decision: DataStoreFindingDecision;
      }): boolean => {
        if (hasName) {
          return areFindingsSimilar(subject, entry.candidate);
        }

        return (
          entry.candidate.dataStoreId !== subject.dataStoreId &&
          sameText(entry.candidate.location, subject.location) &&
          sameText(entry.candidate.locationKind, subject.locationKind) &&
          getFindingNameKey(entry.candidate) === null
        );
      },
    )
    .sort(
      (
        a: { candidate: PrecedentCandidate },
        b: { candidate: PrecedentCandidate },
      ): number => {
        return compareDeterministic(subject)(a.candidate, b.candidate);
      },
    );

  const chosen: Array<DataStoreFindingPrecedent> = alike
    .slice(0, limit)
    .map(
      (entry: {
        candidate: PrecedentCandidate;
        decision: DataStoreFindingDecision;
      }): DataStoreFindingPrecedent => {
        return toPrecedent(entry.candidate, entry.decision, true);
      },
    );

  if (chosen.length >= limit || !hasName) {
    return chosen;
  }

  // 2. The rest of the type's decisions, named alike by meaning.
  const taken: Set<string> = new Set(
    chosen.map((entry: DataStoreFindingPrecedent): string => {
      return entry.findingId;
    }),
  );
  const rest: Array<
    MeaningSearchCandidate<{
      candidate: PrecedentCandidate;
      decision: DataStoreFindingDecision;
    }>
  > = decided
    .filter(
      (entry: { candidate: PrecedentCandidate }): boolean => {
        return (
          !taken.has(entry.candidate.id) &&
          getFindingNameKey(entry.candidate) !== null
        );
      },
    )
    .sort(
      (
        a: { candidate: PrecedentCandidate },
        b: { candidate: PrecedentCandidate },
      ): number => {
        // Newest first: MeaningSearch keeps that order among equals.
        return compareDeterministic(subject)(a.candidate, b.candidate);
      },
    )
    .map(
      (entry: {
        candidate: PrecedentCandidate;
        decision: DataStoreFindingDecision;
      }) => {
        return {
          record: entry,
          text: MeaningSearch.documentText({
            title: getFindingNameWords(entry.candidate).join(" "),
            texts: [entry.candidate.suppressedReason],
          }),
        };
      },
    );

  if (rest.length === 0) {
    return chosen;
  }

  const ranked: Array<
    MeaningSearchMatch<{
      candidate: PrecedentCandidate;
      decision: DataStoreFindingDecision;
    }>
  > = MeaningSearch.rank({
    text: getFindingNameWords(subject).join(" "),
    candidates: rest,
    limit: limit - chosen.length,
  });

  for (const match of ranked) {
    chosen.push(
      toPrecedent(match.record.candidate, match.record.decision, false),
    );
  }

  return chosen;
}
