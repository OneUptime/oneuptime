import logger from "Common/Server/Utils/Logger";
import { ProductBranding } from "Common/Types/Branding/ProductBranding";
import { isWhiteLabelAllowed } from "./WhiteLabelEntitlement";
import { WhiteLabelImage, WhiteLabelImageKind } from "./WhiteLabelImages";
import {
  getWhiteLabelImage,
  toProductBranding,
  WhiteLabelSettings,
} from "./WhiteLabelSettings";
import WhiteLabelStore from "./WhiteLabelStore";

/*
 * The white-label settings this process holds, and the branding core is told
 * about (EnterpriseServerModule.getProductBranding).
 *
 * Core asks synchronously, while env.js, an index page or an email is
 * rendered, so the settings are cached: read at boot, re-read in the
 * background once they are older than WHITE_LABEL_SETTINGS_CACHE_TTL_IN_MS,
 * and re-read at once by a write in this process. Another replica sees a
 * change within the TTL. A failed read keeps the last settings read and is
 * retried after WHITE_LABEL_SETTINGS_RETRY_AFTER_FAILURE_IN_MS, so a database
 * blip never flips an installation's branding.
 *
 * The license decides first, on every ask: while it does not allow
 * white-labelling (WhiteLabelEntitlement), there is no branding at all - the
 * stored settings are kept, and not shown.
 */

export const WHITE_LABEL_SETTINGS_CACHE_TTL_IN_MS: number = 30 * 1000;

export const WHITE_LABEL_SETTINGS_RETRY_AFTER_FAILURE_IN_MS: number = 5 * 1000;

export interface WhiteLabelProviderDependencies {
  loadSettings: () => Promise<WhiteLabelSettings>;
  isAllowed: () => boolean;
  now: () => Date;
  cacheTtlInMs: number;
  retryAfterFailureInMs: number;
}

export const getDefaultWhiteLabelProviderDependencies: () => WhiteLabelProviderDependencies =
  (): WhiteLabelProviderDependencies => {
    return {
      loadSettings: (): Promise<WhiteLabelSettings> => {
        return WhiteLabelStore.readSettings();
      },
      isAllowed: isWhiteLabelAllowed,
      now: (): Date => {
        return new Date();
      },
      cacheTtlInMs: WHITE_LABEL_SETTINGS_CACHE_TTL_IN_MS,
      retryAfterFailureInMs: WHITE_LABEL_SETTINGS_RETRY_AFTER_FAILURE_IN_MS,
    };
  };

export class WhiteLabelProvider {
  private readonly dependencies: WhiteLabelProviderDependencies;

  private settings: WhiteLabelSettings | null = null;
  private loadedAtInMs: number = 0;
  private lastFailedAtInMs: number | null = null;
  private inFlightLoad: Promise<WhiteLabelSettings | null> | null = null;
  // Bumped by every refresh(), so an older load never overwrites a newer one.
  private loadSequence: number = 0;
  private appliedLoadSequence: number = 0;

  public constructor(dependencies?: Partial<WhiteLabelProviderDependencies>) {
    this.dependencies = {
      ...getDefaultWhiteLabelProviderDependencies(),
      ...(dependencies || {}),
    };
  }

  public isAllowed(): boolean {
    try {
      return this.dependencies.isAllowed();
    } catch {
      return false;
    }
  }

  /*
   * The branding core shows: null while the license does not allow
   * white-labelling; otherwise what is set, which is `{}` (OneUptime's own
   * everywhere) until something is, or until the first read lands.
   */
  public getProductBranding(): ProductBranding | null {
    if (!this.isAllowed()) {
      return null;
    }

    const settings: WhiteLabelSettings | null = this.getCachedSettings();

    return settings ? toProductBranding(settings) : {};
  }

  // The settings held right now (reading them again in the background when stale).
  public getCachedSettings(): WhiteLabelSettings | null {
    if (!this.isFresh() && !this.isInFailureBackoff() && !this.inFlightLoad) {
      void this.startLoad();
    }

    return this.settings;
  }

  // The settings, read again first when they are stale. Null only when never read.
  public async getSettings(): Promise<WhiteLabelSettings | null> {
    if (this.isFresh()) {
      return this.settings;
    }

    if (this.settings && this.isInFailureBackoff()) {
      return this.settings;
    }

    const loaded: WhiteLabelSettings | null = await (this.inFlightLoad ||
      this.startLoad());

    return loaded || this.settings;
  }

  public async getImage(
    kind: WhiteLabelImageKind,
  ): Promise<WhiteLabelImage | null> {
    const settings: WhiteLabelSettings | null = await this.getSettings();

    return settings ? getWhiteLabelImage(settings, kind) : null;
  }

  // Reads the settings again now (after a write). Never throws.
  public async refresh(): Promise<WhiteLabelSettings | null> {
    return await this.startLoad();
  }

  private nowInMs(): number {
    return this.dependencies.now().getTime();
  }

  private isFresh(): boolean {
    return (
      this.settings !== null &&
      this.nowInMs() - this.loadedAtInMs < this.dependencies.cacheTtlInMs
    );
  }

  private isInFailureBackoff(): boolean {
    return (
      this.lastFailedAtInMs !== null &&
      this.nowInMs() - this.lastFailedAtInMs <
        this.dependencies.retryAfterFailureInMs
    );
  }

  private startLoad(): Promise<WhiteLabelSettings | null> {
    this.loadSequence++;
    const sequence: number = this.loadSequence;

    const load: Promise<WhiteLabelSettings | null> = Promise.resolve()
      .then((): Promise<WhiteLabelSettings> => {
        return this.dependencies.loadSettings();
      })
      .then(
        (settings: WhiteLabelSettings): WhiteLabelSettings => {
          if (sequence > this.appliedLoadSequence) {
            this.settings = settings;
            this.appliedLoadSequence = sequence;
            this.loadedAtInMs = this.nowInMs();
          }

          this.lastFailedAtInMs = null;

          return settings;
        },
        (err: unknown): null => {
          this.lastFailedAtInMs = this.nowInMs();

          logger.warn(
            `OneUptime Enterprise Edition: could not read the branding settings; ${
              this.settings ? "keeping the settings read earlier" : "showing OneUptime's own until they can be read"
            }. ${err instanceof Error ? err.message : String(err)}`,
          );

          return null;
        },
      )
      .finally((): void => {
        if (this.inFlightLoad === load) {
          this.inFlightLoad = null;
        }
      });

    this.inFlightLoad = load;

    return load;
  }
}

/*
 * The one provider of this process: the module hands its branding to core,
 * and the routes read and refresh it.
 */
const whiteLabelProvider: WhiteLabelProvider = new WhiteLabelProvider();

export default whiteLabelProvider;
