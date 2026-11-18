import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

const LANGUAGES: Array<string> = [
  "da",
  "de",
  "en",
  "es",
  "fa",
  "fr",
  "hi",
  "it",
  "ja",
  "ko",
  "nl",
  "no",
  "pt",
  "ru",
  "sv",
  "zh-CN",
  "zh-TW",
];

const BASE_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

interface DockerComposeService {
  image?: string;
  container_name?: string;
  restart?: string;
  network_mode?: string;
  pid?: string;
  volumes?: Array<string>;
  environment?: Array<string>;
  command?: Array<string>;
}

interface DockerComposeDoc {
  services?: Record<string, DockerComposeService>;
}

describe("Host OpenTelemetry Collector Docker Compose Documentation (#2462)", () => {
  it("includes a valid docker-compose.yml fence in every supported language", () => {
    for (const lang of LANGUAGES) {
      const docPath: string = path.join(
        BASE_DIR,
        lang,
        "telemetry/host-otel-collector.md",
      );
      expect(fs.existsSync(docPath)).toBe(true);

      const content: string = fs.readFileSync(docPath, "utf8");
      expect(content).toContain('```yaml title="docker-compose.yml"');
      expect(content).toContain("docker compose up -d");

      // Extract the docker-compose code fence
      const match: RegExpMatchArray | null = content.match(
        /```yaml title="docker-compose\.yml"\n([\s\S]*?)\n```/,
      );
      expect(match).not.toBeNull();

      const parsed: DockerComposeDoc = yaml.load(
        match![1] as string,
      ) as DockerComposeDoc;
      expect(parsed).toBeDefined();
      expect(parsed.services).toBeDefined();
      expect(parsed.services!["otel-collector"]).toBeDefined();

      const service: DockerComposeService = parsed.services!["otel-collector"]!;
      expect(service.image).toBe(
        "otel/opentelemetry-collector-contrib:0.161.0",
      );
      expect(service.container_name).toBe("otel-collector");
      expect(service.restart).toBe("unless-stopped");
      expect(service.network_mode).toBe("host");
      expect(service.pid).toBe("host");
      expect(service.volumes).toEqual([
        "./config.yaml:/etc/otelcol-contrib/config.yaml:ro",
        "/:/hostfs:ro,rslave",
      ]);
      expect(service.environment).toEqual([
        "HOST_PROC=/hostfs/proc",
        "HOST_SYS=/hostfs/sys",
        "HOST_ETC=/hostfs/etc",
        "HOST_VAR=/hostfs/var",
        "HOST_RUN=/hostfs/run",
        "HOST_DEV=/hostfs/dev",
      ]);
      expect(service.command).toEqual([
        "--config",
        "/etc/otelcol-contrib/config.yaml",
      ]);
    }
  });
});
