import JSONFunctions from "../../Types/JSONFunctions";

export interface HistoryStackSnapshot<T> {
  current: T;
  past: Array<T>;
  future: Array<T>;
}

const DEFAULT_MAX_HISTORY: number = 100;

export default class HistoryStack<T> {
  private current: T;
  private readonly past: Array<T> = [];
  private readonly future: Array<T> = [];
  private readonly maxHistory: number;

  public constructor(initial: T, maxHistory: number = DEFAULT_MAX_HISTORY) {
    this.current = this.clone(initial);
    this.maxHistory = maxHistory;
  }

  private clone(value: T): T {
    return JSONFunctions.deserializeValue(
      JSONFunctions.serializeValue(value as never),
    ) as T;
  }

  public getCurrent(): T {
    return this.current;
  }

  public push(next: T): void {
    this.past.push(this.clone(this.current));
    while (this.past.length > this.maxHistory) {
      this.past.shift();
    }
    this.future.length = 0;
    this.current = next;
  }

  public replace(next: T): void {
    /*
     * Update current without pushing onto undo stack — useful for in-flight
     * edits that should commit a single history entry on completion.
     */
    this.current = next;
  }

  public undo(): boolean {
    if (this.past.length === 0) {
      return false;
    }
    const previous: T = this.past.pop() as T;
    this.future.push(this.clone(this.current));
    this.current = previous;
    return true;
  }

  public redo(): boolean {
    if (this.future.length === 0) {
      return false;
    }
    const next: T = this.future.pop() as T;
    this.past.push(this.clone(this.current));
    this.current = next;
    return true;
  }

  public canUndo(): boolean {
    return this.past.length > 0;
  }

  public canRedo(): boolean {
    return this.future.length > 0;
  }

  public reset(next: T): void {
    this.past.length = 0;
    this.future.length = 0;
    this.current = this.clone(next);
  }

  public snapshot(): HistoryStackSnapshot<T> {
    return {
      current: this.clone(this.current),
      past: this.past.map((v: T) => {
        return this.clone(v);
      }),
      future: this.future.map((v: T) => {
        return this.clone(v);
      }),
    };
  }
}
