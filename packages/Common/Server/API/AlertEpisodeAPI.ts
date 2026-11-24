import AlertEpisode from "../../Models/DatabaseModels/AlertEpisode";
import { OwnerRulePreviewEvent } from "../../Types/Rules/OwnerRulePreview";
import AlertEpisodeService, {
  Service as AlertEpisodeServiceType,
} from "../Services/AlertEpisodeService";
import BaseAPI from "./BaseAPI";
import OwnerRulePreviewRoute from "./OwnerRulePreviewRoute";
import RecordAccessRoute from "./RecordAccessRoute";
import { RecordAccessKind } from "../../Types/RecordAccess/RecordAccess";

/*
 * An alert episode's CRUD API, and which owner rules would run for one being
 * created (POST /alert-episode/owner-rule-preview, Types/Rules/
 * OwnerRulePreview) - as an incident episode's API has.
 */
export default class AlertEpisodeAPI extends BaseAPI<
  AlertEpisode,
  AlertEpisodeServiceType
> {
  public constructor() {
    super(AlertEpisode, AlertEpisodeService);

    OwnerRulePreviewRoute.register({
      router: this.router,
      apiPath: new this.entityType().getCrudApiPath()?.toString() || "",
      event: OwnerRulePreviewEvent.AlertEpisode,
    });

    /*
     * What the reader may do on this record and its parts, each operation
     * allowed or refused with why, by the checks a write runs
     * (Types/RecordAccess/RecordAccess): what every lock on its page reads.
     */
    RecordAccessRoute.register({
      router: this.router,
      apiPath: new this.entityType().getCrudApiPath()?.toString() || "",
      kind: RecordAccessKind.AlertEpisode,
    });
  }
}
