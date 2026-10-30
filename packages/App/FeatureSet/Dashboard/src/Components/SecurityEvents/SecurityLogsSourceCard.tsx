import {
  SECURITY_LOG_FORMAT_GROUP_TEXTS,
  SECURITY_LOG_FORMAT_TEXTS,
} from "./SecurityConnectionsCopy";
import SecurityLogLineCheck from "./SecurityLogLineCheck";
import SecurityLogSource from "Common/Models/DatabaseModels/SecurityLogSource";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import SecurityLogFormat, {
  SECURITY_LOG_FORMAT_GROUPS,
  SecurityLogFormatDefinition,
  SecurityLogFormatGroup,
  getSecurityLogFormatsInGroup,
  readLastFoundAtByFormat,
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
  [SecurityLogFormat.WindowsEvents]: IconProp.ComputerDesktop,
  [SecurityLogFormat.KubernetesAudit]: IconProp.Cube,
  [SecurityLogFormat.AwsCloudTrail]: IconProp.Cloud,
  [SecurityLogFormat.GoogleCloudAudit]: IconProp.DocumentMagnifyingGlass,
  [SecurityLogFormat.AzureActivity]: IconProp.Identification,
  [SecurityLogFormat.Cef]: IconProp.ShieldExclamation,
  [SecurityLogFormat.Leef]: IconProp.ShieldCheck,
  [SecurityLogFormat.WebAttack]: IconProp.Globe,
};

/*
 * What a kind of log says of its own health while Your logs is on: how many
 * the last check found, or when one was last found - so a source that went
 * quiet, a firewall no longer sending CEF, shows up as one that has not been
 * found for a day - or that none has been yet.
 */
export type SecurityLogFormatHealth =
  | { kind: "found-now"; count: number }
  | { kind: "found-before"; at: Date }
  | { kind: "not-yet" };

export function getSecurityLogFormatHealth(data: {
  format: SecurityLogFormat;
  foundByFormat: Record<string, number>;
  lastFoundAtByFormat: Partial<Record<SecurityLogFormat, Date>>;
}): SecurityLogFormatHealth {
  const count: number = data.foundByFormat[data.format] || 0;

  if (count > 0) {
    return { kind: "found-now", count };
  }

  const at: Date | undefined = data.lastFoundAtByFormat[data.format];

  return at ? { kind: "found-before", at } : { kind: "not-yet" };
}

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

export interface SecurityLogScanProgress {
  // The last check stopped part way through a busy stretch; the next goes on from there.
  isCatchingUp: boolean;
  // The checks fell too far behind and skipped the logs that arrived in this range.
  skipped: { from: Date; to: Date } | null;
}

function readResultDate(value: JSONValue | undefined): Date | null {
  if (typeof value !== "string" || !value) {
    return null;
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

// Where the last check left the scan (SecurityLogScanResult).
export function readScanProgress(
  result: JSONObject | undefined,
): SecurityLogScanProgress {
  const skippedFrom: Date | null = readResultDate(result?.["skippedFrom"]);
  const skippedTo: Date | null = readResultDate(result?.["skippedTo"]);

  return {
    isCatchingUp: Boolean(readResultDate(result?.["partialWindowStart"])),
    skipped:
      result?.["skippedBacklog"] === true && skippedFrom && skippedTo
        ? { from: skippedFrom, to: skippedTo }
        : null,
  };
}

/*
 * The project's Your logs record, or null before it was first turned on -
 * as this card and the Events page's empty state read it.
 */
export const readProjectSecurityLogSource: () => Promise<SecurityLogSource | null> =
  async (): Promise<SecurityLogSource | null> => {
    const result: { data: Array<SecurityLogSource> } = await ModelAPI.getList({
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
    });

    return result.data[0] || null;
  };

/*
 * What Your logs says of itself while it is on: when it last checked (or
 * that the first check is coming), when it last found a security event (or
 * that it has found none yet), and that it is catching up when it is. Nothing
 * while it is off.
 */
export const getYourLogsStatusLines: (data: {
  source: SecurityLogSource | null;
  translator: Translator;
}) => Array<string> = (data: {
  source: SecurityLogSource | null;
  translator: Translator;
}): Array<string> => {
  const { source, translator } = data;

  if (source?.isEnabled !== true) {
    return [];
  }

  const timeAgo: (date: Date) => string = (date: Date): string => {
    return (
      formatFeedTimeAgo(
        new Date(date),
        getFeedClock({ language: translator.language }),
      ) || ""
    );
  };

  const lines: Array<string> = [
    source.lastScannedAt
      ? translator.translateTemplate("Checked {{time}}.", {
          time: timeAgo(source.lastScannedAt),
        })
      : translator.translateText("The first check runs within a minute.") || "",
    source.lastEventFoundAt
      ? translator.translateTemplate("Last security event found {{time}}.", {
          time: timeAgo(source.lastEventFoundAt),
        })
      : translator.translateText("No security event found yet.") || "",
  ];

  if (readScanProgress(source.lastScanResult).isCatchingUp) {
    lines.push(
      translator.translateText(
        "Catching up on a busy stretch of logs: the next check goes on where this one stopped.",
      ) || "",
    );
  }

  return lines;
};

/*
 * "Your logs": one switch that makes the logs a project already sends
 * OneUptime a security source. A minute after it is on, every new line that
 * is a sign-in, a sudo, a Windows event, a cloud audit record, a security
 * product's CEF or LEEF, a Kubernetes audit record or a web attack becomes a
 * security event - nothing to install, nothing to send twice
 * (Server/Utils/SecurityEvent/LogScan/SecurityLogScanner.ts). The kinds are
 * listed by where they come from, each with what the checks last found of
 * it, and a line can be checked by hand before any arrives.
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

  useEffect(() => {
    let isCurrent: boolean = true;

    readProjectSecurityLogSource()
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

      setSource(await readProjectSecurityLogSource());
      setIsSaved(true);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setSwitchPosition(null);
    setIsSaving(false);
  };

  const foundByFormat: Record<string, number> = readFoundByFormat(
    source?.lastScanResult,
  );
  const lastFoundAtByFormat: Partial<Record<SecurityLogFormat, Date>> =
    readLastFoundAtByFormat(source?.lastScanResult);

  const timeAgo: (date: Date) => string = (date: Date): string => {
    return (
      formatFeedTimeAgo(
        new Date(date),
        getFeedClock({ language: translator.language }),
      ) || ""
    );
  };

  const renderHealth: (format: SecurityLogFormat) => ReactElement = (
    format: SecurityLogFormat,
  ): ReactElement => {
    const health: SecurityLogFormatHealth = getSecurityLogFormatHealth({
      format,
      foundByFormat,
      lastFoundAtByFormat,
    });

    if (health.kind === "found-now") {
      return (
        <p
          className="mt-1 text-xs font-medium text-emerald-700"
          data-testid={`security-log-format-health-${format}`}
        >
          {translator.translateTemplate("Found in the last check: {{count}}", {
            count: translator.formatNumber(health.count),
          })}
        </p>
      );
    }

    if (health.kind === "found-before") {
      return (
        <p
          className="mt-1 text-xs text-gray-600"
          data-testid={`security-log-format-health-${format}`}
        >
          {translator.translateTemplate("Last found {{time}}", {
            time: timeAgo(health.at),
          })}
        </p>
      );
    }

    return (
      <p
        className="mt-1 text-xs text-gray-400"
        data-testid={`security-log-format-health-${format}`}
      >
        {translator.translateText("None found yet")}
      </p>
    );
  };

  const progress: SecurityLogScanProgress = readScanProgress(
    source?.lastScanResult,
  );

  const statusLines: Array<string> = getYourLogsStatusLines({
    source: source,
    translator: translator,
  });

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

        {isOn && progress.skipped ? (
          <p
            className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800"
            data-testid="security-logs-source-skipped"
          >
            {translator.translateTemplate(
              "The checks fell more than a day behind and skipped the logs that arrived between {{from}} and {{to}}.",
              {
                from: OneUptimeDate.getDateAsLocalFormattedString(
                  progress.skipped.from,
                ),
                to: OneUptimeDate.getDateAsLocalFormattedString(
                  progress.skipped.to,
                ),
              },
            )}
          </p>
        ) : (
          <></>
        )}

        <div>
          <h3 className="text-sm font-medium text-gray-900">
            {translator.translateText("What OneUptime recognizes")}
          </h3>
          {/*
           * Columns from the card's own width, not the window's: beside the
           * side menu the card is about 370px wide at a 768 window, where
           * two columns squeezed each kind's sentence to a few words a line.
           * One column there and on a phone, two from 30rem, three from 46rem.
           */}
          <div className="mt-2 space-y-4 [container-type:inline-size]">
            {SECURITY_LOG_FORMAT_GROUPS.map(
              (group: SecurityLogFormatGroup): ReactElement => {
                const headingId: string = `security-log-format-group-${group}-title`;

                return (
                  <section
                    key={group}
                    aria-labelledby={headingId}
                    data-testid={`security-log-format-group-${group}`}
                  >
                    <h4
                      id={headingId}
                      className="text-xs font-medium text-gray-500"
                    >
                      {translator.translateText(
                        SECURITY_LOG_FORMAT_GROUP_TEXTS[group],
                      )}
                    </h4>
                    <ul
                      data-testid={`security-log-format-group-${group}-kinds`}
                      className="mt-1.5 grid grid-cols-1 gap-2 sm:gap-3 [@container(min-width:30rem)]:grid-cols-2 [@container(min-width:46rem)]:grid-cols-3"
                    >
                      {getSecurityLogFormatsInGroup(group).map(
                        (format: SecurityLogFormatDefinition): ReactElement => {
                          return (
                            <li
                              key={format.format}
                              data-testid={`security-log-format-${format.format}`}
                              className="flex items-start gap-3 rounded-lg border border-gray-200 px-3 py-2.5"
                            >
                              <div className="mt-0.5 flex-shrink-0 text-gray-400">
                                <Icon
                                  icon={
                                    SECURITY_LOG_FORMAT_ICONS[format.format]
                                  }
                                  className="h-4 w-4"
                                />
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-900">
                                  {translator.translateText(
                                    SECURITY_LOG_FORMAT_TEXTS[format.format]
                                      .title,
                                  )}
                                </p>
                                <p className="mt-0.5 text-xs text-gray-500 max-sm:hidden">
                                  {translator.translateText(
                                    SECURITY_LOG_FORMAT_TEXTS[format.format]
                                      .description,
                                  )}
                                </p>
                                {isOn ? renderHealth(format.format) : <></>}
                              </div>
                            </li>
                          );
                        },
                      )}
                    </ul>
                  </section>
                );
              },
            )}
          </div>
        </div>

        <SecurityLogLineCheck icons={SECURITY_LOG_FORMAT_ICONS} />
      </div>
    </Card>
  );
};

export default SecurityLogsSourceCard;
