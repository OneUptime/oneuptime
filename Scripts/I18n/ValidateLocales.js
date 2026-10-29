/*
 * Locale parity validator.
 *
 * Every UI string in OneUptime is auto-translated by looking the string up as a
 * key in the active locale's JSON. If a key exists in en.json but is missing
 * from a locale file, that string silently renders in English for users of that
 * language. This script guards against that drift: it verifies that every locale
 * file mirrors its en.json source key-for-key and preserves all {{interpolation}}
 * placeholders.
 *
 * Run:  npm run i18n:validate
 * Exits non-zero if any locale is missing keys, has extra keys, or breaks a
 * placeholder. (Values left identical to English are reported as info only —
 * loanwords/brand names like "OneUptime", "API", "Dashboard" are legitimately
 * the same across languages.)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// Feature set -> Locales directory (relative to repo root)
const LOCALE_DIRS = {
  Dashboard: "packages/App/FeatureSet/Dashboard/src/Locales",
  AdminDashboard: "packages/App/FeatureSet/AdminDashboard/src/Locales",
  StatusPage: "packages/App/FeatureSet/StatusPage/src/Locales",
  Accounts: "packages/App/FeatureSet/Accounts/src/Locales",
  PublicDashboard: "packages/App/FeatureSet/PublicDashboard/src/Locales",
  Docs: "packages/App/FeatureSet/Docs/Locales",
  APIReference: "packages/App/FeatureSet/APIReference/Locales",
};

// en.json is the source of truth; these 16 locales must mirror it.
const LOCALES = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

/*
 * A {{placeholder}} - or, in a last alternative, a "{{" that starts none,
 * taken up to the next "}" so the search goes on after it (no "{{" in it
 * starts one either). Tried alone, the first alternative read on to that "}"
 * again from every "{{" before it. Only the placeholders are kept: they are
 * what /\{\{[^}]+\}\}/g matched.
 */
const PLACEHOLDER_OR_UNCLOSED = /\{\{[^}]+\}\}|\{\{[^}]*/g;

function flatten(node, prefix, out) {
  if (node !== null && typeof node === "object" && !Array.isArray(node)) {
    for (const key of Object.keys(node)) {
      flatten(node[key], prefix ? `${prefix}\u0000${key}` : key, out);
    }
  } else if (typeof node === "string") {
    out[prefix] = node;
  }
  return out;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function placeholderSet(s) {
  return new Set(
    (s.match(PLACEHOLDER_OR_UNCLOSED) || [])
      .filter((match) => {
        return match.endsWith("}}");
      })
      .sort(),
  );
}

function eqSet(a, b) {
  if (a.size !== b.size) {
    return false;
  }
  for (const v of a) {
    if (!b.has(v)) {
      return false;
    }
  }
  return true;
}

let hadError = false;
let totalUntranslated = 0;

for (const [fs_name, dir] of Object.entries(LOCALE_DIRS)) {
  const enPath = path.join(REPO_ROOT, dir, "en.json");
  let en;
  try {
    en = flatten(readJson(enPath), "", {});
  } catch (e) {
    console.error(`✗ ${fs_name}: cannot read ${enPath}: ${e.message}`);
    hadError = true;
    continue;
  }
  const enKeys = Object.keys(en);

  for (const locale of LOCALES) {
    const locPath = path.join(REPO_ROOT, dir, `${locale}.json`);
    let loc;
    try {
      loc = flatten(readJson(locPath), "", {});
    } catch (e) {
      console.error(
        `✗ ${fs_name}/${locale}: invalid or missing JSON (${e.message})`,
      );
      hadError = true;
      continue;
    }

    const missing = enKeys.filter((k) => !(k in loc));
    const extra = Object.keys(loc).filter((k) => !(k in en));
    const phBad = [];
    let untranslated = 0;
    for (const k of enKeys) {
      const lv = loc[k];
      if (typeof lv !== "string") {
        continue;
      }
      if (!eqSet(placeholderSet(en[k]), placeholderSet(lv))) {
        phBad.push(k.replace(/\u0000/g, "."));
      }
      if (lv === en[k]) {
        untranslated++;
      }
    }
    totalUntranslated += untranslated;

    if (missing.length || extra.length || phBad.length) {
      hadError = true;
      console.error(
        `✗ ${fs_name}/${locale}: missing=${missing.length} extra=${extra.length} placeholder-broken=${phBad.length}`,
      );
      const show = (label, arr) => {
        if (arr.length) {
          console.error(
            `    ${label}: ${arr
              .slice(0, 8)
              .map((k) => k.replace(/\u0000/g, "."))
              .join(" | ")}${arr.length > 8 ? ` … (+${arr.length - 8})` : ""}`,
          );
        }
      };
      show("missing", missing);
      show("extra", extra);
      show("placeholder-broken", phBad);
    }
  }
}

console.error(
  `\ni18n locale check: ${hadError ? "FAILED" : "passed"} — info: ${totalUntranslated} values identical to English (loanwords/brands are expected).`,
);
process.exit(hadError ? 1 : 0);
