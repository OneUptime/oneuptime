/*
 * Where the App image holds the folders Common/Types/InstallScripts serves
 * from: packages/App/Dockerfile.tpl copies agents/<Agent> to
 * /usr/src/agents/<Agent> (and the Kubernetes agent's diagnostic script to
 * /usr/src/HelmChart/Public/kubernetes-agent), the repository's layout under
 * /usr/src. The development compose file bind-mounts the same folders there,
 * read-only.
 */
export const InstallFilesRoot: string = "/usr/src";
