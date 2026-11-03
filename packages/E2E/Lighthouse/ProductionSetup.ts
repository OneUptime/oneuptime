import { ProductionReportsFolder } from "./Production";
import fs from "fs";

// A run's reports and measures are its own: none from an earlier run stay.
export default async function globalSetup(): Promise<void> {
  fs.rmSync(ProductionReportsFolder, { recursive: true, force: true });
  fs.mkdirSync(ProductionReportsFolder, { recursive: true });
}
