import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Input from "Common/UI/Components/Input/Input";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  OPENSTACK_TRACE_END_COMMAND,
  OPENSTACK_TRACE_KEY_COMMAND,
  getOpenStackTraceBootCommand,
  getOpenStackTraceDeleteCommand,
  getOpenStackTraceListCommand,
  readOpenStackTraceId,
} from "Common/Utils/OpenStack/OpenStackTraces";
import React, { FunctionComponent, ReactElement, useState } from "react";
import {
  OpenStackTraceCommandRows,
  fetchOpenStackTraceCommandRows,
} from "../../../Pages/OpenStack/Utils/OpenStackTraceReads";
import {
  chooseOpenStackTraceFlavor,
  chooseOpenStackTraceImage,
  chooseOpenStackTraceNetwork,
} from "../../../Pages/OpenStack/Utils/OpenStackTraceCommand";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { useOpenStackRegion } from "../OpenStackRegionContext";
import useOpenStackRead, { OpenStackRead } from "../Part/UseOpenStackRead";
import CopyableCommand from "../../SetupGuide/CopyableCommand";

/*
 * Trace a request: the commands that sign one, for this cloud, and the way from what the
 * client prints to the trace. Signing happens where the person runs `openstack`, with the same
 * key their services were given. Nothing here keeps it: the one place OneUptime holds a key is the
 * lifecycle check's, if someone gives it one, encrypted and write-only (OpenStackCloudCheck).
 */

export function getOpenStackTraceRoute(traceId: string): Route {
  return RouteUtil.populateRouteParams(RouteMap[PageMap.TRACE_VIEW]!, {
    modelId: traceId,
  });
}

const CommandStep: FunctionComponent<{
  label: string;
  commands: Array<string>;
  testId: string;
}> = (props: {
  label: string;
  commands: Array<string>;
  testId: string;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="space-y-1.5" data-testid={props.testId}>
      <p className="text-sm text-gray-700">
        {translator.translateText(props.label)}
      </p>
      {props.commands.map((command: string): ReactElement => {
        return <CopyableCommand key={command} command={command} />;
      })}
    </div>
  );
};

export interface ComponentProps {
  openStackCloudId: ObjectID;
}

const OpenStackTraceARequestCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { region, regions } = useOpenStackRegion();
  // A flag only where a cloud has more than one region for it to choose between.
  const regionName: string | null =
    region || (regions.length > 1 ? regions[0]! : null);

  const rows: OpenStackRead<OpenStackTraceCommandRows> =
    useOpenStackRead<OpenStackTraceCommandRows>(() => {
      return fetchOpenStackTraceCommandRows({
        openStackCloudId: props.openStackCloudId,
        region: regionName,
      });
    }, [props.openStackCloudId.toString(), regionName]);

  const [pasted, setPasted] = useState<string>("");
  const [notAnId, setNotAnId] = useState<boolean>(false);

  const openPasted: () => void = (): void => {
    const traceId: string | null = readOpenStackTraceId(pasted);

    if (!traceId) {
      setNotAnId(true);
      return;
    }

    setNotAnId(false);
    Navigation.navigate(getOpenStackTraceRoute(traceId));
  };

  return (
    <Card
      title="Trace a request"
      description="Sign one request with your OSProfiler key and follow it across the control plane. Run these where you run openstack, as someone who can."
    >
      <div className="space-y-5" data-testid="openstack-trace-a-request">
        <CommandStep
          testId="openstack-trace-key"
          label="Give this shell the key you set in hmac_keys. It waits for you to paste it, and keeps it out of your history. Every openstack command in this shell is traced until you end it below."
          commands={[OPENSTACK_TRACE_KEY_COMMAND]}
        />
        <CommandStep
          testId="openstack-trace-list"
          label="See the wiring work. This changes nothing."
          commands={[getOpenStackTraceListCommand({ regionName })]}
        />
        <CommandStep
          testId="openstack-trace-boot"
          label="See a boot, which is what this is for. This boots a small real instance, then deletes it. Change what it asks for if your credential cannot use it."
          commands={[
            getOpenStackTraceBootCommand({
              regionName: regionName,
              flavor: chooseOpenStackTraceFlavor(rows.data?.flavors || []),
              image: chooseOpenStackTraceImage(rows.data?.images || []),
              network: chooseOpenStackTraceNetwork(rows.data?.networks || []),
            }),
            getOpenStackTraceDeleteCommand({ regionName }),
          ]}
        />
        <CommandStep
          testId="openstack-trace-end"
          label="Stop signing."
          commands={[OPENSTACK_TRACE_END_COMMAND]}
        />

        <div className="space-y-1.5 border-t border-gray-200 pt-4">
          <label
            className="block text-sm text-gray-700"
            htmlFor="openstack-trace-id"
          >
            <TranslatedSentence
              template="Each command prints {{line}}. Paste it here to open that trace. Give it a few seconds: spans are sent in batches."
              slots={{
                line: (
                  <code className="font-mono text-xs text-gray-800">
                    Trace ID: …
                  </code>
                ),
              }}
            />
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="min-w-0 flex-1">
              <Input
                id="openstack-trace-id"
                dataTestId="openstack-trace-id"
                placeholder="Trace ID: 4e3e0ec6-2938-40b1-8504-09eb1d4b0dee"
                value={pasted}
                onChange={(value: string) => {
                  setPasted(value);
                  setNotAnId(false);
                }}
                onEnterPress={openPasted}
              />
            </div>
            <Button
              title="Open trace"
              dataTestId="openstack-trace-open"
              buttonStyle={ButtonStyleType.NORMAL}
              onClick={openPasted}
            />
          </div>
          {notAnId ? (
            <p
              className="text-sm text-red-700"
              data-testid="openstack-trace-id-invalid"
            >
              {translator.translateText(
                "That holds no trace ID. It looks like 4e3e0ec6-2938-40b1-8504-09eb1d4b0dee, on the line that starts Trace ID.",
              )}
            </p>
          ) : (
            <></>
          )}
          <p className="text-sm text-gray-500">
            {translator.translateText(
              "No Trace ID line means the client has no OSProfiler, which it ignores your key without: pip install osprofiler where you run openstack.",
            )}
          </p>
        </div>
      </div>
    </Card>
  );
};

export default OpenStackTraceARequestCard;
