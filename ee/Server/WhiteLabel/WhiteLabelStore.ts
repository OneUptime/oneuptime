import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import PartialEntity from "Common/Types/Database/PartialEntity";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import {
  readWhiteLabelSettings,
  WHITE_LABEL_SETTINGS_SELECT,
  WhiteLabelSettings,
} from "./WhiteLabelSettings";

/*
 * Every read and write of the white-label settings: GlobalConfig's branding
 * columns, as root. GlobalConfigService refuses those columns to anyone else
 * (ROOT_ONLY_BRANDING_COLUMNS), so these are the only reads and writes there
 * are. Writes skip the hooks, as the license client's do: the value was
 * checked here and nothing else listens for it.
 */
export default class WhiteLabelStore {
  public static async readSettings(): Promise<WhiteLabelSettings> {
    const config: GlobalConfig | null = await GlobalConfigService.findOneById({
      id: ObjectID.getZeroObjectID(),
      select: WHITE_LABEL_SETTINGS_SELECT,
      props: {
        isRoot: true,
      },
    });

    return readWhiteLabelSettings(config);
  }

  public static async writeSettings(
    update: PartialEntity<GlobalConfig>,
  ): Promise<void> {
    const updatedRows: number = await GlobalConfigService.updateOneById({
      id: ObjectID.getZeroObjectID(),
      data: update,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    /*
     * The row is seeded when the installation is first set up
     * (AddDefaultGlobalConfig), so this only happens on an installation that
     * is still starting.
     */
    if (updatedRows === 0) {
      throw new BadDataException(
        "The settings could not be saved because this installation is still being set up. Try again in a minute.",
      );
    }
  }
}
