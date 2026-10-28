import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/DashboardPlaylist";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BadDataException from "../../Types/Exception/BadDataException";
import {
  getDashboardPlaylistDashboardsProblem,
  getDashboardPlaylistIntervalProblem,
  toStoredDashboardPlaylistDashboards,
} from "../../Types/Dashboard/DashboardPlaylist";

/*
 * Dashboard playlists (issue #5235): a write is checked for what the player
 * reads - its dashboards a list of {"dashboardId": "<id>"} in the order
 * they are shown, and how long each is shown a whole number of seconds
 * from 10 to a day - so a playlist that saves is one the player can play.
 *
 * Which dashboards those ids are is not checked here, on purpose. The
 * player reads them as its viewer, and shows only the dashboards that
 * viewer may read and that are not archived, so a deleted dashboard, or one
 * a viewer may not see, is skipped rather than shown. A playlist that names
 * one is never refused for it: an editor saving a playlist keeps the
 * dashboards in it they cannot see themselves.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The write's playlist settings checked, and its dashboards stored as the
   * list they spell (JSON text as its list). Throws on the first problem.
   * Columns the write leaves out are not looked at.
   */
  public static checkWrite(data: Record<string, unknown>): void {
    if (data["dashboards"] !== undefined) {
      const problem: string | null = getDashboardPlaylistDashboardsProblem(
        data["dashboards"],
      );

      if (problem) {
        throw new BadDataException(problem);
      }

      data["dashboards"] = toStoredDashboardPlaylistDashboards(
        data["dashboards"],
      );
    }

    const intervalProblem: string | null = getDashboardPlaylistIntervalProblem(
      data["intervalInSeconds"],
    );

    if (intervalProblem) {
      throw new BadDataException(intervalProblem);
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    Service.checkWrite(createBy.data as unknown as Record<string, unknown>);

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    Service.checkWrite(
      (updateBy.data || {}) as unknown as Record<string, unknown>,
    );

    return { updateBy, carryForward: null };
  }
}

export default new Service();
