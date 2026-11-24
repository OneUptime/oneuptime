import { Alert } from "react-native";
import { copyToClipboard } from "./clipboard";
import { getErrorReference, getFriendlyErrorMessage } from "./error";

/*
 * A failed action said in an alert, as the app says every failure
 * (getFriendlyErrorMessage) - and, when the server failed in a way nobody
 * explained, with a button that copies its reference (#7275): the person
 * gives it to whoever runs their OneUptime server, or to OneUptime
 * support, who find the failure in the server's logs by it.
 */
export const COPY_REFERENCE_LABEL: string = "Copy reference";

export function alertError(title: string, error: unknown): void {
  const message: string = getFriendlyErrorMessage(error);
  const reference: string | null = getErrorReference(error);

  if (!reference) {
    Alert.alert(title, message);
    return;
  }

  Alert.alert(title, message, [
    {
      text: COPY_REFERENCE_LABEL,
      onPress: (): void => {
        copyToClipboard(reference);
      },
    },
    { text: "OK", style: "cancel" },
  ]);
}
