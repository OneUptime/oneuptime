import { formatOverdue } from "./DataObservabilityFormat";
import { Gray500, Green500, Red500 } from "Common/Types/BrandColors";
import DataAssetKind from "Common/Types/DataObservability/DataAssetKind";
import {
  DataAssetFreshness,
  DataAssetFreshnessResult,
  getDataAssetFreshness,
} from "Common/Types/DataObservability/DataAssetFreshness";
import OneUptimeDate from "Common/Types/Date";
import Pill from "Common/UI/Components/Pill/Pill";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  kind: DataAssetKind | undefined;
  lastChangedAt: Date | undefined;
  updateIntervalInSeconds: number | undefined;
}

/*
 * A table's freshness at a glance: Fresh in green, Late (and by how much) in
 * red, Learning in grey while OneUptime has not yet seen it change twice,
 * and nothing for a view, which holds no rows of its own.
 */
const FreshnessPill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const result: DataAssetFreshnessResult = getDataAssetFreshness({
    kind: props.kind,
    lastChangedAt: props.lastChangedAt
      ? OneUptimeDate.fromString(props.lastChangedAt)
      : null,
    updateIntervalInSeconds: props.updateIntervalInSeconds,
    now: OneUptimeDate.getCurrentDate(),
  });

  switch (result.freshness) {
    case DataAssetFreshness.Fresh:
      return <Pill text="Fresh" color={Green500} />;
    case DataAssetFreshness.Late:
      return (
        <Pill
          text={formatOverdue(translator, result.overdueBySeconds)}
          color={Red500}
        />
      );
    case DataAssetFreshness.Unknown:
      return (
        <Pill
          text="Learning"
          color={Gray500}
          tooltip="OneUptime learns how often a table changes from the changes it sees. It needs to see this one change twice."
        />
      );
    default:
      return <span className="text-sm text-gray-400">-</span>;
  }
};

export default FreshnessPill;
