import fs from "fs";
import VMRunner from "Common/Server/Utils/VM/VMRunner";
import { VMHttpCall } from "Common/Server/Utils/VM/VMHttpBridge";
import ReturnResult from "Common/Types/IsolatedVM/ReturnResult";
import {
  JavaScriptStepOutcome,
  getJavaScriptStepOutcome,
} from "./JavaScriptStepResult";
import {
  MAX_SANDBOX_ERROR_MESSAGE_LENGTH,
  MAX_SANDBOX_INPUT_LINE_BYTES,
  SANDBOX_HTTP_FD,
  SANDBOX_PROTOCOL_VERSION,
  SANDBOX_RESULT_FD,
  SandboxHttpResult,
  SandboxLineReader,
  SandboxReply,
  SandboxRequest,
  parseSandboxHttpResult,
  parseSandboxRequest,
  serializeSandboxHttpCall,
} from "./SandboxProtocol";

/*
 * ONE JAVASCRIPT STEP OF A GLOBAL RUNNER, IN A PROCESS OF ITS OWN.
 *
 * The Runner starts this file for each step (SandboxProcess), as a user of
 * its own where the container allows it (the javascript-sandbox launcher),
 * with no network where the kernel allows it (javascript-sandbox-no-network:
 * it may open no socket at all), with an environment of a few names that
 * are not the Runner's (no key, no setting), in /, and under Node's
 * permission model: no file but the code it runs may be read, none written,
 * no process or worker started, and no network API used. It reads the one
 * request on its standard input, runs the step in the same isolated-vm
 * sandbox as before - a fresh isolate of 128 MB, the step's time limit -
 * writes the one reply to fd 3 and exits. Nothing is kept from one step to
 * the next: the process ends with the step.
 *
 * The isolate's HTTP goes through the Runner: each call is written to the
 * HTTP channel (fd 4) and answered on standard input, and the Runner makes
 * it through VMRunner's SSRF guard with its own policy for the step. This
 * process is never told where the step may go, and could not go there
 * itself.
 *
 * Its channels are written as files (fs), not as sockets: under the
 * permission model without --allow-net, Node refuses a socket of any kind,
 * even around a descriptor it was given.
 *
 * It must never import the Runner's Config or anything that does: that file
 * reads the Runner's own settings and exits without them.
 */

export const RUNNER_CLOSED_HTTP_CHANNEL_MESSAGE: string =
  "The Runner closed the step's HTTP channel.";

interface PendingCall {
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}

/*
 * The step's side of its channels: the request, then the Runner's answer to
 * each HTTP call, one line each on standard input; the calls themselves on
 * the HTTP channel.
 */
class RunnerChannel {
  private readonly lines: SandboxLineReader = new SandboxLineReader({
    maxLineBytes: MAX_SANDBOX_INPUT_LINE_BYTES,
  });
  private readonly pending: Map<number, PendingCall> = new Map<
    number,
    PendingCall
  >();
  private readonly httpChannel: fs.WriteStream = fs.createWriteStream("", {
    fd: SANDBOX_HTTP_FD,
    autoClose: false,
  });
  private nextCallId: number = 0;
  private request: Promise<string>;
  private resolveRequest!: (text: string) => void;
  private rejectRequest!: (error: Error) => void;
  private hasRequest: boolean = false;
  private isEnded: boolean = false;

  public constructor() {
    this.request = new Promise<string>(
      (resolve: (text: string) => void, reject: (error: Error) => void) => {
        this.resolveRequest = resolve;
        this.rejectRequest = reject;
      },
    );

    this.httpChannel.on("error", () => {
      this.end();
    });

    process.stdin.on("data", (chunk: Buffer | string) => {
      let received: Array<string>;

      try {
        received = this.lines.push(chunk);
      } catch {
        this.end();
        return;
      }

      for (const line of received) {
        this.take(line);
      }
    });

    process.stdin.on("end", () => {
      this.end();
    });

    process.stdin.on("error", () => {
      this.end();
    });
  }

  public readRequest(): Promise<string> {
    return this.request;
  }

  // Hands one HTTP call to the Runner, and waits for its answer.
  public requestHttp(call: VMHttpCall, signal: AbortSignal): Promise<string> {
    return new Promise<string>(
      (resolve: (value: string) => void, reject: (error: Error) => void) => {
        if (this.isEnded) {
          reject(new Error(RUNNER_CLOSED_HTTP_CHANNEL_MESSAGE));
          return;
        }

        const id: number = ++this.nextCallId;

        this.pending.set(id, { resolve, reject });

        signal.addEventListener(
          "abort",
          () => {
            if (this.pending.delete(id)) {
              reject(new Error("HTTP request was aborted"));
            }
          },
          { once: true },
        );

        this.httpChannel.write(serializeSandboxHttpCall({ id, call }));
      },
    );
  }

  private take(line: string): void {
    if (!this.hasRequest) {
      this.hasRequest = true;
      this.resolveRequest(line);
      return;
    }

    const result: SandboxHttpResult | null = parseSandboxHttpResult(line);

    if (!result) {
      return;
    }

    const call: PendingCall | undefined = this.pending.get(result.id);

    if (!call) {
      return;
    }

    this.pending.delete(result.id);

    if (typeof result.value === "string") {
      call.resolve(result.value);
    } else {
      call.reject(new Error(result.errorMessage || "HTTP request failed"));
    }
  }

  // The Runner is gone: every call waiting on it fails.
  private end(): void {
    if (this.isEnded) {
      return;
    }

    this.isEnded = true;

    if (!this.hasRequest) {
      this.rejectRequest(new Error("The sandbox request never came."));
    }

    for (const call of this.pending.values()) {
      call.reject(new Error(RUNNER_CLOSED_HTTP_CHANNEL_MESSAGE));
    }

    this.pending.clear();
  }
}

function writeReply(reply: SandboxReply): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    const channel: fs.WriteStream = fs.createWriteStream("", {
      fd: SANDBOX_RESULT_FD,
    });

    channel.on("error", () => {
      resolve();
    });

    channel.end(JSON.stringify(reply), () => {
      resolve();
    });
  });
}

function describeError(error: unknown): string {
  const message: string =
    error instanceof Error ? error.message : String(error);

  return message.slice(0, MAX_SANDBOX_ERROR_MESSAGE_LENGTH);
}

async function runStep(
  request: SandboxRequest,
  channel: RunnerChannel,
): Promise<SandboxReply> {
  try {
    const result: ReturnResult = await VMRunner.runCodeInSandbox({
      code: request.code,
      options: {
        args: request.args,
        timeout: request.timeoutInMs,
        httpRequester: (call: VMHttpCall, signal: AbortSignal) => {
          return channel.requestHttp(call, signal);
        },
      },
    });

    const outcome: JavaScriptStepOutcome = getJavaScriptStepOutcome(
      result,
      request.maxOutputBytes,
    );

    return {
      version: SANDBOX_PROTOCOL_VERSION,
      nonce: request.nonce,
      success: outcome.success,
      output: outcome.output,
      ...(outcome.errorMessage !== undefined
        ? {
            errorMessage: outcome.errorMessage.slice(
              0,
              MAX_SANDBOX_ERROR_MESSAGE_LENGTH,
            ),
          }
        : {}),
    };
  } catch (error: unknown) {
    return {
      version: SANDBOX_PROTOCOL_VERSION,
      nonce: request.nonce,
      success: false,
      output: "",
      errorMessage: describeError(error),
    };
  }
}

async function main(): Promise<void> {
  const channel: RunnerChannel = new RunnerChannel();
  let request: SandboxRequest;

  try {
    request = parseSandboxRequest(await channel.readRequest());
  } catch {
    // No nonce to answer to: the Runner reports a step that got no reply.
    process.exit(2);
  }

  await writeReply(await runStep(request, channel));

  // Whatever the step left open ends with the process.
  process.exit(0);
}

void main();
