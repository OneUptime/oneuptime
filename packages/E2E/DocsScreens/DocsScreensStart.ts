import fs from "fs";
import { RESULTS } from "./DocsScreenRun";

// Before the languages run: no result of an earlier run is read as this one's.
export default async function start(): Promise<void> {
  fs.rmSync(RESULTS, { recursive: true, force: true });
}
