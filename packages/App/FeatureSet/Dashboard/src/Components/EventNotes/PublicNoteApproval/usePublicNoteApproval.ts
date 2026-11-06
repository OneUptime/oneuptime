import { useEffect, useRef, useState } from "react";
import {
  PublicNoteApprovalNoteSummary,
  PublicNoteApprovalPolicySummary,
  fetchApprovalPolicy,
  fetchApprovalSummaries,
  getNoteIdsToDescribe,
} from "./PublicNoteApprovalUtil";
import { NoteRecord } from "../EventNotesUtil";

export interface UsePublicNoteApprovalResult {
  // Who approves this kind of note; null until read, or where there is no approval.
  policy: PublicNoteApprovalPolicySummary | null;
  // Where each note on the page stands, by note id.
  summaries: Record<string, PublicNoteApprovalNoteSummary>;
  // Read both again: after a decision, or a note posted.
  refresh: () => Promise<void>;
}

/*
 * A notes feed's public note approval: who approves this kind of note, and
 * where each note on the page stands - read for the notes that have an
 * approval, whenever the notes on the page change. Nothing is read for a
 * kind of note without approval (`apiPath` undefined), or a page with no
 * such notes. A failed read leaves what was shown: the notes themselves
 * still say where they stand (the approval badge reads their columns).
 */
export default function usePublicNoteApproval(data: {
  apiPath?: string | undefined;
  notes: Array<NoteRecord>;
}): UsePublicNoteApprovalResult {
  const [policy, setPolicy] = useState<PublicNoteApprovalPolicySummary | null>(
    null,
  );
  const [summaries, setSummaries] = useState<
    Record<string, PublicNoteApprovalNoteSummary>
  >({});

  // Every read takes a number; an answer older than the latest is dropped.
  const generation: React.MutableRefObject<number> = useRef<number>(0);

  const noteIds: Array<string> = data.apiPath
    ? getNoteIdsToDescribe(data.notes)
    : [];
  const noteIdsKey: string = noteIds.join(",");

  const readPolicy: () => Promise<void> = async (): Promise<void> => {
    if (!data.apiPath) {
      return;
    }

    try {
      setPolicy(await fetchApprovalPolicy(data.apiPath));
    } catch {
      // The composer then says nothing about approval; the server still holds notes.
    }
  };

  const readSummaries: () => Promise<void> = async (): Promise<void> => {
    const current: number = ++generation.current;

    if (!data.apiPath || noteIds.length === 0) {
      setSummaries({});
      return;
    }

    try {
      const list: Array<PublicNoteApprovalNoteSummary> =
        await fetchApprovalSummaries(data.apiPath, noteIds);

      if (current !== generation.current) {
        return;
      }

      const byId: Record<string, PublicNoteApprovalNoteSummary> = {};

      for (const summary of list) {
        byId[summary.noteId] = summary;
      }

      setSummaries(byId);
    } catch {
      // Kept as it was: the notes' own columns still say where they stand.
    }
  };

  useEffect(() => {
    void readPolicy();
  }, [data.apiPath]);

  useEffect(() => {
    void readSummaries();
  }, [data.apiPath, noteIdsKey]);

  return {
    policy,
    summaries,
    refresh: async (): Promise<void> => {
      await Promise.all([readPolicy(), readSummaries()]);
    },
  };
}
