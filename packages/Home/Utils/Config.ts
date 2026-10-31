export const ViewsPath: string = "/usr/src/app/Views";
export const StaticPath: string = "/usr/src/app/Static";
export const BlogRootPath: string = "/usr/src/blog";
/*
 * The one-line installer behind https://oneuptime.com/install.sh. It ships in
 * this image (packages/Home/Dockerfile.tpl copies the package to /usr/src/app),
 * so the route never depends on where the script sits in the GitHub repository.
 */
export const InstallScriptPath: string = "/usr/src/app/Scripts/Install.sh";
/*
 * Where every OneUptime serves the infrastructure agent's installer, with its
 * docs (packages/App/FeatureSet/Docs/Static/scripts/infrastructure-agent):
 * https://oneuptime.com/infrastructure-agent/install.sh sends readers there.
 */
export const InfrastructureAgentInstallScriptPath: string =
  "/docs/static/scripts/infrastructure-agent/install.sh";
