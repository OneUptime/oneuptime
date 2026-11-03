import { clearReports } from "./BaselineFile";

// A run's reports and scores are its own: none from an earlier run stay.
export default async function globalSetup(): Promise<void> {
  clearReports();
}
