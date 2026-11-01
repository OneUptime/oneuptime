/*
 * A revision as a line about its app names it. Cloud Run and Container Apps
 * name a revision after its service ("checkout-00042-xyz",
 * "checkout--abc123"), so a line that already names the app leaves the
 * app's name off the front - "Deployed checkout: revision 00042-xyz replaced
 * 00041-abc", not "revision checkout-00042-xyz replaced checkout-00041-abc";
 * anything else is shown as it is. The Dashboard's rows, header and charts
 * and the server's feed lines and change titles say it the same way; the
 * change event's attributes keep the whole name.
 */
export function getShortCloudAppRevision(data: {
  revision: string | null | undefined;
  appName: string | null | undefined;
}): string {
  const revision: string = (data.revision || "").trim();
  const appName: string = (data.appName || "").trim();

  if (!revision || !appName) {
    return revision;
  }

  for (const separator of ["--", "-"]) {
    const prefix: string = `${appName}${separator}`;

    if (revision.startsWith(prefix) && revision.length > prefix.length) {
      return revision.slice(prefix.length);
    }
  }

  return revision;
}
