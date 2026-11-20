import { JSONObject } from "../../../../Types/JSON";

/*
 * WHAT A BI TOOL'S READ KEEPS SO THE NEXT ONE READS LESS
 * (DataBiConnection.readState).
 *
 *  - powerBi: Power BI's workspaces as last scanned, its scans still
 *    running, and its dataflows' definitions (PowerBiReadState): kept by
 *    the tool's own reader, which reads it back.
 *
 * Each Dataverse environment's entity set names, which a read once asked
 * the environment for and kept here (#9554), are kept with its tables now,
 * by every collection of it (#9696): a state kept before that still holds
 * them, and they are let go at the next write.
 *
 * Kept as JSON and read back here, taking anything and keeping what fits:
 * a state that cannot be read is no state, and the next read reads whole.
 */

export interface BiReadState {
  // The tool's own reader's, as it wrote it (Power BI's); null when there is none.
  powerBi: JSONObject | null;
}

/*
 * A read that has nothing to show yet, but something the next read goes
 * on from - Power BI's scans still running when it stopped waiting
 * (#9697): the read fails, saying why, and the tool keeps the state, so
 * the next read picks the scans up rather than starting over.
 */
export class BiReadKeptStateError extends Error {
  // The tool's own reader's state, as it wrote it (Power BI's).
  public readonly readState: JSONObject | null;

  public constructor(message: string, readState: JSONObject | null) {
    super(message);
    this.name = "BiReadKeptStateError";
    this.readState = readState;
  }
}

function readObject(value: unknown): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

export function readBiReadState(value: unknown): BiReadState {
  const state: JSONObject | null = readObject(value);

  return { powerBi: readObject(state?.["powerBi"]) };
}

// The state as its column keeps it: null when there is nothing to keep.
export function writeBiReadState(state: BiReadState): JSONObject | null {
  return state.powerBi ? { powerBi: state.powerBi } : null;
}
