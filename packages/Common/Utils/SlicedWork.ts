/*
 * WORK THAT CAN PAUSE, WRITTEN ONCE.
 *
 * A loop over a grouped monitor's series - 16,000 of them, 160,000 rows -
 * holds the event loop for as long as it runs, and nothing else the process
 * does (an insert, an API request, a lock's refresh) runs meanwhile
 * (#10108). A server caller wants it to hand the loop back every so often; a
 * browser, a test, or a caller that needs the answer now wants it to run
 * through. So such work is written as a generator that pauses (`yield`) at
 * the points where it may be interrupted - between two series, every so many
 * rows - and its callers drive it:
 *
 *   - SlicedWork.runToEnd runs it through, never pausing: exactly the
 *     synchronous function it was;
 *   - EventLoop.runInSlices (Common/Server/Utils/EventLoop) hands the event
 *     loop back at a pause once the work since the last hand-back has taken
 *     its budget (EventLoopBudget).
 *
 * The work's result is the generator's return value; what it throws, it
 * throws to its driver. A pause yields nothing and is handed nothing back.
 */

export type SlicedWorkSteps<T> = Generator<void, T, void>;

export default class SlicedWork {
  // Runs the work through, as one synchronous call.
  public static runToEnd<T>(work: SlicedWorkSteps<T>): T {
    let step: IteratorResult<void, T> = work.next();

    while (!step.done) {
      step = work.next();
    }

    return step.value;
  }
}
