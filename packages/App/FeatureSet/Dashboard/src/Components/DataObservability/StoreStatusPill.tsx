import { Gray500, Green500, Red500 } from "Common/Types/BrandColors";
import { DataObservabilityStoreSummary } from "Common/Types/DataObservability/DataObservabilityApiTypes";
import Pill from "Common/UI/Components/Pill/Pill";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  store: DataObservabilityStoreSummary;
}

// How a database's table health collection stands: off, failing, collected, or not yet.
const StoreStatusPill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.store.isTableHealthEnabled) {
    return <Pill text="Not watched" color={Gray500} />;
  }

  if (props.store.status === "Failed") {
    return <Pill text="Collection failed" color={Red500} />;
  }

  if (props.store.status === "Collected") {
    return <Pill text="Collected" color={Green500} />;
  }

  return <Pill text="Waiting for first collection" color={Gray500} />;
};

export default StoreStatusPill;
