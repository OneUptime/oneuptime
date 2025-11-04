import Exec from "Common/Server/Utils/Execute";
import LocalFile from "Common/Server/Utils/LocalFile";
import logger from "Common/Server/Utils/Logger";

export interface EnsurePrimarySslOptions {
  hostname: string;
  forceReload?: boolean;
}

export default class NginxConfigurator {
  private static readonly DEFAULT_CONF_PATH: string =
    "/etc/nginx/conf.d/default.conf";
  private static readonly ENVSUBST_SCRIPT_PATH: string =
    "/etc/nginx/envsubst-on-templates.sh";

  public static async ensurePrimarySslConfigured(
    options: EnsurePrimarySslOptions,
  ): Promise<void> {
    const normalizedHost: string = options.hostname.trim().toLowerCase();

    if (!normalizedHost) {
      logger.warn(
        "[NginxConfigurator] Cannot configure SSL because hostname is empty.",
      );
      return;
    }

    const certificateDirective: string =
      `ssl_certificate /etc/nginx/certs/ServerCerts/${normalizedHost}.crt;`;

    let nginxConfig: string = "";
    try {
      nginxConfig = await LocalFile.read(this.DEFAULT_CONF_PATH);
    } catch (err) {
      logger.debug(
        `[NginxConfigurator] Unable to read ${this.DEFAULT_CONF_PATH}; regenerating configuration.`,
      );
      logger.debug(err);
    }

    const templateHasDirective: boolean = nginxConfig.includes(
      certificateDirective,
    );
    const shouldRefreshTemplate: boolean = !templateHasDirective;
    const shouldReload: boolean = options.forceReload === true || shouldRefreshTemplate;

    if (!shouldReload) {
      return;
    }

    const originalPrimaryDomain: string | undefined =
      process.env["PRIMARY_DOMAIN"];

    try {
      process.env["PRIMARY_DOMAIN"] = normalizedHost;

      if (shouldRefreshTemplate) {
        await Exec.executeCommand(this.ENVSUBST_SCRIPT_PATH);
      }

      await Exec.executeCommand("nginx -t");
      await Exec.executeCommand("nginx -s reload");
      logger.info(
        `[NginxConfigurator] Reloaded nginx after updating certificate for ${normalizedHost}.`,
      );
    } catch (err) {
      logger.error(
        "[NginxConfigurator] Failed to reload nginx after certificate update.",
      );
      logger.error(err);
      throw err;
    } finally {
      if (originalPrimaryDomain !== undefined) {
        process.env["PRIMARY_DOMAIN"] = originalPrimaryDomain;
      } else {
        delete process.env["PRIMARY_DOMAIN"];
      }
    }
  }
}
