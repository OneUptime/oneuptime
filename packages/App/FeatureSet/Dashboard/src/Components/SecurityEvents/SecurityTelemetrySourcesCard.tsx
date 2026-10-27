import {
  NEEDS_ENTERPRISE_NOTE,
  SECURITY_TELEMETRY_SOURCES_CARD_ID,
  SECURITY_TELEMETRY_SOURCE_ROWS,
  SecurityTelemetrySourceRow,
  SecurityTelemetrySourceStatus,
  SecurityTelemetrySourceStatusKind,
  getSecurityTelemetrySourceStatus,
  isSecurityTelemetrySourceAvailable,
} from "./SecurityTelemetrySourcesModel";
import SecurityTelemetrySource from "Common/Models/DatabaseModels/SecurityTelemetrySource";
import { SecurityTelemetrySourceKind } from "Common/Types/SecurityEvent/SecurityTelemetrySource";
import Card from "Common/UI/Components/Card/Card";
import {
  formatFeedTimeAgo,
  getFeedClock,
} from "Common/UI/Components/Feed/FeedTime";
import Icon from "Common/UI/Components/Icon/Icon";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import { IS_ENTERPRISE_EDITION } from "Common/UI/Config";
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

/*
 * "Your OneUptime data": the telemetry beyond logs that OneUptime already
 * holds for the project - traces, network flows, its own audit log, session
 * replays - each one switch that makes it a security source. A minute after
 * one is on, what arrives of that kind is read for what an attack leaves
 * in it (Server/Utils/SecurityEvent/TelemetryScan) - nothing to install,
 * nothing to send twice.
 *
 * Each switch saves when it is flipped. A kind has no record until the
 * first time it is turned on, so the first flip creates it; whoever may not
 * change it sees the switch locked and why. Sits under "Your logs" on the
 * Connections page, and reads the same way.
 */
const SecurityTelemetrySourcesCard: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [sources, setSources] = useState<Array<SecurityTelemetrySource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [savingKind, setSavingKind] =
    useState<SecurityTelemetrySourceKind | null>(null);
  const [savedKind, setSavedKind] =
    useState<SecurityTelemetrySourceKind | null>(null);
  /*
   * Where a switch is drawn while it saves, and back where it was when the
   * server says no - never a position nobody saved.
   */
  const [pending, setPending] = useState<{
    kind: SecurityTelemetrySourceKind;
    value: boolean;
  } | null>(null);
  const [error, setError] = useState<string>("");

  const read: () => Promise<Array<SecurityTelemetrySource>> = async (): Promise<
    Array<SecurityTelemetrySource>
  > => {
    const result: { data: Array<SecurityTelemetrySource> } =
      await ModelAPI.getList({
        modelType: SecurityTelemetrySource,
        query: { projectId: ProjectUtil.getCurrentProjectId()! },
        limit: SECURITY_TELEMETRY_SOURCE_ROWS.length * 2,
        skip: 0,
        select: {
          _id: true,
          kind: true,
          isEnabled: true,
          lastScannedAt: true,
          lastEventFoundAt: true,
          lastScanResult: true,
          lastError: true,
        },
        sort: {},
      });

    return result.data;
  };

  useEffect(() => {
    let isCurrent: boolean = true;

    read()
      .then((found: Array<SecurityTelemetrySource>) => {
        if (isCurrent) {
          setSources(found);
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

  const sourceOf: (
    kind: SecurityTelemetrySourceKind,
  ) => SecurityTelemetrySource | undefined = (
    kind: SecurityTelemetrySourceKind,
  ): SecurityTelemetrySource | undefined => {
    return sources.find((source: SecurityTelemetrySource): boolean => {
      return source.kind === kind;
    });
  };

  const flip: (
    kind: SecurityTelemetrySourceKind,
    value: boolean,
  ) => Promise<void> = async (
    kind: SecurityTelemetrySourceKind,
    value: boolean,
  ): Promise<void> => {
    const source: SecurityTelemetrySource | undefined = sourceOf(kind);

    setPending({ kind, value });
    setSavingKind(kind);
    setSavedKind(null);
    setError("");

    try {
      if (source?.id) {
        await ModelAPI.updateById<SecurityTelemetrySource>({
          modelType: SecurityTelemetrySource,
          id: source.id,
          data: { isEnabled: value },
        });
      } else {
        const created: SecurityTelemetrySource = new SecurityTelemetrySource();
        created.projectId = ProjectUtil.getCurrentProjectId()!;
        created.kind = kind;
        created.isEnabled = value;

        await ModelAPI.create<SecurityTelemetrySource>({
          model: created,
          modelType: SecurityTelemetrySource,
        });
      }

      setSources(await read());
      setSavedKind(kind);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setPending(null);
    setSavingKind(null);
  };

  const timeAgo: (date: Date | null) => string = (
    date: Date | null,
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

  const statusLine: (status: SecurityTelemetrySourceStatus) => string = (
    status: SecurityTelemetrySourceStatus,
  ): string => {
    switch (status.kind) {
      case SecurityTelemetrySourceStatusKind.Waiting:
        return (
          translator.translateText("The first check runs within a minute.") ||
          ""
        );
      case SecurityTelemetrySourceStatusKind.Checked:
        return [
          translator.translateTemplate("Checked {{time}}.", {
            time: timeAgo(status.checkedAt),
          }),
          status.lastFoundAt
            ? translator.translateTemplate(
                "Last security event found {{time}}.",
                { time: timeAgo(status.lastFoundAt) },
              )
            : translator.translateText("No security event found yet.") || "",
        ].join(" ");
      default:
        return "";
    }
  };

  return (
    <Card
      title="Your OneUptime data"
      description="Attacks show up in your traces, network traffic, audit log and session replays too. Turn on what OneUptime should watch."
    >
      <div
        id={SECURITY_TELEMETRY_SOURCES_CARD_ID}
        data-testid={SECURITY_TELEMETRY_SOURCES_CARD_ID}
        className="space-y-4"
      >
        {error ? (
          <p
            className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
            data-testid="security-telemetry-sources-error"
          >
            {error}
          </p>
        ) : (
          <></>
        )}

        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {SECURITY_TELEMETRY_SOURCE_ROWS.map(
            (row: SecurityTelemetrySourceRow): ReactElement => {
              const source: SecurityTelemetrySource | undefined = sourceOf(
                row.kind,
              );
              const isOn: boolean = source?.isEnabled === true;
              const isSwitchOn: boolean =
                pending?.kind === row.kind ? pending.value : isOn;
              const gate: PermissionGateResult = PermissionGate.check(
                new SecurityTelemetrySource(),
                source?.id ? ModelAction.Update : ModelAction.Create,
              );
              const isAvailable: boolean = isSecurityTelemetrySourceAvailable({
                row,
                isEnterpriseEdition: IS_ENTERPRISE_EDITION,
                isOn,
              });
              const status: SecurityTelemetrySourceStatus =
                getSecurityTelemetrySourceStatus({
                  isOn,
                  lastScannedAt: source?.lastScannedAt,
                  lastEventFoundAt: source?.lastEventFoundAt,
                  lastScanResult: source?.lastScanResult,
                  lastError: source?.lastError,
                });
              const line: string = statusLine(status);

              return (
                <li
                  key={row.kind}
                  data-testid={`security-telemetry-source-${row.kind}`}
                  className="flex items-start gap-3 px-4 py-3"
                >
                  <div className="mt-0.5 flex-shrink-0 text-gray-400">
                    <Icon icon={row.icon} className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Toggle
                      title={row.title}
                      description={row.description}
                      value={isSwitchOn}
                      disabled={
                        isLoading ||
                        savingKind !== null ||
                        !gate.isAllowed ||
                        !isAvailable
                      }
                      tooltip={
                        !gate.isAllowed
                          ? gate.disabledReason
                          : !isAvailable
                            ? NEEDS_ENTERPRISE_NOTE
                            : undefined
                      }
                      dataTestId={`security-telemetry-source-toggle-${row.kind}`}
                      onChange={(value: boolean) => {
                        void flip(row.kind, value);
                      }}
                    />

                    {!isAvailable ? (
                      <p className="text-xs text-gray-500">
                        {translator.translateText(NEEDS_ENTERPRISE_NOTE)}
                      </p>
                    ) : (
                      <></>
                    )}

                    {savingKind === row.kind || savedKind === row.kind ? (
                      <p role="status" className="text-xs text-gray-500">
                        {savingKind === row.kind
                          ? translator.translateText("Saving…")
                          : translator.translateText("Saved")}
                      </p>
                    ) : (
                      <></>
                    )}

                    {line ? (
                      <p
                        className="text-xs text-gray-500"
                        data-testid={`security-telemetry-source-status-${row.kind}`}
                      >
                        {line}
                        {status.foundInLastCheck > 0 ? (
                          <span className="ml-1 font-medium text-emerald-700">
                            {translator.translateTemplate(
                              "Found in the last check: {{count}}",
                              {
                                count: translator.formatNumber(
                                  status.foundInLastCheck,
                                ),
                              },
                            )}
                          </span>
                        ) : (
                          <></>
                        )}
                      </p>
                    ) : (
                      <></>
                    )}

                    {status.kind ===
                    SecurityTelemetrySourceStatusKind.Failed ? (
                      <p
                        className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"
                        data-testid={`security-telemetry-source-last-error-${row.kind}`}
                      >
                        {translator.translateTemplate(
                          "The last check failed: {{error}}",
                          { error: status.error },
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
    </Card>
  );
};

export default SecurityTelemetrySourcesCard;
