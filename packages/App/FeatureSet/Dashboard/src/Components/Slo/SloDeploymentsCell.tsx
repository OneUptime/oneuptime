import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  FROZEN_SINCE_TEMPLATE,
  POLICY_TIER_DEPLOYMENTS_FROZEN_TEXT,
  SloDeploymentFreeze,
  getSloDeploymentFreeze,
} from "./SloPolicyTier";

export const SLO_DEPLOYMENTS_CELL_TEST_ID: string = "slo-deployments-frozen";

export interface ComponentProps {
  // Read with deploymentsAllowed and deploymentsFrozenAt.
  slo: ServiceLevelObjective;
}

/*
 * The SLO list's Deployments cell (#6377): "Frozen since <time>", in red with
 * the lock the Overview's badge wears, while the SLO's error budget policy
 * tier freezes deployments - and nothing for an SLO that allows them, so the
 * column stays quiet for a team that gates nothing. Read from the row itself
 * (getSloDeploymentFreeze), so the list stays one query.
 */
const SloDeploymentsCell: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const freeze: SloDeploymentFreeze | null = getSloDeploymentFreeze(props.slo);

  if (!freeze) {
    return <TableEmptyValue />;
  }

  return (
    <Pill
      // Worded here, in the reader's language: drawn as given.
      text={
        freeze.frozenAt
          ? translator.translateTemplate(FROZEN_SINCE_TEMPLATE, {
              time: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                freeze.frozenAt,
              ),
            })
          : translator.translateText(POLICY_TIER_DEPLOYMENTS_FROZEN_TEXT) ||
            POLICY_TIER_DEPLOYMENTS_FROZEN_TEXT
      }
      isUserContent={true}
      tooltip={
        freeze.frozenAt ? OneUptimeDate.fromNow(freeze.frozenAt) : undefined
      }
      isTooltipUserContent={true}
      tone={PillTone.Danger}
      icon={IconProp.Lock}
      size={PillSize.Small}
      dataTestId={SLO_DEPLOYMENTS_CELL_TEST_ID}
    />
  );
};

export default SloDeploymentsCell;
