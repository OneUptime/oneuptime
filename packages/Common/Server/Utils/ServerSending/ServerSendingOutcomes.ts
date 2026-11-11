import { ServerSendingChannel } from "../../../Types/ServerSending/ServerSendingStatus";

/*
 * HOW THE SERVER'S OWN SENDS WENT, AS THE SENDERS TELL IT.
 *
 * The email, SMS and call senders (App/FeatureSet/Notification) tell this
 * how each message sent through the server's own settings went - never one
 * sent through a project's own mail server or Twilio account, whose failures
 * are the project's to fix, and never one refused before it reached the
 * mail service, the gateway or Twilio for a reason of the project's (a low
 * balance, SMS switched off for the project).
 *
 * The Notification service registers what writes it down when it starts
 * (ServerSendingStatus.recordOutcome), as it registers the readers of the
 * logos its emails carry. Until then, and in a test that sends without it,
 * nothing is written: this file imports nothing that reaches the database,
 * so a sender can tell it everything without a test standing in for it.
 */

export interface ServerSendingOutcome {
  channel: ServerSendingChannel;
  succeeded: boolean;
  // Why it failed, in the sender's words. Ignored for a send that went out.
  reason?: string | undefined;
}

export type ServerSendingOutcomeRecorder = (
  outcome: ServerSendingOutcome,
) => Promise<void>;

export default class ServerSendingOutcomes {
  private static recorder: ServerSendingOutcomeRecorder | null = null;

  public static register(recorder: ServerSendingOutcomeRecorder | null): void {
    ServerSendingOutcomes.recorder = recorder;
  }

  public static isRegistered(): boolean {
    return ServerSendingOutcomes.recorder !== null;
  }

  /*
   * Writes down how a send went. Never throws, and never holds the send up
   * for long: a write that fails is only a thing the server did not
   * remember, never a message that was not sent.
   */
  public static async record(outcome: ServerSendingOutcome): Promise<void> {
    const recorder: ServerSendingOutcomeRecorder | null =
      ServerSendingOutcomes.recorder;

    if (!recorder) {
      return;
    }

    try {
      await recorder(outcome);
    } catch {
      // Nothing remembered this time; the next send tells it again.
    }
  }

  public static async recordSucceeded(
    channel: ServerSendingChannel,
  ): Promise<void> {
    await ServerSendingOutcomes.record({ channel: channel, succeeded: true });
  }

  public static async recordFailed(
    channel: ServerSendingChannel,
    reason: string | undefined,
  ): Promise<void> {
    await ServerSendingOutcomes.record({
      channel: channel,
      succeeded: false,
      reason: reason,
    });
  }
}
