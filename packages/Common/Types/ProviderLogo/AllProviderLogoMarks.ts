import ProviderLogo from "./ProviderLogo";
import { ProviderLogoMarkShapes } from "./ProviderLogoMark";
import CloudflareMark from "./Marks/cloudflare";
import BackblazeMark from "./Marks/backblaze";
import WasabiMark from "./Marks/wasabi";
import MinIOMark from "./Marks/minio";
import MicrosoftDefenderMark from "./Marks/microsoft-defender";
import SplunkMark from "./Marks/splunk";
import ElasticMark from "./Marks/elastic";
import OktaMark from "./Marks/okta";
import MicrosoftEntraIdMark from "./Marks/microsoft-entra-id";
import GoogleWorkspaceMark from "./Marks/google-workspace";
import AzureMark from "./Marks/azure";
import GoogleCloudMark from "./Marks/google-cloud";
import OpenAIMark from "./Marks/openai";
import AnthropicMark from "./Marks/anthropic";
import ClaudeMark from "./Marks/claude";
import MistralAIMark from "./Marks/mistral-ai";
import OllamaMark from "./Marks/ollama";
import GoogleCalendarMark from "./Marks/google-calendar";
import CiscoMark from "./Marks/cisco";
import ZoomMark from "./Marks/zoom";
import GoogleMeetMark from "./Marks/google-meet";
import MicrosoftTeamsMark from "./Marks/microsoft-teams";
import SlackMark from "./Marks/slack";
import DiscordMark from "./Marks/discord";
import TelegramMark from "./Marks/telegram";
import MattermostMark from "./Marks/mattermost";
import OpsgenieMark from "./Marks/opsgenie";
import PagerDutyMark from "./Marks/pagerduty";
import IncidentIoMark from "./Marks/incident-io";
import GrafanaMark from "./Marks/grafana";
import AtlassianStatuspageMark from "./Marks/atlassian-statuspage";
import BetterStackMark from "./Marks/better-stack";
import PingdomMark from "./Marks/pingdom";
import UptimeKumaMark from "./Marks/uptime-kuma";
import UptimeRobotMark from "./Marks/uptimerobot";
import StatusCakeMark from "./Marks/statuscake";
import OpenTelemetryMark from "./Marks/opentelemetry";
import FluentBitMark from "./Marks/fluent-bit";
import FluentdMark from "./Marks/fluentd";
import KubernetesMark from "./Marks/kubernetes";
import NodeJsMark from "./Marks/nodejs";
import PythonMark from "./Marks/python";
import GoMark from "./Marks/go";
import JavaMark from "./Marks/java";
import DotNetMark from "./Marks/dotnet";
import RustMark from "./Marks/rust";
import PhpMark from "./Marks/php";
import RubyMark from "./Marks/ruby";
import ElixirMark from "./Marks/elixir";
import CPlusPlusMark from "./Marks/cplusplus";
import SwiftMark from "./Marks/swift";
import ReactMark from "./Marks/react";
import AngularMark from "./Marks/angular";
import ExpressMark from "./Marks/express";
import NestJsMark from "./Marks/nestjs";
import NextJsMark from "./Marks/nextjs";
import FastifyMark from "./Marks/fastify";
import KoaMark from "./Marks/koa";
import HapiMark from "./Marks/hapi";
import BunMark from "./Marks/bun";
import DenoMark from "./Marks/deno";
import DjangoMark from "./Marks/django";
import FlaskMark from "./Marks/flask";
import FastAPIMark from "./Marks/fastapi";
import CeleryMark from "./Marks/celery";
import SpringBootMark from "./Marks/spring-boot";
import QuarkusMark from "./Marks/quarkus";
import KotlinMark from "./Marks/kotlin";
import KtorMark from "./Marks/ktor";
import GinMark from "./Marks/gin";
import RailsMark from "./Marks/rails";
import SinatraMark from "./Marks/sinatra";
import SidekiqMark from "./Marks/sidekiq";
import SlimMark from "./Marks/slim";
import ActixWebMark from "./Marks/actix-web";
import PhoenixMark from "./Marks/phoenix";
import DatadogMark from "./Marks/datadog";
import NewRelicMark from "./Marks/new-relic";
import DynatraceMark from "./Marks/dynatrace";
import SentryMark from "./Marks/sentry";
import InstatusMark from "./Marks/instatus";
import PrometheusMark from "./Marks/prometheus";
import WhatsAppMark from "./Marks/whatsapp";
import DockerMark from "./Marks/docker";
import TerraformMark from "./Marks/terraform";
import ProxmoxMark from "./Marks/proxmox";
import CephMark from "./Marks/ceph";
import GitHubMark from "./Marks/github";
import GitLabMark from "./Marks/gitlab";
import ForgejoMark from "./Marks/forgejo";
import GiteaMark from "./Marks/gitea";
import GitMark from "./Marks/git";

/*
 * EVERY MARK'S SHAPES AT ONCE - for the server (the website draws the marks
 * into its pages) and for tests. Never imported by a frontend: a page loads
 * each mark on its own, the first time it draws it
 * (Common/UI/Components/ProviderLogo/ProviderLogoMarkLoader.ts), and the
 * guards in Tests/UI/Components/ProviderLogo hold the frontends to that.
 */
const ALL_PROVIDER_LOGO_MARKS: Readonly<
  Partial<Record<ProviderLogo, ProviderLogoMarkShapes>>
> = {
  [ProviderLogo.Cloudflare]: CloudflareMark,
  [ProviderLogo.Backblaze]: BackblazeMark,
  [ProviderLogo.Wasabi]: WasabiMark,
  [ProviderLogo.MinIO]: MinIOMark,
  [ProviderLogo.MicrosoftDefender]: MicrosoftDefenderMark,
  [ProviderLogo.Splunk]: SplunkMark,
  [ProviderLogo.Elastic]: ElasticMark,
  [ProviderLogo.Okta]: OktaMark,
  [ProviderLogo.MicrosoftEntraId]: MicrosoftEntraIdMark,
  [ProviderLogo.GoogleWorkspace]: GoogleWorkspaceMark,
  [ProviderLogo.Azure]: AzureMark,
  [ProviderLogo.GoogleCloud]: GoogleCloudMark,
  [ProviderLogo.OpenAI]: OpenAIMark,
  [ProviderLogo.Anthropic]: AnthropicMark,
  [ProviderLogo.Claude]: ClaudeMark,
  [ProviderLogo.MistralAI]: MistralAIMark,
  [ProviderLogo.Ollama]: OllamaMark,
  [ProviderLogo.GoogleCalendar]: GoogleCalendarMark,
  [ProviderLogo.Cisco]: CiscoMark,
  [ProviderLogo.Zoom]: ZoomMark,
  [ProviderLogo.GoogleMeet]: GoogleMeetMark,
  [ProviderLogo.MicrosoftTeams]: MicrosoftTeamsMark,
  [ProviderLogo.Slack]: SlackMark,
  [ProviderLogo.Discord]: DiscordMark,
  [ProviderLogo.Telegram]: TelegramMark,
  [ProviderLogo.Mattermost]: MattermostMark,
  [ProviderLogo.Opsgenie]: OpsgenieMark,
  [ProviderLogo.PagerDuty]: PagerDutyMark,
  [ProviderLogo.IncidentIo]: IncidentIoMark,
  [ProviderLogo.Grafana]: GrafanaMark,
  [ProviderLogo.AtlassianStatuspage]: AtlassianStatuspageMark,
  [ProviderLogo.BetterStack]: BetterStackMark,
  [ProviderLogo.Pingdom]: PingdomMark,
  [ProviderLogo.UptimeKuma]: UptimeKumaMark,
  [ProviderLogo.UptimeRobot]: UptimeRobotMark,
  [ProviderLogo.StatusCake]: StatusCakeMark,
  [ProviderLogo.OpenTelemetry]: OpenTelemetryMark,
  [ProviderLogo.FluentBit]: FluentBitMark,
  [ProviderLogo.Fluentd]: FluentdMark,
  [ProviderLogo.Kubernetes]: KubernetesMark,
  [ProviderLogo.NodeJs]: NodeJsMark,
  [ProviderLogo.Python]: PythonMark,
  [ProviderLogo.Go]: GoMark,
  [ProviderLogo.Java]: JavaMark,
  [ProviderLogo.DotNet]: DotNetMark,
  [ProviderLogo.Rust]: RustMark,
  [ProviderLogo.Php]: PhpMark,
  [ProviderLogo.Ruby]: RubyMark,
  [ProviderLogo.Elixir]: ElixirMark,
  [ProviderLogo.CPlusPlus]: CPlusPlusMark,
  [ProviderLogo.Swift]: SwiftMark,
  [ProviderLogo.React]: ReactMark,
  [ProviderLogo.Angular]: AngularMark,
  [ProviderLogo.Express]: ExpressMark,
  [ProviderLogo.NestJs]: NestJsMark,
  [ProviderLogo.NextJs]: NextJsMark,
  [ProviderLogo.Fastify]: FastifyMark,
  [ProviderLogo.Koa]: KoaMark,
  [ProviderLogo.Hapi]: HapiMark,
  [ProviderLogo.Bun]: BunMark,
  [ProviderLogo.Deno]: DenoMark,
  [ProviderLogo.Django]: DjangoMark,
  [ProviderLogo.Flask]: FlaskMark,
  [ProviderLogo.FastAPI]: FastAPIMark,
  [ProviderLogo.Celery]: CeleryMark,
  [ProviderLogo.SpringBoot]: SpringBootMark,
  [ProviderLogo.Quarkus]: QuarkusMark,
  [ProviderLogo.Kotlin]: KotlinMark,
  [ProviderLogo.Ktor]: KtorMark,
  [ProviderLogo.Gin]: GinMark,
  [ProviderLogo.Rails]: RailsMark,
  [ProviderLogo.Sinatra]: SinatraMark,
  [ProviderLogo.Sidekiq]: SidekiqMark,
  [ProviderLogo.Slim]: SlimMark,
  [ProviderLogo.ActixWeb]: ActixWebMark,
  [ProviderLogo.Phoenix]: PhoenixMark,
  [ProviderLogo.Datadog]: DatadogMark,
  [ProviderLogo.NewRelic]: NewRelicMark,
  [ProviderLogo.Dynatrace]: DynatraceMark,
  [ProviderLogo.Sentry]: SentryMark,
  [ProviderLogo.Instatus]: InstatusMark,
  [ProviderLogo.Prometheus]: PrometheusMark,
  [ProviderLogo.WhatsApp]: WhatsAppMark,
  [ProviderLogo.Docker]: DockerMark,
  [ProviderLogo.Terraform]: TerraformMark,
  [ProviderLogo.Proxmox]: ProxmoxMark,
  [ProviderLogo.Ceph]: CephMark,
  [ProviderLogo.GitHub]: GitHubMark,
  [ProviderLogo.GitLab]: GitLabMark,
  [ProviderLogo.Forgejo]: ForgejoMark,
  [ProviderLogo.Gitea]: GiteaMark,
  [ProviderLogo.Git]: GitMark,
};

export default ALL_PROVIDER_LOGO_MARKS;
