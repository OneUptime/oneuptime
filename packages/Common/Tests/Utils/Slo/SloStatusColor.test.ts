import {
  Blue500,
  Gray500,
  Green,
  Red,
  Yellow,
} from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import {
  getSloStatusColor,
  getSloStatusText,
} from "../../../Utils/Slo/SloStatusColor";

describe("SloStatusColor", () => {
  describe("getSloStatusColor", () => {
    it("colours a healthy SLO green", () => {
      expect(getSloStatusColor(SloStatus.Healthy).toString()).toBe(
        Green.toString(),
      );
    });

    it("colours an at-risk SLO yellow", () => {
      expect(getSloStatusColor(SloStatus.AtRisk).toString()).toBe(
        Yellow.toString(),
      );
    });

    it("colours an exhausted error budget red", () => {
      expect(getSloStatusColor(SloStatus.BudgetExhausted).toString()).toBe(
        Red.toString(),
      );
    });

    /*
     * Set up right, and measured from its monitors' first check (#9354):
     * worth knowing, needs nothing - the Info tone's blue, never the gray
     * of a setup someone has to fix.
     */
    it("colours a waiting SLO blue, apart from the grays of the setups to fix", () => {
      expect(getSloStatusColor(SloStatus.Waiting).toString()).toBe(
        Blue500.toString(),
      );
      expect(getSloStatusColor(SloStatus.Waiting).toString()).not.toBe(
        getSloStatusColor(SloStatus.Misconfigured).toString(),
      );
    });

    it("colours a misconfigured SLO gray because there is nothing to measure", () => {
      expect(getSloStatusColor(SloStatus.Misconfigured).toString()).toBe(
        Gray500.toString(),
      );
    });

    it("colours a paused SLO gray because it is deliberately not measured", () => {
      expect(getSloStatusColor(SloStatus.Paused).toString()).toBe(
        Gray500.toString(),
      );
    });

    it("colours an unset status gray rather than claiming a health colour", () => {
      expect(getSloStatusColor(undefined).toString()).toBe(Gray500.toString());
      expect(getSloStatusColor(null).toString()).toBe(Gray500.toString());
    });

    it("colours an unrecognised persisted status gray", () => {
      expect(getSloStatusColor("Something New" as SloStatus).toString()).toBe(
        Gray500.toString(),
      );
    });

    it("returns a colour for every member of the SloStatus enum", () => {
      for (const status of Object.values(SloStatus)) {
        const color: Color = getSloStatusColor(status);

        expect(color).toBeInstanceOf(Color);
        expect(color.toString()).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    });

    /*
     * The status palette, and the Info tone's blue for Waiting (#9354): the
     * colour a chip of the Info tone draws elsewhere, worth knowing and
     * asking nothing.
     */
    it("only ever uses the brand colours the SLO pages use", () => {
      const allowed: Array<string> = [
        Green.toString(),
        Yellow.toString(),
        Red.toString(),
        Blue500.toString(),
        Gray500.toString(),
      ];

      for (const status of Object.values(SloStatus)) {
        expect(allowed).toContain(getSloStatusColor(status).toString());
      }
    });
  });

  describe("getSloStatusText", () => {
    it.each(Object.values(SloStatus))(
      "passes the %s status through unchanged",
      (status: SloStatus) => {
        expect(getSloStatusText(status)).toBe(status);
      },
    );

    it("labels an unevaluated SLO Unknown rather than defaulting to Healthy", () => {
      expect(getSloStatusText(undefined)).toBe("Unknown");
      expect(getSloStatusText(null)).toBe("Unknown");
      expect(getSloStatusText(undefined)).not.toBe(SloStatus.Healthy);
    });
  });
});
