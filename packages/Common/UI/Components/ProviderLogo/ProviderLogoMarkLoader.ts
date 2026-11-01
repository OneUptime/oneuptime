import ProviderLogo from "../../../Types/ProviderLogo/ProviderLogo";
import { ProviderLogoMarkShapes } from "../../../Types/ProviderLogo/ProviderLogoMark";

/*
 * Where each mark's shapes are: one module per mark in
 * Common/Types/ProviderLogo/Marks, loaded on its own the first time a page
 * draws the mark (the bundler makes a small file of every module the
 * loaders name), so a page carries only the marks it shows. A mark loaded
 * once is drawn at once after that.
 *
 * Every mark is part of the installation: nothing is fetched from another
 * address, so an installation without the internet draws every one.
 */

// What the bundler makes of a mark's module.
type ProviderLogoMarkModule = { default: ProviderLogoMarkShapes };

type ProviderLogoMarkLoader = () => Promise<ProviderLogoMarkModule>;

/*
 * One loader per mark, each naming its module in full: the bundler can only
 * split out a module whose name it can read. Kept in step with the Marks
 * folder by Tests/UI/Components/ProviderLogo/ProviderLogoMarkLoader.test.ts.
 */
export const PROVIDER_LOGO_MARK_LOADERS: Readonly<
  Partial<Record<ProviderLogo, ProviderLogoMarkLoader>>
> = {
  [ProviderLogo.Cloudflare]: () => {
    return import("../../../Types/ProviderLogo/Marks/cloudflare");
  },
  [ProviderLogo.Backblaze]: () => {
    return import("../../../Types/ProviderLogo/Marks/backblaze");
  },
  [ProviderLogo.Wasabi]: () => {
    return import("../../../Types/ProviderLogo/Marks/wasabi");
  },
  [ProviderLogo.MinIO]: () => {
    return import("../../../Types/ProviderLogo/Marks/minio");
  },
  [ProviderLogo.MicrosoftDefender]: () => {
    return import("../../../Types/ProviderLogo/Marks/microsoft-defender");
  },
  [ProviderLogo.Splunk]: () => {
    return import("../../../Types/ProviderLogo/Marks/splunk");
  },
  [ProviderLogo.Elastic]: () => {
    return import("../../../Types/ProviderLogo/Marks/elastic");
  },
  [ProviderLogo.Okta]: () => {
    return import("../../../Types/ProviderLogo/Marks/okta");
  },
  [ProviderLogo.MicrosoftEntraId]: () => {
    return import("../../../Types/ProviderLogo/Marks/microsoft-entra-id");
  },
  [ProviderLogo.GoogleWorkspace]: () => {
    return import("../../../Types/ProviderLogo/Marks/google-workspace");
  },
  [ProviderLogo.Azure]: () => {
    return import("../../../Types/ProviderLogo/Marks/azure");
  },
  [ProviderLogo.GoogleCloud]: () => {
    return import("../../../Types/ProviderLogo/Marks/google-cloud");
  },
  [ProviderLogo.OpenAI]: () => {
    return import("../../../Types/ProviderLogo/Marks/openai");
  },
  [ProviderLogo.Anthropic]: () => {
    return import("../../../Types/ProviderLogo/Marks/anthropic");
  },
  [ProviderLogo.Claude]: () => {
    return import("../../../Types/ProviderLogo/Marks/claude");
  },
  [ProviderLogo.MistralAI]: () => {
    return import("../../../Types/ProviderLogo/Marks/mistral-ai");
  },
  [ProviderLogo.Ollama]: () => {
    return import("../../../Types/ProviderLogo/Marks/ollama");
  },
  [ProviderLogo.GoogleCalendar]: () => {
    return import("../../../Types/ProviderLogo/Marks/google-calendar");
  },
  [ProviderLogo.Cisco]: () => {
    return import("../../../Types/ProviderLogo/Marks/cisco");
  },
  [ProviderLogo.Zoom]: () => {
    return import("../../../Types/ProviderLogo/Marks/zoom");
  },
  [ProviderLogo.GoogleMeet]: () => {
    return import("../../../Types/ProviderLogo/Marks/google-meet");
  },
  [ProviderLogo.MicrosoftTeams]: () => {
    return import("../../../Types/ProviderLogo/Marks/microsoft-teams");
  },
  [ProviderLogo.Slack]: () => {
    return import("../../../Types/ProviderLogo/Marks/slack");
  },
  [ProviderLogo.Discord]: () => {
    return import("../../../Types/ProviderLogo/Marks/discord");
  },
  [ProviderLogo.Telegram]: () => {
    return import("../../../Types/ProviderLogo/Marks/telegram");
  },
  [ProviderLogo.Mattermost]: () => {
    return import("../../../Types/ProviderLogo/Marks/mattermost");
  },
  [ProviderLogo.Opsgenie]: () => {
    return import("../../../Types/ProviderLogo/Marks/opsgenie");
  },
  [ProviderLogo.PagerDuty]: () => {
    return import("../../../Types/ProviderLogo/Marks/pagerduty");
  },
  [ProviderLogo.IncidentIo]: () => {
    return import("../../../Types/ProviderLogo/Marks/incident-io");
  },
  [ProviderLogo.Grafana]: () => {
    return import("../../../Types/ProviderLogo/Marks/grafana");
  },
  [ProviderLogo.AtlassianStatuspage]: () => {
    return import("../../../Types/ProviderLogo/Marks/atlassian-statuspage");
  },
  [ProviderLogo.BetterStack]: () => {
    return import("../../../Types/ProviderLogo/Marks/better-stack");
  },
  [ProviderLogo.Pingdom]: () => {
    return import("../../../Types/ProviderLogo/Marks/pingdom");
  },
  [ProviderLogo.UptimeKuma]: () => {
    return import("../../../Types/ProviderLogo/Marks/uptime-kuma");
  },
  [ProviderLogo.UptimeRobot]: () => {
    return import("../../../Types/ProviderLogo/Marks/uptimerobot");
  },
  [ProviderLogo.StatusCake]: () => {
    return import("../../../Types/ProviderLogo/Marks/statuscake");
  },
  [ProviderLogo.OpenTelemetry]: () => {
    return import("../../../Types/ProviderLogo/Marks/opentelemetry");
  },
  [ProviderLogo.FluentBit]: () => {
    return import("../../../Types/ProviderLogo/Marks/fluent-bit");
  },
  [ProviderLogo.Fluentd]: () => {
    return import("../../../Types/ProviderLogo/Marks/fluentd");
  },
  [ProviderLogo.Kubernetes]: () => {
    return import("../../../Types/ProviderLogo/Marks/kubernetes");
  },
  [ProviderLogo.NodeJs]: () => {
    return import("../../../Types/ProviderLogo/Marks/nodejs");
  },
  [ProviderLogo.Python]: () => {
    return import("../../../Types/ProviderLogo/Marks/python");
  },
  [ProviderLogo.Go]: () => {
    return import("../../../Types/ProviderLogo/Marks/go");
  },
  [ProviderLogo.Java]: () => {
    return import("../../../Types/ProviderLogo/Marks/java");
  },
  [ProviderLogo.DotNet]: () => {
    return import("../../../Types/ProviderLogo/Marks/dotnet");
  },
  [ProviderLogo.Rust]: () => {
    return import("../../../Types/ProviderLogo/Marks/rust");
  },
  [ProviderLogo.Php]: () => {
    return import("../../../Types/ProviderLogo/Marks/php");
  },
  [ProviderLogo.Ruby]: () => {
    return import("../../../Types/ProviderLogo/Marks/ruby");
  },
  [ProviderLogo.Elixir]: () => {
    return import("../../../Types/ProviderLogo/Marks/elixir");
  },
  [ProviderLogo.CPlusPlus]: () => {
    return import("../../../Types/ProviderLogo/Marks/cplusplus");
  },
  [ProviderLogo.Swift]: () => {
    return import("../../../Types/ProviderLogo/Marks/swift");
  },
  [ProviderLogo.React]: () => {
    return import("../../../Types/ProviderLogo/Marks/react");
  },
  [ProviderLogo.Angular]: () => {
    return import("../../../Types/ProviderLogo/Marks/angular");
  },
  [ProviderLogo.Express]: () => {
    return import("../../../Types/ProviderLogo/Marks/express");
  },
  [ProviderLogo.NestJs]: () => {
    return import("../../../Types/ProviderLogo/Marks/nestjs");
  },
  [ProviderLogo.NextJs]: () => {
    return import("../../../Types/ProviderLogo/Marks/nextjs");
  },
  [ProviderLogo.Fastify]: () => {
    return import("../../../Types/ProviderLogo/Marks/fastify");
  },
  [ProviderLogo.Koa]: () => {
    return import("../../../Types/ProviderLogo/Marks/koa");
  },
  [ProviderLogo.Hapi]: () => {
    return import("../../../Types/ProviderLogo/Marks/hapi");
  },
  [ProviderLogo.Bun]: () => {
    return import("../../../Types/ProviderLogo/Marks/bun");
  },
  [ProviderLogo.Deno]: () => {
    return import("../../../Types/ProviderLogo/Marks/deno");
  },
  [ProviderLogo.Django]: () => {
    return import("../../../Types/ProviderLogo/Marks/django");
  },
  [ProviderLogo.Flask]: () => {
    return import("../../../Types/ProviderLogo/Marks/flask");
  },
  [ProviderLogo.FastAPI]: () => {
    return import("../../../Types/ProviderLogo/Marks/fastapi");
  },
  [ProviderLogo.Celery]: () => {
    return import("../../../Types/ProviderLogo/Marks/celery");
  },
  [ProviderLogo.SpringBoot]: () => {
    return import("../../../Types/ProviderLogo/Marks/spring-boot");
  },
  [ProviderLogo.Quarkus]: () => {
    return import("../../../Types/ProviderLogo/Marks/quarkus");
  },
  [ProviderLogo.Kotlin]: () => {
    return import("../../../Types/ProviderLogo/Marks/kotlin");
  },
  [ProviderLogo.Ktor]: () => {
    return import("../../../Types/ProviderLogo/Marks/ktor");
  },
  [ProviderLogo.Gin]: () => {
    return import("../../../Types/ProviderLogo/Marks/gin");
  },
  [ProviderLogo.Rails]: () => {
    return import("../../../Types/ProviderLogo/Marks/rails");
  },
  [ProviderLogo.Sinatra]: () => {
    return import("../../../Types/ProviderLogo/Marks/sinatra");
  },
  [ProviderLogo.Sidekiq]: () => {
    return import("../../../Types/ProviderLogo/Marks/sidekiq");
  },
  [ProviderLogo.Slim]: () => {
    return import("../../../Types/ProviderLogo/Marks/slim");
  },
  [ProviderLogo.ActixWeb]: () => {
    return import("../../../Types/ProviderLogo/Marks/actix-web");
  },
  [ProviderLogo.Phoenix]: () => {
    return import("../../../Types/ProviderLogo/Marks/phoenix");
  },
  [ProviderLogo.WhatsApp]: () => {
    return import("../../../Types/ProviderLogo/Marks/whatsapp");
  },
  [ProviderLogo.Docker]: () => {
    return import("../../../Types/ProviderLogo/Marks/docker");
  },
  [ProviderLogo.Terraform]: () => {
    return import("../../../Types/ProviderLogo/Marks/terraform");
  },
  [ProviderLogo.Proxmox]: () => {
    return import("../../../Types/ProviderLogo/Marks/proxmox");
  },
  [ProviderLogo.Ceph]: () => {
    return import("../../../Types/ProviderLogo/Marks/ceph");
  },
  [ProviderLogo.GitHub]: () => {
    return import("../../../Types/ProviderLogo/Marks/github");
  },
  [ProviderLogo.GitLab]: () => {
    return import("../../../Types/ProviderLogo/Marks/gitlab");
  },
  [ProviderLogo.Forgejo]: () => {
    return import("../../../Types/ProviderLogo/Marks/forgejo");
  },
  [ProviderLogo.Gitea]: () => {
    return import("../../../Types/ProviderLogo/Marks/gitea");
  },
  [ProviderLogo.Git]: () => {
    return import("../../../Types/ProviderLogo/Marks/git");
  },
};

const loadedMarks: Map<ProviderLogo, ProviderLogoMarkShapes> = new Map();
const loadingMarks: Map<
  ProviderLogo,
  Promise<ProviderLogoMarkShapes | undefined>
> = new Map();

// A mark's shapes, when they have been loaded already.
export function getLoadedProviderLogoMark(
  mark: ProviderLogo,
): ProviderLogoMarkShapes | undefined {
  return loadedMarks.get(mark);
}

function isMarkShapes(value: unknown): value is ProviderLogoMarkShapes {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((shape: unknown): boolean => {
      return (
        typeof shape === "object" &&
        shape !== null &&
        typeof (shape as { d?: unknown }).d === "string"
      );
    })
  );
}

/*
 * Loads a mark once, however many places ask for it at the same time. A
 * mark that failed to load (a dropped connection) is asked for again the
 * next time it is drawn; until then its tile is drawn without it.
 */
export function loadProviderLogoMark(
  mark: ProviderLogo,
): Promise<ProviderLogoMarkShapes | undefined> {
  const loaded: ProviderLogoMarkShapes | undefined = loadedMarks.get(mark);

  if (loaded) {
    return Promise.resolve(loaded);
  }

  const loading: Promise<ProviderLogoMarkShapes | undefined> | undefined =
    loadingMarks.get(mark);

  if (loading) {
    return loading;
  }

  const loader: ProviderLogoMarkLoader | undefined =
    PROVIDER_LOGO_MARK_LOADERS[mark];

  if (!loader) {
    return Promise.resolve(undefined);
  }

  const promise: Promise<ProviderLogoMarkShapes | undefined> = loader()
    .then(
      (module: ProviderLogoMarkModule): ProviderLogoMarkShapes | undefined => {
        const shapes: unknown = module.default;

        if (!isMarkShapes(shapes)) {
          return undefined;
        }

        loadedMarks.set(mark, shapes);
        return shapes;
      },
    )
    .catch((): undefined => {
      return undefined;
    })
    .finally((): void => {
      loadingMarks.delete(mark);
    });

  loadingMarks.set(mark, promise);
  return promise;
}
