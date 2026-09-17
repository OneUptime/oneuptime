/*
 * Wire dialects the security-events ingest endpoint accepts. Clients can
 * name the format explicitly (query param or header); when they do not,
 * ingest sniffs it per event — see SecurityEventFormatDetector.
 */
enum SecurityEventFormat {
  // Native OCSF event JSON (class_uid / category_uid / severity_id ...).
  Ocsf = "ocsf",

  // Google SecOps / Chronicle UDM event JSON (metadata.event_type ...).
  Udm = "udm",

  /*
   * Google SecOps detection/alert payloads — what a SOAR playbook webhook
   * or the detections stream delivers (rule metadata + matched events).
   */
  GoogleSecOpsAlert = "google-secops-alert",

  // Anything else — best-effort field mapping.
  Generic = "generic",
}

export default SecurityEventFormat;
