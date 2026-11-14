import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ONE HINDI WORD FOR AN INCIDENT (#7110).
 *
 * Hindi called an incident घटना in some 1,550 Dashboard strings and
 * इंसिडेंट, the English word in Devanagari letters, in 57 more - so one
 * page could say both, and a reader could take them for two things. Every
 * one of them says घटना now, in the Dashboard, the Admin Dashboard, the
 * sign-in pages and the docs.
 *
 * घटना is feminine (plural घटनाएं, oblique घटनाओं), where the loanword was
 * read as masculine, so the sentences around it were rewritten to agree:
 * "खुली घटनाएं" (open incidents), not "खुले"; "अनसुलझी घटनाएं", not
 * "अनसुलझे". This suite keeps the loanword out, pins sentences the issue
 * named as their rewrite reads, and catches the agreement a plain word swap
 * would have left wrong.
 */

const APP: string = path.resolve(__dirname, "../..");

// Every Hindi locale file a reader of OneUptime meets.
const HINDI_LOCALES: ReadonlyArray<string> = [
  "FeatureSet/Dashboard/src/Locales/hi.json",
  "FeatureSet/AdminDashboard/src/Locales/hi.json",
  "FeatureSet/Accounts/src/Locales/hi.json",
  "FeatureSet/StatusPage/src/Locales/hi.json",
  "FeatureSet/PublicDashboard/src/Locales/hi.json",
  "FeatureSet/Docs/Locales/hi.json",
  "FeatureSet/APIReference/Locales/hi.json",
  "../Common/Server/Locales/hi.json",
];

const HINDI_DOCS: string = path.join(APP, "FeatureSet/Docs/Content/hi");

/*
 * The English word in Devanagari, however it is spelled: इंसिडेंट,
 * इन्सिडेंट, इंसीडेंट, इंसिडेन्ट.
 */
const LOANWORD: RegExp = /इ(?:ं|न्)स(?:ि|ी)ड(?:ें|ेन्)ट/u;

// A key that names an incident: "Create incident", "navbar.items.incidents".
const INCIDENT_KEY: RegExp = /incident/i;

/*
 * Agreement a swap from the masculine loanword to the feminine घटना would
 * leave wrong: a masculine adjective before it, a masculine participle
 * after it.
 */
const MASCULINE_AGREEMENT: RegExp =
  /(?:खुले|अनसुलझे) घटना|घटना (?:बनाया|खोला|हल किया|बंद किया) गया|घटनाएं (?:बनाए|खोले|हल किए|बंद किए) गए/u;

type Locale = Record<string, unknown>;

interface Value {
  key: string;
  text: string;
}

function readLocale(file: string): Locale {
  return JSON.parse(fs.readFileSync(path.join(APP, file), "utf8")) as Locale;
}

// Every string of a locale, under its key (a nested one as its path).
function valuesOf(locale: Locale, prefix: string = ""): Array<Value> {
  const values: Array<Value> = [];

  for (const [key, value] of Object.entries(locale)) {
    const fullKey: string = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "string") {
      values.push({ key: fullKey, text: value });
    } else if (value && typeof value === "object") {
      values.push(...valuesOf(value as Locale, fullKey));
    }
  }

  return values;
}

// The keys whose wording holds the loanword.
function withLoanword(values: ReadonlyArray<Value>): Array<string> {
  return values
    .filter((value: Value): boolean => {
      return LOANWORD.test(value.text);
    })
    .map((value: Value): string => {
      return value.key;
    });
}

function markdownFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...markdownFiles(full));
    } else if (entry.name.endsWith(".md")) {
      files.push(full);
    }
  }

  return files;
}

const DASHBOARD: Locale = readLocale(HINDI_LOCALES[0]!);
const DASHBOARD_VALUES: Array<Value> = valuesOf(DASHBOARD);

function dashboardWord(key: string): string {
  return DASHBOARD[key] as string;
}

describe("Hindi's word for an incident", () => {
  test("no Dashboard value whose key mentions an incident says इंसिडेंट", () => {
    const incidentValues: Array<Value> = DASHBOARD_VALUES.filter(
      (value: Value): boolean => {
        return INCIDENT_KEY.test(value.key);
      },
    );

    // The issue counted some 1,600: the guard reads them all.
    expect(incidentValues.length).toBeGreaterThan(1500);
    expect(withLoanword(incidentValues)).toEqual([]);
  });

  test.each(HINDI_LOCALES)("%s says it nowhere", (file: string) => {
    expect({ file, keys: withLoanword(valuesOf(readLocale(file))) }).toEqual({
      file,
      keys: [],
    });
  });

  test("no Hindi docs page says it", () => {
    const pages: Array<string> = markdownFiles(HINDI_DOCS);

    expect(pages.length).toBeGreaterThan(100);

    const saying: Array<string> = pages
      .filter((page: string): boolean => {
        return LOANWORD.test(fs.readFileSync(page, "utf8"));
      })
      .map((page: string): string => {
        return path.relative(HINDI_DOCS, page);
      });

    expect(saying).toEqual([]);
  });

  test("the guard sees the loanword however it is spelled, and not घटना (negative control)", () => {
    const planted: Array<Value> = [
      { key: "Create incident", text: "इंसिडेंट बनाएं" },
      { key: "Open incidents", text: "खुले इन्सिडेंट" },
      { key: "Incident timeline", text: "इंसीडेंट टाइमलाइन" },
      { key: "Incident", text: "घटना" },
      { key: "Incidents", text: "घटनाएं" },
    ];

    expect(withLoanword(planted)).toEqual([
      "Create incident",
      "Open incidents",
      "Incident timeline",
    ]);
  });

  test("the words themselves", () => {
    expect(dashboardWord("incident")).toBe("घटना");
    expect(dashboardWord(" incidents")).toBe(" घटनाएं");
    expect(dashboardWord("Incident Response")).toBe("घटना प्रतिक्रिया");
    // The docs' navigation section, as the Dashboard names the same work.
    expect(
      (
        readLocale("FeatureSet/Docs/Locales/hi.json")["navSections"] as Record<
          string,
          string
        >
      )["Incident Response"],
    ).toBe("घटना प्रतिक्रिया");
    expect(
      readLocale("FeatureSet/Accounts/src/Locales/hi.json")[
        "Full OneUptime platform with incident response, status pages, and workflow automation."
      ],
    ).toBe(
      "घटना प्रतिक्रिया, स्टेटस पेज और वर्कफ़्लो ऑटोमेशन के साथ पूरा OneUptime प्लेटफ़ॉर्म।",
    );
  });

  /*
   * Sentences the issue named, as rewritten: a notification setting, a
   * Slack integration's text and a status page template's rule.
   */
  test("the notification setting, the Slack text and the template rule read घटना", () => {
    expect(
      dashboardWord(
        "Your choices for incident and alert creation, state changes, reminders, assignments, monitor health, and on-call shifts stay as they are. Other notification channels, paging, account and billing emails are unaffected.",
      ),
    ).toBe(
      "घटना और अलर्ट बनने, स्थिति बदलने, रिमाइंडर, असाइनमेंट, मॉनिटर स्वास्थ्य और ऑन-कॉल शिफ्ट के लिए आपके विकल्प जैसे हैं वैसे ही रहते हैं। अन्य सूचना चैनल, ऑन-कॉल पेजिंग, खाता और बिलिंग ईमेल अप्रभावित रहते हैं।",
    );
    expect(
      dashboardWord(
        "Post incidents, alerts and scheduled maintenance to your Slack channels, give each incident a channel of its own, and let your team acknowledge, resolve and page from Slack.",
      ),
    ).toBe(
      "घटनाएं, अलर्ट और शेड्यूल्ड मेंटेनेंस अपने Slack चैनलों में पोस्ट करें, हर घटना को उसका अपना चैनल दें, और अपनी टीम को Slack से स्वीकार करने, हल करने और पेज करने दें।",
    );
    expect(
      dashboardWord(
        "Only someone who can read every incident and its custom fields can save a template that places a custom field or the incident's labels. The status page roles on their own cannot add them.",
      ),
    ).toBe(
      "कोई कस्टम फ़ील्ड या घटना के लेबल रखने वाला टेम्पलेट केवल वही सहेज सकता है जो हर घटना और उसके कस्टम फ़ील्ड पढ़ सकता है। केवल स्टेटस पेज भूमिकाओं से इन्हें जोड़ा नहीं जा सकता।",
    );
  });

  // Open and unresolved incidents are feminine plurals now.
  test("adjectives agree with घटना", () => {
    expect(dashboardWord("Open Incidents and Alerts")).toBe(
      "खुली घटनाएं और अलर्ट",
    );
    expect(
      dashboardWord(
        "Unresolved incidents and alerts about this pod, incidents first.",
      ),
    ).toBe("इस पॉड से जुड़ी अनसुलझी घटनाएं और अलर्ट, पहले घटनाएं।");

    for (const file of HINDI_LOCALES) {
      const wrong: Array<string> = valuesOf(readLocale(file))
        .filter((value: Value): boolean => {
          return MASCULINE_AGREEMENT.test(value.text);
        })
        .map((value: Value): string => {
          return value.key;
        });

      expect({ file, wrong }).toEqual({ file, wrong: [] });
    }

    // The agreement check sees the swap a plain replace would make.
    expect(MASCULINE_AGREEMENT.test("खुले घटना और अलर्ट")).toBe(true);
    expect(MASCULINE_AGREEMENT.test("घटना बनाया गया")).toBe(true);
    expect(MASCULINE_AGREEMENT.test("खुली घटनाएं और अलर्ट")).toBe(false);
  });

  /*
   * The backup page names what PostgreSQL holds as the Admin Dashboard's
   * backup screen does, so a reader finds the same words on both.
   */
  test("the Admin Dashboard's backup words and the backups page say the same", () => {
    const admin: string = readLocale(
      "FeatureSet/AdminDashboard/src/Locales/hi.json",
    )["PostgreSQL: projects, monitors, incidents, users"] as string;

    expect(admin).toBe("PostgreSQL: प्रोजेक्ट, मॉनिटर, घटनाएं, उपयोगकर्ता");
    expect(
      fs.readFileSync(path.join(HINDI_DOCS, "installation/backups.md"), "utf8"),
    ).toContain(`**${admin}**`);
  });
});
