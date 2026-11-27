import { translationKey } from "../../../../Translator";
import StorageSystem from "../../../StorageSystem";
import { StorageArrayProbeCollector } from "../../../Collection/StorageArrayProbeCollector";
import { POWERMAX_SYMMETRIX_ID_ATTRIBUTE } from "./PowerMaxSeries";

/*
 * Dell PowerMax is collected by a probe from Unisphere for PowerMax: one
 * Unisphere adds every array it manages. Its REST API listens on 8443, and
 * computes performance every 5 minutes, so a probe reads it every 5 (or
 * 10, to go easier on a busy Unisphere).
 */
const POWERMAX_PROBE_COLLECTOR: StorageArrayProbeCollector = {
  storageSystem: StorageSystem.DellPowerMax,
  serverProductName: "Unisphere for PowerMax",
  serverShortName: "Unisphere",
  defaultPort: 8443,
  acceptedPaths: ["/", "/univmax", "/univmax/restapi", "/univmax/rest"],
  arrayIdentityAttribute: POWERMAX_SYMMETRIX_ID_ATTRIBUTE,
  collectionInterval: { defaultMinutes: 5, minMinutes: 5, maxMinutes: 10 },
  docsPath: "/docs/telemetry/storage-arrays#dell-powermax",
  words: {
    connectTitle: translationKey("Connect Unisphere"),
    offerQuestion: translationKey("Monitoring Dell PowerMax?"),
    listDescription: translationKey(
      "Unisphere for PowerMax servers a probe reads your PowerMax arrays from. Connect one with a read-only account, and every array it manages appears in Storage Arrays.",
    ),
    addressTitle: translationKey("Unisphere Address"),
    addressPlaceholder: "https://unisphere.example.com:8443",
    addressDescription: translationKey(
      "The address you open Unisphere for PowerMax at. Port 8443 unless yours listens on another.",
    ),
    usernamePlaceholder: "oneuptime",
    usernameDescription: translationKey(
      "A Unisphere user with the Monitor role, and the PerfMonitor role for performance. It needs nothing more: OneUptime never changes the array.",
    ),
    probeDescription: translationKey(
      "The probe that reads this Unisphere. It has to reach Unisphere on TCP 8443, so it is usually one you run in Unisphere's network.",
    ),
    certificateDescription: translationKey(
      "Leave empty if the probe trusts Unisphere's certificate. Unisphere signs its own by default: test the connection to see it and trust it.",
    ),
    certificateCheckHint: translationKey(
      "Check the fingerprint against Unisphere's certificate first, for example with openssl s_client from the probe's machine.",
    ),
    testDescription: translationKey(
      "The probe logs in to Unisphere with these settings, reads what the account can see on each array, and leaves. Nothing is saved.",
    ),
    namePlaceholder: translationKey("Defaults to Unisphere's host name"),
    nameDescription: translationKey(
      "How this Unisphere is named in OneUptime. Each of its arrays appears in Storage Arrays under its Symmetrix ID, which you can rename.",
    ),
    intervalDescription: translationKey(
      "Every 5 or 10 minutes. Unisphere computes performance every 5 minutes; read a busy Unisphere every 10 to go easier on it.",
    ),
  },
};

export default POWERMAX_PROBE_COLLECTOR;
