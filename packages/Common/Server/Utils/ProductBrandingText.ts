import EnterpriseEdition from "../Enterprise/EnterpriseEdition";
import ProductBrandingUtil, {
  ProductBranding,
} from "../../Types/Branding/ProductBranding";
import { CallRequestMessage, GatherInput, Say } from "../../Types/Call/CallRequest";
import PushNotificationMessage from "../../Types/PushNotification/PushNotificationMessage";

/*
 * The installation's own name in the messages OneUptime sends on the paging
 * channels - SMS, voice calls and push notifications - when it goes by one
 * (EnterpriseEdition.getProductBranding). "This is a message from OneUptime"
 * reads "This is a message from <name>".
 *
 * These messages are built as whole sentences with the values already in
 * them, so the name is replaced as a word across the whole text
 * (ProductBrandingUtil.replaceProductName): a value that says OneUptime as a
 * word reads the installation's name too, as it does in the frontends.
 *
 * While the installation shows OneUptime's own branding, every function here
 * returns exactly what it was given.
 */
export default class ProductBrandingText {
  // "OneUptime", or the name the installation goes by.
  public static getProductName(
    branding: ProductBranding | null = EnterpriseEdition.getProductBranding(),
  ): string {
    return ProductBrandingUtil.getProductName(branding);
  }

  // The name to put in place of OneUptime, or null to leave text alone.
  private static getReplacementName(
    branding: ProductBranding | null,
  ): string | null {
    return ProductBrandingUtil.isRenamed(branding)
      ? ProductBrandingUtil.getProductName(branding)
      : null;
  }

  public static brandText(
    text: string,
    branding: ProductBranding | null = EnterpriseEdition.getProductBranding(),
  ): string {
    const name: string | null = ProductBrandingText.getReplacementName(branding);

    if (!name || typeof text !== "string") {
      return text;
    }

    return ProductBrandingUtil.replaceProductName(text, name);
  }

  // Every sentence a call says: the plain ones, and a gather's prompts and answers.
  public static brandCallRequest<T extends CallRequestMessage>(
    callRequest: T,
    branding: ProductBranding | null = EnterpriseEdition.getProductBranding(),
  ): T {
    if (!ProductBrandingText.getReplacementName(branding)) {
      return callRequest;
    }

    const brand: (text: string) => string = (text: string): string => {
      return ProductBrandingText.brandText(text, branding);
    };

    const brandSay: (say: Say) => Say = (say: Say): Say => {
      return { ...say, sayMessage: brand(say.sayMessage) };
    };

    return {
      ...callRequest,
      data: callRequest.data.map((item: CallRequestMessage["data"][number]) => {
        if (!item || typeof item !== "object") {
          return item;
        }

        if ("sayMessage" in item) {
          return brandSay(item as Say);
        }

        if ("introMessage" in item) {
          const gather: GatherInput = item as GatherInput;
          const onInput: GatherInput["onInputCallRequest"] = {
            ...gather.onInputCallRequest,
          };

          for (const key of Object.keys(onInput)) {
            const say: Say | undefined = onInput[key];

            if (say && typeof say.sayMessage === "string") {
              onInput[key] = brandSay(say);
            }
          }

          return {
            ...gather,
            introMessage: brand(gather.introMessage),
            noInputMessage: brand(gather.noInputMessage),
            onInputCallRequest: onInput,
          };
        }

        return item;
      }),
    };
  }

  /*
   * A push notification's title and body, and its icon: OneUptime's default
   * icon becomes the installation's browser tab icon when it has one.
   */
  public static brandPushMessage(
    message: PushNotificationMessage,
    defaultIcons: ReadonlyArray<string>,
    branding: ProductBranding | null = EnterpriseEdition.getProductBranding(),
  ): PushNotificationMessage {
    if (!branding) {
      return message;
    }

    const branded: PushNotificationMessage = {
      ...message,
      title: ProductBrandingText.brandText(message.title, branding),
      body: ProductBrandingText.brandText(message.body, branding),
    };

    if (
      branding.faviconUrl &&
      (!message.icon || defaultIcons.includes(message.icon))
    ) {
      branded.icon = branding.faviconUrl;
    }

    return branded;
  }
}
