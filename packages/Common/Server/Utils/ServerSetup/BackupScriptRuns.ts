import GlobalConfigService from "../../Services/GlobalConfigService";
import CaptureSpan from "../Telemetry/CaptureSpan";
import {
  BackupScriptCheckIn,
  BackupScriptRun,
  toBackupScriptRun,
} from "../../../Types/Backup/BackupScriptRun";
import { JSONObject } from "../../../Types/JSON";

/*
 * WHAT `npm run backup` TOLD THE SERVER (#7026), KEPT WHERE THE SETUP
 * CHECKLIST READS IT.
 *
 * The route the script calls (POST /api/admin/health/backup-run, behind the
 * cluster key) hands this how the run went; the server keeps it with its
 * own time, the run's end, replacing the run before. The checklist's Backups
 * check reads it (ServerSetupChecklist.readFacts): "Backed up with npm run
 * backup", failing, or out of date a week on.
 */
export default class BackupScriptRuns {
  @CaptureSpan()
  public static async record(data: {
    checkIn: BackupScriptCheckIn;
    now?: Date | undefined;
  }): Promise<BackupScriptRun> {
    const run: BackupScriptRun = toBackupScriptRun({
      checkIn: data.checkIn,
      now: data.now || new Date(),
    });

    await GlobalConfigService.writeBackupScriptLastRun(
      run as unknown as JSONObject,
    );

    return run;
  }
}
