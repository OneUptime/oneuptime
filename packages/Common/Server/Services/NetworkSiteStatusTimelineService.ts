import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/NetworkSiteStatusTimeline";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnDelete } from "../Types/Database/Hooks";
import StateTimelineRowsKept from "../Utils/Database/StateTimelineRowsKept";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BadDataException from "../../Types/Exception/BadDataException";
import { KEPT_STATUS_HISTORY_DAYS } from "../../Types/StateTimeline/RowsKeptOnDelete";

export const NETWORK_SITE_STATUS_EVENT_KEPT_MESSAGE: string = `This status event is the site's current status, or covers part of its last ${KEPT_STATUS_HISTORY_DAYS} days, so it can't be deleted: a site's status history is written by its rollups, and its uptime is worked out from it. Status events that ended more than ${KEPT_STATUS_HISTORY_DAYS} days ago can be deleted.`;

/*
 * A network site's status history: one row per change of its rolled-up
 * status, written by NetworkSiteService's rollups alone. Its uptime figures
 * and its Status Timeline page are worked out from these rows, so a delete -
 * by query or of one row by its id - only ever trims the old end: each site
 * keeps its current status, and every event that covers part of the last 90
 * days (Types/StateTimeline/RowsKeptOnDelete). Nobody corrects this history
 * by hand, so no event's neighbour is moved to close a gap: a delete that
 * would leave one is refused.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);

    this.keepRowsOnDeleteByQuery(
      StateTimelineRowsKept.forTable("NetworkSiteStatusTimeline"),
    );
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    // A delete by query: DatabaseService has already narrowed it to the events that are over.
    if (!Service.getOneRowIdNamedBy(deleteBy.query)) {
      return { deleteBy, carryForward: null };
    }

    // The one event named by its id, and the delete held to it.
    const toBeDeleted: { row: Model | null; deletesMore: boolean } =
      await this.findOneRowAndHoldDeleteToIt(deleteBy, {
        _id: true,
      });

    if (
      toBeDeleted.row?.id &&
      (await this.isRowKeptOnDeleteByQuery(toBeDeleted.row.id))
    ) {
      throw new BadDataException(NETWORK_SITE_STATUS_EVENT_KEPT_MESSAGE);
    }

    return { deleteBy, carryForward: null };
  }
}

export default new Service();
