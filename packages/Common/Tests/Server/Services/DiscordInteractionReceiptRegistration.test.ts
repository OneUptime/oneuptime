import fs from "fs";
import path from "path";
import Services from "../../../Server/Services/Index";
import DiscordInteractionReceiptService from "../../../Server/Services/DiscordInteractionReceiptService";

const BASE_API_INDEX_SOURCE: string = fs.readFileSync(
  path.resolve(__dirname, "../../../../App/FeatureSet/BaseAPI/Index.ts"),
  "utf8",
);

describe("Discord interaction receipt registration", () => {
  test("registers durable receipt retention with the cleanup worker", () => {
    expect(Services).toContain(DiscordInteractionReceiptService);
    expect(DiscordInteractionReceiptService.hardDeleteItemByColumnName).toBe(
      "expiresAt",
    );
    expect(DiscordInteractionReceiptService.hardDeleteItemsOlderThanDays).toBe(
      1,
    );
  });

  test("does not mount an internal receipt CRUD route", () => {
    expect(BASE_API_INDEX_SOURCE).not.toContain("DiscordInteractionReceipt");
  });
});
