/*
 * EACH LANGUAGE'S ONE WORD FOR THE AUTHENTICATOR APP (#10915).
 *
 * The sign-in page (Accounts), User Profile > Security (Dashboard) and the
 * setup key both of them draw (AuthenticatorAppSetupCode) named the
 * authenticator app two or three ways in one language. Hindi's sign-in page
 * offered "प्रमाणीकरण ऐप", asked for the code from the "प्रमाणक ऐप", and
 * the Dashboard's card was titled "ऑथेंटिकेटर ऐप"; Danish said
 * autentifikator-app beside godkendelsesapp, Portuguese the European
 * aplicação de autenticação beside the Brazilian aplicativo and app, and
 * Persian برنامهٔ احراز هویت beside اپلیکیشن احراز هویت. German and Spanish
 * said another word in a few sentences too. The two guards that read these
 * words wanted two different ones (#10915).
 *
 * Each language now says the word its Dashboard's Authenticator apps card
 * says - the rulebook's "the one its menus say" - on the sign-in pages, in
 * the Dashboard and the Admin Dashboard, in the server's messages and in
 * the docs:
 *
 *   - word: the one word, in the forms a sentence needs (a plural, a case
 *     ending, an article joined to it), as a pattern;
 *   - dropped: the words the language said for it beside the one, which
 *     no string and no docs page says any more.
 *
 * Read by AuthenticatorAppWordPerLanguage (every app's words and the docs),
 * SecurityPageWordsInEveryLanguage (the Dashboard's Security pages) and
 * AuthenticatorSetupKeyLocales (the setup key on the sign-in pages).
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export interface AuthenticatorAppWord {
  word: RegExp;
  dropped?: RegExp | undefined;
}

export const AUTHENTICATOR_APP_WORDS: Readonly<
  Record<string, AuthenticatorAppWord>
> = {
  de: { word: /Authenticator-Apps?/, dropped: /Authentifizierungs-Apps?/ },
  fr: { word: /applications? d['’]authentification/i },
  es: {
    word: /aplicaci(?:ón|ones) de autenticación/i,
    dropped: /\bapps? de autenticación/i,
  },
  it: { word: /app di autenticazione/i },
  pt: {
    word: /\bapps? autenticador(?:es)?/i,
    dropped:
      /\baplicativos? autenticador|\baplicativos? de autenticação|\baplicaç(?:ão|ões) de autenticação/i,
  },
  nl: { word: /authenticator-apps?/i },
  da: { word: /godkendelsesapp/i, dropped: /autentifikator-?app/i },
  no: { word: /autentiseringsapp/i },
  sv: { word: /autentiseringsapp/i },
  // In every case: приложение-, приложения-, приложении-аутентификатор…
  ru: { word: /приложени\p{L}*-аутентификатор/iu },
  ja: { word: /認証アプリ/ },
  ko: { word: /인증 앱/ },
  "zh-CN": { word: /身份验证器应用/ },
  "zh-TW": { word: /驗證器應用程式/ },
  hi: { word: /ऑथेंटिकेटर ऐप/, dropped: /प्रमाणीकरण ऐप|प्रमाणक ऐप/ },
  fa: {
    word: /اپلیکیشن(?:‌های)? احراز هویت/,
    dropped: /برنامه(?:ٔ|ی|‌ی|‌های)?\s?احراز هویت/,
  },
  // With and without its article: تطبيق مصادقة, تطبيق المصادقة, تطبيقات…
  ar: { word: /تطبيق(?:ات)? (?:ال)?مصادقة/ },
};

// Every language the authenticator app is named in, English aside.
export const AUTHENTICATOR_APP_LANGUAGES: ReadonlyArray<string> = Object.keys(
  AUTHENTICATOR_APP_WORDS,
);
