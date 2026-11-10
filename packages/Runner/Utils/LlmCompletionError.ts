/*
 * A model call of the code agent that failed (issue #6441), with what the
 * agent needs to decide whether to try it again: the HTTP status the
 * OneUptime server answered with, or that it never answered at all.
 *
 * The words are the server's own (a provider's error, a limit the run
 * reached, a run no longer running), so AIRunRetryPolicy reads the kind of
 * failure from them first, and from the status code after (a 429 or a 5xx
 * is a service unavailable for now, any other 4xx a refusal no repeat gets
 * past). A call that got no answer says the server "could not be reached",
 * which the policy reads as unavailable for now.
 *
 * Its own module, not BackendAPI's: the agent's tests replace BackendAPI
 * whole, and still throw this.
 */
export default class LlmCompletionError extends Error {
  // The status the server answered with; undefined when it never answered.
  public readonly statusCode: number | undefined;
  // The call got no answer: the server is down, restarting or out of reach.
  public readonly isNetworkFailure: boolean;

  public constructor(data: {
    message: string;
    statusCode?: number | undefined;
    isNetworkFailure?: boolean | undefined;
  }) {
    super(data.message);
    this.name = "LlmCompletionError";
    this.statusCode = data.statusCode;
    this.isNetworkFailure = data.isNetworkFailure === true;
  }
}
