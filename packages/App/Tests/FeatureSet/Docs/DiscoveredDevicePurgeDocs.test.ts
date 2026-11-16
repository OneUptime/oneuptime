import { describe, expect, test } from "@jest/globals";
import NetworkEndpointService from "Common/Server/Services/NetworkEndpointService";
import SoftDeletedRowsPurge, {
  SOFT_DELETED_ROWS_RETENTION_IN_DAYS,
} from "Common/Server/Utils/Retention/SoftDeletedRowsPurge";
import { MORE_SETTINGS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import DiscoveredDeviceRetentionCopy from "../../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredDevices/DiscoveredDeviceRetentionCopy";
import {
  NETWORK_DEVICE_PAGE,
  drawnPath,
  sectionInLanguage,
} from "./NetworkDocsLabels";

/*
 * Issue #6528: a discovered device the age-out removes is soft deleted, kept
 * in the database for 30 days, and then deleted for good - on every
 * installation, since NetworkEndpointService opts in to the daily purge of
 * soft-deleted rows, which elsewhere runs only where billing is on. The
 * network device guide's paragraph on unseen devices says so, in every docs
 * language, and the English guide says what the code does.
 */

const SECTION_HEADING: string = "### Discovered devices";

// What each language's paragraph on unseen devices ends with.
const DELETED_FOR_GOOD: Readonly<Record<string, string>> = {
  en: "Removed devices stay in the database for 30 days and are then deleted for good, on every installation, self-hosted ones included.",
  da: "Fjernede enheder bliver i databasen i 30 dage og slettes derefter permanent, på alle installationer, også selvhostede.",
  de: "Entfernte Geräte bleiben 30 Tage lang in der Datenbank und werden dann endgültig gelöscht, bei jeder Installation, auch bei selbst gehosteten.",
  es: "Los dispositivos eliminados permanecen en la base de datos durante 30 días y después se eliminan para siempre, en todas las instalaciones, incluidas las autoalojadas.",
  fa: "دستگاه‌های حذف‌شده 30 روز در پایگاه داده می‌مانند و سپس برای همیشه پاک می‌شوند، در همهٔ نصب‌ها، از جمله نصب‌های خودمیزبان.",
  fr: "Les équipements retirés restent 30 jours dans la base de données, puis sont supprimés définitivement, sur toutes les installations, auto-hébergées comprises.",
  hi: "हटाए गए डिवाइस 30 दिनों तक डेटाबेस में रहते हैं और फिर स्थायी रूप से मिटा दिए जाते हैं, हर इंस्टॉलेशन पर, सेल्फ़-होस्टेड इंस्टॉलेशन पर भी।",
  it: "I dispositivi rimossi restano nel database per 30 giorni e poi vengono eliminati definitivamente, su ogni installazione, comprese quelle self-hosted.",
  ja: "一覧から削除されたデバイスは、30 日間データベースに保持された後、完全に削除されます。これはセルフホストのインストールを含む、すべてのインストールで同じです。",
  ko: "목록에서 삭제된 디바이스는 30일 동안 데이터베이스에 보관된 뒤 영구히 삭제됩니다. 자체 호스팅 설치를 포함한 모든 설치에서 마찬가지입니다.",
  nl: "Verwijderde apparaten blijven 30 dagen in de database en worden daarna voorgoed verwijderd, op elke installatie, ook op een zelf gehoste.",
  no: "Fjernede enheter blir værende i databasen i 30 dager og slettes deretter for godt, på alle installasjoner, også selvhostede.",
  pt: "Dispositivos removidos ficam no banco de dados por 30 dias e depois são excluídos de vez, em todas as instalações, inclusive nas auto-hospedadas.",
  ru: "Удалённые устройства хранятся в базе данных 30 дней, а затем удаляются навсегда, в любой установке, в том числе самостоятельно размещённой.",
  sv: "Borttagna enheter finns kvar i databasen i 30 dagar och raderas sedan permanent, på alla installationer, även självhostade.",
  "zh-CN":
    "被删除的设备会在数据库中保留 30 天，然后被永久删除，包括自托管安装在内的所有安装都是如此。",
  "zh-TW":
    "被刪除的裝置會在資料庫中保留 30 天，然後被永久刪除，包括自行託管的安裝在內的所有安裝都是如此。",
};

// The paragraph on unseen devices: the one naming the setting's path.
function ageOutParagraph(language: string): string {
  const path: string = drawnPath(language, [
    MORE_SETTINGS_SECTION_TITLE,
    DiscoveredDeviceRetentionCopy.cardTitle,
    DiscoveredDeviceRetentionCopy.label,
  ]);
  const paragraphs: Array<string> = sectionInLanguage(
    language,
    NETWORK_DEVICE_PAGE,
    SECTION_HEADING,
  )
    .split("\n\n")
    .filter((paragraph: string): boolean => {
      return paragraph.includes(path);
    });

  expect({ language, paragraphs: paragraphs.length }).toEqual({
    language,
    paragraphs: 1,
  });

  return (paragraphs[0] as string).trim();
}

describe("every docs language's guide", () => {
  test("has the sentence for every language the docs are served in, and only those", () => {
    expect(Object.keys(DELETED_FOR_GOOD).sort()).toEqual(
      [...SUPPORTED_DOCS_LANGUAGE_CODES].sort(),
    );
  });

  test.each([...SUPPORTED_DOCS_LANGUAGE_CODES])(
    "%s: ends the paragraph on unseen devices with how long a removed device is kept, on every installation",
    (language: string) => {
      const sentence: string = DELETED_FOR_GOOD[language] as string;

      expect(sentence).toContain(String(SOFT_DELETED_ROWS_RETENTION_IN_DAYS));
      expect(ageOutParagraph(language).endsWith(sentence)).toBe(true);
    },
  );
});

describe("the English guide says what the code does", () => {
  test("a removed device is kept as long as the purge keeps a soft-deleted row", () => {
    expect(SOFT_DELETED_ROWS_RETENTION_IN_DAYS).toBe(30);
    expect(ageOutParagraph("en")).toContain(
      "Removed devices stay in the database for 30 days and are then deleted for good",
    );
  });

  test("on every installation: the discovered devices are purged where billing is off, as where it is on", () => {
    expect(NetworkEndpointService.purgesSoftDeletedRowsOnEveryInstall).toBe(
      true,
    );
    expect(
      SoftDeletedRowsPurge.isPurgedOnThisInstall(NetworkEndpointService, false),
    ).toBe(true);
    expect(
      SoftDeletedRowsPurge.isPurgedOnThisInstall(NetworkEndpointService, true),
    ).toBe(true);
    expect(ageOutParagraph("en")).toContain(
      "on every installation, self-hosted ones included.",
    );
  });
});
