import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";
import websiteHljs, {
  WEBSITE_ONLY_LANGUAGES,
  resolveRegisteredLanguage,
} from "../../../UI/Components/CodeBlock/WebsiteLanguageRegistry";

/*
 * The grammars only the website's OpenTelemetry guides highlight - Java,
 * Kotlin, Java's .properties, INI (TOML too, by its alias) and Protobuf -
 * registered on the Dashboard's highlight.js core by
 * WebsiteLanguageRegistry, which the website alone imports: every
 * frontend's bundle stays without them.
 */

const COMMON: string = path.resolve(__dirname, "../../..");
const PACKAGES: string = path.resolve(COMMON, "..");
const REGISTRY_FILE: string = path.join(
  COMMON,
  "UI/Components/CodeBlock/LanguageRegistry.ts",
);
const WEBSITE_REGISTRY: string = "CodeBlock/WebsiteLanguageRegistry";

// Every .ts and .tsx file under a folder, node_modules and build output aside.
function sourceFiles(folder: string): Array<string> {
  const files: Array<string> = [];
  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!["node_modules", "build", "dist", ".git"].includes(entry.name)) {
          walk(full);
        }
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        files.push(full);
      }
    }
  };

  if (fs.existsSync(folder)) {
    walk(folder);
  }

  return files;
}

describe("the website's own grammars", () => {
  test("highlight Java, Kotlin, .properties, INI and Protobuf", () => {
    const samples: Array<[string, string, string]> = [
      ["java", "public class App { }", "hljs-keyword"],
      ["kotlin", "fun main() { val count = 1 }", "hljs-keyword"],
      ["properties", "otel.traces.exporter=otlp", "hljs-meta"],
      ["ini", "[uwsgi]\nmodule = shop.wsgi", "hljs-section"],
      [
        "protobuf",
        "service Orders { rpc GetOrder(Req) returns (Order); }",
        "hljs-keyword",
      ],
    ];

    expect([...WEBSITE_ONLY_LANGUAGES].sort()).toEqual(
      samples
        .map(([language]: [string, string, string]): string => {
          return language;
        })
        .sort(),
    );
    for (const [language, code, token] of samples) {
      expect(resolveRegisteredLanguage(language)).toBe(language);
      expect([
        language,
        websiteHljs.highlight(code, { language: language }).value,
      ]).toEqual([language, expect.stringContaining(token)]);
    }
  });

  test("keep the grammars the Dashboard registers too", () => {
    for (const language of ["python", "csharp", "xml", "bash", "yaml"]) {
      expect(resolveRegisteredLanguage(language)).toBe(language);
    }
  });

  test("read Go, Ruby, PHP, Rust and Elixir with the Dashboard's own grammars", () => {
    const registry: string = fs.readFileSync(REGISTRY_FILE, "utf8");

    for (const language of ["go", "ruby", "php", "rust", "elixir"]) {
      expect(resolveRegisteredLanguage(language)).toBe(language);
      expect([
        language,
        registry.includes(`highlight.js/lib/languages/${language}"`),
      ]).toEqual([language, true]);
      expect(WEBSITE_ONLY_LANGUAGES).not.toContain(language);
    }
  });

  test("read a Cargo.toml as TOML, the INI grammar's alias", () => {
    expect(resolveRegisteredLanguage("toml")).toBe("toml");
    expect(
      websiteHljs.highlight('[dependencies]\nopentelemetry = "0.33.1"', {
        language: "toml",
      }).value,
    ).toContain("hljs-section");
  });

  test("are not in the Dashboard's registry, which every frontend loads", () => {
    const source: string = fs.readFileSync(REGISTRY_FILE, "utf8");

    for (const language of WEBSITE_ONLY_LANGUAGES) {
      expect([
        language,
        source.includes(`highlight.js/lib/languages/${language}"`),
      ]).toEqual([language, false]);
    }
  });

  test("are imported by the website alone", () => {
    const frontends: Array<string> = [
      path.join(COMMON, "UI"),
      path.join(PACKAGES, "App", "FeatureSet"),
      path.join(PACKAGES, "MobileApp"),
    ];
    const importers: Array<string> = frontends
      .flatMap(sourceFiles)
      .filter((file: string): boolean => {
        return (
          !file.endsWith("WebsiteLanguageRegistry.ts") &&
          fs.readFileSync(file, "utf8").includes(WEBSITE_REGISTRY)
        );
      })
      .map((file: string): string => {
        return path.relative(PACKAGES, file);
      });

    expect(importers).toEqual([]);
  });
});
