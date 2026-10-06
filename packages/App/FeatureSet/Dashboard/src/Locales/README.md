# Dashboard translations

The Dashboard is translated into 16 languages: `de fr es it pt nl da no sv ru ja ko zh-CN zh-TW hi fa`.
This file explains how a string gets from the source code to the screen in the
reader's language, how to route new strings through translation, how to fill in
a language, and the rules the guard test enforces.

## How it works

- **The key is the English text.** `en.json` maps `"No monitors yet."` to
  itself; `de.json` maps it to `"Noch keine Monitore."`. A handful of older keys
  are nested (`navbar.items.formsTitle`, `commandPalette.actions.logOut`) and
  are read with `t("navbar.items.formsTitle")`.
- **English is the fallback.** A key that is missing, or whose value is still
  the English text, shows English. StatusPage, Accounts and AdminDashboard
  have small locale files of their own, and PublicDashboard has none. They
  render the same shared components, so a shared component's sentence reads
  English there unless that app's file has the key.
- **A sentence is translated whole, or not at all.** A sentence with a value in
  it is one key with a `{{placeholder}}` (`"Delete {{itemName}}"`). A locale
  moves the placeholder wherever its grammar puts it (`"{{itemName}} löschen"`).
  When the locale has no translation of the sentence, the whole sentence is
  English, the model name included. You never get a German name inside an
  English sentence.
- **Plurals.** A count-dependent sentence is a `PluralTemplate`
  `{ one: "{{count}} monitor", other: "{{count}} monitors" }`. In `en.json` the
  `other` sentence is the key, and `"<key>_one"` holds the `one` sentence. A
  locale translates both. The `_one` form is used for the counts its language
  calls "one" (`Intl.PluralRules`: 1 in German, 21 in Russian, 0 and 1 in
  French). The general form is used for every other count. A language with more
  forms (Russian) writes its general form so it reads right for any count:
  `"Мониторов: {{count}}"`. Japanese, Korean and Chinese have no "one" form, so
  their `_one` key is never shown and may stay English. Locale files hold
  exactly `en.json`'s keys. Never add `_few`, `_many` or other suffixes.
- **Model names in sentences.** A model's `singularName`/`pluralName` goes into
  a sentence as `translatableTerm(name, { inSentence: true })`. It is translated
  along with the sentence and cased for mid-sentence use in the reader's
  language: "No incidents yet." in English, "Noch keine Vorfälle." in German,
  whose nouns keep their capital. Acronyms and brand names keep their casing.
- **Values built from translated pieces.** Clauses joined into one sentence,
  or names joined with "or", go into a sentence as
  `composedValue((translator) => ...)`, built with the `translator` they are
  handed. That is the reader's when their language words the sentence, and
  English otherwise, so a locale that words the pieces but not the sentence
  still reads one English sentence. A list's separators and its "and"/"or"
  are keys of their own (`"{{first}}, {{second}} or {{third}}"`).
- **Numbers** in a plural `{{count}}` are written the reader's way (`1.234` in
  German). Pass your own `count` value to override.
- **What ships.** The files here keep every key, so the tooling can track
  what is left to translate. The bundle carries only what a reader can tell
  apart (`Common/UI/esbuild-locales.js`, wired in the Dashboard's
  `esbuild.config.js`). `en.json` ships without the entries that map to
  themselves: the lookup passes the English as its default, so a missing one
  reads the same. It ships without its `_one` forms too: the code hands
  `translatePlural` the English `one` sentence, so an English reader never
  needs them. Its nested keys ship. Every other locale ships without the
  strings that equal `en.json`'s, its English placeholders and its
  same-as-English strings: i18next falls back to English, which the entry
  chunk always holds. A language with a "one" form also ships every `_one`
  form, translated or still English, since `en.json` no longer carries them;
  Japanese, Korean and Chinese never read one. So `en.json` adds about 10 KB
  to the entry chunk instead of 1.8 MB, however many plurals there are, and a
  locale's chunk holds its translations and the `_one` forms it reads. Read
  strings through the lookups above only, and a `_one` key only as the plural
  it belongs to. `i18n.exists()` or `getResourceBundle()` would see the
  shipped copy, not these files.

Everything above lives in `Common/UI/Utils/TranslateTemplate.ts`, which has a
`Translator` with `translateText`, `translateTemplate`, `translatePlural`,
`translateTerm`, `hasTranslation` and `formatNumber`.

## Routing a string through translation (stage 2)

The goal: every string a Dashboard reader sees is looked up at run time, and
`npm run i18n:extract` can find it in the source. Two rules cover nearly every
case:

1. **Hand English literals to the shared components.** They translate their
   own text props: Card `title`/`description`, ModelTable, ModelDetail and form
   field `title`/`description`/`placeholder`, Button `title`, Modal `title` and
   button texts, Pill and StatusBadge `text`, Tooltip `text`, MoreMenuItem,
   Checkbox, CollapsibleSection, SideOver, Link, EmptyState, the "What AI may
   do" building blocks (`Components/AiAccess/AiAccessRow.tsx`), and more. Do not
   translate a prop before you pass it. Write it as a literal, so the extractor
   sees it. `USER_FACING_PROPS` in `scripts/i18n/ExtractStrings.ts` lists the
   prop names the extractor reads.
2. **Look up everything you render yourself**, as a whole sentence.

### In a React component

```tsx
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  composedValue,
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

const translator: Translator = useTranslator();

// Fixed text.
<p>{translator.translateText("No monitors yet.")}</p>

// A sentence with values. Never glue pieces together.
translator.translateTemplate("Monitor {{name}} is {{status}}.", {
  name: monitor.name,                               // inserted as is
  status: translatableTerm(statusName, { inSentence: true }), // translated
});

// A count.
translator.translatePlural(
  { one: "{{count}} monitor selected", other: "{{count}} monitors selected" },
  count,
);

// A list built from translated pieces, in the sentence's language
// (formatNameList: Components/AiAccess/AiAccessModes.ts).
translator.translateTemplate("Changing this needs {{permissions}}.", {
  permissions: composedValue((sentence: Translator): string => {
    return formatNameList(permissionTitles, "or", sentence);
  }),
});
```

`useTranslateValue()` (`Common/UI/Utils/Translation`) has the same helpers
plus `translateString`, and many pages already use it. `t()` from
`react-i18next` is for the nested keys only.

**A sentence with a link, bold text or another element inside it.** Use
`TranslatedSentence` (`Common/UI/Components/TranslatedSentence/TranslatedSentence`)
so the locale can move the element:

```tsx
<TranslatedSentence
  template="Read the {{guide}} before you enable SSO."
  slots={{ guide: <Link to={GUIDE}>{translator.translateText("setup guide")}</Link> }}
/>
```

**An action on a model** ("Edit Monitor", "Delete Status Page"):
`translateNamedAction(translator, { template: "Edit {{itemName}}", itemName: model.singularName })`.
It looks up the whole English phrase first, so a locale can word one model's
button its own way. If there is no entry for the phrase, it fills the template.

### Outside a component (utilities, validators, enum labels)

Use the global functions in `Common/UI/Utils/TranslateTemplate.ts`:
`translateText`, `translateTemplate`, `translatePlural`, `translateTerm`, or
`getGlobalTranslator()`. They read the Dashboard's i18next instance, and
answer in English before it is set up, or in an app that has none.

Translate **when the string is shown**, not when a module loads, because the
reader can switch language at any time. Keep English constants and look them up
where you render them. A template kept in a constant must be wrapped in
`translationKey()` so the extractor finds it:

```ts
export const NO_MATCH: string = translationKey("No {{itemsName}} match these filters.");
```

The extractor does not read a label map keyed by an enum
(`{ [MonitorType.API]: "API Monitor" }`). Wrap each label in
`translationKey()`, and look the label up where you render it.

### What to leave alone

- Data the user typed: names, descriptions, label values.
- Identifiers, URLs, code, JSON keys, CSS classes, `data-testid` values,
  analytics event names.
- Brand and product names. They read the same in every language. Add them to
  `i18n/SameAsEnglish.json` if they stand alone as a key.

### After routing a directory

```sh
cd packages/App/FeatureSet/Dashboard
npm run i18n:hardcoded -- --dir Pages/Monitors   # what is still hard-coded there
npm run i18n:extract                             # new keys -> en.json, English placeholders -> every locale
npm run i18n:check                               # every file sound, no translation lost
```

Then commit `src/Locales/*.json` with your code. The new keys are untranslated
(English) in every locale, and that is expected. Stage 3 translates them, and
the guard test allows untranslated keys to grow by exactly the keys you added.
Routing never needs `i18n:baseline`. Leave `i18n/Progress/` to the
translators.

`npm run i18n:hardcoded -- --summary` counts what is left per directory. The
three columns are element text (`text`), plain HTML attributes such as `title`,
`placeholder`, `aria-label` and `alt` (`html`), and sentences glued from pieces
with template literals or `+` (`composed`). Some of these are not copy, such as
a unit, a code sample or a format string. The list is a work list, not a test.

The extractor reads `Dashboard/src`, `Common/UI` and the database and
analytics models' names and column titles. To route strings that live
elsewhere, add the directory to `SOURCE_ROOTS` in
`scripts/i18n/ExtractStrings.ts`. Examples: `Common/Types` catalogs such as
permission descriptions, monitor-type descriptions and workflow components.

## Filling in a language (stage 3)

Work on **one locale**, and touch only its two files:
`src/Locales/<code>.json` and `i18n/Progress/<code>.json`. Never edit `en.json`
or another locale. Agents translating different languages then never conflict.

```sh
cd packages/App/FeatureSet/Dashboard
npm run i18n:check -- --locale de --list                              # what is left
npm run i18n:export -- --locale de --limit 500 --out /tmp/de-1.json   # { key: English }, in en.json order
# translate the values in /tmp/de-1.json: keep every key and every {{placeholder}}
npm run i18n:apply -- --locale de --file /tmp/de-1.json               # checks each value, then writes de.json
npm run i18n:baseline -- --locale de                                  # ratchet: record the lower count
```

Use `--offset` to page through the export. `apply` rejects a value that is
empty, changes the `{{placeholders}}`, belongs to a key `en.json` lacks, or is
identical to the English. If a string really reads the same in your language
(for example "Status" in German), put it in a file of its own and apply it with
`--same-as-english`. That records it in `i18n/Progress/<code>.json`, so it no
longer counts as untranslated.

Translation guidelines:

- Translate the meaning for a UI, not word by word. Keep it short, because
  buttons and table headers have little room.
- Use the terms the locale file already uses for a concept. Search `<code>.json`
  for the English word.
- Keep `{{placeholders}}` exactly, and move them where your grammar wants them.
  A `{{value}}` filled with a model name arrives already translated.
- Keep what `en.json` ends with: a sentence's full stop, a question mark, a
  colon, `…`.
- Plural keys: translate the general key so it reads right for any count, and
  translate `<key>_one` for your "one" form. In ja/ko/zh-CN/zh-TW, `_one` is
  never shown, so translate it the same as the general form or leave it.

## What "untranslated" means

A locale must have every `en.json` key and no others. A key is
**untranslated** when its value is missing or exactly the English text, unless
that is right for it:

- the English has no letters (`"{{count}}"`, `"—"`, `"1-10"`);
- the English is on the global list `i18n/SameAsEnglish.json` (brands,
  protocols, code, examples);
- the English is on the locale's own list in `i18n/Progress/<code>.json`
  (`"sameAsEnglish"`);
- the key is a `_one` form in a language without that form (ja, ko, zh-CN,
  zh-TW).

`npm run i18n:check` prints, per locale, the keys, the untranslated count, the
values excused as the same as English, the problems, and the baseline status.
Use `--list` for the keys and `--json` for a machine-readable report.

## The guard test

`packages/App/Tests/Dashboard/DashboardLocalesGuard.test.ts` runs in CI and
fails when any of these breaks:

- `en.json` maps every flat key to itself (except `_one` forms), has no empty
  value, and is in canonical form (two-space JSON with a trailing newline).
- Every locale has every `en.json` key and nothing else. Every value is a
  non-empty string with the English `{{placeholders}}`, and the keys follow
  `en.json`'s order. `npm run i18n:extract` restores the order.
- **No translation is ever lost.** Each locale's untranslated count may exceed
  its recorded baseline only by the number of keys added since the baseline:
  `untranslated - baseline.untranslated <= keys - baseline.keys`. Translating
  lowers the count. `npm run i18n:baseline` records the lower count, and it
  refuses to record a higher one without `--force`.
- The same-as-English lists are sorted, have no repeats, and name only English
  that `en.json` has.
- Every nested key a `t("a.b")` call reads in the Dashboard's code or
  `Common/UI` is in `en.json`. i18next shows a missing nested key as the key
  itself. Give the call its English (`t("a.b", "English")`) and run
  `npm run i18n:extract`.

`Scripts/I18n/ValidateLocales.js` (the repository-wide validator) checks the
same key parity and placeholders.

What ships is tested apart from the files.
`packages/Common/Tests/UI/EsbuildLocales.test.ts` builds the real locale files
with the Dashboard's `esbuild.config.js`. It checks that each language ships
exactly what the plugin keeps, that only English is in the entry chunk, that
the `_one` forms ship with the languages that read them and not with English,
and that `en.json`'s share of the entry stays under 32 KB.
`packages/Common/Tests/App/Dashboard/DashboardRuntimeLocales.test.tsx` checks
that every string in all seventeen languages reads the same from the shipped
copies as from these files, every plural at counts that pick each form, and
that no source looks a `_one` key up on its own.

## Merging and conflicts

`npm run i18n:extract` is deterministic. Existing keys keep their place, and new
flat keys go **at the end of `en.json`, sorted**. A new nested object goes after
the last one. Every locale mirrors `en.json`'s order. Running it twice changes
nothing.

Two branches that both add keys therefore meet at the end of `en.json` and of
every locale file, and git reports a conflict. To resolve it, run extract during
the merge:

```sh
git fetch origin master && git merge origin/master    # conflicts in src/Locales/*.json
cd packages/App/FeatureSet/Dashboard
npm run i18n:extract    # reads git's merge stages (or the conflict markers) and merges both sides
npm run i18n:check
git add src/Locales && git commit --no-edit
```

When both sides changed one value, a translation wins over an English
placeholder. Otherwise the branch being merged into wins. A conflict in a
progress file (`i18n/Progress/<code>.json`) only happens if two branches
translated the same locale. Take either side, then run
`npm run i18n:baseline -- --locale <code>`.

## Files

| Path | What it is |
| --- | --- |
| `src/Locales/en.json` | Every key. It is written by `i18n:extract`. Do not edit it by hand, except to fix a nested key's English. |
| `src/Locales/<code>.json` | One language. It mirrors `en.json` key for key. |
| `i18n/SameAsEnglish.json` | English that reads the same in every language. |
| `i18n/Progress/<code>.json` | The locale's baseline and its own same-as-English list. |
| `scripts/i18n/ExtractStrings.ts` | Finds user-facing strings in the TypeScript syntax tree. |
| `scripts/i18n/LocaleFiles.ts` | Reads, orders, aligns and merges locale files. |
| `scripts/i18n/LocaleStatus.ts` | What counts as untranslated, problems, and baselines. |
| `scripts/i18n/I18n.ts` | The `npm run i18n:*` commands. |
| `Common/UI/esbuild-locales.js` | The build plugin that ships each locale without what the English fallback already shows. |

## Not covered yet

- Dates and relative times are formatted by Moment in English.
- The `Common/Types` catalogs are not scanned: permissions, monitor-type and
  workflow-component descriptions.
- `ee/Dashboard` and documentation markdown are not scanned.
