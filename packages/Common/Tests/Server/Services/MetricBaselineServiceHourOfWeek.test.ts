import { MetricBaselineService } from "../../../Server/Services/MetricBaselineService";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * computeHourOfWeek names the hour of the week a rollup keeps an instant
 * under. Ingest writes a time as UTC text and ClickHouse hands that text back,
 * so it is the UTC hour, whatever zone this process runs in.
 */
describe("MetricBaselineService.computeHourOfWeek", () => {
  const hourOf: (time: string) => number = (time: string): number => {
    return MetricBaselineService.computeHourOfWeek(new Date(time));
  };

  test("Monday begins the week", () => {
    expect(hourOf("2026-11-02T00:00:00.000Z")).toBe(0);
  });

  test("Monday 09:00 is hour 9", () => {
    expect(hourOf("2026-11-02T09:59:59.999Z")).toBe(9);
  });

  test("Tuesday begins a day later", () => {
    expect(hourOf("2026-11-03T00:00:00.000Z")).toBe(24);
  });

  test("Sunday 23:00 ends the week", () => {
    expect(hourOf("2026-11-08T23:30:00.000Z")).toBe(167);
  });

  test("a time zone in the text is read off, not kept", () => {
    expect(hourOf("2026-11-02T09:00:00.000+09:00")).toBe(0);
  });

  test("the zone this process runs in changes nothing", () => {
    const random: SeededRandom = seededRandom(168);
    const monday: number = Date.UTC(2026, 10, 2);

    for (let index: number = 0; index < 500; index++) {
      const hourOfWeek: number = random(168);
      const instant: Date = new Date(
        monday + hourOfWeek * 3600000 + random(3600000),
      );

      /*
       * A process in another zone reads other local hours for one instant.
       * Jest gives a test its own copy of process.env, so a test cannot
       * change the zone it runs in: it is the local reading that is moved.
       */
      jest.spyOn(instant, "getHours").mockReturnValue(random(24));
      jest.spyOn(instant, "getDay").mockReturnValue(random(7));

      expect(MetricBaselineService.computeHourOfWeek(instant)).toBe(hourOfWeek);
    }
  });
});
