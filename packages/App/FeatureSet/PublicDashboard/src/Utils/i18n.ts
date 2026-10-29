import { startVisitorTranslation } from "Common/UI/Utils/VisitorLanguage";

import en from "../Locales/en.json";
import de from "../Locales/de.json";
import fr from "../Locales/fr.json";
import es from "../Locales/es.json";
import it from "../Locales/it.json";
import pt from "../Locales/pt.json";
import nl from "../Locales/nl.json";
import da from "../Locales/da.json";
import no from "../Locales/no.json";
import sv from "../Locales/sv.json";
import ru from "../Locales/ru.json";
import ja from "../Locales/ja.json";
import ko from "../Locales/ko.json";
import zhCN from "../Locales/zh-CN.json";
import zhTW from "../Locales/zh-TW.json";
import hi from "../Locales/hi.json";
import fa from "../Locales/fa.json";

/*
 * A public dashboard's words in its visitor's language - the browser's, as
 * nothing on the page picks one (Common/UI/Utils/VisitorLanguage). Its
 * locale files hold what a visitor reads while the page moves onto a new
 * version of OneUptime or cannot load (ChunkLoadRecovery), as a status
 * page words it, and the screen an error draws (ErrorBoundary), whose
 * buttons are those words too; the dashboard itself stays as it is drawn.
 */
export const PUBLIC_DASHBOARD_LANGUAGE: string = startVisitorTranslation({
  en,
  de,
  fr,
  es,
  it,
  pt,
  nl,
  da,
  no,
  sv,
  ru,
  ja,
  ko,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  hi,
  fa,
});
