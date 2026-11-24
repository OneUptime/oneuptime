import GlobalConfigService from "../../Services/GlobalConfigService";
import logger from "../Logger";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  DEFAULT_INVITE_MESSAGE,
  DEFAULT_NO_PROJECT_MESSAGE,
  HelpAndSupportSettings,
  HelpItemChange,
  getDefaultHelpAndSupportSettings,
  getInviteMessage,
  readHelpAndSupportSettings,
  toHelpAndSupportJSON,
  withHelpItemChanged,
} from "../../../Types/HelpAndSupport/HelpAndSupport";

/*
 * WHERE THIS SERVER SENDS ITS PEOPLE FOR HELP, ON THE SERVER (#10864-#10866).
 *
 * The rules are pure (Types/HelpAndSupport/HelpAndSupport); this reads what
 * an admin saved (GlobalConfig.helpAndSupport) and writes what an admin
 * changes on Admin Dashboard > Settings > Help and Support.
 *
 * Every page's env.js, every single sign-on screen that needs an invitation
 * and every Give feedback asks, so what is saved is kept for
 * HELP_AND_SUPPORT_CACHE_TTL_MS. A write here takes effect on this server at
 * once; another server's copy runs out within the TTL.
 *
 * A read that fails keeps the settings read before, so a database hiccup
 * never puts a server's own links back to OneUptime's for a moment. Only a
 * server that has not read them once answers every default until it can.
 */

export const HELP_AND_SUPPORT_CACHE_TTL_MS: number = 30_000;

interface CachedSettings {
  settings: HelpAndSupportSettings;
  readAt: number;
}

export class HelpAndSupportServerSettingsClass {
  private cached: CachedSettings | null = null;
  private lastRead: HelpAndSupportSettings | null = null;
  /*
   * Bumped by every write, so a read that was on the wire when the settings
   * changed answers its own caller but never puts the old ones back.
   */
  private generation: number = 0;

  // The time, in milliseconds (tests replace it).
  public now(): number {
    return Date.now();
  }

  // What an admin saved, as it is stored (tests replace it).
  public async readStored(): Promise<unknown> {
    const config: GlobalConfig | null = await GlobalConfigService.findOneById({
      id: ObjectID.getZeroObjectID(),
      select: { helpAndSupport: true },
      props: { isRoot: true },
    });

    return config?.helpAndSupport || null;
  }

  // Stores what an admin saved (tests replace it).
  public async writeStored(settings: JSONObject): Promise<void> {
    await GlobalConfigService.writeHelpAndSupport(settings);
  }

  /*
   * The settings, kept for HELP_AND_SUPPORT_CACHE_TTL_MS. On a failed read,
   * the ones read before, or every default when none were.
   */
  public async getSettings(): Promise<HelpAndSupportSettings> {
    const now: number = this.now();

    if (this.cached && now - this.cached.readAt < HELP_AND_SUPPORT_CACHE_TTL_MS) {
      return this.cached.settings;
    }

    const generation: number = this.generation;

    try {
      const settings: HelpAndSupportSettings = readHelpAndSupportSettings(
        await this.readStored(),
      );

      if (generation === this.generation) {
        this.cached = { settings: settings, readAt: now };
        this.lastRead = settings;
      }

      return settings;
    } catch (err) {
      logger.warn(
        `Could not read where this server sends people for help; ${
          this.lastRead
            ? "keeping the settings read before"
            : "showing OneUptime's own until they can be read"
        }.`,
      );
      logger.warn(err);

      return this.lastRead || getDefaultHelpAndSupportSettings();
    }
  }

  /*
   * Changes one item, read fresh first so a change another admin made since
   * is kept, and answers the settings as they now stand. The change was
   * checked by readHelpItemChange; it is checked again on the way in, as
   * everything stored is (readHelpAndSupportSettings).
   */
  public async save(change: HelpItemChange): Promise<HelpAndSupportSettings> {
    const current: HelpAndSupportSettings = readHelpAndSupportSettings(
      await this.readStored(),
    );

    const next: HelpAndSupportSettings = readHelpAndSupportSettings(
      toHelpAndSupportJSON(withHelpItemChanged(current, change)),
    );

    await this.writeStored(toHelpAndSupportJSON(next));

    this.generation++;
    this.cached = { settings: next, readAt: this.now() };
    this.lastRead = next;

    return next;
  }

  // Forgets this server's copy (after a write elsewhere in tests).
  public forget(): void {
    this.generation++;
    this.cached = null;
  }

  /*
   * What the single sign-on screen says to someone who needs an invitation
   * to sign in: the server's own words, or the screen's default.
   */
  public async getInviteMessage(): Promise<string> {
    return getInviteMessage(await this.getSettings(), DEFAULT_INVITE_MESSAGE);
  }

  /*
   * The same, for someone whose account is a member of no project: the
   * server's own words, or that screen's default.
   */
  public async getNoProjectMessage(): Promise<string> {
    return getInviteMessage(
      await this.getSettings(),
      DEFAULT_NO_PROJECT_MESSAGE,
    );
  }
}

export default new HelpAndSupportServerSettingsClass();
