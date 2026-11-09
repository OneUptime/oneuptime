import Route from "Common/Types/API/Route";
import { getIngestRefusalFixRoute } from "../../Telemetry/IngestRefusalRoutes";
import { RumSignalAction } from "./RumSignalWords";

/*
 * Where an action of a RUM empty chart or setup check row takes the reader
 * when it is a link to another page: a refusal's fix (issue #6378). null
 * for an action that is not one.
 */
export function getRumActionRoute(action: RumSignalAction): Route | null {
  switch (action.kind) {
    case "open-key":
      return getIngestRefusalFixRoute({ fix: "open-key", keyId: action.keyId });
    case "budgets":
    case "billing":
      return getIngestRefusalFixRoute({ fix: action.kind, keyId: null });
    default:
      return null;
  }
}
