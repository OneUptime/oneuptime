import {
  AppleBinaryImage,
  AppleCrashFrame,
  AppleCrashReport,
  AppleCrashThread,
  findAppleImage,
  isAppleSystemBinary,
} from "./AppleCrashReport";
import {
  AppleSymbolMatch,
  AppleSymbolTable,
  lookupAppleSymbol,
} from "./AppleSymbols";

/*
 * AN IOS CRASH'S OR HANG'S FRAMES, NAMED BY THEIR FUNCTIONS (#9922).
 *
 * Each frame of a report (AppleCrashReport) whose binary's UUID has a dSYM
 * (AppleSymbols) is named by the function its offset falls in, and written
 * as Apple's symbolicated reports write a frame beside its position:
 *
 *   0   MyApp   0x000000010003c1a4 0x100004000 + 229796 (CartViewController.checkout() + 120)
 *
 * so the report still says where the frame was - what a later dSYM, or a
 * person with one, resolves it by - and reads by its function. A frame with
 * no dSYM stays as it was. Grouping reads the names back (ExceptionGrouping),
 * the same in every build of the app.
 *
 * Pure, and never throws.
 */

export interface AppleSymbolicationResult {
  // The report's text with the resolved frames written again.
  text: string;
  // How many frames a dSYM resolved.
  resolvedFrames: number;
}

function framesOf(report: AppleCrashReport): Array<AppleCrashFrame> {
  return [
    ...report.threads.flatMap((thread: AppleCrashThread) => {
      return thread.frames;
    }),
    ...(report.lastExceptionBacktrace || []),
  ];
}

/*
 * The binary UUIDs a report's frames could be resolved by, each once: the
 * app's own binaries and frameworks. Apple's are left out - no app's dSYMs
 * hold them, and a report names dozens - so a crash asks for the few builds
 * of the app it was in.
 */
export function getAppleReportDebugIds(
  report: AppleCrashReport,
): Array<string> {
  const debugIds: Array<string> = [];

  for (const frame of framesOf(report)) {
    if (frame.offset === null) {
      continue;
    }

    const image: AppleBinaryImage | null = findAppleImage(report, frame);

    if (
      image?.debugId &&
      !isAppleSystemBinary({ name: image.name, path: image.path }) &&
      !debugIds.includes(image.debugId)
    ) {
      debugIds.push(image.debugId);
    }
  }

  return debugIds;
}

/*
 * The function a frame is in. Every frame but the innermost is a return
 * address: the instruction after a call, which is the next function's first
 * when the call was the last of its own (a call that never returns), so it
 * is looked up one byte earlier, as Apple's symbolicator does; the offset
 * into the function is the frame's own.
 */
export function resolveAppleFrame(
  frame: AppleCrashFrame,
  table: AppleSymbolTable,
): AppleSymbolMatch | null {
  if (frame.offset === null) {
    return null;
  }

  const lookupOffset: number =
    frame.index > 0 && frame.offset > 0 ? frame.offset - 1 : frame.offset;
  const match: AppleSymbolMatch | null = lookupAppleSymbol(table, lookupOffset);

  if (!match) {
    return null;
  }

  return {
    name: match.name,
    symbolOffset: match.symbolOffset + (frame.offset - lookupOffset),
  };
}

// A frame written with the function it is in, beside its position.
export function formatSymbolicatedAppleFrame(
  frame: AppleCrashFrame,
  functionName: string,
  symbolOffset: number,
): string {
  const position: string =
    frame.address !== null && frame.loadAddress !== null
      ? `0x${frame.address.toString(16).padStart(16, "0")} 0x${frame.loadAddress.toString(16)} + ${frame.offset}`
      : `${frame.binaryName} + ${frame.offset}`;

  return `${String(frame.index).padEnd(4)}${frame.binaryName.padEnd(30)} ${position} (${functionName} + ${symbolOffset})`;
}

/*
 * The report with every frame a dSYM resolves named by its function. A
 * name is read as people read it (`displayName`: Swift's demangled), and a
 * name with no character left to show leaves its frame as it was.
 */
export function symbolicateAppleReport(input: {
  report: AppleCrashReport;
  tables: Map<string, AppleSymbolTable>;
  displayName: (symbol: string) => string;
}): AppleSymbolicationResult {
  const lines: Array<string> = [...input.report.lines];
  let resolvedFrames: number = 0;

  try {
    for (const frame of framesOf(input.report)) {
      const image: AppleBinaryImage | null = findAppleImage(
        input.report,
        frame,
      );
      const table: AppleSymbolTable | undefined = image?.debugId
        ? input.tables.get(image.debugId)
        : undefined;

      if (!table) {
        continue;
      }

      const match: AppleSymbolMatch | null = resolveAppleFrame(frame, table);

      if (!match) {
        continue;
      }

      const name: string = input
        .displayName(match.name)
        .replace(/[\r\n]+/g, " ")
        .trim();

      if (!name) {
        continue;
      }

      lines[frame.lineIndex] = formatSymbolicatedAppleFrame(
        frame,
        name,
        match.symbolOffset,
      );
      resolvedFrames++;
    }
  } catch {
    return { text: input.report.lines.join("\n"), resolvedFrames: 0 };
  }

  return { text: lines.join("\n"), resolvedFrames };
}
