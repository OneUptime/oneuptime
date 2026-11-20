import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import { BROWSER_SETUP, SESSION_REPLAY } from "./RumDocsPages";
import { DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE } from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A BROWSER KEY IS SAID TO BE PUBLIC BEFORE ANYONE PASTES IT INTO A PAGE
 * (#7503).
 *
 * Session Replay's install step, and Browser Setup's, said to pick Browser
 * as the key type and "copy the key's Secret Key" - and the next step puts
 * that value in every page's HTML. Publishing something called a secret
 * made a careful reader stop, and a less careful one reach for a Server
 * key, which is none of what makes a Browser key safe to publish. Both
 * steps now say, in every language, that a Browser key is meant to be
 * public, why, and that a Server key never goes in a page - in the same
 * paragraph as the copy, so it is read before the paste.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");

const KEY_VIEW: string = fs.readFileSync(
  path.join(
    REPO_ROOT,
    "packages/App/FeatureSet/Dashboard/src/Pages/Settings/TelemetryIngestionKeyView.tsx",
  ),
  "utf8",
);

// The sentence, as each language writes it.
const PUBLIC: Record<string, string> = {
  en: "A Browser key is meant to be public: it works only from the origins you list, sends only browser telemetry and session replays, and is rate-limited. Never put a Server key in a page.",
  da: "En Browser-nøgle er beregnet til at være offentlig: Den virker kun fra de oprindelser, du angiver, sender kun browsertelemetri og sessionsafspilninger og har en grænse for antal forespørgsler. Læg aldrig en Server-nøgle i en side.",
  de: "Ein Browser-Schlüssel ist dafür gedacht, öffentlich zu sein: Er funktioniert nur von den Ursprüngen aus, die Sie angeben, sendet nur Browser-Telemetrie und Sitzungswiedergaben und hat eine Obergrenze für Anfragen. Legen Sie nie einen Server-Schlüssel in eine Seite.",
  es: "Una clave Navegador está pensada para ser pública: solo funciona desde los orígenes que indiques, solo envía telemetría del navegador y reproducciones de sesiones, y tiene un límite de solicitudes. No pongas nunca una clave de Servidor en una página.",
  fa: "کلید Browser قرار است عمومی باشد: فقط از مبدأهایی که فهرست می‌کنید کار می‌کند، فقط تله‌متری مرورگر و بازپخش‌های نشست را می‌فرستد و سقفی برای شمار درخواست‌ها دارد. هرگز کلید سرور را در صفحه نگذارید.",
  fr: "Une clé Navigateur est faite pour être publique : elle ne fonctionne que depuis les origines que vous listez, n'envoie que la télémétrie du navigateur et les relectures de session, et son nombre de requêtes est limité. Ne mettez jamais une clé Serveur dans une page.",
  hi: "Browser कुंजी सार्वजनिक होने के लिए ही बनी है: यह केवल उन्हीं ओरिजिन से काम करती है जिन्हें आप सूचीबद्ध करते हैं, केवल ब्राउज़र टेलीमेट्री और सेशन रीप्ले भेजती है, और इस पर अनुरोधों की सीमा लागू होती है। किसी पेज में कभी भी सर्वर कुंजी न रखें।",
  it: "Una chiave Browser è pensata per essere pubblica: funziona solo dalle origini che elenchi, invia solo telemetria del browser e riproduzioni delle sessioni, e ha un limite di richieste. Non mettere mai una chiave Server in una pagina.",
  ja: "Browser キーは公開される前提のキーです。指定したオリジンからしか機能せず、送れるのはブラウザーのテレメトリとセッションリプレイだけで、リクエスト数にも上限があります。サーバーキーは決してページに入れないでください。",
  ko: "Browser 키는 공개되는 것을 전제로 한 키입니다. 지정한 출처에서만 작동하고, 브라우저 텔레메트리와 세션 리플레이만 보낼 수 있으며, 요청 수에도 한도가 있습니다. 서버 키는 절대 페이지에 넣지 마세요.",
  nl: "Een Browser-sleutel is bedoeld om openbaar te zijn: hij werkt alleen vanaf de origins die je opgeeft, verstuurt alleen browsertelemetrie en sessieherhalingen en heeft een limiet op het aantal verzoeken. Zet nooit een Server-sleutel in een pagina.",
  no: "En Browser-nøkkel er ment å være offentlig: Den virker bare fra opprinnelsene du oppgir, sender bare nettlesertelemetri og øktavspillinger og har en grense for antall forespørsler. Legg aldri en Server-nøkkel i en side.",
  pt: "Uma chave Browser foi feita para ser pública: só funciona a partir das origens que você lista, só envia telemetria do navegador e reproduções de sessão, e tem um limite de requisições. Nunca coloque uma chave Servidor em uma página.",
  ru: "Ключ Browser задуман как публичный: он работает только с источников, которые вы укажете, отправляет только телеметрию браузера и записи сеансов, а число его запросов ограничено. Никогда не размещайте на странице серверный ключ.",
  sv: "En Browser-nyckel är tänkt att vara offentlig: Den fungerar bara från de ursprung som du anger, skickar bara webbläsartelemetri och sessionsuppspelningar och har en gräns för antalet förfrågningar. Lägg aldrig en Server-nyckel i en sida.",
  "zh-CN":
    "Browser 密钥本来就是公开的：它只在你列出的来源上有效，只能发送浏览器遥测和会话回放，并且有请求速率限制。切勿将服务器密钥放进页面。",
  "zh-TW":
    "Browser 金鑰本來就是公開的：它只在你列出的來源上有效，只能傳送瀏覽器遙測和工作階段重播，而且有請求速率限制。切勿把伺服器金鑰放進頁面。",
};

// Browser Setup's Japanese names the key as the rest of that page does.
function sentenceOn(page: string, language: string): string {
  const sentence: string = PUBLIC[language] as string;

  return page === BROWSER_SETUP && language === "ja"
    ? sentence.replace("Browser キー", "ブラウザーキー")
    : sentence;
}

// The one line of `page` that holds `needle`.
function lineWith(language: string, page: string, needle: string): string {
  const lines: Array<string> = readPage(language, page)
    .split("\n")
    .filter((line: string): boolean => {
      return line.includes(needle);
    });

  expect({ language, page, lines: lines.length }).toEqual({
    language,
    page,
    lines: 1,
  });

  return lines[0] as string;
}

describe("both install steps say a Browser key is public", () => {
  it("has a sentence for every docs language", () => {
    expect(Object.keys(PUBLIC).sort()).toEqual([...DOCS_LANGUAGES].sort());
  });

  for (const language of DOCS_LANGUAGES) {
    it(`${language}: Session Replay's "Create a Browser key" step says it where the key is copied`, () => {
      const sentence: string = sentenceOn(SESSION_REPLAY, language);
      const line: string = lineWith(language, SESSION_REPLAY, sentence);

      // The step's own paragraph: the key type, the origins, the copy.
      expect(line).toContain("/docs/rum/browser-setup#");
      expect(line.indexOf(sentence)).toBeGreaterThan(0);
      // After the copy, before the link to the screens.
      expect(line.indexOf(sentence)).toBeLessThan(line.indexOf("]("));
    });

    it(`${language}: Browser Setup's key step says it where the key is copied`, () => {
      const sentence: string = sentenceOn(BROWSER_SETUP, language);
      const line: string = lineWith(language, BROWSER_SETUP, sentence);

      expect(line).toContain("`x-oneuptime-token`");
      expect(line.indexOf(sentence)).toBeGreaterThan(
        line.indexOf("`x-oneuptime-token`"),
      );
    });
  }

  it("is true to the product: a Browser key is rate-limited and the key's page calls it safe to publish", () => {
    expect(DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE).toBeGreaterThan(0);
    expect(KEY_VIEW).toContain(
      "Safe to publish in a page. Accepted only from the allowed origins below",
    );
    expect(KEY_VIEW).toContain("never ship it to a browser");
  });

  it("English: the step reads the copy, then why publishing it is fine", () => {
    expect(
      lineWith("en", SESSION_REPLAY, "Then copy the key's **Secret Key**."),
    ).toContain(`Then copy the key's **Secret Key**. ${PUBLIC["en"]}`);
    expect(lineWith("en", BROWSER_SETUP, "Copy its **Secret Key**")).toContain(
      `it is the token the SDK sends as \`x-oneuptime-token\`. ${PUBLIC["en"]}`,
    );
  });
});
