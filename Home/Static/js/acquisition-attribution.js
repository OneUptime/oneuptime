(function (window, document) {
  "use strict";

  var COOKIE_NAME = "ou_acquisition";
  var STORAGE_KEY = "acquisitionAttribution";
  var MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
  var CLICK_IDS = ["gclid", "wbraid", "gbraid"];
  var UTM_MAP = {
    utm_source: "utmSource",
    utm_medium: "utmMedium",
    utm_campaign: "utmCampaign",
    utm_term: "utmTerm",
    utm_content: "utmContent"
  };

  function safeParse(value) {
    try { return value ? JSON.parse(value) : null; } catch (_) { return null; }
  }
  function readCookie() {
    var prefix = COOKIE_NAME + "=";
    var item = document.cookie.split(";").map(function (v) { return v.trim(); }).find(function (v) { return v.indexOf(prefix) === 0; });
    return item ? safeParse(decodeURIComponent(item.slice(prefix.length))) : null;
  }
  function readStorage(key) {
    try { return safeParse(window.localStorage.getItem(key)); } catch (_) { return null; }
  }
  function writeStorage(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* cookie remains canonical */ }
  }
  function createId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }
  function consentState() {
    try {
      var value = window.localStorage.getItem("cookiesAccepted");
      return value === "true" ? "granted" : value === "false" ? "denied" : "unknown";
    } catch (_) { return "unknown"; }
  }
  function cleanUrl(value) {
    if (!value) return "";
    try {
      var url = new URL(value, window.location.origin);
      Object.keys(UTM_MAP).concat(CLICK_IDS).forEach(function (key) { url.searchParams.delete(key); });
      url.hash = "";
      url.username = "";
      url.password = "";
      return url.toString().slice(0, 1000);
    } catch (_) { return ""; }
  }
  function legacyAttribution() {
    var first = readStorage("firstTouch");
    var latest = {};
    try {
      Object.keys(UTM_MAP).forEach(function (key) {
        var stored = window.localStorage.getItem(UTM_MAP[key]);
        if (stored) latest[UTM_MAP[key]] = stored;
      });
      latest.landingPage = cleanUrl(window.localStorage.getItem("utmUrl"));
      latest.clickIds = readStorage("clickIds") || undefined;
    } catch (_) { /* no local storage */ }
    if (first && first.landingUrl && !first.landingPage) first.landingPage = cleanUrl(first.landingUrl);
    return { firstTouch: first || undefined, latestTouch: Object.keys(latest).length ? latest : undefined };
  }
  function writeCookie(value) {
    var secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = COOKIE_NAME + "=" + encodeURIComponent(JSON.stringify(value)) + "; Path=/; Max-Age=" + MAX_AGE_SECONDS + "; SameSite=Lax" + secure;
  }
  function captureTouch() {
    var attribution = readCookie() || readStorage(STORAGE_KEY) || legacyAttribution();
    attribution.anonymousVisitorId = attribution.anonymousVisitorId || createId();
    attribution.consentState = consentState();
    var params = new URLSearchParams(window.location.search);
    var touch = { clickIds: {} };
    var attributed = false;
    Object.keys(UTM_MAP).forEach(function (key) {
      var value = params.get(key);
      if (value) { touch[UTM_MAP[key]] = value.slice(0, 500); attributed = true; }
    });
    CLICK_IDS.forEach(function (key) {
      var value = params.get(key);
      if (value) { touch.clickIds[key] = value.slice(0, 500); attributed = true; }
    });
    if (!Object.keys(touch.clickIds).length) delete touch.clickIds;
    touch.channel = attributed ? "attributed" : (document.referrer && new URL(document.referrer).hostname !== window.location.hostname ? "organic_referral" : "direct");
    touch.landingPage = cleanUrl(window.location.href);
    touch.referrer = cleanUrl(document.referrer);
    touch.timestamp = new Date().toISOString();
    if (!attribution.firstTouch) attribution.firstTouch = touch;
    attribution.latestTouch = touch;
    if (attributed && touch.clickIds && (touch.clickIds.gclid || touch.clickIds.gbraid || touch.clickIds.wbraid)) attribution.latestPaidTouch = touch;
    writeCookie(attribution);
    writeStorage(STORAGE_KEY, attribution);
    writeStorage("firstTouch", attribution.firstTouch);
    if (attributed) {
      Object.keys(UTM_MAP).forEach(function (key) { try { window.localStorage.removeItem(UTM_MAP[key]); } catch (_) {} });
      Object.keys(UTM_MAP).forEach(function (key) { if (touch[UTM_MAP[key]]) try { window.localStorage.setItem(UTM_MAP[key], touch[UTM_MAP[key]]); } catch (_) {} });
      try { window.localStorage.setItem("utmUrl", touch.landingPage); } catch (_) {}
      writeStorage("clickIds", touch.clickIds || {});
    }
    return attribution;
  }
  function send(type, externalReferenceId) {
    var attribution = api.get();
    if (!attribution || !attribution.anonymousVisitorId) return;
    var touch = attribution.latestTouch || {};
    var eventId = [attribution.anonymousVisitorId, type, touch.timestamp || "unknown", externalReferenceId || ""].join(":");
    var body = { eventId: eventId, touchpointType: type, attribution: attribution, occurredAt: touch.timestamp, externalReferenceId: externalReferenceId };
    try {
      window.fetch("/api/acquisition/touchpoint", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true });
    } catch (_) { /* best effort and never blocks navigation */ }
  }
  var api = {
    capture: captureTouch,
    get: function () { return readCookie() || readStorage(STORAGE_KEY) || legacyAttribution(); },
    send: send,
    meaningful: function (reference) { send("meaningful_visit", reference); }
  };
  window.OneUptimeAttribution = api;
  document.addEventListener("DOMContentLoaded", function () { captureTouch(); send("visit"); });
})(window, document);
