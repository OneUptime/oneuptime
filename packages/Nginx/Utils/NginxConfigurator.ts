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
  private static readonly NGINX_LOG_DIRECTORY: string = "/var/log/nginx";
  private static readonly NGINX_ACCESS_LOG_PATH: string = `${NginxConfigurator.NGINX_LOG_DIRECTORY}/access.log`;
  private static readonly NGINX_ERROR_LOG_PATH: string = `${NginxConfigurator.NGINX_LOG_DIRECTORY}/error.log`;

  private static async ensureLogFiles(): Promise<void> {
    try {
      await LocalFile.makeDirectory(this.NGINX_LOG_DIRECTORY);

      const accessLogExists: boolean = await LocalFile.doesFileExist(
        this.NGINX_ACCESS_LOG_PATH,
      );

      if (!accessLogExists) {
        await LocalFile.write(this.NGINX_ACCESS_LOG_PATH, "");
      }

      const errorLogExists: boolean = await LocalFile.doesFileExist(
        this.NGINX_ERROR_LOG_PATH,
      );

      if (!errorLogExists) {
        await LocalFile.write(this.NGINX_ERROR_LOG_PATH, "");
      }
    } catch (err) {
      logger.error(
        "[NginxConfigurator] Failed to ensure nginx log files exist before reload.",
      );
      logger.error(err);
      throw err;
    }
  }

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

    const certificateDirective: string = `ssl_certificate /etc/nginx/certs/ServerCerts/${normalizedHost}.crt;`;

    let nginxConfig: string = "";
    try {
      nginxConfig = await LocalFile.read(this.DEFAULT_CONF_PATH);
    } catch (err) {
      logger.debug(
        `[NginxConfigurator] Unable to read ${this.DEFAULT_CONF_PATH}; regenerating configuration.`,
      );
      logger.debug(err);
    }

    const templateHasDirective: boolean =
      nginxConfig.includes(certificateDirective);
    const shouldRefreshTemplate: boolean = !templateHasDirective;
    const shouldReload: boolean =
      options.forceReload === true || shouldRefreshTemplate;

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

      await this.ensureLogFiles();
      await Exec.executeCommandInheritStdio({
        command: "nginx",
        args: ["-t", "-c", "/etc/nginx/nginx.conf"],
      });
      await Exec.executeCommandInheritStdio({
        command: "nginx",
        args: ["-s", "reload"],
      });
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
