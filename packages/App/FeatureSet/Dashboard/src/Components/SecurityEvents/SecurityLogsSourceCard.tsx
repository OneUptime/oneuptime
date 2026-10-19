import { SECURITY_LOG_FORMAT_TEXTS } from "./SecurityConnectionsCopy";
import SecurityLogSource from "Common/Models/DatabaseModels/SecurityLogSource";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import SecurityLogFormat, {
  SECURITY_LOG_FORMATS,
  SecurityLogFormatDefinition,
} from "Common/Types/SecurityEvent/SecurityLogFormat";
import Card from "Common/UI/Components/Card/Card";
import {
  formatFeedTimeAgo,
  getFeedClock,
} from "Common/UI/Components/Feed/FeedTime";
import Icon from "Common/UI/Components/Icon/Icon";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export const SECURITY_LOGS_SOURCE_CARD_ID: string = "security-logs-source";

export const SECURITY_LOG_FORMAT_ICONS: Record<SecurityLogFormat, IconProp> = {
  [SecurityLogFormat.SshSignIn]: IconProp.Terminal,
  [SecurityLogFormat.Sudo]: IconProp.Key,
  [SecurityLogFormat.KubernetesAudit]: IconProp.Cube,
  [SecurityLogFormat.AwsCloudTrail]: IconProp.Cloud,
  [SecurityLogFormat.WebAttack]: IconProp.Globe,
};

// How many security events the last check found, by log format.
export function readFoundByFormat(
  result: JSONObject | undefined,
): Record<string, number> {
  const byFormat: JSONValue | undefined = result?.["byFormat"];
  const found: Record<string, number> = {};

  if (!byFormat || typeof byFormat !== "object" || Array.isArray(byFormat)) {
    return found;
  }

  for (const [format, count] of Object.entries(byFormat as JSONObject)) {
    if (typeof count === "number" && Number.isFinite(count) && count > 0) {
      found[format] = count;
    }
  }

  return found;
}

/*
 * "Your logs": one switch that makes the logs a project already sends
 * OneUptime a security source. A minute after it is on, every new line that
 * is a sign-in, a sudo, a Kubernetes audit record, a CloudTrail record or a
 * web attack becomes a security event - nothing to install, nothing to send
 * twice (Server/Utils/SecurityEvent/LogScan/SecurityLogScanner.ts).
 *
 * The switch saves when it is flipped. The project has no record until the
 * first time it is turned on, so the first flip creates it; whoever may not
 * change it sees the switch locked and why.
 */
const SecurityLogsSourceCard: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [source, setSource] = useState<SecurityLogSource | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isSaved, setIsSaved] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const read: () => Promise<SecurityLogSource | null> =
    async (): Promise<SecurityLogSource | null> => {
      const result: { data: Array<SecurityLogSource> } = await ModelAPI.getList(
        {
          modelType: SecurityLogSource,
          query: { projectId: ProjectUtil.getCurrentProjectId()! },
          limit: 1,
          skip: 0,
          select: {
            _id: true,
            isEnabled: true,
            lastScannedAt: true,
            lastEventFoundAt: true,
            lastScanResult: true,
            lastError: true,
          },
          sort: {},
        },
      );

      return result.data[0] || null;
    };

  useEffect(() => {
    let isCurrent: boolean = true;

    read()
      .then((found: SecurityLogSource | null) => {
        if (isCurrent) {
          setSource(found);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  const gate: PermissionGateResult = PermissionGate.check(
    new SecurityLogSource(),
    source?.id ? ModelAction.Update : ModelAction.Create,
  );
  const isOn: boolean = source?.isEnabled === true;
  /*
   * Where the switch is drawn: the new position while it saves, and back
   * where it was when the server says no - never a position nobody saved.
   */
  const [switchPosition, setSwitchPosition] = useState<boolean | null>(null);
  const isSwitchOn: boolean = switchPosition ?? isOn;

  const flip: (value: boolean) => Promise<void> = async (
    value: boolean,
  ): Promise<void> => {
    setSwitchPosition(value);
    setIsSaving(true);
    setIsSaved(false);
    setError("");

    try {
      if (source?.id) {
        await ModelAPI.updateById<SecurityLogSource>({
          modelType: SecurityLogSource,
          id: source.id,
          data: { isEnabled: value },
        });
      } else {
        const created: SecurityLogSource = new SecurityLogSource();
        created.projectId = ProjectUtil.getCurrentProjectId()!;
        created.isEnabled = value;

        await ModelAPI.create<SecurityLogSource>({
          model: created,
          modelType: SecurityLogSource,
        });
      }

      setSource(await read());
      setIsSaved(true);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setSwitchPosition(null);
    setIsSaving(false);
  };

  const timeAgo: (date: Date | undefined) => string = (
    date: Date | undefined,
  ): string => {
    if (!date) {
      return "";
    }

    return (
      formatFeedTimeAgo(
        new Date(date),
        getFeedClock({ language: translator.language }),
      ) || ""
    );
  };

  const foundByFormat: Record<string, number> = readFoundByFormat(
    source?.lastScanResult,
  );

  const statusLines: Array<string> = [];

  if (isOn) {
    statusLines.push(
      source?.lastScannedAt
        ? translator.translateTemplate("Checked {{time}}.", {
            time: timeAgo(source.lastScannedAt),
          })
        : translator.translateText("The first check runs within a minute.") ||
            "",
    );
    statusLines.push(
      source?.lastEventFoundAt
        ? translator.translateTemplate("Last security event found {{time}}.", {
            time: timeAgo(source.lastEventFoundAt),
          })
        : translator.translateText("No security event found yet.") || "",
    );
  }

  return (
    <Card
      title="Your logs"
      description="Attacks often show up in the logs you already send OneUptime. Nothing to install."
    >
      <div
        id={SECURITY_LOGS_SOURCE_CARD_ID}
        data-testid={SECURITY_LOGS_SOURCE_CARD_ID}
        className="space-y-5"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <Toggle
            title="Find security events in your logs"
            description="Every minute, OneUptime reads this project's new logs and turns the lines it recognizes into security events. Your logs stay as they are."
            value={isSwitchOn}
            disabled={isLoading || isSaving || !gate.isAllowed}
            tooltip={gate.isAllowed ? undefined : gate.disabledReason}
            dataTestId="security-logs-source-toggle"
            onChange={(value: boolean) => {
              void flip(value);
            }}
          />
          <p
            role="status"
            className="text-xs text-gray-500 sm:pt-1"
            data-testid="security-logs-source-saving"
          >
            {isSaving
              ? translator.translateText("Saving…")
              : isSaved
                ? translator.translateText("Saved")
                : ""}
          </p>
        </div>

        {error ? (
          <p
            className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
            data-testid="security-logs-source-error"
          >
            {error}
          </p>
        ) : (
          <></>
        )}

        {statusLines.length > 0 ? (
          <p
            className="text-sm text-gray-600"
            data-testid="security-logs-source-status"
          >
            {statusLines.join(" ")}
          </p>
        ) : (
          <></>
        )}

        {isOn && source?.lastError ? (
          <p
            className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800"
            data-testid="security-logs-source-last-error"
          >
            {translator.translateTemplate("The last check failed: {{error}}", {
              error: source.lastError,
            })}
          </p>
        ) : (
          <></>
        )}

        <div>
          <h3 className="text-sm font-medium text-gray-900">
            {translator.translateText("What OneUptime recognizes")}
          </h3>
          <ul className="mt-2 grid grid-cols-1 gap-2 sm:gap-3 md:grid-cols-2 xl:grid-cols-3">
            {SECURITY_LOG_FORMATS.map(
              (format: SecurityLogFormatDefinition): ReactElement => {
                const found: number = foundByFormat[format.format] || 0;

                return (
                  <li
                    key={format.format}
                    data-testid={`security-log-format-${format.format}`}
                    className="flex items-start gap-3 rounded-lg border border-gray-200 px-3 py-2.5"
                  >
                    <div className="mt-0.5 flex-shrink-0 text-gray-400">
                      <Icon
                        icon={SECURITY_LOG_FORMAT_ICONS[format.format]}
                        className="h-4 w-4"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">
                        {translator.translateText(
                          SECURITY_LOG_FORMAT_TEXTS[format.format].title,
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500 max-sm:hidden">
                        {translator.translateText(
                          SECURITY_LOG_FORMAT_TEXTS[format.format].description,
                        )}
                      </p>
                      {isOn && found > 0 ? (
                        <p className="mt-1 text-xs font-medium text-emerald-700">
                          {translator.translateTemplate(
                            "Found in the last check: {{count}}",
                            { count: translator.formatNumber(found) },
                          )}
                        </p>
                      ) : (
                        <></>
                      )}
                    </div>
                  </li>
                );
              },
            )}
          </ul>
        </div>
      </div>
    </Card>
  );
};

export default SecurityLogsSourceCard;
