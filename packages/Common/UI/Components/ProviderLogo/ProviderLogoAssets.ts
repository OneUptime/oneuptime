import ProviderLogo from "../../../Types/ProviderLogo/ProviderLogo";

/*
 * Where each logo's image is: one SVG file per logo in
 * Common/UI/Images/ProviderLogos, named as the logo is, and a "-dark" file
 * beside it for a brand whose mark would all but disappear on the dark
 * theme's surface (OpenAI's black knot, the dark lettering of the AWS logo):
 * the mark that brand draws on dark backgrounds - its own reversed logo, or
 * its one-colour mark in white. Where each file comes from, and the rules
 * its brand sets for using it, are in that folder's README.
 *
 * Every file is part of the installation: nothing is fetched from another
 * address, so an installation without the internet draws every logo. Each
 * one is loaded by itself, the first time a page draws it (the bundler makes
 * a small file of every image the loaders name), so a page carries only the
 * logos it shows. A logo loaded once is drawn at once after that.
 */

/*
 * The logos that are wider than they are tall - a wordmark, as AWS's,
 * Splunk's, Zoom's, Cisco's and Go's are, or Cloudflare's cloud: drawn
 * across the tile's whole inside, so they are as large as the square ones
 * beside them instead of shrunk to fit a square. A file's viewBox is fitted
 * to what it draws, so its proportions are the logo's own (the tests hold
 * this list to them).
 */
export const WIDE_PROVIDER_LOGOS: ReadonlyArray<ProviderLogo> = [
  ProviderLogo.Aws,
  ProviderLogo.Cloudflare,
  ProviderLogo.Splunk,
  ProviderLogo.Zoom,
  ProviderLogo.Cisco,
  ProviderLogo.Go,
  ProviderLogo.Php,
  ProviderLogo.Fastify,
  ProviderLogo.Koa,
  ProviderLogo.Hapi,
];

export function getProviderLogoFileName(
  logo: ProviderLogo,
  isDarkMark: boolean,
): string {
  return `${logo}${isDarkMark ? "-dark" : ""}.svg`;
}

/*
 * Whether the brand has a mark of its own for dark backgrounds: whether its
 * "-dark" file is there. The files are the one list of them.
 */
export function hasDarkProviderLogoMark(logo: ProviderLogo): boolean {
  return Boolean(
    PROVIDER_LOGO_FILE_LOADERS[getProviderLogoFileName(logo, true)],
  );
}

export function isWideProviderLogo(logo: ProviderLogo): boolean {
  return WIDE_PROVIDER_LOGOS.includes(logo);
}

// What the bundler makes of an image: a module whose default is its address.
type ProviderLogoFileModule = { default: unknown };

type ProviderLogoFileLoader = () => Promise<ProviderLogoFileModule>;

/*
 * One loader per file, each naming its file in full: the bundler can only
 * split out an image whose name it can read. Kept in step with the folder by
 * Tests/UI/Components/ProviderLogo/ProviderLogoAssets.test.ts.
 */
export const PROVIDER_LOGO_FILE_LOADERS: Readonly<
  Record<string, ProviderLogoFileLoader>
> = {
  "amazon-bedrock.svg": () => {
    return import("../../Images/ProviderLogos/amazon-bedrock.svg");
  },
  "amazon-s3.svg": () => {
    return import("../../Images/ProviderLogos/amazon-s3.svg");
  },
  "angular.svg": () => {
    return import("../../Images/ProviderLogos/angular.svg");
  },
  "anthropic-dark.svg": () => {
    return import("../../Images/ProviderLogos/anthropic-dark.svg");
  },
  "anthropic.svg": () => {
    return import("../../Images/ProviderLogos/anthropic.svg");
  },
  "atlassian-statuspage.svg": () => {
    return import("../../Images/ProviderLogos/atlassian-statuspage.svg");
  },
  "aws-dark.svg": () => {
    return import("../../Images/ProviderLogos/aws-dark.svg");
  },
  "aws-security-hub.svg": () => {
    return import("../../Images/ProviderLogos/aws-security-hub.svg");
  },
  "aws.svg": () => {
    return import("../../Images/ProviderLogos/aws.svg");
  },
  "azure-blob-storage.svg": () => {
    return import("../../Images/ProviderLogos/azure-blob-storage.svg");
  },
  "azure-openai.svg": () => {
    return import("../../Images/ProviderLogos/azure-openai.svg");
  },
  "azure.svg": () => {
    return import("../../Images/ProviderLogos/azure.svg");
  },
  "backblaze.svg": () => {
    return import("../../Images/ProviderLogos/backblaze.svg");
  },
  "better-stack-dark.svg": () => {
    return import("../../Images/ProviderLogos/better-stack-dark.svg");
  },
  "better-stack.svg": () => {
    return import("../../Images/ProviderLogos/better-stack.svg");
  },
  "bun.svg": () => {
    return import("../../Images/ProviderLogos/bun.svg");
  },
  "cisco.svg": () => {
    return import("../../Images/ProviderLogos/cisco.svg");
  },
  "claude.svg": () => {
    return import("../../Images/ProviderLogos/claude.svg");
  },
  "cloudflare.svg": () => {
    return import("../../Images/ProviderLogos/cloudflare.svg");
  },
  "cplusplus.svg": () => {
    return import("../../Images/ProviderLogos/cplusplus.svg");
  },
  "crowdstrike-dark.svg": () => {
    return import("../../Images/ProviderLogos/crowdstrike-dark.svg");
  },
  "crowdstrike.svg": () => {
    return import("../../Images/ProviderLogos/crowdstrike.svg");
  },
  "deno.svg": () => {
    return import("../../Images/ProviderLogos/deno.svg");
  },
  "discord.svg": () => {
    return import("../../Images/ProviderLogos/discord.svg");
  },
  "dotnet.svg": () => {
    return import("../../Images/ProviderLogos/dotnet.svg");
  },
  "elastic-dark.svg": () => {
    return import("../../Images/ProviderLogos/elastic-dark.svg");
  },
  "elastic.svg": () => {
    return import("../../Images/ProviderLogos/elastic.svg");
  },
  "elixir.svg": () => {
    return import("../../Images/ProviderLogos/elixir.svg");
  },
  "express-dark.svg": () => {
    return import("../../Images/ProviderLogos/express-dark.svg");
  },
  "express.svg": () => {
    return import("../../Images/ProviderLogos/express.svg");
  },
  "fastify-dark.svg": () => {
    return import("../../Images/ProviderLogos/fastify-dark.svg");
  },
  "fastify.svg": () => {
    return import("../../Images/ProviderLogos/fastify.svg");
  },
  "fluent-bit.svg": () => {
    return import("../../Images/ProviderLogos/fluent-bit.svg");
  },
  "fluentd.svg": () => {
    return import("../../Images/ProviderLogos/fluentd.svg");
  },
  "go.svg": () => {
    return import("../../Images/ProviderLogos/go.svg");
  },
  "google-calendar.svg": () => {
    return import("../../Images/ProviderLogos/google-calendar.svg");
  },
  "google-cloud-storage.svg": () => {
    return import("../../Images/ProviderLogos/google-cloud-storage.svg");
  },
  "google-cloud.svg": () => {
    return import("../../Images/ProviderLogos/google-cloud.svg");
  },
  "google-meet.svg": () => {
    return import("../../Images/ProviderLogos/google-meet.svg");
  },
  "google-security-operations.svg": () => {
    return import("../../Images/ProviderLogos/google-security-operations.svg");
  },
  "google-vertex-ai.svg": () => {
    return import("../../Images/ProviderLogos/google-vertex-ai.svg");
  },
  "grafana.svg": () => {
    return import("../../Images/ProviderLogos/grafana.svg");
  },
  "groq.svg": () => {
    return import("../../Images/ProviderLogos/groq.svg");
  },
  "hapi-dark.svg": () => {
    return import("../../Images/ProviderLogos/hapi-dark.svg");
  },
  "hapi.svg": () => {
    return import("../../Images/ProviderLogos/hapi.svg");
  },
  "incident-io.svg": () => {
    return import("../../Images/ProviderLogos/incident-io.svg");
  },
  "java.svg": () => {
    return import("../../Images/ProviderLogos/java.svg");
  },
  "koa-dark.svg": () => {
    return import("../../Images/ProviderLogos/koa-dark.svg");
  },
  "koa.svg": () => {
    return import("../../Images/ProviderLogos/koa.svg");
  },
  "kubernetes.svg": () => {
    return import("../../Images/ProviderLogos/kubernetes.svg");
  },
  "mattermost-dark.svg": () => {
    return import("../../Images/ProviderLogos/mattermost-dark.svg");
  },
  "mattermost.svg": () => {
    return import("../../Images/ProviderLogos/mattermost.svg");
  },
  "microsoft-copilot-dark.svg": () => {
    return import("../../Images/ProviderLogos/microsoft-copilot-dark.svg");
  },
  "microsoft-copilot.svg": () => {
    return import("../../Images/ProviderLogos/microsoft-copilot.svg");
  },
  "microsoft-defender.svg": () => {
    return import("../../Images/ProviderLogos/microsoft-defender.svg");
  },
  "microsoft-sentinel.svg": () => {
    return import("../../Images/ProviderLogos/microsoft-sentinel.svg");
  },
  "microsoft-teams.svg": () => {
    return import("../../Images/ProviderLogos/microsoft-teams.svg");
  },
  "minio.svg": () => {
    return import("../../Images/ProviderLogos/minio.svg");
  },
  "mistral-ai.svg": () => {
    return import("../../Images/ProviderLogos/mistral-ai.svg");
  },
  "nestjs.svg": () => {
    return import("../../Images/ProviderLogos/nestjs.svg");
  },
  "nextjs.svg": () => {
    return import("../../Images/ProviderLogos/nextjs.svg");
  },
  "nodejs.svg": () => {
    return import("../../Images/ProviderLogos/nodejs.svg");
  },
  "okta-dark.svg": () => {
    return import("../../Images/ProviderLogos/okta-dark.svg");
  },
  "okta.svg": () => {
    return import("../../Images/ProviderLogos/okta.svg");
  },
  "ollama-dark.svg": () => {
    return import("../../Images/ProviderLogos/ollama-dark.svg");
  },
  "ollama.svg": () => {
    return import("../../Images/ProviderLogos/ollama.svg");
  },
  "openai-dark.svg": () => {
    return import("../../Images/ProviderLogos/openai-dark.svg");
  },
  "openai.svg": () => {
    return import("../../Images/ProviderLogos/openai.svg");
  },
  "opentelemetry.svg": () => {
    return import("../../Images/ProviderLogos/opentelemetry.svg");
  },
  "opsgenie.svg": () => {
    return import("../../Images/ProviderLogos/opsgenie.svg");
  },
  "pagerduty.svg": () => {
    return import("../../Images/ProviderLogos/pagerduty.svg");
  },
  "php.svg": () => {
    return import("../../Images/ProviderLogos/php.svg");
  },
  "pingdom.svg": () => {
    return import("../../Images/ProviderLogos/pingdom.svg");
  },
  "python.svg": () => {
    return import("../../Images/ProviderLogos/python.svg");
  },
  "react.svg": () => {
    return import("../../Images/ProviderLogos/react.svg");
  },
  "ruby.svg": () => {
    return import("../../Images/ProviderLogos/ruby.svg");
  },
  "rust-dark.svg": () => {
    return import("../../Images/ProviderLogos/rust-dark.svg");
  },
  "rust.svg": () => {
    return import("../../Images/ProviderLogos/rust.svg");
  },
  "slack.svg": () => {
    return import("../../Images/ProviderLogos/slack.svg");
  },
  "splunk-dark.svg": () => {
    return import("../../Images/ProviderLogos/splunk-dark.svg");
  },
  "splunk.svg": () => {
    return import("../../Images/ProviderLogos/splunk.svg");
  },
  "statuscake.svg": () => {
    return import("../../Images/ProviderLogos/statuscake.svg");
  },
  "swift.svg": () => {
    return import("../../Images/ProviderLogos/swift.svg");
  },
  "telegram.svg": () => {
    return import("../../Images/ProviderLogos/telegram.svg");
  },
  "uptime-kuma.svg": () => {
    return import("../../Images/ProviderLogos/uptime-kuma.svg");
  },
  "uptimerobot.svg": () => {
    return import("../../Images/ProviderLogos/uptimerobot.svg");
  },
  "wasabi.svg": () => {
    return import("../../Images/ProviderLogos/wasabi.svg");
  },
  "zoom-dark.svg": () => {
    return import("../../Images/ProviderLogos/zoom-dark.svg");
  },
  "zoom.svg": () => {
    return import("../../Images/ProviderLogos/zoom.svg");
  },
};

const loadedFiles: Map<string, string> = new Map();
const loadingFiles: Map<string, Promise<string | undefined>> = new Map();

// A file's address, when it has been loaded already.
export function getLoadedProviderLogoFile(
  fileName: string,
): string | undefined {
  return loadedFiles.get(fileName);
}

/*
 * Loads a file once, however many logos ask for it at the same time. An
 * address the bundler did not make (a test's stand-in for images) is no
 * address: the tile is drawn without a mark.
 */
export function loadProviderLogoFile(
  fileName: string,
): Promise<string | undefined> {
  const loaded: string | undefined = loadedFiles.get(fileName);

  if (loaded) {
    return Promise.resolve(loaded);
  }

  const loading: Promise<string | undefined> | undefined =
    loadingFiles.get(fileName);

  if (loading) {
    return loading;
  }

  const loader: ProviderLogoFileLoader | undefined =
    PROVIDER_LOGO_FILE_LOADERS[fileName];

  if (!loader) {
    return Promise.resolve(undefined);
  }

  const promise: Promise<string | undefined> = loader()
    .then((module: ProviderLogoFileModule): string | undefined => {
      const address: unknown = module.default;

      if (typeof address !== "string" || address.length === 0) {
        return undefined;
      }

      loadedFiles.set(fileName, address);
      return address;
    })
    .catch((): undefined => {
      // A file that failed to load (a dropped connection) is asked for again next time.
      return undefined;
    })
    .finally((): void => {
      loadingFiles.delete(fileName);
    });

  loadingFiles.set(fileName, promise);
  return promise;
}
