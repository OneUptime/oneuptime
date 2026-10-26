import React, { FunctionComponent, ReactElement, useMemo } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import Host from "Common/Models/DatabaseModels/Host";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import SetupGuideCard, {
  SetupGuideRenderContext,
} from "../SetupGuide/SetupGuideCard";
import { SetupGuideContent } from "../SetupGuide/SetupGuide";
import AppLink from "../AppLink/AppLink";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import { HostCollectorOsType } from "Common/Types/HostCollector/HostCollector";
import {
  HostAddOption,
  getHostAddGuide,
  getHostAddOptionForOsType,
  getHostAddOptions,
  resolveHostAddOption,
} from "./HostCollectorGuide";
import HostConnectionWatch from "./HostConnectionWatch";

/*
 * Adding a host, OneUptime's default way: pick what the host runs and a
 * key, run one command on the host, and watch it connect. The Hosts list
 * shows it in its Add Host dialog (an empty list's showcase opens that
 * too); a host that was set up by hand shows it on its Collector page, to
 * hand its collector over to OneUptime.
 *
 * The same shape every "add it, then it just reports" flow takes: a few ways
 * in at the top, the key, the one thing to run, then a live last step that
 * says when it worked.
 */

/*
 * Under the step that waits, while adding hosts. On a host's own page - its
 * collector handed over or installed again - the step's live line says it
 * all ("Waiting for the new collector to connect").
 */
export const ADD_HOST_WAIT_STEP_DESCRIPTION: string = translationKey(
  "It shows up under Hosts as soon as it connects, with the config OneUptime sent it.",
);

export interface ComponentProps {
  title?: string | undefined;
  description?: string | undefined;
  initialOption?: HostAddOption | undefined;
  /*
   * The host's own system, when OneUptime knows it (a host's own page):
   * the guide gives only that system's command, without asking.
   */
  osType?: HostCollectorOsType | null | undefined;
  onHostConnected?: ((host: Host) => void) | undefined;
  /*
   * The host already reports through a collector installed by hand: the
   * command stops that one (its Collector page hands it over to OneUptime).
   */
  replaceExisting?: boolean | undefined;
  /*
   * No "Install the collector yourself" topic: the page shows the manual
   * guide below, or the collector is OneUptime's already.
   */
  hideManualInstallTopic?: boolean | undefined;
  // The last step waits for this host only (a host's own page).
  hostId?: ObjectID | undefined;
  // Without its card and header, in a dialog that has its own (Add Host).
  isBare?: boolean | undefined;
}

/*
 * Under the three systems, while adding hosts: a cluster's nodes are not
 * added here, the Kubernetes agent monitors them - and where to set it up.
 */
const KubernetesNodesNote: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span data-testid="add-host-kubernetes-note">
      {translator.translateText(
        "Kubernetes nodes are monitored by the Kubernetes agent instead.",
      )}{" "}
      <AppLink
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.KUBERNETES_DOCUMENTATION] as Route,
        )}
        className="font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
      >
        {translator.translateTemplate("Set up the Kubernetes agent")}
      </AppLink>
    </span>
  );
};

const AddHostGuide: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // Hosts that report from now on are the ones this guide added.
  const since: Date = useMemo(() => {
    return new Date();
  }, []);

  return (
    <SetupGuideCard
      title={props.title || "Add a host"}
      description={
        props.description ||
        "Run one command on the host. It installs the OpenTelemetry Collector, and OneUptime keeps its config up to date: no config.yaml to write."
      }
      icon={IconProp.Server}
      isBare={props.isBare}
      newKeyName={translationKey("Hosts key")}
      optionsLabel="What does the host run?"
      options={getHostAddOptions(props.osType)}
      optionsNote={props.hostId ? undefined : <KubernetesNodesNote />}
      initialOption={
        props.osType
          ? getHostAddOptionForOsType(props.osType)
          : props.initialOption
      }
      getContent={(context: SetupGuideRenderContext): SetupGuideContent => {
        return getHostAddGuide({
          oneuptimeUrl: context.oneuptimeUrl,
          apiKey: context.apiKey,
          option: resolveHostAddOption(context.option),
          replaceExisting: props.replaceExisting,
          hideManualInstallTopic: props.hideManualInstallTopic,
        });
      }}
      lastStep={{
        title: translator.translateTemplate("Wait for the host"),
        description: props.hostId
          ? undefined
          : translator.translateTemplate(ADD_HOST_WAIT_STEP_DESCRIPTION),
        content: (
          <HostConnectionWatch
            since={since}
            hostId={props.hostId}
            onHostConnected={props.onHostConnected}
          />
        ),
      }}
    />
  );
};

export default AddHostGuide;
