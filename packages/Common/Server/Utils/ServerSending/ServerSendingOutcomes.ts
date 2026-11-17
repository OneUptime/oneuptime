import {
  ServerSendingChannel,
  ServerSendingFailureScope,
} from "../../../Types/ServerSending/ServerSendingStatus";

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
  /*
   * Whose problem a failure is (#9217): left out, the server's, as every
   * failure of SMS and calls is. One recipient's is kept with that
   * recipient, and never says the server's sends fail.
   */
  scope?: ServerSendingFailureScope | undefined;
  /*
   * Who it was sent to: the recipient a refusal is kept with, and the one a
   * send that went out takes off the refusals.
   */
  recipient?: string | undefined;
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
    recipient?: string | undefined,
  ): Promise<void> {
    const outcome: ServerSendingOutcome = { channel: channel, succeeded: true };

    if (recipient) {
      outcome.recipient = recipient;
    }

    await ServerSendingOutcomes.record(outcome);
  }

  public static async recordFailed(
    channel: ServerSendingChannel,
    reason: string | undefined,
    whose?: {
      scope: ServerSendingFailureScope;
      recipient?: string | undefined;
    },
  ): Promise<void> {
    const outcome: ServerSendingOutcome = {
      channel: channel,
      succeeded: false,
      reason: reason,
    };

    if (whose) {
      outcome.scope = whose.scope;

      if (whose.recipient) {
        outcome.recipient = whose.recipient;
      }
    }

    await ServerSendingOutcomes.record(outcome);
  }
}
