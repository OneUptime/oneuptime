import { getAffectedResourceLabel } from "Common/Types/StatusPage/StatusPageAffectedResources";

/*
 * A resource's name on the page. Kept in Common, so the page's maintenance
 * calendar, which the server renders, names resources exactly as the page
 * does (StatusPageAffectedResources).
 */
export default getAffectedResourceLabel;
