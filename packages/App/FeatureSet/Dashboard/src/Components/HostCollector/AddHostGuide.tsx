import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import IconProp from "Common/Types/Icon/IconProp";
import Host from "Common/Models/DatabaseModels/Host";
import ObjectID from "Common/Types/ObjectID";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import SetupGuideCard, {
  SetupGuideRenderContext,
} from "../SetupGuide/SetupGuideCard";
import { SetupGuideContent } from "../SetupGuide/SetupGuide";
import {
  HOST_ADD_OPTIONS,
  HostAddOption,
  getHostAddGuide,
  resolveHostAddOption,
} from "./HostCollectorGuide";
import HostConnectionWatch from "./HostConnectionWatch";

/*
 * Adding a host, OneUptime's default way: pick what the host runs and a
 * key, run one command on the host, and watch it connect. The Hosts list
 * shows it as its first-run card and in its Add Host dialog; a host that
 * was set up by hand shows it on its Collector page, to hand its collector
 * over to OneUptime.
 *
 * The same shape every "add it, then it just reports" flow takes: a few ways
 * in at the top, the key, the one thing to run, then a live last step that
 * says when it worked.
 */

export interface ComponentProps {
  title?: string | undefined;
  description?: string | undefined;
  initialOption?: HostAddOption | undefined;
  onHostConnected?: ((host: Host) => void) | undefined;
  /*
   * The host already reports through a collector installed by hand: the
   * command stops that one (its Collector page hands it over to OneUptime).
   */
  replaceExisting?: boolean | undefined;
  // The last step waits for this host only (a host's own page).
  hostId?: ObjectID | undefined;
  // Without its card and header, in a dialog that has its own (Add Host).
  isBare?: boolean | undefined;
}

const AddHostGuide: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // Hosts that report from now on are the ones this guide added.
  const since: Date = useMemo(() => {
    return new Date();
  }, []);
  const [option, setOption] = useState<HostAddOption>(
    resolveHostAddOption(props.initialOption),
  );

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
      options={HOST_ADD_OPTIONS}
      initialOption={props.initialOption}
      onOptionChange={(key: string) => {
        setOption(resolveHostAddOption(key));
      }}
      getContent={(context: SetupGuideRenderContext): SetupGuideContent => {
        return getHostAddGuide({
          oneuptimeUrl: context.oneuptimeUrl,
          apiKey: context.apiKey,
          option: resolveHostAddOption(context.option),
          replaceExisting: props.replaceExisting,
        });
      }}
      lastStep={
        option === "kubernetes"
          ? undefined
          : {
              title: translator.translateTemplate("Wait for the host"),
              description: translator.translateTemplate(
                "It shows up under Hosts as soon as it connects, with the config OneUptime sent it.",
              ),
              content: (
                <HostConnectionWatch
                  since={since}
                  hostId={props.hostId}
                  onHostConnected={props.onHostConnected}
                />
              ),
            }
      }
    />
  );
};

export default AddHostGuide;
