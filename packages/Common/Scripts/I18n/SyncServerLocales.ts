import { syncServerLocales } from "./ServerLocales";

/*
 * npm run i18n:server-sync (from the repository's root): en.json of the
 * server's locale set from the sentences its code and email templates look
 * up, and every other language aligned to it - a new sentence in English,
 * to be translated, a sentence no longer looked up gone. Running it twice
 * changes nothing. See Common/Server/Locales/README.md.
 */
const changed: Array<string> = syncServerLocales();

// eslint-disable-next-line no-console
console.log(
  changed.length > 0
    ? `Updated:\n${changed.join("\n")}`
    : "The server's locale files are up to date.",
);
