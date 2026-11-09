import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { IngestRefusalFix } from "./IngestRefusalWords";

/*
 * Where a refusal's fix takes the reader (issue #6378): the refused key's
 * own page, the project's budgets (Settings > Usage, where the explorers'
 * budget banner sends them too) or Billing. null for a fix that is not a
 * page ("pick-key" opens a dialog), or the key's page without its id.
 */
export function getIngestRefusalFixRoute(data: {
  fix: IngestRefusalFix;
  keyId: string | null;
}): Route | null {
  switch (data.fix) {
    case "open-key":
      return data.keyId
        ? RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_TELEMETRY_INGESTION_KEY_VIEW] as Route,
            { modelId: new ObjectID(data.keyId) },
          )
        : null;
    case "budgets":
      return RouteUtil.populateRouteParams(
        RouteMap[PageMap.SETTINGS_USAGE_HISTORY] as Route,
      );
    case "billing":
      return RouteUtil.populateRouteParams(
        RouteMap[PageMap.SETTINGS_BILLING] as Route,
      );
    default:
      return null;
  }
}
