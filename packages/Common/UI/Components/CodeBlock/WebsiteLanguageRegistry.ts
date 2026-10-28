/*
 * THE GRAMMARS THE WEBSITE'S OPENTELEMETRY GUIDES HIGHLIGHT ON THE SERVER.
 *
 * The guides (packages/Home/Utils/Integrations/OpenTelemetry) colour their
 * code where the page is made, with the Dashboard's highlight.js core and
 * grammars (LanguageRegistry.ts). They also show Java, Kotlin, Java
 * .properties and INI files, which no Dashboard code block shows, so those
 * four grammars are registered here, on the same core, and the Dashboard's
 * eager bundle stays the size it is. Only the website, which highlights on
 * its server, imports this file: Tests/UI/Components/WebsiteLanguageRegistry
 * holds every frontend to that.
 */
import hljs from "./LanguageRegistry";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import kotlin from "highlight.js/lib/languages/kotlin";
import properties from "highlight.js/lib/languages/properties";

hljs.registerLanguage("java", java);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("properties", properties);
hljs.registerLanguage("ini", ini);

// The languages this file adds to the Dashboard's.
export const WEBSITE_ONLY_LANGUAGES: ReadonlyArray<string> = [
  "java",
  "kotlin",
  "properties",
  "ini",
];

export { resolveRegisteredLanguage } from "./LanguageRegistry";

export default hljs;
