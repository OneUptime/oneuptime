import net from "net";
import VMRunner from "Common/Server/Utils/VM/VMRunner";
import ReturnResult from "Common/Types/IsolatedVM/ReturnResult";
import {
  JavaScriptStepOutcome,
  getJavaScriptStepOutcome,
} from "./JavaScriptStepResult";
import {
  MAX_SANDBOX_ERROR_MESSAGE_LENGTH,
  MAX_SANDBOX_REQUEST_BYTES,
  SANDBOX_PROTOCOL_VERSION,
  SANDBOX_RESULT_FD,
  SandboxReply,
  SandboxRequest,
  parseSandboxRequest,
} from "./SandboxProtocol";

/*
 * ONE JAVASCRIPT STEP OF A GLOBAL RUNNER, IN A PROCESS OF ITS OWN.
 *
 * The Runner starts this file for each step (SandboxProcess), as a user of
 * its own where the container allows it (the javascript-sandbox launcher),
 * with an environment of a few names that are not the Runner's (no key, no
 * setting), in /, and under Node's permission model: no file but the code
 * it runs may be read, none written, no process or worker started. It reads
 * the one request on its standard input, runs the step in the same
 * isolated-vm sandbox as before - a fresh isolate of 128 MB, the step's time
 * limit, HTTP to public addresses only - writes the one reply to fd 3 and
 * exits. Nothing is kept from one step to the next: the process ends with
 * the step.
 *
 * It must never import the Runner's Config or anything that does: that file
 * reads the Runner's own settings and exits without them.
 */

async function readRequest(): Promise<string> {
  const chunks: Array<Buffer> = [];
  let total: number = 0;

  for await (const chunk of process.stdin) {
    const buffer: Buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(String(chunk), "utf8");

    total += buffer.length;

    if (total > MAX_SANDBOX_REQUEST_BYTES) {
      throw new Error("The sandbox request is too large.");
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function writeReply(reply: SandboxReply): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    const channel: net.Socket = new net.Socket({
      fd: SANDBOX_RESULT_FD,
      readable: false,
      writable: true,
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

async function runStep(request: SandboxRequest): Promise<SandboxReply> {
  try {
    const result: ReturnResult = await VMRunner.runCodeInSandbox({
      code: request.code,
      options: {
        args: request.args,
        timeout: request.timeoutInMs,
        ...request.policy,
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
  let request: SandboxRequest;

  try {
    request = parseSandboxRequest(await readRequest());
  } catch {
    // No nonce to answer to: the Runner reports a step that got no reply.
    process.exit(2);
  }

  await writeReply(await runStep(request));

  // Whatever the step left open (a keep-alive socket) ends with the process.
  process.exit(0);
}

void main();
