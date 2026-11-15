import { AsyncLocalStorage } from "async_hooks";

/*
 * WHETHER A NOTIFICATION RULE'S PAGE GOT AS FAR AS A SENDER (issue #8407).
 *
 * UserNotificationRuleService.executeNotificationRuleItem claims a rule on
 * the person's log before it sends it, so two ticks never send it twice.
 * Between the claim and the send it reads the rule, the project's Twilio
 * settings, the incident or alert, the person's language, and writes the
 * notification's row: a database error in any of those used to keep the
 * claim with nothing sent, and the rule - "call me after 10 minutes" - was
 * never sent at all, as the next tick found it claimed.
 *
 * A send that failed before anything of it reached a sender can be sent
 * again without paging anybody twice: its claim is given back. One that
 * reached a sender cannot be, and keeps its claim. This says which: an
 * attempt counts as handed to a sender from the moment a send's result
 * handler is made (OnCallSendFailure's whenNotificationRequestAnswers,
 * whenNotificationRequestFails, whenSendFails) - which every channel of the
 * delivery half does right as it hands its notification over, and nothing
 * else does.
 *
 * Kept per attempt, through every await of it (AsyncLocalStorage), so the
 * delivery half needs no flag threaded through it; outside an attempt the
 * mark does nothing. An attempt run inside another counts for both.
 */
export default class OnCallSendAttempt {
  private static readonly attempts: AsyncLocalStorage<OnCallSendAttempt> =
    new AsyncLocalStorage<OnCallSendAttempt>();

  // Whether anything of this attempt was handed to a sender.
  public handedToASender: boolean = false;

  // The attempt this one runs inside, if any.
  private readonly outer: OnCallSendAttempt | undefined;

  private constructor(outer: OnCallSendAttempt | undefined) {
    this.outer = outer;
  }

  // A new attempt, inside the one running now if there is one.
  public static begin(): OnCallSendAttempt {
    return new OnCallSendAttempt(OnCallSendAttempt.attempts.getStore());
  }

  /*
   * A notification is being handed to a sender: the attempts running now
   * count as sent.
   */
  public static markHandedToASender(): void {
    let attempt: OnCallSendAttempt | undefined =
      OnCallSendAttempt.attempts.getStore();

    while (attempt) {
      attempt.handedToASender = true;
      attempt = attempt.outer;
    }
  }

  // Runs `send` as this attempt.
  public run<T>(send: () => Promise<T>): Promise<T> {
    return OnCallSendAttempt.attempts.run(this, send);
  }
}
