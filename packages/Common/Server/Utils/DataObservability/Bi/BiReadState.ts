import { JSONObject } from "../../../../Types/JSON";
import {
  DataverseEntitySetState,
  readDataverseEntitySetState,
} from "./DataverseEntitySets";

/*
 * WHAT A BI TOOL'S READ KEEPS SO THE NEXT ONE READS LESS
 * (DataBiConnection.readState).
 *
 *  - powerBi: Power BI's workspaces as last scanned, and its dataflows'
 *    definitions (PowerBiReadState): kept by the tool's own reader, which
 *    reads it back.
 *  - dataverseEntitySets: each Dataverse environment's entity set names,
 *    for the tables Power BI's OData connectors name by them
 *    (DataverseEntitySets).
 *
 * Kept as JSON and read back here, taking anything and keeping what fits:
 * a state that cannot be read is no state, and the next read reads whole.
 */

export interface BiReadState {
  // The tool's own reader's, as it wrote it (Power BI's); null when there is none.
  powerBi: JSONObject | null;
  dataverseEntitySets: DataverseEntitySetState;
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

  return {
    powerBi: readObject(state?.["powerBi"]),
    dataverseEntitySets: readDataverseEntitySetState(
      state?.["dataverseEntitySets"],
    ),
  };
}

// The state as its column keeps it: null when there is nothing to keep.
export function writeBiReadState(state: BiReadState): JSONObject | null {
  const written: JSONObject = {};

  if (state.powerBi) {
    written["powerBi"] = state.powerBi;
  }

  if (Object.keys(state.dataverseEntitySets).length > 0) {
    written["dataverseEntitySets"] =
      state.dataverseEntitySets as unknown as JSONObject;
  }

  return Object.keys(written).length > 0 ? written : null;
}
