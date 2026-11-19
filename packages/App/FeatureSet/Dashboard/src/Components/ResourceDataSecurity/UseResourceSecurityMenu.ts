import {
  getResourceComplianceRoute,
  getResourceDataSecurityRoute,
} from "./ResourceDataSecurityPages";
import useResourceDataScope, {
  ResourceDataScopeState,
} from "./UseResourceDataScope";
import useIsProductShownInResources from "../../Utils/ProjectProducts/ProductsInResources";
import Route from "Common/Types/API/Route";
import { DataStoreResourceKind } from "Common/Types/DataSecurity/DataStoreResource";
import ObjectID from "Common/Types/ObjectID";
import ProductKey from "Common/Types/Product/ProductKey";

/*
 * SECURITY EVENTS AND DATA SECURITY IN A RESOURCE'S MENU (#9547, #9555).
 *
 * Security Events is an entry beside the resource's Logs, where the
 * security events about it open in the explorer (ResourceSecurityEventsPage)
 * - the way a network device's menu has always had it. Data Security is a
 * Security section with the resource's Data Security and Compliance pages,
 * for a resource that holds data stores (Types/DataSecurity/DataStoreResource).
 *
 * Each is drawn only while its product is on, shown in the project, in use
 * and readable by the person (ProductsInResources), and the Security section
 * only for a resource with a store: a menu never grows by an entry that
 * would always open an empty page. Both entries of the section come
 * together, so it never repeats its only entry's name.
 *
 * Hooks, not components: the menu writes the entries itself, so the shared
 * SideMenu reads them as it reads every other entry - which section holds
 * the page, what the phone's button names, which fold opens by itself.
 */

// Whether the resource's menu offers its Security Events page.
export function useResourceSecurityEventsMenu(): boolean {
  return useIsProductShownInResources(ProductKey.SecurityEvents);
}

export interface ResourceDataSecurityMenu {
  dataSecurityRoute: Route;
  complianceRoute: Route;
}

/*
 * The resource's Security section's two pages, or null while the section
 * is not drawn: Data Security not shown in its pages, or a resource with
 * no data store.
 */
export function useResourceDataSecurityMenu(data: {
  kind: DataStoreResourceKind;
  modelId: ObjectID;
}): ResourceDataSecurityMenu | null {
  const isShown: boolean = useIsProductShownInResources(
    ProductKey.DataSecurity,
  );
  const { scope }: ResourceDataScopeState = useResourceDataScope({
    kind: data.kind,
    modelId: data.modelId,
    isEnabled: isShown,
  });
  const dataSecurityRoute: Route | null = getResourceDataSecurityRoute(
    data.kind,
    data.modelId,
  );
  const complianceRoute: Route | null = getResourceComplianceRoute(
    data.kind,
    data.modelId,
  );

  if (
    !isShown ||
    !scope ||
    scope.dataStoreIds.length === 0 ||
    !dataSecurityRoute ||
    !complianceRoute
  ) {
    return null;
  }

  return { dataSecurityRoute, complianceRoute };
}
