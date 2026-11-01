import IconProp from "../Icon/IconProp";
import ProviderLogo from "./ProviderLogo";

/*
 * HOW EACH PRODUCT IN THE REGISTRY IS DRAWN.
 *
 * Every one is drawn as an icon is - an inline SVG in one colour, the colour
 * of the icons around it - in one of three ways:
 *
 *  1. By its own mark: the brand's official mark, its shapes in one colour
 *     (Marks/<logo>.ts, drawn in the box PROVIDER_LOGO_MARK_BOXES gives it).
 *  2. By its maker's mark, where the product is one of a maker's many and
 *     has no one-colour mark its maker lets others draw: Google Cloud
 *     Storage by Google Cloud's, Azure Blob Storage by Azure's
 *     (PROVIDER_LOGOS_DRAWN_BY_THEIR_MAKERS_MARK).
 *  3. By one of OneUptime's own icons, where the brand's rules allow no logo
 *     in a product like this, or none in one colour: Amazon Web Services
 *     asks to be named in plain text only, and never recoloured;
 *     Groq licenses its logo to partners only; CrowdStrike asks for written
 *     consent; Microsoft lets others draw only its own artwork, and has no
 *     one-colour Copilot mark (PROVIDER_LOGO_STAND_IN_ICONS). The product's
 *     name is always written beside it, so it is still recognised.
 *
 * The README beside this file says where every mark comes from and what its
 * brand asks. React-free and free of the shapes themselves (each mark is
 * loaded on its own, the first time a page draws it), so the box of every
 * mark is known before its shapes arrive and nothing moves when they do.
 */

/*
 * The box each mark's shapes are drawn in ("x y width height"): fitted to
 * the drawing, so its proportions are the mark's own - a square symbol is
 * square, a wordmark (Zoom's, Splunk's) as wide as it is. Kept in step with
 * the Marks folder by Tests/Types/ProviderLogo/ProviderLogoMarks.test.ts.
 */
export const PROVIDER_LOGO_MARK_BOXES: Readonly<
  Partial<Record<ProviderLogo, string>>
> = {
  [ProviderLogo.Cloudflare]: "0 6.573 24.001 10.854",
  [ProviderLogo.Backblaze]: "4.736 0 14.528 24.001",
  [ProviderLogo.Wasabi]: "-0.001 -0.001 24.002 24.002",
  [ProviderLogo.MinIO]: "5.756 0 12.488 24",
  [ProviderLogo.MicrosoftDefender]: "-0.031 0 1920.031 2048",
  [ProviderLogo.Splunk]: "-0.001 8.439 24.001 7.121",
  [ProviderLogo.Elastic]: "-0.001 0.046 24.002 23.908",
  [ProviderLogo.Okta]: "0 0 24 24",
  [ProviderLogo.MicrosoftEntraId]: "0 140 2048 1768",
  [ProviderLogo.GoogleWorkspace]: "0.306 0 23.388 24",
  [ProviderLogo.Azure]: "0 230 2048 1588",
  [ProviderLogo.GoogleCloud]: "0 2.377 24 19.247",
  [ProviderLogo.OpenAI]: "-0.001 0.001 256.001 259.527",
  [ProviderLogo.Anthropic]: "0 3.54 24 16.92",
  [ProviderLogo.Claude]: "0.009 0 23.982 24",
  [ProviderLogo.MistralAI]: "0 3.428 24 17.144",
  [ProviderLogo.Ollama]: "2.92 -0.001 18.159 24.001",
  [ProviderLogo.GoogleCalendar]: "-0.001 -0.001 24.001 24.001",
  [ProviderLogo.Cisco]: "0 5.672 24 12.653",
  [ProviderLogo.Zoom]: "0 9.271 24 5.459",
  [ProviderLogo.GoogleMeet]: "0 2.111 24 19.778",
  [ProviderLogo.MicrosoftTeams]: "0 85 2048 1899",
  [ProviderLogo.Slack]: "0 0 255.392 255.189",
  [ProviderLogo.Discord]: "-0.001 2.853 24.002 18.294",
  [ProviderLogo.Telegram]: "0 -0.001 24 24.001",
  [ProviderLogo.Mattermost]: "0 -0.001 24.001 24.001",
  [ProviderLogo.WhatsApp]: "0.057 -0.001 23.887 24.002",
  [ProviderLogo.Opsgenie]: "1.927 -0.001 20.146 24.001",
  [ProviderLogo.PagerDuty]: "3.73 0 16.541 24",
  [ProviderLogo.IncidentIo]: "-0.001 0 256.002 345.15",
  [ProviderLogo.Grafana]: "0.953 0 22.095 24",
  [ProviderLogo.AtlassianStatuspage]: "0 3.158 24.001 17.685",
  [ProviderLogo.BetterStack]: "-0.001 2.482 24.002 19.036",
  [ProviderLogo.Pingdom]: "0 2.35 24 19.3",
  [ProviderLogo.UptimeKuma]: "0 0.955 24.001 22.09",
  [ProviderLogo.UptimeRobot]: "0 0 180 180",
  [ProviderLogo.StatusCake]: "17.25 15.596 161.838 250.04",
  [ProviderLogo.OpenTelemetry]: "0.001 -0.001 23.998 24.002",
  [ProviderLogo.FluentBit]: "0 3.516 24 16.967",
  [ProviderLogo.Fluentd]: "0 2.194 24 19.611",
  [ProviderLogo.Kubernetes]: "0 0.356 24.001 23.289",
  [ProviderLogo.NodeJs]: "1.358 -0.001 21.283 24.001",
  [ProviderLogo.Python]: "-0.06 0 24.121 24",
  [ProviderLogo.Go]: "-0.001 7.516 24.002 8.967",
  [ProviderLogo.Java]: "2.331 0 19.338 24",
  [ProviderLogo.DotNet]: "-0.001 7.528 24.001 8.944",
  [ProviderLogo.Rust]: "0 0.003 24 23.993",
  [ProviderLogo.Php]: "0 5.688 24 12.626",
  [ProviderLogo.Ruby]: "0 0.073 24 23.854",
  [ProviderLogo.Elixir]: "4.206 0 15.588 24.002",
  [ProviderLogo.CPlusPlus]: "1.336 -0.001 21.327 24.001",
  [ProviderLogo.Swift]: "0 0 24.001 24.001",
  [ProviderLogo.React]: "0 1.313 24 21.377",
  [ProviderLogo.Angular]: "0.662 0 22.676 24",
  [ProviderLogo.Express]: "0 3.227 24 17.545",
  [ProviderLogo.NestJs]: "-0.001 0.047 24.002 23.907",
  [ProviderLogo.NextJs]: "0 0 24 24",
  [ProviderLogo.Fastify]: "0 4.301 24.001 15.398",
  [ProviderLogo.Koa]: "0 5.586 24 12.827",
  [ProviderLogo.Hapi]: "0 -0.001 511.575 350.277",
  [ProviderLogo.Bun]: "0 1.404 24 21.193",
  [ProviderLogo.Deno]: "-0.001 0.983 24.002 22.033",
  [ProviderLogo.Django]: "2.685 0 18.629 24",
  [ProviderLogo.Flask]: "-0.001 2.499 24.001 19.001",
  [ProviderLogo.FastAPI]: "-0.001 0.038 24.001 23.924",
  [ProviderLogo.Celery]: "-0.001 -0.001 24.002 24.002",
  [ProviderLogo.SpringBoot]: "-0.001 1.227 24.001 21.546",
  [ProviderLogo.Quarkus]: "0 0 24 24",
  [ProviderLogo.Kotlin]: "0 0 24 24",
  [ProviderLogo.Ktor]: "0 0 24 24",
  [ProviderLogo.Gin]: "3.468 -0.001 17.064 24.002",
  [ProviderLogo.Rails]: "0 4.635 24 14.73",
  [ProviderLogo.Sinatra]: "-0.001 4.115 24.001 15.769",
  [ProviderLogo.Sidekiq]: "0 0 24 24",
  [ProviderLogo.Slim]: "0 11 256 250.982",
  [ProviderLogo.ActixWeb]: "0 0.078 24.001 23.844",
  [ProviderLogo.Phoenix]: "0 3.798 24 16.404",
  [ProviderLogo.Docker]: "-0.001 3.388 24.002 17.224",
  [ProviderLogo.Terraform]: "1.44 0 21.121 24",
  [ProviderLogo.Proxmox]: "0 1.547 24.001 20.906",
  [ProviderLogo.Ceph]: "-0.001 0.256 24.002 23.488",
  [ProviderLogo.GitHub]: "0 0.296 24 23.407",
  [ProviderLogo.GitLab]: "-0.001 0.443 24 23.113",
  [ProviderLogo.Forgejo]: "4.322 0 15.356 24.001",
  [ProviderLogo.Gitea]: "-0.001 4.602 24.002 14.797",
  [ProviderLogo.Git]: "-0.001 -0.001 24.001 24.003",
};

/*
 * Products drawn by their maker's mark: a cloud's services by the cloud's.
 * Google's one-colour product icons and Microsoft's Fabric glyphs have no
 * mark of their own for these, and the name beside the mark says which of
 * the maker's products it is.
 */
export const PROVIDER_LOGOS_DRAWN_BY_THEIR_MAKERS_MARK: Readonly<
  Partial<Record<ProviderLogo, ProviderLogo>>
> = {
  [ProviderLogo.GoogleCloudStorage]: ProviderLogo.GoogleCloud,
  [ProviderLogo.GoogleVertexAI]: ProviderLogo.GoogleCloud,
  [ProviderLogo.GoogleSecurityOperations]: ProviderLogo.GoogleCloud,
  [ProviderLogo.AzureBlobStorage]: ProviderLogo.Azure,
  [ProviderLogo.AzureOpenAI]: ProviderLogo.Azure,
  [ProviderLogo.MicrosoftSentinel]: ProviderLogo.Azure,
};

/*
 * Products drawn by one of OneUptime's own icons, because their brand's
 * rules allow no logo in a product like this, or none in one colour (the
 * README quotes each rule). The icon says what the product is; its name,
 * written beside it, says whose.
 */
export const PROVIDER_LOGO_STAND_IN_ICONS: Readonly<
  Partial<Record<ProviderLogo, IconProp>>
> = {
  // AWS: "plain text only (no logos)", and never "changing the ... color".
  [ProviderLogo.Aws]: IconProp.Cloud,
  [ProviderLogo.AmazonS3]: IconProp.Archive,
  [ProviderLogo.AmazonBedrock]: IconProp.CPUChip,
  [ProviderLogo.AwsSecurityHub]: IconProp.ShieldCheck,
  // CrowdStrike: no display of its marks without its written consent.
  [ProviderLogo.CrowdStrike]: IconProp.Bolt,
  // Groq: its logos are for licensed partners only.
  [ProviderLogo.Groq]: IconProp.Bolt,
  /*
   * Microsoft: its own artwork only, and it ships no one-colour Copilot
   * mark. A chat bubble, as the AI connections' catalog draws Copilot: the
   * sparkles are the icon of a provider the product does not know.
   */
  [ProviderLogo.MicrosoftCopilot]: IconProp.ChatBubbleLeft,
};

/*
 * The logo whose mark draws this one: its own, or its maker's. None for a
 * product drawn by an icon of OneUptime's.
 */
export function getProviderLogoMark(
  logo: ProviderLogo,
): ProviderLogo | undefined {
  if (PROVIDER_LOGO_MARK_BOXES[logo]) {
    return logo;
  }

  return PROVIDER_LOGOS_DRAWN_BY_THEIR_MAKERS_MARK[logo];
}

// The icon of OneUptime's that stands for a product drawn without its logo.
export function getProviderLogoStandInIcon(
  logo: ProviderLogo,
): IconProp | undefined {
  return PROVIDER_LOGO_STAND_IN_ICONS[logo];
}

export interface ProviderLogoMarkBox {
  // The viewBox attribute: "x y width height".
  viewBox: string;
  width: number;
  height: number;
}

// The box the mark that draws this logo sits in, or none for a stand-in.
export function getProviderLogoMarkBox(
  logo: ProviderLogo,
): ProviderLogoMarkBox | undefined {
  const mark: ProviderLogo | undefined = getProviderLogoMark(logo);
  const viewBox: string | undefined = mark
    ? PROVIDER_LOGO_MARK_BOXES[mark]
    : undefined;

  if (!viewBox) {
    return undefined;
  }

  const parts: Array<number> = viewBox.split(" ").map((part: string) => {
    return Number(part);
  });

  return {
    viewBox,
    width: parts[2] || 0,
    height: parts[3] || 0,
  };
}

/*
 * The size a mark is drawn at, in pixels, for an icon's size: as tall as the
 * icon when the mark is taller than wide, as wide when it is about square,
 * and given some more width when it is a wordmark (Zoom's, Splunk's), never
 * past the room there is - so square symbols, tall ones and wordmarks look
 * about as large as each other beside the same words.
 */
export interface ProviderLogoMarkSize {
  width: number;
  height: number;
}

// A mark wider than this many times its height reads as a wordmark.
export const PROVIDER_LOGO_WORDMARK_RATIO: number = 1.3;

export function getProviderLogoMarkSize(data: {
  box: ProviderLogoMarkBox;
  // The icon's size: the square a symbol fills.
  size: number;
  // The widest the mark may be.
  maxWidth: number;
}): ProviderLogoMarkSize {
  const ratio: number =
    data.box.height > 0 ? data.box.width / data.box.height : 1;
  const round: (value: number) => number = (value: number): number => {
    return Math.round(value * 10) / 10;
  };

  if (ratio <= 1) {
    return { width: round(data.size * ratio), height: data.size };
  }

  const width: number = Math.min(
    Math.max(
      data.size,
      data.size * Math.sqrt(ratio / PROVIDER_LOGO_WORDMARK_RATIO),
    ),
    Math.max(data.size, data.maxWidth),
  );

  return { width: round(width), height: round(width / ratio) };
}
