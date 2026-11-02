import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import ObjectID from "Common/Types/ObjectID";
import {
  readSessionLengths,
  SESSION_LENGTH_SETTING_COLUMNS,
  SessionLengthSettingColumn,
  SessionLengths,
} from "Common/Types/UserSession/SessionLength";

/*
 * Where the session lengths are read from: GlobalConfig's five columns
 * (Common/Types/UserSession/SessionLength.ts), as root. A master admin
 * writes them through the generic API, as every other GlobalConfig setting
 * (Admin Dashboard > Settings > Session Length), where EditionPermissions
 * holds the write to the license and GlobalConfigService to the columns'
 * ranges; the change is then announced to every server, which forgets what
 * it read (SessionLengthProvider.forget).
 */
export const SESSION_LENGTHS_SELECT: Record<SessionLengthSettingColumn, true> =
  SESSION_LENGTH_SETTING_COLUMNS.reduce(
    (
      select: Record<SessionLengthSettingColumn, true>,
      column: SessionLengthSettingColumn,
    ): Record<SessionLengthSettingColumn, true> => {
      select[column] = true;
      return select;
    },
    {} as Record<SessionLengthSettingColumn, true>,
  );

export default class SessionLengthStore {
  /*
   * What the row applies to each kind of sign-in, each value read as
   * SessionLength reads it: a value no write could have set is the default.
   * No row yet - an installation that is still being set up - is no
   * lengths. Throws when the row cannot be read.
   */
  public static async readLengths(): Promise<SessionLengths> {
    const config: GlobalConfig | null = await GlobalConfigService.findOneById({
      id: ObjectID.getZeroObjectID(),
      select: SESSION_LENGTHS_SELECT,
      props: {
        isRoot: true,
      },
    });

    return readSessionLengths(
      config as unknown as Partial<
        Record<SessionLengthSettingColumn, unknown>
      > | null,
    );
  }
}
