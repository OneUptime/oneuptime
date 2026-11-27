/*
 * ONE PLATFORM A PROBE COLLECTS (#11004): what its management server is
 * called, where it listens, how often it is read, and the words of its
 * Connect form. The poller itself lives in the probe
 * (packages/Probe/Utils/StorageArray/<Vendor>/<Product>); this is what the
 * server and the dashboard need to know of it.
 *
 * Every word a person reads is an English translation key (translationKey),
 * found by the Dashboard's i18n:extract where the platform's folder is a
 * source root (Common/Types/StorageArray/Platforms).
 */
export interface StorageArrayProbeCollector {
  // The platform: its StorageArrayPlatform.storageSystem.
  storageSystem: string;
  // The management server's product: "Unisphere for PowerMax".
  serverProductName: string;
  // How a sentence names one: "Unisphere".
  serverShortName: string;
  // The port the REST API listens on when the address names none.
  defaultPort: number;
  /*
   * The paths a browser shows for the server, accepted in an address and
   * dropped: a person pastes what their browser shows.
   */
  acceptedPaths: ReadonlyArray<string>;
  /*
   * The resource attribute of each array's batch that carries the array's
   * own identifier (a PowerMax's Symmetrix ID). The server finds the
   * array's row by it (StorageArray.systemId) and names the batch after
   * that row, so an array renamed in OneUptime stays the same array.
   */
  arrayIdentityAttribute: string;
  /*
   * How often a probe reads it, in minutes. The upper bound stays under the
   * inventory's 15-minute stale window
   * (StorageArrayResourceService.getStaleThresholdMinutes).
   */
  collectionInterval: {
    defaultMinutes: number;
    minMinutes: number;
    maxMinutes: number;
  };
  // Where the docs explain it.
  docsPath: string;
  words: {
    // The Connect button and form: "Connect Unisphere".
    connectTitle: string;
    /*
     * The question the Storage Arrays list asks before its Connect link,
     * for someone about to install the agent instead: "Monitoring Dell
     * PowerMax?"
     */
    offerQuestion: string;
    // The list of connections, one line: what they are for.
    listDescription: string;
    addressTitle: string;
    addressPlaceholder: string;
    addressDescription: string;
    usernamePlaceholder: string;
    usernameDescription: string;
    probeDescription: string;
    certificateDescription: string;
    // How to check a fingerprint before trusting it.
    certificateCheckHint: string;
    testDescription: string;
    namePlaceholder: string;
    nameDescription: string;
    intervalDescription: string;
  };
}
