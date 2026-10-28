import CriteriaFilterUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import { CheckOn } from "../../../Types/Monitor/CriteriaFilter";
import MonitorType, {
  MonitorTypeHelper,
  MonitorTypeProps,
} from "../../../Types/Monitor/MonitorType";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { describe, expect, test } from "@jest/globals";

/*
 * The Traces card in Create Monitor's type picker promises what a Traces
 * monitor can alert on. It said "Alert on span latency and error rate",
 * while the monitor's one criteria counts the spans that match its filters
 * (Span Count): no criteria reads a span's duration, and none a rate. The
 * card now says what the criteria form offers, and this keeps the two
 * together - a criteria that reads latency would have to come with new
 * card copy.
 */

function tracesCard(): MonitorTypeProps {
  const card: MonitorTypeProps | undefined =
    MonitorTypeHelper.getAllMonitorTypeProps().find(
      (props: MonitorTypeProps): boolean => {
        return props.monitorType === MonitorType.Traces;
      },
    );

  if (!card) {
    throw new Error("The type picker has no Traces card.");
  }

  return card;
}

describe("the Traces monitor type's card", () => {
  test("the criteria form offers one check for Traces: the span count", () => {
    expect(
      CriteriaFilterUtil.getCheckOnOptionsByMonitorType(MonitorType.Traces).map(
        (option: DropdownOption): string => {
          return option.value.toString();
        },
      ),
    ).toEqual([CheckOn.SpanCount]);
  });

  test("says it alerts on requests that fail or stop, which a span count answers", () => {
    expect(tracesCard().description).toBe(
      "Alert when requests fail, or stop arriving.",
    );
  });

  test("promises nothing a span count cannot answer", () => {
    const description: string = tracesCard().description.toLowerCase();

    for (const promise of ["latency", "error rate", "duration", "slow"]) {
      expect({ promise, made: description.includes(promise) }).toEqual({
        promise,
        made: false,
      });
    }
  });

  test("is not found by a latency search: its keywords name what it counts", () => {
    const keywords: Array<string> = tracesCard().keywords;

    expect(keywords).not.toContain("latency");
    expect(keywords).toEqual(
      expect.arrayContaining(["span count", "failed requests", "error spans"]),
    );
    expect(
      MonitorTypeHelper.getAllMonitorTypeProps()
        .find((props: MonitorTypeProps): boolean => {
          return props.monitorType === MonitorType.Metrics;
        })
        ?.keywords.includes("latency"),
    ).toBe(true);
  });
});
