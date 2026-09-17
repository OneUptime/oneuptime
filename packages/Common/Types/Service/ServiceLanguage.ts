import TechStack from "./TechStack";

/*
 * Which runtime a telemetry service is written in, and how to work that out
 * from what the service actually reported.
 *
 * This started life inside the dashboard's service-overview charts
 * (`serviceGoldenMetrics.ts`), where it picked which runtime charts to draw.
 * It lives in Common now because a second consumer needs the same answer from
 * a place the dashboard cannot reach: the monitor recommendation catalog. The
 * recommendations a Java service should get (JVM heap pressure, GC pause
 * time, thread exhaustion) have nothing in common with the ones a Go service
 * should get (goroutine leaks, GC cycles), and the catalog runs in Common.
 *
 * `serviceGoldenMetrics.ts` re-exports everything here, so the dashboard's
 * existing import paths are unchanged.
 */

// Canonical values of the telemetry.sdk.language resource attribute.
export type ServiceLanguage =
  | "java"
  | "dotnet"
  | "nodejs"
  | "python"
  | "go"
  | "ruby"
  | "php"
  | "rust"
  | "erlang"
  | "swift"
  | "cpp"
  | "webjs";

export const SERVICE_LANGUAGE_DISPLAY_NAMES: Record<ServiceLanguage, string> = {
  java: "Java",
  dotnet: ".NET",
  nodejs: "Node.js",
  python: "Python",
  go: "Go",
  ruby: "Ruby",
  php: "PHP",
  rust: "Rust",
  erlang: "Erlang / Elixir",
  swift: "Swift",
  cpp: "C++",
  webjs: "Browser JS",
};

const KNOWN_LANGUAGES: Array<ServiceLanguage> = Object.keys(
  SERVICE_LANGUAGE_DISPLAY_NAMES,
) as Array<ServiceLanguage>;

/*
 * process.runtime.name values seen in the wild → language. Checked as
 * case-insensitive substrings, so "OpenJDK Runtime Environment" → java.
 * Ordered: more specific markers first ("graalvm" before "go").
 */
const RUNTIME_NAME_MARKERS: Array<{ marker: string; lang: ServiceLanguage }> = [
  { marker: "openjdk", lang: "java" },
  { marker: "graalvm", lang: "java" },
  { marker: "java", lang: "java" },
  { marker: "dotnet", lang: "dotnet" },
  { marker: ".net", lang: "dotnet" },
  { marker: "node", lang: "nodejs" },
  { marker: "deno", lang: "nodejs" },
  { marker: "bun", lang: "nodejs" },
  { marker: "cpython", lang: "python" },
  { marker: "pypy", lang: "python" },
  { marker: "python", lang: "python" },
  { marker: "beam", lang: "erlang" },
  { marker: "erlang", lang: "erlang" },
  { marker: "ruby", lang: "ruby" },
  { marker: "php", lang: "php" },
  { marker: "rust", lang: "rust" },
  { marker: "swift", lang: "swift" },
  { marker: "go", lang: "go" },
];

// Manual tech-stack selections → language (JVM languages map to java).
const TECH_STACK_LANGUAGES: Partial<Record<TechStack, ServiceLanguage>> = {
  [TechStack.Java]: "java",
  [TechStack.Kotlin]: "java",
  [TechStack.CSharp]: "dotnet",
  [TechStack.NodeJS]: "nodejs",
  [TechStack.TypeScript]: "nodejs",
  [TechStack.JavaScript]: "nodejs",
  [TechStack.React]: "webjs",
  [TechStack.Python]: "python",
  [TechStack.Go]: "go",
  [TechStack.Ruby]: "ruby",
  [TechStack.PHP]: "php",
  [TechStack.Rust]: "rust",
  [TechStack.Swift]: "swift",
  [TechStack.CPlusPlus]: "cpp",
};

/*
 * Best-effort language for a service, in descending order of trust:
 *
 *   1. `telemetry.sdk.language` — stamped by the SDK itself, so it is what the
 *      process actually runs on rather than what anyone believes it runs on.
 *   2. `process.runtime.name` — present when runtime instrumentation is on but
 *      the SDK attribute did not survive a collector hop.
 *   3. The manually-chosen tech stack — a human's answer, used only when the
 *      telemetry has not answered.
 *
 * Returns null when nothing identifies the runtime. Callers must treat that as
 * "unknown", never as a default language: recommending JVM heap monitors to a
 * service that turns out to be Go is worse than recommending nothing.
 */
export const detectServiceLanguage: (data: {
  telemetrySdkLanguage?: string | undefined;
  runtimeName?: string | undefined;
  techStack?: Array<TechStack> | undefined;
}) => ServiceLanguage | null = (data: {
  telemetrySdkLanguage?: string | undefined;
  runtimeName?: string | undefined;
  techStack?: Array<TechStack> | undefined;
}): ServiceLanguage | null => {
  const sdkLanguage: string = (data.telemetrySdkLanguage || "")
    .trim()
    .toLowerCase();
  if (sdkLanguage && KNOWN_LANGUAGES.includes(sdkLanguage as ServiceLanguage)) {
    return sdkLanguage as ServiceLanguage;
  }

  const runtimeName: string = (data.runtimeName || "").trim().toLowerCase();
  if (runtimeName) {
    for (const entry of RUNTIME_NAME_MARKERS) {
      if (runtimeName.includes(entry.marker)) {
        return entry.lang;
      }
    }
  }

  for (const stack of data.techStack || []) {
    const lang: ServiceLanguage | undefined = TECH_STACK_LANGUAGES[stack];
    if (lang) {
      return lang;
    }
  }

  return null;
};
