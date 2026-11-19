/*
 * TRY AGAIN ON A CODE TASK: WHY ONE IS NOT ASKED AGAIN, IN ONE SET OF WORDS.
 *
 * A failed or stopped turn of a Code task is asked again from its
 * conversation, its row in a list (Try again, Retry selected) and an
 * insight's Fix Task card (#6439, #6509): a request in the words it was
 * asked in, and a fix OneUptime started - from an exception, a trace, a
 * service, an investigation or an insight - with the context it started
 * with, as a new turn of the same task (CodeTaskFixRetry). The server
 * refuses one it cannot ask again in these sentences, and the Dashboard
 * words each in the reader's language (CodeTaskCopy's
 * CODE_TASK_TRY_AGAIN_REFUSAL_KEYS, which the suite holds to these).
 *
 * Pure: no server or browser code, so both sides read the same words.
 */

// The latest turn is still working, or finished: there is nothing to ask again.
export const CODE_TASK_TRY_AGAIN_ONLY_FAILED_MESSAGE: string =
  "Only a turn that failed or was stopped can be tried again.";

/*
 * A task asked for on GitHub (its answer goes back to the issue or pull
 * request), or a pull request's production review (Review again).
 */
export const CODE_TASK_TRY_AGAIN_NOT_IN_CODE_MESSAGE: string =
  "This turn was not asked for in Code, so it cannot be asked again. Reply with what you want AI to do instead.";

/*
 * A fix that may already have written: it recorded a pull request, its
 * trail holds a line a Runner logs just before it pushes or opens one, or
 * its task has a pull request (CodeFixAutoRetry.mayHaveWritten). Asked
 * again, it would work on a new branch and could open a second pull
 * request beside the first.
 */
export const CODE_TASK_TRY_AGAIN_MAY_HAVE_WRITTEN_MESSAGE: string =
  "OneUptime AI may already have pushed a branch or opened a pull request for this task, so it does not start it again: that could open a second one. Reply with what you want AI to do instead.";

// Another fix of the same exception, trace, service, incident or alert works now.
export const CODE_TASK_TRY_AGAIN_FIX_ON_ITS_WAY_MESSAGE: string =
  "OneUptime AI is already working on another fix for the same problem. Wait for it to finish, then try again if you still need to.";

// The exception a fix was for: resolved, archived, or gone.
export const CODE_TASK_TRY_AGAIN_EXCEPTION_RESOLVED_MESSAGE: string =
  "This exception is resolved, so OneUptime AI does not fix it again. Unresolve it first, then try again.";

export const CODE_TASK_TRY_AGAIN_EXCEPTION_ARCHIVED_MESSAGE: string =
  "This exception is archived, so OneUptime AI does not fix it again. Unarchive it first, then try again.";

export const CODE_TASK_TRY_AGAIN_EXCEPTION_GONE_MESSAGE: string =
  "The exception this fix was for is gone, so OneUptime AI cannot fix it again.";

/*
 * A fix of an incident's or alert's investigation, when the record was
 * investigated again since: the fix is worked out from the latest analysis
 * only (SubjectCodeFixRun, FixFromIncident).
 */
export const CODE_TASK_TRY_AGAIN_INVESTIGATION_MOVED_MESSAGE: string =
  "This fix came from an investigation that is no longer the latest one. Start a fix from the latest investigation instead.";

// Every refusal of Try again, for the suite that holds the Dashboard to them.
export const CODE_TASK_TRY_AGAIN_REFUSALS: ReadonlyArray<string> = [
  CODE_TASK_TRY_AGAIN_ONLY_FAILED_MESSAGE,
  CODE_TASK_TRY_AGAIN_NOT_IN_CODE_MESSAGE,
  CODE_TASK_TRY_AGAIN_MAY_HAVE_WRITTEN_MESSAGE,
  CODE_TASK_TRY_AGAIN_FIX_ON_ITS_WAY_MESSAGE,
  CODE_TASK_TRY_AGAIN_EXCEPTION_RESOLVED_MESSAGE,
  CODE_TASK_TRY_AGAIN_EXCEPTION_ARCHIVED_MESSAGE,
  CODE_TASK_TRY_AGAIN_EXCEPTION_GONE_MESSAGE,
  CODE_TASK_TRY_AGAIN_INVESTIGATION_MOVED_MESSAGE,
];
