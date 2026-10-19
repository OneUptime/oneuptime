import BadDataException from "../../../../Types/Exception/BadDataException";
import SecurityEventDestinationProvider from "../../../../Types/SecurityEvent/Destinations/SecurityEventDestinationProvider";
import GoogleSecOpsSender from "./GoogleSecOps/GoogleSecOpsSender";
import { SecurityEventSender } from "./Types";

/*
 * One sender per SIEM OneUptime sends to. Senders are stateless, so one
 * instance serves every destination of every project. Tests swap a sender
 * for one with a fake endpoint (setSender).
 */
const SENDERS: Map<SecurityEventDestinationProvider, SecurityEventSender> =
  new Map<SecurityEventDestinationProvider, SecurityEventSender>([
    [SecurityEventDestinationProvider.GoogleSecOps, new GoogleSecOpsSender()],
  ]);

export default class SecurityEventDestinationRegistry {
  public static getSender(
    provider: SecurityEventDestinationProvider | string | undefined,
  ): SecurityEventSender {
    const sender: SecurityEventSender | undefined = SENDERS.get(
      provider as SecurityEventDestinationProvider,
    );

    if (!sender) {
      throw new BadDataException(
        "Provider must be one of the SIEMs OneUptime can send security events to.",
      );
    }

    return sender;
  }

  public static setSender(
    provider: SecurityEventDestinationProvider,
    sender: SecurityEventSender,
  ): void {
    SENDERS.set(provider, sender);
  }
}
