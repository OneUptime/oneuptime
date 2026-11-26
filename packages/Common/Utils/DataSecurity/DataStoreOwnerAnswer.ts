import {
  DATA_STORE_OWNER_CONFIDENCES,
  DataStoreOwnerCandidate,
  DataStoreOwnerConfidence,
  DataStoreOwnerEvidence,
  MAX_DATA_STORE_OWNER_REASON_LENGTH,
  MAX_PROPOSED_DATA_STORE_OWNERS,
} from "../../Types/DataSecurity/DataStoreOwnerProposal";

/*
 * ONEUPTIME AI'S ANSWER ABOUT WHO OWNS A STORE, HELD TO ITS EVIDENCE (#10374).
 *
 * OneUptime AI is told the store, the candidates the evidence names - a
 * team by its name, a person only as "P1" - and each piece of evidence by
 * its id. It answers which candidates own the store, the evidence that
 * rests on, why in one sentence, how sure it is, and where the evidence
 * disagrees. Nothing it says is taken on its word:
 *
 *   - an owner that is no candidate - one it made up - is dropped, and so
 *     is evidence that is not the store's;
 *   - every owner kept rests on evidence that names it: the evidence it
 *     cited that does, or else every piece that does;
 *   - where it says the evidence disagrees, it is at most Low sure, so a
 *     person looks before approving;
 *   - its sentences name the candidates by reference only ("{T1}"), and
 *     are written with their names here, so nothing it was not told
 *     reaches them, and a person's name or email never reaches it.
 *
 * What is left is the proposal, or nothing - with why: it named no owner,
 * or it said the evidence disagrees too much to pick one.
 *
 * Pure: the server's proposal and the eval harness's score read it alike.
 */

// The answer as OneUptime AI gives it (StrictAnswer reads its shape).
export interface DataStoreOwnerAnswer {
  owners: Array<string>;
  restsOn: Array<string>;
  confidence: string;
  reason: string;
  disagreement: string;
}

export type HeldDataStoreOwnerAnswer =
  | {
      kind: "owners";
      owners: Array<DataStoreOwnerCandidate>;
      restsOn: Array<string>;
      confidence: DataStoreOwnerConfidence;
      reason: string;
      disagreement: string;
      // What it named that the evidence does not: dropped.
      inventedOwners: Array<string>;
      inventedEvidence: Array<string>;
    }
  | {
      kind: "nothing";
      // A decision's detail code: Why AI did not act says it.
      detail: "no-owner-named" | "evidence-disagrees";
      disagreement: string;
      inventedOwners: Array<string>;
      inventedEvidence: Array<string>;
    };

function readRef(value: string): string {
  return value
    .trim()
    .replace(/^\{|\}$/g, "")
    .trim()
    .toUpperCase();
}

function confidenceOf(value: string): DataStoreOwnerConfidence {
  const folded: string = value.trim().toLowerCase();

  return (
    DATA_STORE_OWNER_CONFIDENCES.find(
      (confidence: DataStoreOwnerConfidence): boolean => {
        return confidence.toLowerCase() === folded;
      },
    ) || DataStoreOwnerConfidence.Low
  );
}

/*
 * A sentence of OneUptime AI's, with each candidate's reference ("{T1}",
 * or a bare "T1") written as its name, any other braced reference left
 * out, on one line and held to a length.
 */
export function writeOwnerSentence(
  sentence: string,
  candidates: ReadonlyArray<DataStoreOwnerCandidate>,
): string {
  const byRef: Map<string, string> = new Map(
    candidates.map((candidate: DataStoreOwnerCandidate): [string, string] => {
      return [candidate.ref.toUpperCase(), candidate.name];
    }),
  );

  /*
   * One pass over what OneUptime AI wrote, so a name written in is never
   * read as a reference again; the braces left over go after it.
   */
  const written: string = sentence
    .slice(0, MAX_DATA_STORE_OWNER_REASON_LENGTH * 3)
    .replace(
      /\{\s*([A-Za-z]\d{1,3})\s*\}|\b([TP]\d{1,3})\b/g,
      (whole: string, braced?: string, bare?: string): string => {
        if (braced) {
          return byRef.get(braced.toUpperCase()) || "";
        }

        return byRef.get((bare || "").toUpperCase()) || whole;
      },
    )
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();

  return written.length > MAX_DATA_STORE_OWNER_REASON_LENGTH
    ? `${written.slice(0, MAX_DATA_STORE_OWNER_REASON_LENGTH - 1).trim()}…`
    : written;
}

export function holdDataStoreOwnerAnswerToEvidence(data: {
  answer: DataStoreOwnerAnswer;
  candidates: ReadonlyArray<DataStoreOwnerCandidate>;
  evidence: ReadonlyArray<DataStoreOwnerEvidence>;
}): HeldDataStoreOwnerAnswer {
  const candidatesByRef: Map<string, DataStoreOwnerCandidate> = new Map(
    data.candidates.map(
      (
        candidate: DataStoreOwnerCandidate,
      ): [string, DataStoreOwnerCandidate] => {
        return [candidate.ref.toUpperCase(), candidate];
      },
    ),
  );
  const evidenceById: Map<string, DataStoreOwnerEvidence> = new Map(
    data.evidence.map(
      (item: DataStoreOwnerEvidence): [string, DataStoreOwnerEvidence] => {
        return [item.id.toUpperCase(), item];
      },
    ),
  );

  const inventedOwners: Array<string> = [];
  const owners: Array<DataStoreOwnerCandidate> = [];

  for (const named of data.answer.owners) {
    const ref: string = readRef(named);
    const candidate: DataStoreOwnerCandidate | undefined =
      candidatesByRef.get(ref);

    if (!candidate) {
      if (ref && !inventedOwners.includes(ref)) {
        inventedOwners.push(ref);
      }
      continue;
    }

    if (!owners.includes(candidate)) {
      owners.push(candidate);
    }
  }

  const inventedEvidence: Array<string> = [];
  const cited: Array<string> = [];

  for (const named of data.answer.restsOn) {
    const id: string = readRef(named);

    if (!evidenceById.has(id)) {
      if (id && !inventedEvidence.includes(id)) {
        inventedEvidence.push(id);
      }
      continue;
    }

    if (!cited.includes(id)) {
      cited.push(id);
    }
  }

  const disagreement: string = writeOwnerSentence(
    data.answer.disagreement || "",
    data.candidates,
  );
  const kept: Array<DataStoreOwnerCandidate> = owners.slice(
    0,
    MAX_PROPOSED_DATA_STORE_OWNERS,
  );

  if (kept.length === 0) {
    return {
      kind: "nothing",
      detail: disagreement ? "evidence-disagrees" : "no-owner-named",
      disagreement,
      inventedOwners,
      inventedEvidence,
    };
  }

  /*
   * What the owners rest on: the cited evidence that names one of them,
   * and, for an owner none of it names, every piece that does.
   */
  const namesOwner: (id: string, owner: DataStoreOwnerCandidate) => boolean = (
    id: string,
    owner: DataStoreOwnerCandidate,
  ): boolean => {
    return owner.evidenceIds.some((evidenceId: string): boolean => {
      return evidenceId.toUpperCase() === id;
    });
  };
  const restsOn: Array<string> = cited.filter((id: string): boolean => {
    return kept.some((owner: DataStoreOwnerCandidate): boolean => {
      return namesOwner(id, owner);
    });
  });

  for (const owner of kept) {
    if (
      restsOn.some((id: string): boolean => {
        return namesOwner(id, owner);
      })
    ) {
      continue;
    }

    for (const evidenceId of owner.evidenceIds) {
      const id: string = evidenceId.toUpperCase();

      if (evidenceById.has(id) && !restsOn.includes(id)) {
        restsOn.push(id);
      }
    }
  }

  const confidence: DataStoreOwnerConfidence = disagreement
    ? DataStoreOwnerConfidence.Low
    : confidenceOf(data.answer.confidence || "");

  return {
    kind: "owners",
    owners: kept,
    restsOn: restsOn.map((id: string): string => {
      return evidenceById.get(id)!.id;
    }),
    confidence,
    reason: writeOwnerSentence(data.answer.reason || "", data.candidates),
    disagreement,
    inventedOwners,
    inventedEvidence,
  };
}
