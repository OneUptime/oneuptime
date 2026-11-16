import VMHttpBridge, {
  MAX_PENDING_HTTP_REQUESTS,
  TOO_MANY_PENDING_HTTP_REQUESTS_MESSAGE,
  VMHttpPolicy,
} from "Common/Server/Utils/VM/VMHttpBridge";
import {
  MAX_SANDBOX_ERROR_MESSAGE_LENGTH,
  SandboxHttpCall,
  SandboxHttpResult,
  parseSandboxHttpCall,
  serializeSandboxHttpResult,
} from "./SandboxProtocol";

/*
 * A GLOBAL RUNNER'S JAVASCRIPT STEP'S HTTP, MADE BY THE RUNNER.
 *
 * The step's process may open no socket (Native/javascript-sandbox-no-
 * network.c): code that got out of its isolate reaches nothing by itself -
 * not the app, a database or a cache on the cluster's or Compose's network,
 * not the Kubernetes API, not a cloud metadata endpoint. Its isolate's axios
 * still works: the process hands each call to the Runner on its HTTP channel
 * (SandboxProtocol), and the Runner makes it here, with a bridge of the
 * step's own (VMHttpBridge, the very code that made it in the step's
 * process before), under the policy the Runner decided for the step - on a
 * global Runner, public addresses only - which the step's process is never
 * handed and cannot widen. The Runner applies the run's limits again
 * (VMHttpBridge.reserve): what the step's process checked first is never
 * taken on trust.
 *
 * Every call ends with one answer on the step's standard input: the
 * response's envelope, or why there is none. A line that is not a call - or
 * a call whose number is already in flight - is not the step's worker
 * talking, and the Runner stops the process (handle answers false). When
 * the step ends, every call still in flight is aborted.
 */

export interface SandboxHttpChannelOptions {
  policy: VMHttpPolicy;
  // Writes one answer, a line, to the step's standard input.
  send: (line: string) => void;
  // For tests: the bridge that makes the step's calls.
  bridge?: VMHttpBridge | undefined;
}

function describeError(error: unknown): string {
  const message: string =
    error instanceof Error ? error.message : String(error);

  return message.slice(0, MAX_SANDBOX_ERROR_MESSAGE_LENGTH);
}

export default class SandboxHttpChannel {
  private readonly bridge: VMHttpBridge;
  private readonly inFlight: Map<number, AbortController> = new Map<
    number,
    AbortController
  >();
  private isClosed: boolean = false;
  private callCount: number = 0;

  public constructor(private readonly options: SandboxHttpChannelOptions) {
    this.bridge = options.bridge || new VMHttpBridge(options.policy);
  }

  // Calls the step made, and calls still waiting on their answer.
  public get calls(): number {
    return this.callCount;
  }

  public get pending(): number {
    return this.inFlight.size;
  }

  /*
   * One line the step's process wrote on its HTTP channel. False when it is
   * not a call the step's worker would write, and the Runner should stop
   * the process.
   */
  public handle(line: string): boolean {
    if (this.isClosed) {
      return true;
    }

    const httpCall: SandboxHttpCall | null = parseSandboxHttpCall(line);

    if (!httpCall || this.inFlight.has(httpCall.id)) {
      return false;
    }

    this.callCount++;

    if (this.inFlight.size >= MAX_PENDING_HTTP_REQUESTS) {
      this.answer({
        id: httpCall.id,
        errorMessage: TOO_MANY_PENDING_HTTP_REQUESTS_MESSAGE,
      });
      return true;
    }

    try {
      this.bridge.reserve(httpCall.call);
    } catch (error: unknown) {
      this.answer({ id: httpCall.id, errorMessage: describeError(error) });
      return true;
    }

    const controller: AbortController = new AbortController();
    this.inFlight.set(httpCall.id, controller);

    void this.bridge.execute(httpCall.call, controller.signal).then(
      (value: string) => {
        this.settle(httpCall.id, controller, { id: httpCall.id, value });
      },
      (error: unknown) => {
        this.settle(httpCall.id, controller, {
          id: httpCall.id,
          errorMessage: describeError(error),
        });
      },
    );

    return true;
  }

  // The step ended: every call in flight is aborted, and none is answered.
  public close(): void {
    this.isClosed = true;

    for (const controller of this.inFlight.values()) {
      controller.abort();
    }

    this.inFlight.clear();
  }

  private settle(
    id: number,
    controller: AbortController,
    result: SandboxHttpResult,
  ): void {
    if (this.inFlight.get(id) !== controller) {
      return;
    }

    this.inFlight.delete(id);
    this.answer(result);
  }

  private answer(result: SandboxHttpResult): void {
    if (this.isClosed) {
      return;
    }

    this.options.send(serializeSandboxHttpResult(result));
  }
}
