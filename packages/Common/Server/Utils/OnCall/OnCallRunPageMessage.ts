import { AsyncLocalStorage } from "async_hooks";
import { toOnCallPersonPageMessage } from "../../../Types/OnCallDutyPolicy/OnCallPersonPage";

/*
 * THE MESSAGE A RUN IS CREATED WITH, WHEN NO CALLER MAY WRITE IT.
 *
 * A page from Slack or Microsoft Teams that names an on-call policy starts
 * the policy as the person who paged (OnCallPageService.startPolicy): its
 * run is created with their permissions, so whether they may start it is
 * the run's own check. The message they wrote is kept on the run
 * (OnCallDutyPolicyExecutionLog.pageMessage), a column no caller may write.
 *
 * Written after the run was created, it came too late for the run's first
 * notifications: creating the run pages its first level then and there
 * (OnCallDutyPolicyExecutionLogService.onCreateSuccess), and those were
 * composed before the message was on the run. The people its first level
 * pages - the ones the person asked for first - were never told what they
 * wrote (https://github.com/OneUptime/oneuptime/issues/7838).
 *
 * So the run is created inside startWith, and the service writes the
 * message on it as it is created, once every check on the caller has passed
 * (onCreatePermitted), the way it writes the workflow that started a run.
 * Only the first run created inside startWith takes it: nothing else made
 * while the run pages - its first level's people's pages, a later run -
 * ever does. Nothing here is read from a request.
 */

interface PageMessageStore {
  message: string;
  isTaken: boolean;
}

const pageMessageStore: AsyncLocalStorage<PageMessageStore> =
  new AsyncLocalStorage<PageMessageStore>();

export default class OnCallRunPageMessage {
  /*
   * Runs `start` - the create of one run - with the message its person
   * wrote, as a page keeps it (toOnCallPersonPageMessage). With none,
   * `start` runs as it is.
   */
  public static startWith<T>(
    message: string | null | undefined,
    start: () => Promise<T>,
  ): Promise<T> {
    const pageMessage: string = toOnCallPersonPageMessage(message);

    if (!pageMessage) {
      return start();
    }

    return pageMessageStore.run(
      { message: pageMessage, isTaken: false },
      start,
    );
  }

  /*
   * The message for the run being created now, taken once: the first call
   * inside startWith gets it, every later one - and every call outside
   * startWith - none.
   */
  public static take(): string | undefined {
    const store: PageMessageStore | undefined = pageMessageStore.getStore();

    if (!store || store.isTaken) {
      return undefined;
    }

    store.isTaken = true;

    return store.message;
  }
}
