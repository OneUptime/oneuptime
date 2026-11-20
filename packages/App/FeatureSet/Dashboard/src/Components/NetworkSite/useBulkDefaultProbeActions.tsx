import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import Probe from "Common/Models/DatabaseModels/Probe";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import useBulkRelationActions, {
  BulkRelationActionsResult,
} from "../BulkRelation/useBulkRelationActions";
import { gateSiteBulkAction } from "./BulkSiteActionGate";
import {
  ALREADY_USES_PROBE_REASON,
  CLEAR_DEFAULT_PROBE_ACTION_TITLE,
  CLEAR_DEFAULT_PROBE_CONFIRM_MESSAGE,
  CLEAR_DEFAULT_PROBE_CONFIRM_TITLE,
  DEFAULT_PROBE_FIELD_PLACEHOLDER,
  DEFAULT_PROBE_FIELD_TITLE,
  NO_DEFAULT_PROBE_REASON,
  SET_DEFAULT_PROBE_ACTION_TITLE,
  SET_DEFAULT_PROBE_DESCRIPTION,
} from "./BulkSiteActionWords";

/*
 * "Set Default Probe" / "Clear Default Probe" on Network -> Sites
 * (#10188): the probe that polls the devices added to a site, or to a site
 * below it, without one of their own - usually a custom probe deployed in
 * that network. It is a choice about devices still to come: a device takes
 * its site's default when it is added or moved there, and nothing re-reads
 * it, so the devices already in a site keep polling as they do
 * (NetworkSiteService.resolveDefaultProbeIdForSite).
 */
function useBulkDefaultProbeActions(): BulkRelationActionsResult<NetworkSite> {
  return useBulkRelationActions<NetworkSite>({
    modelType: NetworkSite,
    column: "probeId",
    set: {
      title: SET_DEFAULT_PROBE_ACTION_TITLE,
      icon: IconProp.Signal,
      description: SET_DEFAULT_PROBE_DESCRIPTION,
      submitButtonText: SET_DEFAULT_PROBE_ACTION_TITLE,
      field: {
        title: DEFAULT_PROBE_FIELD_TITLE,
        placeholder: DEFAULT_PROBE_FIELD_PLACEHOLDER,
        dropdownModal: {
          type: Probe,
          labelField: "name",
          valueField: "_id",
          sort: { name: SortOrder.Ascending },
        },
      },
    },
    clear: {
      title: CLEAR_DEFAULT_PROBE_ACTION_TITLE,
      icon: IconProp.Close,
      confirmTitle: CLEAR_DEFAULT_PROBE_CONFIRM_TITLE,
      confirmMessage: CLEAR_DEFAULT_PROBE_CONFIRM_MESSAGE,
    },
    readRelationId: (site: NetworkSite): string | null => {
      return (site.probeId || site.probe?._id)?.toString() || null;
    },
    alreadySetReason: ALREADY_USES_PROBE_REASON,
    notSetReason: NO_DEFAULT_PROBE_REASON,
    gate: gateSiteBulkAction,
  });
}

export default useBulkDefaultProbeActions;
