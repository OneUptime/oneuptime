import {
  DisableTelemetryIngestion,
  ServerProductsStartingValue,
} from "../../EnvironmentConfig";
import GlobalConfigService from "../../Services/GlobalConfigService";
import logger from "../Logger";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import ObjectID from "../../../Types/ObjectID";
import ProductKey, { isProductKey } from "../../../Types/Product/ProductKey";
import {
  ServerProductOffReason,
  ServerProductsOff,
  ServerProductsPreset,
  ServerProductsSettings,
  ServerProductsStartingValue as StartingValue,
  getOffProducts,
  getPresetOf,
  getProductOffMessage,
  getServerProductsOff,
  isServerProductsPreset,
  isSwitchableProduct,
  parseServerProductsSettings,
  parseServerProductsStartingValue,
  shouldSuggestStoppingIngestion,
  toServerProductsSettingsJSON,
  withPreset,
  withProductSwitched,
} from "../../../Types/Product/ServerProducts";
import {
  ServerProductsAnswer,
  ServerProductsSource,
} from "../../../Types/Product/ServerProductsAnswer";

/*
 * THE PRODUCTS THIS SERVER SWITCHES OFF, ON THE SERVER (#6815).
 *
 * The rules are pure (Types/Product/ServerProducts); this reads what they
 * need - what an admin saved (GlobalConfig.serverProducts), the starting
 * value (SERVER_PRODUCTS) and whether ingestion is stopped
 * (DISABLE_TELEMETRY_INGESTION) - and writes what an admin decides.
 *
 * What is off is asked for on every project products answer, every write
 * through the API and every Ask AI tool, so it is kept for
 * OFF_PRODUCTS_CACHE_TTL_MS. A write drops this server's copy at once;
 * another server's runs out within the TTL.
 *
 * A read that fails keeps nothing and answers "everything on": switching a
 * product off is about what people see, never a lock, so a database hiccup
 * must not hide a whole server's products - nor refuse every write.
 */

export const OFF_PRODUCTS_CACHE_TTL_MS: number = 10_000;

interface CachedOff {
  off: ServerProductsOff;
  expiresAt: number;
}

export class ServerProductsClass {
  private cached: CachedOff | null = null;
  /*
   * Bumped by every write, so a read that was on the wire when the products
   * changed answers its own caller but never puts the old list back.
   */
  private generation: number = 0;
  private didWarnAboutStartingValue: boolean = false;

  // SERVER_PRODUCTS, as config.env or Helm set it (tests replace it).
  public getStartingValueText(): string {
    return ServerProductsStartingValue;
  }

  // DISABLE_TELEMETRY_INGESTION (tests replace it).
  public isTelemetryIngestionStopped(): boolean {
    return DisableTelemetryIngestion;
  }

  /*
   * The starting value SERVER_PRODUCTS gives. A name it does not know is
   * said once in the log, so a typo does not go unnoticed.
   */
  public getStartingValue(): StartingValue {
    const startingValue: StartingValue = parseServerProductsStartingValue(
      this.getStartingValueText(),
    );

    if (
      startingValue.unknownNames.length > 0 &&
      !this.didWarnAboutStartingValue
    ) {
      this.didWarnAboutStartingValue = true;
      logger.warn(
        `SERVER_PRODUCTS names something that is neither a preset nor a product, and it was left out: ${startingValue.unknownNames.join(", ")}. Use everything, monitoring-and-status-pages, incident-response, or product keys such as monitors,incidents,status-pages.`,
      );
    }

    return startingValue;
  }

  // What an admin saved, or null when nobody has.
  public async getSavedSettings(): Promise<ServerProductsSettings | null> {
    const config: GlobalConfig | null = await GlobalConfigService.findOneById({
      id: ObjectID.getZeroObjectID(),
      select: { serverProducts: true },
      props: { isRoot: true },
    });

    return parseServerProductsSettings(config?.serverProducts);
  }

  /*
   * What is off on this server, and why - kept for OFF_PRODUCTS_CACHE_TTL_MS.
   * Answers "everything on" when it cannot be read.
   */
  public async getOff(): Promise<ServerProductsOff> {
    const now: number = OneUptimeDate.getCurrentDate().getTime();

    if (this.cached && this.cached.expiresAt > now) {
      return this.cached.off;
    }

    const generation: number = this.generation;

    let off: ServerProductsOff;

    try {
      off = getServerProductsOff({
        settings: await this.getSavedSettings(),
        startingValue: this.getStartingValue().off,
        isTelemetryIngestionStopped: this.isTelemetryIngestionStopped(),
      });
    } catch (err) {
      logger.error(
        "Could not read the products switched off on this server; every product is treated as on:",
      );
      logger.error(err as Error);
      return {};
    }

    if (generation === this.generation) {
      this.cached = { off: off, expiresAt: now + OFF_PRODUCTS_CACHE_TTL_MS };
    }

    return off;
  }

  // Why a product is off on this server, or null when it is on.
  public async getOffReason(
    product: ProductKey,
  ): Promise<ServerProductOffReason | null> {
    const off: ServerProductsOff = await this.getOff();

    return off[product] || null;
  }

  /*
   * Refuses what cannot be done because a product is off, with what
   * happened and what to do next (getProductOffMessage): the API's writes,
   * Ask AI's tools.
   */
  public async assertProductIsOn(product: ProductKey): Promise<void> {
    const reason: ServerProductOffReason | null =
      await this.getOffReason(product);

    if (reason) {
      throw new ForbiddenException(
        getProductOffMessage({ product: product, reason: reason }),
      );
    }
  }

  // Of the products given, the first one that is off, with its reason.
  public async getFirstOff(
    products: ReadonlyArray<ProductKey>,
  ): Promise<{ product: ProductKey; reason: ServerProductOffReason } | null> {
    if (products.length === 0) {
      return null;
    }

    const off: ServerProductsOff = await this.getOff();

    for (const product of products) {
      const reason: ServerProductOffReason | undefined = off[product];

      if (reason) {
        return { product: product, reason: reason };
      }
    }

    return null;
  }

  // What Admin Dashboard > Settings > Products draws, read fresh.
  public async getAnswer(): Promise<ServerProductsAnswer> {
    const settings: ServerProductsSettings | null =
      await this.getSavedSettings();
    const startingValue: StartingValue = this.getStartingValue();
    const isStopped: boolean = this.isTelemetryIngestionStopped();
    const switchedOff: Array<ProductKey> = settings
      ? settings.off
      : startingValue.off;

    const off: ServerProductsOff = getServerProductsOff({
      settings: settings,
      startingValue: startingValue.off,
      isTelemetryIngestionStopped: isStopped,
    });

    return {
      off: off,
      switchedOff: [...switchedOff],
      preset: getPresetOf(switchedOff),
      source: settings
        ? ServerProductsSource.Saved
        : ServerProductsSource.StartingValue,
      startingValue: this.getStartingValueText().trim(),
      startingValueUnknownNames: [...startingValue.unknownNames],
      isTelemetryIngestionStopped: isStopped,
      shouldSuggestStoppingIngestion: shouldSuggestStoppingIngestion({
        off: off,
        isTelemetryIngestionStopped: isStopped,
      }),
      changedAt: settings ? settings.changedAt : null,
    };
  }

  /*
   * One click on the page: the products a preset keeps on, every other one
   * off. A master admin only; the route checks, and this refuses anything
   * that is not a preset.
   */
  public async applyPreset(data: {
    preset: unknown;
    byUserId: ObjectID | null;
  }): Promise<void> {
    if (!isServerProductsPreset(data.preset)) {
      throw new BadDataException(
        "Choose a preset: monitoring-and-status-pages, incident-response or everything.",
      );
    }

    const preset: ServerProductsPreset = data.preset;

    await this.save(
      withPreset({
        preset: preset,
        userId: data.byUserId ? data.byUserId.toString() : null,
        now: OneUptimeDate.getCurrentDate(),
      }),
    );
  }

  /*
   * One switch on the page, from what the switches say now - saved, or the
   * starting value, which saving makes the admin's own.
   */
  public async switchProduct(data: {
    product: unknown;
    isOn: unknown;
    byUserId: ObjectID | null;
  }): Promise<void> {
    if (!isProductKey(data.product)) {
      throw new BadDataException(
        "Choose one of the products, by its key, such as logs or status-pages.",
      );
    }

    if (typeof data.isOn !== "boolean") {
      throw new BadDataException(
        "Say whether to switch the product on: isOn must be true or false.",
      );
    }

    if (!isSwitchableProduct(data.product)) {
      throw new BadDataException(
        "Users, Teams and Project Settings are always on: every project needs them to run itself.",
      );
    }

    const settings: ServerProductsSettings | null =
      await this.getSavedSettings();

    await this.save(
      withProductSwitched({
        currentOff: settings ? settings.off : this.getStartingValue().off,
        product: data.product,
        isOn: data.isOn,
        userId: data.byUserId ? data.byUserId.toString() : null,
        now: OneUptimeDate.getCurrentDate(),
      }),
    );
  }

  // Drops this server's copy, so the next question reads the list again.
  public forget(): void {
    this.generation++;
    this.cached = null;
  }

  // The products off, in the menu's order (for logs and the doctor).
  public async getOffProducts(): Promise<Array<ProductKey>> {
    return getOffProducts(await this.getOff());
  }

  private async save(settings: ServerProductsSettings): Promise<void> {
    await GlobalConfigService.writeServerProducts(
      toServerProductsSettingsJSON(settings),
    );

    this.forget();
  }
}

export default new ServerProductsClass();
