export const ViewsPath: string = "/usr/src/app/Views";
export const StaticPath: string = "/usr/src/app/Static";
export const BlogRootPath: string = "/usr/src/blog";
/*
 * The one-line installer behind https://oneuptime.com/install.sh. It ships in
 * this image (Home/Dockerfile.tpl copies ./Home to /usr/src/app), so the route
 * never depends on where the script sits in the GitHub repository.
 */
export const InstallScriptPath: string = "/usr/src/app/Scripts/Install.sh";
