import MonitorProbe from "Common/Models/DatabaseModels/MonitorProbe";
import MonitorSecret from "Common/Models/DatabaseModels/MonitorSecret";
import Probe from "Common/Models/DatabaseModels/Probe";
import URL from "Common/Types/API/URL";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorSecretType from "Common/Types/Monitor/MonitorSecretType";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import { FIRST_PROBE_VERSION_WITH_TOTP_CODES } from "Common/Types/Probe/ProbeCapability";
import { doStepsNeedOneTimeCodes } from "Common/Utils/Monitor/MonitorSecretReferences";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { DOCS_URL } from "Common/UI/Config";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import {
  ONE_TIME_CODE_PROBES_COPY,
  ONE_TIME_CODE_PROBES_WARNING_TEST_ID,
  UPDATE_A_PROBE_DOCS_PATH,
  doStepsReferenceSecretsWhereCodesGo,
  getProbesTooOldForOneTimeCodes,
} from "./OneTimeCodeProbes";

export interface ComponentProps {
  // The monitor's steps as the form holds them now.
  monitorSteps: MonitorSteps | undefined | null;
  monitorType: MonitorType | undefined;
  /*
   * The probes that check the monitor: the ones the form picked, or - for a
   * monitor that exists - read here from its probes that are switched on.
   */
  probeIds?: Array<string> | undefined;
  monitorId?: ObjectID | undefined;
  // Changed when the monitor's probes may have changed, to read them again.
  refreshToggle?: string | undefined;
}

/*
 * Says which probes are too old to make the one-time codes a monitor needs
 * (OneUptime issue #9759): a custom probe older than
 * FIRST_PROBE_VERSION_WITH_TOTP_CODES fails such a check, with a sentence
 * saying to update it, where it used to send {{monitorSecrets.NAME}} as
 * written. Drawn where probes are picked and where the steps that use a
 * code are written, and only when both hold: a step needs a code, and a
 * probe that checks the monitor is too old. Global probes never are.
 *
 * Whether a step needs a code is read as the server reads it
 * (MonitorSecretReferences): a script that asks oneuptime.getTotpCode
 * always does; a reference does when it names a one-time code secret,
 * which a reader who may not list the project's secrets cannot tell. A
 * probe's release is read only by whoever may read it (Probe's readers);
 * anyone else is told nothing rather than something wrong.
 */
const OneTimeCodeProbesWarning: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const mayNeedCodes: boolean = doStepsReferenceSecretsWhereCodesGo({
    monitorSteps: props.monitorSteps,
    monitorType: props.monitorType,
  });

  // The project's one-time code secrets' names: null until read, or unreadable.
  const [totpSecretNames, setTotpSecretNames] = useState<Array<string> | null>(
    null,
  );
  const [projectProbes, setProjectProbes] = useState<Array<Probe> | null>(null);
  const [monitorProbeIds, setMonitorProbeIds] = useState<Array<string>>([]);

  const canReadVersions: boolean = PermissionGate.canReadColumn(
    new Probe(),
    "reportedVersion",
  );

  // The secrets and the probes are read once, and only for a monitor that may need a code.
  useEffect(() => {
    if (!mayNeedCodes || !canReadVersions || projectProbes) {
      return;
    }

    let isCurrent: boolean = true;

    const read: () => Promise<void> = async (): Promise<void> => {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (!projectId) {
        return;
      }

      try {
        const probes: Array<Probe> = (
          await ModelAPI.getList<Probe>({
            modelType: Probe,
            query: { projectId: projectId },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              _id: true,
              name: true,
              reportedVersion: true,
              lastAlive: true,
            },
            sort: {},
          })
        ).data;

        if (isCurrent) {
          setProjectProbes(probes);
        }
      } catch {
        // Nothing to say without them: the check's result still says why.
      }

      if (
        !PermissionGate.canReadColumn(new MonitorSecret(), "name") ||
        !PermissionGate.canReadColumn(new MonitorSecret(), "secretType")
      ) {
        return;
      }

      try {
        const secrets: Array<MonitorSecret> = (
          await ModelAPI.getList<MonitorSecret>({
            modelType: MonitorSecret,
            query: {
              projectId: projectId,
              secretType: MonitorSecretType.TOTP,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              name: true,
            },
            sort: {},
          })
        ).data;

        if (isCurrent) {
          setTotpSecretNames(
            secrets
              .map((secret: MonitorSecret): string => {
                return secret.name || "";
              })
              .filter(Boolean),
          );
        }
      } catch {
        // A reference alone then says nothing: only a script's ask does.
      }
    };

    read().catch(() => {
      // Read above, each in its own try.
    });

    return () => {
      isCurrent = false;
    };
  }, [mayNeedCodes, canReadVersions]);

  // A monitor that exists: the probes switched on to check it.
  useEffect(() => {
    if (!mayNeedCodes || !canReadVersions || !props.monitorId) {
      return;
    }

    let isCurrent: boolean = true;

    ModelAPI.getList<MonitorProbe>({
      modelType: MonitorProbe,
      query: {
        projectId: ProjectUtil.getCurrentProjectId()!,
        monitorId: props.monitorId,
        isEnabled: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        probeId: true,
      },
      sort: {},
    })
      .then((list: { data: Array<MonitorProbe> }) => {
        if (isCurrent) {
          setMonitorProbeIds(
            list.data
              .map((monitorProbe: MonitorProbe): string => {
                return monitorProbe.probeId?.toString() || "";
              })
              .filter(Boolean),
          );
        }
      })
      .catch(() => {
        // Nothing to say without them.
      });

    return () => {
      isCurrent = false;
    };
  }, [
    mayNeedCodes,
    canReadVersions,
    props.monitorId?.toString(),
    props.refreshToggle,
  ]);

  if (!mayNeedCodes || !canReadVersions || !projectProbes) {
    return <></>;
  }

  if (
    !doStepsNeedOneTimeCodes({
      monitorSteps: props.monitorSteps,
      monitorType: props.monitorType,
      totpSecretNames: totpSecretNames,
    })
  ) {
    return <></>;
  }

  const tooOld: Array<{ id: string; name: string }> =
    getProbesTooOldForOneTimeCodes({
      projectProbes: projectProbes,
      probeIds: props.monitorId ? monitorProbeIds : props.probeIds || [],
    });

  if (tooOld.length === 0) {
    return <></>;
  }

  return (
    <Alert
      type={AlertType.WARNING}
      dataTestId={ONE_TIME_CODE_PROBES_WARNING_TEST_ID}
      className="mb-4"
      title={
        <div className="space-y-2">
          <p>
            {translator.translateText(ONE_TIME_CODE_PROBES_COPY.probesTooOld)}
          </p>
          <ul
            className="list-disc space-y-0.5 ps-5 font-medium"
            data-testid={`${ONE_TIME_CODE_PROBES_WARNING_TEST_ID}-probes`}
          >
            {tooOld.map((probe: { id: string; name: string }) => {
              // A probe's name is its owner's, drawn as written.
              return (
                <li key={probe.id} dir="auto">
                  {probe.name}
                </li>
              );
            })}
          </ul>
          <p>
            {translator.translateTemplate(
              ONE_TIME_CODE_PROBES_COPY.howToUpdate,
              {
                version: FIRST_PROBE_VERSION_WITH_TOTP_CODES,
              },
            )}
          </p>
          <Link
            to={URL.fromString(
              `${DOCS_URL.toString()}${UPDATE_A_PROBE_DOCS_PATH}`,
            )}
            openInNewTab={true}
            className="inline-flex items-center gap-1 font-medium underline"
            dataTestId={`${ONE_TIME_CODE_PROBES_WARNING_TEST_ID}-docs`}
          >
            {translator.translateText(ONE_TIME_CODE_PROBES_COPY.updateLink)}
            <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
          </Link>
        </div>
      }
    />
  );
};

export default OneTimeCodeProbesWarning;
