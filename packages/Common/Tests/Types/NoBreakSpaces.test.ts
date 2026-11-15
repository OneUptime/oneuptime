import { describe, expect, test } from "@jest/globals";
import {
  NARROW_NO_BREAK_SPACE,
  NO_BREAK_SPACE,
  NoBreakLocaleTree,
  setsPunctuationApart,
  withFrenchSpacing,
  withFrenchSpacingInHtml,
  withNoBreakSpaces,
  withNoBreakSpacesInLocale,
  withNumbersKeptWithUnits,
} from "../../Types/NoBreakSpaces";

/*
 * WHERE A LINE MAY NOT BREAK (Types/NoBreakSpaces).
 *
 * French's marks stay on the line of the words they belong to (#8032),
 * and a number stays on the line of its unit (#8043). The expectations
 * write the spaces by name: NB is U+00A0, NNB is U+202F.
 */

const NB: string = NO_BREAK_SPACE;
const NNB: string = NARROW_NO_BREAK_SPACE;

// What a pattern reads as whitespace.
const WHITESPACE: RegExp = /\s/;

describe("the two no-break spaces", () => {
  test("are the no-break space and the narrow no-break space", () => {
    expect(NB).toBe("\u00A0");
    expect(NNB).toBe("\u202F");
  });

  test("count as whitespace to a pattern and to trim, as a plain space does", () => {
    // The Translator reads a sentence's end with \s and trims a value's spaces.
    expect(WHITESPACE.test(NB)).toBe(true);
    expect(WHITESPACE.test(NNB)).toBe(true);
    expect(`${NB}x${NNB}`.trim()).toBe("x");
  });
});

describe("setsPunctuationApart", () => {
  test.each([
    ["fr", true],
    ["fr-CA", true],
    ["fr_BE", true],
    ["FR", true],
    ["en", false],
    ["de", false],
    ["es", false],
    ["fa", false],
    ["", false],
    [undefined, false],
    [null, false],
  ])("%s: %s", (language: string | null | undefined, expected: boolean) => {
    expect(setsPunctuationApart(language)).toBe(expected);
  });
});

describe("withFrenchSpacing", () => {
  test("the empty Archived Workflows page's sentence keeps each guillemet with its words (#8032)", () => {
    expect(
      withFrenchSpacing(
        "Pour en archiver un, sélectionnez-le dans la liste « Flux de travail » et choisissez « Archiver », ou ouvrez sa page Paramètres.",
      ),
    ).toBe(
      `Pour en archiver un, sélectionnez-le dans la liste «${NB}Flux de travail${NB}» et choisissez «${NB}Archiver${NB}», ou ouvrez sa page Paramètres.`,
    );
  });

  test("a question, an exclamation and a semicolon take the narrow no-break space", () => {
    expect(withFrenchSpacing("Archiver 3 flux de travail ?")).toBe(
      `Archiver 3 flux de travail${NNB}?`,
    );
    expect(withFrenchSpacing("Copié !")).toBe(`Copié${NNB}!`);
    expect(withFrenchSpacing("un objet ; puis un autre")).toBe(
      `un objet${NNB}; puis un autre`,
    );
  });

  test("a colon takes the full no-break space", () => {
    expect(withFrenchSpacing("Dupliquer : Flux de travail")).toBe(
      `Dupliquer${NB}: Flux de travail`,
    );
    expect(withFrenchSpacing("Suivez ces étapes :")).toBe(
      `Suivez ces étapes${NB}:`,
    );
  });

  test("a placeholder before a mark keeps it, and the value goes in later", () => {
    expect(withFrenchSpacing("Supprimer « {{name}} » ?")).toBe(
      `Supprimer «${NB}{{name}}${NB}»${NNB}?`,
    );
    expect(withFrenchSpacing("Mise à jour : {{eventType}}")).toBe(
      `Mise à jour${NB}: {{eventType}}`,
    );
    expect(withFrenchSpacing("{{count}} ?")).toBe(`{{count}}${NNB}?`);
  });

  test("a mark after a closing guillemet, a bracket, Markdown's emphasis or a tag", () => {
    expect(withFrenchSpacing("« Archiver » ?")).toBe(
      `«${NB}Archiver${NB}»${NNB}?`,
    );
    expect(withFrenchSpacing("(facultatif) :")).toBe(`(facultatif)${NB}:`);
    expect(withFrenchSpacing("**Gravité :** Majeur")).toBe(
      `**Gravité${NB}:** Majeur`,
    );
    expect(withFrenchSpacing("<b>Note</b> : lisez")).toBe(
      `<b>Note</b>${NB}: lisez`,
    );
    expect(withFrenchSpacing("Voici les détails :<br>")).toBe(
      `Voici les détails${NB}:<br>`,
    );
    expect(withFrenchSpacing("`npm run build` ?")).toBe(
      `\`npm run build\`${NNB}?`,
    );
  });

  test("marks one after another: the first holds the space", () => {
    expect(withFrenchSpacing("Quoi ?!")).toBe(`Quoi${NNB}?!`);
    expect(withFrenchSpacing("« Vraiment ? »")).toBe(
      `«${NB}Vraiment${NNB}?${NB}»`,
    );
  });

  test("a run of spaces before a mark is one no-break space", () => {
    expect(withFrenchSpacing("Bien  :  deux")).toBe(`Bien${NB}:  deux`);
    expect(withFrenchSpacing("«   x   »")).toBe(`«${NB}x${NB}»`);
  });

  test("a fixed-width space a line breaks at is set too, and a figure space is left", () => {
    // U+2009 THIN SPACE breaks a line; U+2007 FIGURE SPACE does not.
    expect(withFrenchSpacing("Pourquoi\u2009?")).toBe(`Pourquoi${NNB}?`);
    expect(withFrenchSpacing("Pourquoi\u2007?")).toBe("Pourquoi\u2007?");
  });

  test("a no-break space already there is kept: setting twice is setting once", () => {
    const once: string = withFrenchSpacing(
      "Supprimer « {{name}} » ? Oui : non ; vraiment !",
    );

    expect(withFrenchSpacing(once)).toBe(once);
    expect(withFrenchSpacing(`Déjà${NB}: fait${NNB}?`)).toBe(
      `Déjà${NB}: fait${NNB}?`,
    );
  });

  test("a mark that is no French punctuation keeps its space", () => {
    // A merge request's reference.
    expect(withFrenchSpacing("MR !{{number}}")).toBe("MR !{{number}}");
    // A minute past the hour.
    expect(withFrenchSpacing("toutes les heures à :{{minute}}")).toBe(
      "toutes les heures à :{{minute}}",
    );
    // Characters a password may hold, and a wildcard after a comma.
    expect(withFrenchSpacing("Essayez !, @, # ou $.")).toBe(
      "Essayez !, @, # ou $.",
    );
    expect(withFrenchSpacing("* est un texte, ? est un caractère")).toBe(
      "* est un texte, ? est un caractère",
    );
    // A list of characters, each set apart by a space.
    expect(withFrenchSpacing("lettres, chiffres et - _ . / : #")).toBe(
      "lettres, chiffres et - _ . / : #",
    );
  });

  test("a mark written right after its word is left as written", () => {
    expect(withFrenchSpacing("user:jane et url:/checkout")).toBe(
      "user:jane et url:/checkout",
    );
    expect(withFrenchSpacing("https://exemple.fr?a=1")).toBe(
      "https://exemple.fr?a=1",
    );
  });

  test("code in backticks keeps its spaces", () => {
    expect(withFrenchSpacing("Utilisez `a ? b : c` ici : vraiment ?")).toBe(
      `Utilisez \`a ? b : c\` ici${NB}: vraiment${NNB}?`,
    );
    expect(withFrenchSpacing("`« x »` puis « y »")).toBe(
      `\`« x »\` puis «${NB}y${NB}»`,
    );
  });

  test("an HTML tag keeps its spaces", () => {
    expect(
      withFrenchSpacing('<span title="Statut : ok">Statut : ok</span>'),
    ).toBe(`<span title="Statut : ok">Statut${NB}: ok</span>`);
  });

  test("text with nothing to set comes back as it is", () => {
    for (const text of ["", "Bonjour", "Fait.", "a:b", "Rien à voir ici"]) {
      expect(withFrenchSpacing(text)).toBe(text);
    }
  });

  test("a guillemet with nothing inside it keeps its space", () => {
    expect(withFrenchSpacing("« »")).toBe(`«${NB}»`);
    expect(withFrenchSpacing("«  ")).toBe("«  ");
  });

  test("single guillemets are set like double ones", () => {
    expect(withFrenchSpacing("‹ x ›")).toBe(`‹${NB}x${NB}›`);
  });
});

describe("withFrenchSpacingInHtml", () => {
  test("sets a page's text, and never its code, its preformatted text or a tag", () => {
    const html: string = [
      "<p>Remarque :</p>",
      "<pre><code>a ? b : c « d »</code></pre>",
      "<p><strong>Note</strong> : l&#39;équipe ?</p>",
      "<p>Lancez <code>x ? y : z</code> ; puis « voyez ».</p>",
      '<a href="/docs/fr/x" title="Aide : ici">Aide : ici</a>',
      "<script>var a = b ? c : d;</script>",
      "<style>a { color : red; }</style>",
      "<!-- note : interne -->",
    ].join("");

    expect(withFrenchSpacingInHtml(html)).toBe(
      [
        `<p>Remarque${NB}:</p>`,
        "<pre><code>a ? b : c « d »</code></pre>",
        `<p><strong>Note</strong>${NB}: l&#39;équipe${NNB}?</p>`,
        `<p>Lancez <code>x ? y : z</code>${NNB}; puis «${NB}voyez${NB}».</p>`,
        `<a href="/docs/fr/x" title="Aide : ici">Aide${NB}: ici</a>`,
        "<script>var a = b ? c : d;</script>",
        "<style>a { color : red; }</style>",
        "<!-- note : interne -->",
      ].join(""),
    );
  });

  test("a mark after an entity is set", () => {
    expect(withFrenchSpacingInHtml("<p>&quot;Prêt&quot; ?</p>")).toBe(
      `<p>&quot;Prêt&quot;${NNB}?</p>`,
    );
  });

  test("a page with nothing to set comes back as it is", () => {
    const html: string = "<p>Bonjour.</p><pre>a ? b</pre>";

    expect(withFrenchSpacingInHtml(html)).toBe(html);
  });
});

describe("withNumbersKeptWithUnits", () => {
  test("the network site hero's uptime titles, in German (#8043)", () => {
    expect(
      withNumbersKeptWithUnits(
        "Verfügbarkeit ({{hours}} Std.)",
        "Uptime ({{hours}}h)",
      ),
    ).toBe(`Verfügbarkeit ({{hours}}${NB}Std.)`);
    expect(
      withNumbersKeptWithUnits(
        "Verfügbarkeit ({{days}} T.)",
        "Uptime ({{days}}d)",
      ),
    ).toBe(`Verfügbarkeit ({{days}}${NB}T.)`);
  });

  test.each([
    ["Tiempo de actividad ({{hours}} h)", "Uptime ({{hours}}h)"],
    ["Disponibilité ({{days}} j)", "Uptime ({{days}}d)"],
    ["Доступность ({{days}} дн.)", "Uptime ({{days}}d)"],
    ["وقت التشغيل ({{hours}} س)", "Uptime ({{hours}}h)"],
    ["زمان کارکرد ({{days}} روز)", "Uptime ({{days}}d)"],
    ["稼働率（{{hours}} 時間）", "Uptime ({{hours}}h)"],
  ])("%s keeps its number with its unit", (words: string, english: string) => {
    const kept: string = withNumbersKeptWithUnits(words, english);

    expect(kept).not.toMatch(/\}\} /);
    expect(kept.replace(NB, " ")).toBe(words);
  });

  test("a translation that writes no space is left as it is", () => {
    expect(
      withNumbersKeptWithUnits("Oppetid ({{hours}}u)", "Uptime ({{hours}}h)"),
    ).toBe("Oppetid ({{hours}}u)");
  });

  test("English beside its unit with a space, and every unit symbol English writes", () => {
    expect(
      withNumbersKeptWithUnits(
        "Alle {{minutes}} Min.",
        "Every {{minutes}} min",
      ),
    ).toBe(`Alle {{minutes}}${NB}Min.`);
    expect(withNumbersKeptWithUnits("{{value}} мс", "{{value}} ms")).toBe(
      `{{value}}${NB}мс`,
    );
    expect(
      withNumbersKeptWithUnits("{{percent}} % genutzt", "{{percent}}% used"),
    ).toBe(`{{percent}}${NB}% genutzt`);
    expect(
      withNumbersKeptWithUnits("Signal {{dbm}} dBm", "Signal {{dbm}} dBm"),
    ).toBe(`Signal {{dbm}}${NB}dBm`);
    expect(
      withNumbersKeptWithUnits(
        "{{gigabytes}} Go par jour",
        "{{gigabytes}} GB a day",
      ),
    ).toBe(`{{gigabytes}}${NB}Go par jour`);
  });

  test("only the numbers English writes beside a unit: another placeholder keeps its space", () => {
    expect(
      withNumbersKeptWithUnits(
        "{{count}} Sonden in {{minutes}} Min.",
        "{{count}} probes in {{minutes}} min",
      ),
    ).toBe(`{{count}} Sonden in {{minutes}}${NB}Min.`);
  });

  test("a word after a number is no unit", () => {
    for (const english of [
      "{{count}} monitors",
      "{{count}} more",
      "{{count}} days ago",
      "{{count}} hosts",
      "{{count}} services",
      "{{count}} Bytes",
    ]) {
      expect(withNumbersKeptWithUnits("{{count}} x", english)).toBe(
        "{{count}} x",
      );
    }
  });

  test("written digits beside a unit: the same number in the translation", () => {
    expect(withNumbersKeptWithUnits("Letzte 24 Std.", "Last 24h")).toBe(
      `Letzte 24${NB}Std.`,
    );
    expect(
      withNumbersKeptWithUnits(
        "Fichier de moins de 10 Mo.",
        "A file under 10 MB.",
      ),
    ).toBe(`Fichier de moins de 10${NB}Mo.`);
    expect(
      withNumbersKeptWithUnits("99,9 % disponible", "99.9% available"),
    ).toBe(`99,9${NB}% disponible`);
  });

  test("a number in another script's digits is the same number", () => {
    expect(withNumbersKeptWithUnits("آخرین ۲۴ ساعت", "Last 24h")).toBe(
      `آخرین ۲۴${NB}ساعت`,
    );
    expect(withNumbersKeptWithUnits("آخر ٢٤ ساعة", "Last 24h")).toBe(
      `آخر ٢٤${NB}ساعة`,
    );
    expect(withNumbersKeptWithUnits("पिछले २४ घंटे", "Last 24h")).toBe(
      `पिछले २४${NB}घंटे`,
    );
  });

  test("another number keeps its space", () => {
    expect(
      withNumbersKeptWithUnits("Letzte 7 Tage, nicht 24 Std.", "Last 24h"),
    ).toBe(`Letzte 7 Tage, nicht 24${NB}Std.`);
    expect(withNumbersKeptWithUnits("240 Std.", "Last 24h")).toBe("240 Std.");
    expect(withNumbersKeptWithUnits("v24 Std.", "Last 24h")).toBe("v24 Std.");
  });

  test("a placeholder written with spaces inside its braces", () => {
    expect(
      withNumbersKeptWithUnits(
        "Alle {{ minutes }} Min.",
        "Every {{minutes}} min",
      ),
    ).toBe(`Alle {{ minutes }}${NB}Min.`);
  });

  test("code in backticks keeps its spaces", () => {
    expect(
      withNumbersKeptWithUnits(
        "Mit `sleep {{seconds}} s` warten {{seconds}} Sek.",
        "Wait {{seconds}}s with sleep",
      ),
    ).toBe(`Mit \`sleep {{seconds}} s\` warten {{seconds}}${NB}Sek.`);
  });

  test("an English text with no number beside a unit changes nothing", () => {
    expect(
      withNumbersKeptWithUnits("{{count}} Monitore", "{{count}} monitors"),
    ).toBe("{{count}} Monitore");
    expect(withNumbersKeptWithUnits("Speichern", "Save")).toBe("Speichern");
    expect(withNumbersKeptWithUnits("", "Uptime ({{hours}}h)")).toBe("");
  });

  test("the English text itself, beside its unit with a space", () => {
    expect(
      withNumbersKeptWithUnits(
        "Every {{minutes}} min",
        "Every {{minutes}} min",
      ),
    ).toBe(`Every {{minutes}}${NB}min`);
  });

  test("setting twice is setting once", () => {
    const once: string = withNumbersKeptWithUnits(
      "Verfügbarkeit ({{hours}} Std.)",
      "Uptime ({{hours}}h)",
    );

    expect(withNumbersKeptWithUnits(once, "Uptime ({{hours}}h)")).toBe(once);
  });
});

describe("a unit a language writes in two words (#8304)", () => {
  test("Arabic's milliseconds, short: the number and both words of the unit hold", () => {
    // The Dashboard's "{{value}} ms": "411 ملي ث" broke as "411 ملي" over "ث".
    expect(withNumbersKeptWithUnits("{{value}} ملي ث", "{{value}} ms")).toBe(
      `{{value}}${NB}ملي${NB}ث`,
    );
    expect(withNumbersKeptWithUnits("411 ملي ث", "411 ms")).toBe(
      `411${NB}ملي${NB}ث`,
    );
  });

  test("Arabic's milliseconds, long, in each spelling its sentences use, and its nanoseconds", () => {
    for (const unit of [
      ["ملي", "ثانية"],
      ["مللي", "ثانية"],
      ["ميلي", "ثانية"],
      ["نانو", "ثانية"],
    ] as Array<[string, string]>) {
      expect(
        withNumbersKeptWithUnits(
          `المسبار {{offset}} ${unit[0]} ${unit[1]} أو أكثر`,
          "the probe's {{offset}} ms or more",
        ),
      ).toBe(`المسبار {{offset}}${NB}${unit[0]}${NB}${unit[1]} أو أكثر`);
    }
  });

  test("inside a sentence, between brackets and beside another unit", () => {
    expect(
      withNumbersKeptWithUnits(
        "الأحدث: الوسيط {{median}} ملي ث ({{min}}–{{max}} ملي ث)",
        "Latest: {{median}} ms median ({{min}}–{{max}} ms)",
      ),
    ).toBe(
      `الأحدث: الوسيط {{median}}${NB}ملي${NB}ث ({{min}}–{{max}}${NB}ملي${NB}ث)`,
    );
  });

  test("Arabic-Indic digits hold their unit too", () => {
    expect(withNumbersKeptWithUnits("٤١١ ملي ث", "411 ms")).toBe(
      `٤١١${NB}ملي${NB}ث`,
    );
  });

  test("the unit's words where no number is held to them are words a line may break between", () => {
    // "in milliseconds" in prose, and a number English writes with no unit.
    expect(
      withNumbersKeptWithUnits(
        "المدة بالمللي ثانية {{value}} ملي ث",
        "Duration in milliseconds {{value}} ms",
      ),
    ).toBe(`المدة بالمللي ثانية {{value}}${NB}ملي${NB}ث`);
    expect(withNumbersKeptWithUnits("{{count}} ملي ث", "{{count}} rows")).toBe(
      "{{count}} ملي ث",
    );
    expect(withNumbersKeptWithUnits("ملي ث {{value}}", "{{value}} ms")).toBe(
      "ملي ث {{value}}",
    );
  });

  test("a longer word that starts with the unit's second word is no unit", () => {
    expect(withNumbersKeptWithUnits("{{value}} ملي ثقيل", "{{value}} ms")).toBe(
      `{{value}}${NB}ملي ثقيل`,
    );
  });

  test("Persian writes its unit as one word, with a zero-width non-joiner: nothing more to hold", () => {
    expect(
      withNumbersKeptWithUnits("{{value}} میلی‌ثانیه", "{{value}} ms"),
    ).toBe(`{{value}}${NB}میلی‌ثانیه`);
  });

  test("code in backticks keeps its spaces, and setting twice is setting once", () => {
    expect(
      withNumbersKeptWithUnits(
        "`5 ملي ث` {{value}} ملي ث",
        "`5 ms` {{value}} ms",
      ),
    ).toBe(`\`5 ملي ث\` {{value}}${NB}ملي${NB}ث`);

    const once: string = withNumbersKeptWithUnits(
      "{{value}} ملي ث",
      "{{value}} ms",
    );

    expect(withNumbersKeptWithUnits(once, "{{value}} ms")).toBe(once);
  });

  test("through withNoBreakSpaces and a locale, as the Admin Dashboard's i18next is handed it", () => {
    expect(withNoBreakSpaces("{{count}} ملي ث", "{{count}} ms", "ar")).toBe(
      `{{count}}${NB}ملي${NB}ث`,
    );
    expect(
      withNoBreakSpacesInLocale({
        locale: { "{{count}} ms": "{{count}} ملي ث" },
        language: "ar",
      }),
    ).toEqual({ "{{count}} ms": `{{count}}${NB}ملي${NB}ث` });
  });
});

describe("withNoBreakSpaces", () => {
  test("French: its marks and its numbers", () => {
    expect(
      withNoBreakSpaces(
        "Disponibilité ({{days}} j) : {{value}} %",
        "Uptime ({{days}}d): {{value}}%",
        "fr",
      ),
    ).toBe(`Disponibilité ({{days}}${NB}j)${NB}: {{value}}${NB}%`);
  });

  test("another language: its numbers, and its colon as written", () => {
    // A language that writes no space before its colon has none to set.
    expect(
      withNoBreakSpaces(
        "Verfügbarkeit ({{days}} T.): {{value}} %",
        "Uptime ({{days}}d): {{value}}%",
        "de",
      ),
    ).toBe(`Verfügbarkeit ({{days}}${NB}T.): {{value}}${NB}%`);
    // Only French's marks: a space before a mark in another language stays.
    expect(withNoBreakSpaces("Wirklich ?", "Really?", "de")).toBe("Wirklich ?");
  });
});

describe("withNoBreakSpacesInLocale", () => {
  const english: NoBreakLocaleTree = {
    "Archive {{count}} workflows?": "Archive {{count}} workflows?",
    "Archive {{count}} workflows?_one": "Archive {{count}} workflow?",
    "Uptime ({{hours}}h)": "Uptime ({{hours}}h)",
    "Every {{minutes}} min": "Every {{minutes}} min",
    uptimeHistory: {
      dayLabel: "{{date}}: {{uptime}}% uptime",
    },
  };

  test("French: each of its own wordings, nested ones too", () => {
    const french: NoBreakLocaleTree = {
      "Archive {{count}} workflows?": "Archiver {{count}} flux de travail ?",
      "Archive {{count}} workflows?_one":
        "Archiver {{count}} flux de travail ?",
      "Uptime ({{hours}}h)": "Disponibilité ({{hours}} h)",
      uptimeHistory: {
        dayLabel: "{{date}} : {{uptime}} % de disponibilité",
      },
    };

    expect(
      withNoBreakSpacesInLocale({ locale: french, language: "fr", english }),
    ).toEqual({
      "Archive {{count}} workflows?": `Archiver {{count}} flux de travail${NNB}?`,
      "Archive {{count}} workflows?_one": `Archiver {{count}} flux de travail${NNB}?`,
      "Uptime ({{hours}}h)": `Disponibilité ({{hours}}${NB}h)`,
      uptimeHistory: {
        dayLabel: `{{date}}${NB}: {{uptime}}${NB}% de disponibilité`,
      },
    });
  });

  test("a flat key is its own English, plural suffix and mark aside, where no English locale has it", () => {
    expect(
      withNoBreakSpacesInLocale({
        locale: {
          "{{count}} hrs_one": "{{count}} Std.",
          "{{count}} hrs_one_sameAsEnglish": "{{count}} Std.",
          "Uptime ({{hours}}h)": "Verfügbarkeit ({{hours}} Std.)",
        },
        language: "de",
      }),
    ).toEqual({
      "{{count}} hrs_one": `{{count}}${NB}Std.`,
      "{{count}} hrs_one_sameAsEnglish": `{{count}}${NB}Std.`,
      "Uptime ({{hours}}h)": `Verfügbarkeit ({{hours}}${NB}Std.)`,
    });
  });

  test("an English placeholder left in a locale stays English, so the lookup still reads it as none", () => {
    const locale: NoBreakLocaleTree = {
      "Every {{minutes}} min": "Every {{minutes}} min",
      "Archive {{count}} workflows?_one": "Archive {{count}} workflow?",
    };

    expect(withNoBreakSpacesInLocale({ locale, language: "fr", english })).toBe(
      locale,
    );
  });

  test("the locale handed in is never changed", () => {
    const locale: NoBreakLocaleTree = {
      "Uptime ({{hours}}h)": "Verfügbarkeit ({{hours}} Std.)",
      nested: { "Really?": "Vraiment ?" },
    };
    const copy: string = JSON.stringify(locale);
    const set: NoBreakLocaleTree = withNoBreakSpacesInLocale({
      locale,
      language: "fr",
    });

    expect(JSON.stringify(locale)).toBe(copy);
    expect(set).not.toBe(locale);
    expect((set["nested"] as NoBreakLocaleTree)["Really?"]).toBe(
      `Vraiment${NNB}?`,
    );
  });

  test("English, and a locale with nothing to set, come back as the same object", () => {
    expect(withNoBreakSpacesInLocale({ locale: english, language: "en" })).toBe(
      english,
    );

    const german: NoBreakLocaleTree = { Save: "Speichern", n: { a: "b" } };

    expect(withNoBreakSpacesInLocale({ locale: german, language: "de" })).toBe(
      german,
    );
  });

  test("what is no string - a number, an array - is kept as it is", () => {
    const locale: NoBreakLocaleTree = {
      count: 3,
      list: ["a ?", "b"],
      "Really?": "Vraiment ?",
    };
    const set: NoBreakLocaleTree = withNoBreakSpacesInLocale({
      locale,
      language: "fr",
    });

    expect(set["count"]).toBe(3);
    expect(set["list"]).toBe(locale["list"]);
    expect(set["Really?"]).toBe(`Vraiment${NNB}?`);
  });
});
