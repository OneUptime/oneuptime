/*
 * SIGNS THAT SOMEBODY IS STUCK, ON THE DASHBOARD'S OWN PAGES (issue #6834).
 *
 * The recorder already notices rage clicks and dead clicks on any page.
 * These are the three the Dashboard can tell that a recorder cannot:
 *
 *   frustration/form_refused_repeatedly  a form on one page refused the
 *                                        person FORM_REFUSALS_FOR_SIGNAL
 *                                        times - by its own checks or the
 *                                        server's - without going through;
 *   frustration/page_left_quickly        a page opened and left within
 *                                        QUICK_EXIT_MS, by the person (a
 *                                        click or a key on it): a redirect
 *                                        moves on with no input, and is not
 *                                        a person giving up;
 *   frustration/back_and_forth           A, B, A, B: going back and forth
 *                                        between two pages within
 *                                        BACK_AND_FORTH_WINDOW_MS, looking
 *                                        for something on one of them.
 *
 * Each names the page it happened on (a route pattern, never an address),
 * and the recording adds where in a guided setup it was (DashboardRecording).
 * Pure and clock-free - every call says when - so the tests drive it.
 */

export enum DashboardSignalName {
  FormRefusedRepeatedly = "frustration/form_refused_repeatedly",
  PageLeftQuickly = "frustration/page_left_quickly",
  BackAndForth = "frustration/back_and_forth",
}

export const FORM_REFUSALS_FOR_SIGNAL: number = 3;
export const QUICK_EXIT_MS: number = 5000;
export const BACK_AND_FORTH_WINDOW_MS: number = 60 * 1000;

export interface DashboardSignalHit {
  name: DashboardSignalName;
  // The route pattern of the page it happened on.
  page: string;
}

interface PageVisit {
  page: string;
  atMs: number;
}

export default class DashboardSignals {
  private page: string | null = null;
  private enteredAtMs: number = 0;
  private hadInputOnPage: boolean = false;
  private refusalsOnPage: number = 0;
  private hasSignalledRefusals: boolean = false;
  private visits: Array<PageVisit> = [];

  /*
   * The person is on this page now. Answers what leaving the last one, and
   * arriving here, says. The same page again (a query change, a re-render)
   * is no move at all.
   */
  public notePage(page: string, atMs: number): Array<DashboardSignalHit> {
    if (page === this.page) {
      return [];
    }

    const hits: Array<DashboardSignalHit> = [];

    if (
      this.page !== null &&
      this.hadInputOnPage &&
      atMs - this.enteredAtMs < QUICK_EXIT_MS
    ) {
      hits.push({ name: DashboardSignalName.PageLeftQuickly, page: this.page });
    }

    this.page = page;
    this.enteredAtMs = atMs;
    this.hadInputOnPage = false;
    this.refusalsOnPage = 0;
    this.hasSignalledRefusals = false;

    this.visits.push({ page: page, atMs: atMs });

    if (this.visits.length > 4) {
      this.visits.shift();
    }

    if (this.isBackAndForth(atMs)) {
      hits.push({ name: DashboardSignalName.BackAndForth, page: page });
      // A new A, B, A, B is needed before it says so again.
      this.visits = [{ page: page, atMs: atMs }];
    }

    return hits;
  }

  // A click or a key on the page: the person, not a redirect, is here.
  public noteInput(): void {
    this.hadInputOnPage = true;
  }

  // A form on this page refused the person. Signals once per page visit.
  public noteFormRefusal(): Array<DashboardSignalHit> {
    if (this.page === null || this.hasSignalledRefusals) {
      return [];
    }

    this.hadInputOnPage = true;
    this.refusalsOnPage++;

    if (this.refusalsOnPage < FORM_REFUSALS_FOR_SIGNAL) {
      return [];
    }

    this.hasSignalledRefusals = true;

    return [
      { name: DashboardSignalName.FormRefusedRepeatedly, page: this.page },
    ];
  }

  private isBackAndForth(atMs: number): boolean {
    if (this.visits.length < 4) {
      return false;
    }

    const [first, second, third, fourth] = this.visits as [
      PageVisit,
      PageVisit,
      PageVisit,
      PageVisit,
    ];

    return (
      first.page === third.page &&
      second.page === fourth.page &&
      first.page !== second.page &&
      atMs - first.atMs <= BACK_AND_FORTH_WINDOW_MS
    );
  }
}
