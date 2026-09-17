import {
  SERVICE_LANGUAGE_DISPLAY_NAMES,
  ServiceLanguage,
  detectServiceLanguage,
} from "../../../Types/Service/ServiceLanguage";
import TechStack from "../../../Types/Service/TechStack";

/*
 * Which runtime a service is written in, decided from three sources of
 * evidence of decreasing trustworthiness.
 *
 * This used to only pick which charts to draw on the service overview, where
 * a wrong answer is a chart with no data in it. It now also picks which
 * monitors OneUptime recommends, where a wrong answer is a monitor that
 * queries a metric the service never emits and therefore never fires — a
 * silent gap that reads as coverage. Every case below is about the difference
 * between "we know" and "we are guessing".
 */

const ALL_LANGUAGES: Array<ServiceLanguage> = Object.keys(
  SERVICE_LANGUAGE_DISPLAY_NAMES,
) as Array<ServiceLanguage>;

describe("detectServiceLanguage", () => {
  describe("precedence between the three sources", () => {
    /*
     * The order is not arbitrary. `telemetry.sdk.language` is stamped by the
     * SDK inside the process, so it describes what the process actually runs
     * on. `process.runtime.name` is the same information one hop later.
     * The tech stack is a human's answer typed into a form, which can be
     * months out of date. Each test below sets up a deliberate disagreement
     * so the winner is unambiguous.
     */
    it("prefers the SDK language over the runtime name", () => {
      expect(
        detectServiceLanguage({
          telemetrySdkLanguage: "go",
          runtimeName: "OpenJDK Runtime Environment",
        }),
      ).toBe("go");
    });

    it("prefers the SDK language over the tech stack", () => {
      expect(
        detectServiceLanguage({
          telemetrySdkLanguage: "python",
          techStack: [TechStack.Java],
        }),
      ).toBe("python");
    });

    it("prefers the runtime name over the tech stack", () => {
      expect(
        detectServiceLanguage({
          runtimeName: "node",
          techStack: [TechStack.Java],
        }),
      ).toBe("nodejs");
    });

    it("falls through to the tech stack when telemetry says nothing", () => {
      expect(
        detectServiceLanguage({
          techStack: [TechStack.Rust],
        }),
      ).toBe("rust");
    });
  });

  describe("the SDK language attribute", () => {
    it.each(ALL_LANGUAGES)("recognises %s", (language: ServiceLanguage) => {
      expect(detectServiceLanguage({ telemetrySdkLanguage: language })).toBe(
        language,
      );
    });

    it("is matched case-insensitively and ignores surrounding whitespace", () => {
      expect(
        detectServiceLanguage({ telemetrySdkLanguage: "  DotNet  " }),
      ).toBe("dotnet");
    });

    /*
     * The important negative case. An unrecognised value must NOT be returned
     * verbatim — it would be a string that looks like a `ServiceLanguage` to
     * every consumer and matches no template set, so the recommendations page
     * would show nothing at all rather than the language-agnostic set.
     */
    it("does not pass an unrecognised SDK language through", () => {
      expect(
        detectServiceLanguage({ telemetrySdkLanguage: "cobol" }),
      ).toBeNull();
    });

    it("falls through to the other sources when the SDK language is unknown", () => {
      expect(
        detectServiceLanguage({
          telemetrySdkLanguage: "cobol",
          techStack: [TechStack.Go],
        }),
      ).toBe("go");
    });
  });

  describe("the runtime name markers", () => {
    it.each([
      ["OpenJDK 64-Bit Server VM", "java"],
      ["GraalVM CE", "java"],
      ["Java HotSpot(TM) 64-Bit Server VM", "java"],
      [".NET 9.0.0", "dotnet"],
      ["dotnet", "dotnet"],
      ["node", "nodejs"],
      ["Deno", "nodejs"],
      ["bun", "nodejs"],
      ["CPython", "python"],
      ["PyPy", "python"],
      ["BEAM", "erlang"],
      ["Erlang/OTP 26", "erlang"],
      ["ruby", "ruby"],
      ["PHP 8.3", "php"],
      ["rustc", "rust"],
      ["swift", "swift"],
      ["go", "go"],
    ])(
      "maps runtime name %s to %s",
      (runtimeName: string, expected: string) => {
        expect(detectServiceLanguage({ runtimeName: runtimeName })).toBe(
          expected,
        );
      },
    );

    /*
     * `go` is a two-letter substring, so it appears inside plenty of words —
     * "GraalVM" does not contain it, but the ordering still matters and this
     * pins it: the JVM markers are checked first, so a runtime string that
     * contains both loses to the more specific one.
     */
    it("checks specific markers before the two-letter go marker", () => {
      expect(
        detectServiceLanguage({ runtimeName: "GraalVM for Go interop" }),
      ).toBe("java");
    });

    it("returns null for a runtime name it does not recognise", () => {
      expect(detectServiceLanguage({ runtimeName: "SomeVM 1.0" })).toBeNull();
    });
  });

  describe("the tech stack fallback", () => {
    it("maps Kotlin to java, because the runtime is what matters", () => {
      expect(detectServiceLanguage({ techStack: [TechStack.Kotlin] })).toBe(
        "java",
      );
    });

    it("maps C# to dotnet", () => {
      expect(detectServiceLanguage({ techStack: [TechStack.CSharp] })).toBe(
        "dotnet",
      );
    });

    it.each([TechStack.TypeScript, TechStack.JavaScript, TechStack.NodeJS])(
      "maps %s to nodejs",
      (techStack: TechStack) => {
        expect(detectServiceLanguage({ techStack: [techStack] })).toBe(
          "nodejs",
        );
      },
    );

    it("maps React to webjs rather than to nodejs", () => {
      expect(detectServiceLanguage({ techStack: [TechStack.React] })).toBe(
        "webjs",
      );
    });

    it("takes the first entry that maps to a runtime", () => {
      expect(
        detectServiceLanguage({
          techStack: [TechStack.Shell, TechStack.Markdown, TechStack.Go],
        }),
      ).toBe("go");
    });

    it.each([TechStack.Shell, TechStack.Markdown, TechStack.Other])(
      "does not invent a runtime for %s",
      (techStack: TechStack) => {
        expect(detectServiceLanguage({ techStack: [techStack] })).toBeNull();
      },
    );
  });

  describe("when nothing identifies the runtime", () => {
    /*
     * Null, never a default. A default would hand every unidentified service
     * one language's recommendations — monitors on metrics it does not emit,
     * presented as if OneUptime had established what it runs on.
     */
    it("returns null for no input at all", () => {
      expect(detectServiceLanguage({})).toBeNull();
    });

    it("returns null for empty strings and an empty tech stack", () => {
      expect(
        detectServiceLanguage({
          telemetrySdkLanguage: "",
          runtimeName: "",
          techStack: [],
        }),
      ).toBeNull();
    });

    it("returns null for whitespace-only telemetry values", () => {
      expect(
        detectServiceLanguage({
          telemetrySdkLanguage: "   ",
          runtimeName: "  ",
        }),
      ).toBeNull();
    });

    it("returns null for explicitly undefined fields", () => {
      expect(
        detectServiceLanguage({
          telemetrySdkLanguage: undefined,
          runtimeName: undefined,
          techStack: undefined,
        }),
      ).toBeNull();
    });
  });
});

describe("SERVICE_LANGUAGE_DISPLAY_NAMES", () => {
  it("names every language, non-blank", () => {
    expect(ALL_LANGUAGES.length).toBeGreaterThan(0);

    for (const language of ALL_LANGUAGES) {
      expect(
        SERVICE_LANGUAGE_DISPLAY_NAMES[language].trim().length,
      ).toBeGreaterThan(0);
    }
  });

  it("gives each language a distinct display name", () => {
    const names: Array<string> = ALL_LANGUAGES.map(
      (language: ServiceLanguage) => {
        return SERVICE_LANGUAGE_DISPLAY_NAMES[language];
      },
    );

    expect(new Set<string>(names).size).toBe(names.length);
  });
});
