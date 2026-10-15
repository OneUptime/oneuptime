import {
  ADD_PROBE_DIALOG_DESCRIPTION,
  ADD_PROBE_NAME_DESCRIPTION,
  ADD_PROBE_NAME_PLACEHOLDER,
  PROBE_DOCS_PATH,
  RUN_PROBE_CONNECTED,
  RUN_PROBE_INSTRUCTIONS,
  RUN_PROBE_INSTRUCTIONS_WITHOUT_KEY,
  RUN_PROBE_KEY_HIDDEN,
  RUN_PROBE_OTHER_WAYS,
  RUN_PROBE_WAITING,
  RUN_PROBE_WAITING_WITHOUT_KEY,
  getDefaultProbeName,
} from "./AddProbeCopy";
import {
  NetworkProbeFacts,
  PROBE_PLAN_UPGRADE_BUTTON,
  PROBE_STEP_PLAN_NEEDED,
  isProbeConnected,
} from "./NetworkProbeSetup";
import { getPlanNeededToAddProbe } from "./ProbePlanGate";
import { getProbeDockerRunCommand } from "../Probe/ProbeRunCommand";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Probe from "Common/Models/DatabaseModels/Probe";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { DOCS_URL, HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
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

/*
 * "Add a probe", without leaving Network: name it, then run it.
 *
 * The probe is what reaches the devices, so it is the first thing a new
 * Network project needs - and the only way to one used to be a link into
 * Monitors → Settings → Probes, where Create Probe asked for a name and a
 * description and then showed nothing about running it (the command was on
 * the probe's own page, one click further). Here the second step IS the
 * command, with the new probe's ID and key filled in, and the dialog watches
 * for the probe to check in, so the person sees it work.
 *
 * The probe's key is read back only by roles that may read it (project owners
 * and admins); anyone else who may add a probe is told who can give it to
 * them, rather than shown a command that cannot work.
 *
 * On OneUptime Cloud below the plan a probe needs (ProbePlanGate), there is
 * no name to ask: the server would refuse the probe. The dialog - opened by a
 * probe field's "Add a probe" link as well as by the first-run path - says
 * which plan it needs and offers the way to it instead.
 */

export interface AddProbeModalProbe {
  id: string;
  name: string;
}

export interface ComponentProps {
  /*
   * A probe already added and not running yet: the dialog opens on its run
   * step (the first-run path's "How to run it").
   */
  probe?: AddProbeModalProbe | undefined;
  onClose: () => void;
  // The probe was added, or checked in: the caller reads its probes again.
  onProbeChanged?: (() => void) | undefined;
}

interface AddProbeFormData {
  name: string;
}

// How often the run step asks whether the probe has checked in.
export const RUN_PROBE_POLL_INTERVAL_IN_MS: number = 5 * 1000;

const AddProbeModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [probe, setProbe] = useState<AddProbeModalProbe | null>(
    props.probe || null,
  );
  /*
   * Below the plan a probe needs, the name step says so instead (read once:
   * the plan does not change while the dialog is open).
   */
  const [planNeeded] = useState<PlanType | null>(() => {
    return props.probe ? null : getPlanNeededToAddProbe();
  });
  /*
   * The probe's key, once it is read: which probe it was read for, and the
   * key (null when the server gave none back, or the read failed). Keyed by
   * the probe so the step never shows one probe's key under another's name,
   * and never flashes "no key" in the render between the probe being added
   * and its key being asked for.
   */
  const [keyRead, setKeyRead] = useState<{
    probeId: string;
    key: string | null;
  } | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  /*
   * The project's probe names, so the name the dialog suggests is a new one.
   * Read when the dialog opens on its name step; until then (or when they
   * cannot be read) the plain suggestion stands, and the server refuses a
   * name that is taken in words of its own.
   */
  const [existingProbeNames, setExistingProbeNames] =
    useState<Array<string> | null>(props.probe || planNeeded ? [] : null);

  const canReadProbeKey: boolean = PermissionGate.canReadColumn(
    new Probe(),
    "key",
  );

  useEffect(() => {
    if (existingProbeNames !== null) {
      return undefined;
    }

    let isCurrent: boolean = true;

    ModelAPI.getList<Probe>({
      modelType: Probe,
      query: {
        projectId: ProjectUtil.getCurrentProjectId()!,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        _id: true,
        name: true,
      },
      sort: {},
    })
      .then((result: ListResult<Probe>) => {
        if (isCurrent) {
          setExistingProbeNames(
            result.data.map((item: Probe): string => {
              return item.name || "";
            }),
          );
        }
      })
      .catch(() => {
        if (isCurrent) {
          setExistingProbeNames([]);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  // The run step's command: the probe's key, read once.
  useEffect(() => {
    if (!probe || !canReadProbeKey) {
      return undefined;
    }

    let isCurrent: boolean = true;
    const probeId: string = probe.id;

    ModelAPI.getItem<Probe>({
      modelType: Probe,
      id: new ObjectID(probeId),
      select: {
        _id: true,
        key: true,
      },
    })
      .then((item: Probe | null) => {
        if (isCurrent) {
          setKeyRead({ probeId: probeId, key: item?.key || null });
        }
      })
      .catch((err: Error) => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
          setKeyRead({ probeId: probeId, key: null });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [probe?.id]);

  /*
   * Whether the probe has checked in, asked every few seconds until it has:
   * then there is nothing left to wait for, and the caller hears once.
   */
  useEffect(() => {
    if (!probe || isConnected) {
      return undefined;
    }

    let isCurrent: boolean = true;

    const checkConnection: () => Promise<void> = async (): Promise<void> => {
      const item: Probe | null = await ModelAPI.getItem<Probe>({
        modelType: Probe,
        id: new ObjectID(probe.id),
        select: {
          _id: true,
          connectionStatus: true,
          lastAlive: true,
        },
      });

      if (!isCurrent || !item) {
        return;
      }

      const facts: NetworkProbeFacts = {
        id: probe.id,
        name: probe.name,
        connectionStatus: item.connectionStatus || null,
        lastAlive: item.lastAlive || null,
      };

      if (isProbeConnected(facts, new Date())) {
        isCurrent = false;
        setIsConnected(true);
        props.onProbeChanged?.();
      }
    };

    checkConnection().catch(() => {
      // Asked again on the next tick; a missed answer changes nothing.
    });

    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      if (!isCurrent) {
        return;
      }

      checkConnection().catch(() => {
        // Asked again on the next tick.
      });
    }, RUN_PROBE_POLL_INTERVAL_IN_MS);

    return () => {
      isCurrent = false;
      clearInterval(timer);
    };
  }, [probe?.id, isConnected]);

  if (!probe && planNeeded) {
    const billingRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.SETTINGS_BILLING] as Route,
    );

    return (
      <Modal
        title="Add a probe"
        onClose={props.onClose}
        submitButtonText={PROBE_PLAN_UPGRADE_BUTTON}
        onSubmit={() => {
          Navigation.navigate(billingRoute);
        }}
      >
        <div
          className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          data-testid="add-probe-plan-needed"
        >
          <Icon
            icon={IconProp.Lock}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700"
          />
          <span>
            {translator.translateTemplate(PROBE_STEP_PLAN_NEEDED, {
              planName: planNeeded,
            })}
          </span>
        </div>
      </Modal>
    );
  }

  if (!probe) {
    return (
      <BasicFormModal<AddProbeFormData>
        title="Add a probe"
        name="Network > Add a probe"
        description={ADD_PROBE_DIALOG_DESCRIPTION}
        submitButtonText="Add Probe"
        onClose={props.onClose}
        error={error}
        isLoading={existingProbeNames === null}
        onSubmit={async (data: AddProbeFormData) => {
          setError("");

          const name: string = String(data.name || "").trim();
          const model: Probe = new Probe();
          model.name = name;
          model.projectId = ProjectUtil.getCurrentProjectId()!;

          try {
            const response: HTTPResponse<
              JSONObject | JSONArray | Probe | Array<Probe>
            > = await ModelAPI.create<Probe>({
              model: model,
              modelType: Probe,
            });

            const createdId: string =
              (response.data as Probe | undefined)?.id?.toString() || "";

            if (!createdId) {
              setError(
                translator.translateText(
                  "The probe was added, but the server did not say which it is. Open it under Monitors → Settings → Probes to run it.",
                ) || "",
              );
              return;
            }

            setProbe({ id: createdId, name: name });
            props.onProbeChanged?.();
          } catch (err) {
            setError(API.getFriendlyMessage(err));
          }
        }}
        formProps={{
          initialValues: {
            name: getDefaultProbeName(existingProbeNames || []),
          },
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
              description: ADD_PROBE_NAME_DESCRIPTION,
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: ADD_PROBE_NAME_PLACEHOLDER,
            },
          ],
        }}
      />
    );
  }

  const oneUptimeUrl: string = `${HTTP_PROTOCOL}${HOST}`;

  /*
   * The key this step can print: still being read, read, or none - a role
   * that may not read it, or a read that came back without one. With none,
   * there is no command, so the step's words ask nobody here to run one.
   */
  const isKeyLoading: boolean =
    canReadProbeKey && keyRead?.probeId !== probe.id;
  const probeKey: string | null =
    keyRead?.probeId === probe.id ? keyRead.key : null;
  const hasCommand: boolean = isKeyLoading || Boolean(probeKey);

  return (
    <Modal
      title="Run the probe"
      modalWidth={ModalWidth.Medium}
      /*
       * One button, a plain way out: the probe exists already, so there is
       * nothing to cancel and nothing left to do here. "Close" while it is
       * waiting - the first-run step keeps waiting - and "Done" once it has
       * checked in; the green line above says so.
       */
      onClose={props.onClose}
      closeButtonText={isConnected ? "Done" : "Close"}
      closeButtonStyleType={ButtonStyleType.NORMAL}
      error={error || undefined}
    >
      <div className="space-y-4" data-testid="add-probe-run-step">
        <p className="text-sm text-gray-600">
          {translator.translateTemplate(
            hasCommand
              ? RUN_PROBE_INSTRUCTIONS
              : RUN_PROBE_INSTRUCTIONS_WITHOUT_KEY,
            {
              name: probe.name,
            },
          )}
        </p>

        {isKeyLoading ? (
          <div
            className="h-24 animate-pulse rounded-md bg-gray-100"
            data-testid="add-probe-command-loading"
          ></div>
        ) : probeKey ? (
          <div data-testid="add-probe-command">
            <CodeBlock
              language="bash"
              code={getProbeDockerRunCommand({
                probeId: probe.id,
                probeKey: probeKey,
                oneUptimeUrl: oneUptimeUrl,
              })}
            />
          </div>
        ) : error ? (
          /*
           * The key could not be read: the dialog's error says why, and
           * there is no command to print in its place.
           */
          <></>
        ) : (
          <p
            className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600"
            data-testid="add-probe-key-hidden"
          >
            {translator.translateTemplate(RUN_PROBE_KEY_HIDDEN, {
              name: probe.name,
            })}
          </p>
        )}

        <a
          className="inline-flex text-sm font-medium text-indigo-600 hover:underline"
          href={URL.fromString(DOCS_URL.toString())
            .addRoute(PROBE_DOCS_PATH)
            .toString()}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="add-probe-other-ways"
        >
          {translator.translateText(RUN_PROBE_OTHER_WAYS)}
        </a>

        <div
          role="status"
          aria-live="polite"
          data-testid="add-probe-connection"
          data-connected={isConnected ? "true" : "false"}
          className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
            isConnected
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-gray-200 bg-gray-50 text-gray-600"
          }`}
        >
          {isConnected ? (
            <Icon
              icon={IconProp.CheckCircle}
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600"
            />
          ) : (
            <span className="relative mt-1.5 flex h-2 w-2 flex-shrink-0">
              <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-500 opacity-75 motion-safe:animate-ping"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500"></span>
            </span>
          )}
          <span>
            {translator.translateTemplate(
              isConnected
                ? RUN_PROBE_CONNECTED
                : hasCommand
                  ? RUN_PROBE_WAITING
                  : RUN_PROBE_WAITING_WITHOUT_KEY,
              { name: probe.name },
            )}
          </span>
        </div>
      </div>
    </Modal>
  );
};

export default AddProbeModal;
