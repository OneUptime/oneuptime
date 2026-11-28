import AccessLogFormatDetails from "./AccessLogFormatDetails";
import {
  ACCESS_LOGS_DESCRIPTION,
  ACCESS_LOGS_OFF,
  ACCESS_LOGS_ON,
  ACCESS_LOGS_SWITCH_TITLE,
  ACCESS_LOGS_TITLE,
  TRUSTED_PROXIES_TEST_IDS,
} from "../SecurityTrustedProxiesCopy";
import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import { getPageAnchorNameForTitle } from "Common/UI/Utils/PageAnchor";
import ProjectUtil from "Common/UI/Utils/Project";
import { readAccessLogFormat } from "Common/Utils/SecurityEvent/LogParsers/AccessLogFormat";
import React, { FunctionComponent, ReactElement } from "react";

// Its place in More settings: the key the folded header names it by.
export const ACCESS_LOGS_CARD_KEY: string =
  getPageAnchorNameForTitle(ACCESS_LOGS_TITLE) || "access-logs";

// Whether a project holds a format OneUptime reads lines by.
export function hasAccessLogFormat(value: unknown): boolean {
  return (
    typeof value === "string" && readAccessLogFormat(value).format !== null
  );
}

export interface ComponentProps {
  // Told whether the access logs are read for the header, for the fold's chip.
  onChange?: ((isOn: boolean) => void) | undefined;
  // Told whether a log format is given, for the fold's chip (#11048).
  onFormatChange?: ((hasFormat: boolean) => void) | undefined;
}

/*
 * ACCESS LOGS (#10548): whether the project's web servers' access logs end
 * with the X-Forwarded-For header, as nginx's main format does
 * (Project.securityReadAccessLogForwardedFor, off unless turned on). A line
 * never says what its fields are, so only the project can say this; with
 * it on, a combined line's last field is read as the X-Forwarded-For its
 * trusted proxy forwarded (Common/Utils/SecurityEvent/LogParsers/
 * WebAttackLogParser). Under More settings on Security Events >
 * Connections, beside Trusted Proxies: it saves when flipped, and a
 * Project Owner, a Project Admin or a Security Admin may flip it.
 *
 * Under the switch, the project's own Log Format (#11048,
 * Project.securityAccessLogFormat, AccessLogFormatDetails): the nginx
 * log_format its lines are written in, read field by field wherever it puts
 * X-Forwarded-For; set by the same people, in a dialog of its own.
 */
const SecurityAccessLogsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return <></>;
  }

  return (
    <ModelSwitchCard<Project>
      modelType={Project}
      modelId={projectId}
      column="securityReadAccessLogForwardedFor"
      cardTitle={ACCESS_LOGS_TITLE}
      cardDescription={ACCESS_LOGS_DESCRIPTION}
      cardId={ACCESS_LOGS_CARD_KEY}
      title={ACCESS_LOGS_SWITCH_TITLE}
      getDescription={(isOn: boolean): string => {
        return isOn ? ACCESS_LOGS_ON : ACCESS_LOGS_OFF;
      }}
      select={{ securityAccessLogFormat: true }}
      onLoaded={(item: Project): void => {
        props.onFormatChange?.(
          hasAccessLogFormat(item.securityAccessLogFormat),
        );
      }}
      getDetails={(item: Project): ReactElement => {
        return (
          <AccessLogFormatDetails
            value={item.securityAccessLogFormat}
            onSaved={(saved: string): void => {
              props.onFormatChange?.(hasAccessLogFormat(saved));
            }}
          />
        );
      }}
      onChange={props.onChange}
      dataTestId={TRUSTED_PROXIES_TEST_IDS.accessLogsSwitch}
    />
  );
};

export default SecurityAccessLogsCard;
