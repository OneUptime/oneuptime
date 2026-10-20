/*
 * ONE FRAME OF A PROFILE'S STACK, AND WHOSE CODE IT IS.
 *
 * Stored stacks are arrays of "functionName@fileName:lineNumber" strings
 * (OtelProfilesIngestService.resolveStackFrames): the file and the line are
 * left out when the profiler did not know them, and a frame without "@" is
 * a bare name. parseProfileFrame reads one back, splitting on the LAST
 * colon, since a Windows path ("C:\...") or a URL holds colons of its own.
 *
 * getProfileFrameOrigin says whose code a frame runs: the application's
 * own, a library it depends on, the language runtime, or the operating
 * system. The Profiler draws "your code" first, and "Fix with AI" is only
 * offered on it. The rule reads the file path first and the function name
 * when there is no path (eBPF frames of a JVM or a .NET runtime often carry
 * none); when nothing says otherwise a frame is the application's own, so
 * a person's code is never hidden as somebody else's.
 *
 * Pure: the server and the Dashboard import it alike.
 */

export interface ParsedProfileFrame {
  functionName: string;
  fileName: string;
  lineNumber: number;
}

export enum ProfileFrameOrigin {
  // The application's own code.
  Own = "own",
  // A library the application depends on (node_modules, site-packages, ...).
  Dependency = "dependency",
  // The language runtime and its standard library.
  Runtime = "runtime",
  // The operating system: the kernel, libc and other shared libraries.
  Native = "native",
  // A frame with no file and no telling name.
  Unknown = "unknown",
}

export function parseProfileFrame(frame: string): ParsedProfileFrame {
  const value: string = frame || "";
  const atIndex: number = value.indexOf("@");

  if (atIndex === -1) {
    return { functionName: value, fileName: "", lineNumber: 0 };
  }

  const functionName: string = value.substring(0, atIndex);
  const rest: string = value.substring(atIndex + 1);
  const lastColonIndex: number = rest.lastIndexOf(":");

  if (lastColonIndex === -1) {
    return { functionName, fileName: rest, lineNumber: 0 };
  }

  const lineText: string = rest.substring(lastColonIndex + 1);

  // "C:\app\x.cs" has a colon that is no line number.
  if (!isDigits(lineText)) {
    return { functionName, fileName: rest, lineNumber: 0 };
  }

  return {
    functionName,
    fileName: rest.substring(0, lastColonIndex),
    lineNumber: parseInt(lineText, 10) || 0,
  };
}

/*
 * The identity a function keeps across deploys: its name and its file.
 * Line numbers move with every change to the file, so they are left out.
 */
export function getProfileFunctionKey(
  functionName: string,
  fileName: string,
): string {
  return `${functionName}\u0000${fileName}`;
}

function isDigits(text: string): boolean {
  if (text.length === 0 || text.length > 9) {
    return false;
  }

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);
    if (code < 48 || code > 57) {
      return false;
    }
  }

  return true;
}

// Path pieces that mark a library the application depends on.
const DEPENDENCY_PATH_MARKERS: ReadonlyArray<string> = [
  "node_modules/",
  "site-packages/",
  "dist-packages/",
  "/vendor/",
  "/gems/",
  "/go/pkg/mod/",
  "/.m2/repository/",
  "/.nuget/packages/",
  "/.cargo/registry/",
  "/bower_components/",
];

// Path beginnings that mark the language runtime and its standard library.
const RUNTIME_PATH_PREFIXES: ReadonlyArray<string> = [
  "node:",
  "internal/",
  "/usr/local/go/",
  "/usr/lib/go/",
  "runtime/",
  "/opt/python",
  "/usr/local/lib/python",
  "/usr/lib/python",
  "/usr/local/lib/ruby/",
  "/usr/lib/ruby/",
  "java/",
  "javax/",
  "jdk/",
  "jdk.",
  "[v8",
  "v8::",
  "<frozen ",
];

// Function name beginnings of the runtimes' own code, for frames with no file.
const RUNTIME_FUNCTION_PREFIXES: ReadonlyArray<string> = [
  "runtime.",
  "runtime/",
  "java.",
  "javax.",
  "jdk.",
  "sun.",
  "com.sun.",
  "System.",
  "Microsoft.",
  "(garbage collector)",
  "(program)",
  "(idle)",
];

// Path beginnings and endings of the operating system's code.
const NATIVE_PATH_PREFIXES: ReadonlyArray<string> = [
  "[kernel",
  "/lib/",
  "/lib64/",
  "/usr/lib/",
  "/usr/lib64/",
];

// Frame kinds the OpenTelemetry eBPF profiler stamps on system frames.
const NATIVE_FRAME_TYPES: ReadonlyArray<string> = ["kernel", "native"];

export function getProfileFrameOrigin(
  fileName: string | null | undefined,
  functionName?: string | null | undefined,
  frameType?: string | null | undefined,
): ProfileFrameOrigin {
  const file: string = (fileName || "").trim();
  const lowerFile: string = file.toLowerCase().split("\\").join("/");
  const name: string = (functionName || "").trim();
  const kind: string = (frameType || "").toLowerCase().trim();

  if (kind === "kernel") {
    return ProfileFrameOrigin.Native;
  }

  if (lowerFile) {
    for (const marker of DEPENDENCY_PATH_MARKERS) {
      if (lowerFile.includes(marker)) {
        return ProfileFrameOrigin.Dependency;
      }
    }

    for (const prefix of RUNTIME_PATH_PREFIXES) {
      if (lowerFile.startsWith(prefix)) {
        return ProfileFrameOrigin.Runtime;
      }
    }

    for (const prefix of NATIVE_PATH_PREFIXES) {
      if (lowerFile.startsWith(prefix)) {
        return ProfileFrameOrigin.Native;
      }
    }

    if (lowerFile.endsWith(".so") || lowerFile.includes(".so.")) {
      return ProfileFrameOrigin.Native;
    }

    return ProfileFrameOrigin.Own;
  }

  if (!name) {
    return ProfileFrameOrigin.Unknown;
  }

  for (const prefix of RUNTIME_FUNCTION_PREFIXES) {
    if (name.startsWith(prefix)) {
      return ProfileFrameOrigin.Runtime;
    }
  }

  if (NATIVE_FRAME_TYPES.includes(kind)) {
    return ProfileFrameOrigin.Native;
  }

  // An address the profiler could not name ("0x7f3a…") is nobody's code.
  if (name.startsWith("0x")) {
    return ProfileFrameOrigin.Unknown;
  }

  return ProfileFrameOrigin.Own;
}

export function isOwnProfileFrame(
  fileName: string | null | undefined,
  functionName?: string | null | undefined,
  frameType?: string | null | undefined,
): boolean {
  return (
    getProfileFrameOrigin(fileName, functionName, frameType) ===
    ProfileFrameOrigin.Own
  );
}
