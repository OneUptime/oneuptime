import PageComponentProps from "../PageComponentProps";
import DiscoveredDeviceRetentionCard from "../../Components/NetworkDevice/DiscoveredDevices/DiscoveredDeviceRetentionCard";
import {
  DISCOVERED_DEVICES_MORE_SETTINGS_TEST_ID,
  getDiscoveredDeviceRetentionFoldedItem,
} from "../../Components/NetworkDevice/DiscoveredDevices/DiscoveredDeviceRetentionCopy";
import DiscoveredDevicesTable from "../../Components/NetworkDevice/DiscoveredDevices/DiscoveredDevicesTable";
import ObjectID from "Common/Types/ObjectID";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * Network > Topology > Discovered Devices (OneUptime issue #5775): every
 * device the project's switches, routers and network controllers have seen
 * - POS terminals, kiosks, cameras, printers - and whether OneUptime
 * monitors it. Found by name, address, MAC or vendor; added to monitoring
 * a selection at a time, through the discovery import; hidden from the
 * topology map, or shown on it again, in bulk. It used to be the Endpoints
 * table, which could only be read, classified and deleted a row at a time.
 *
 * Under it, folded under More settings, Unseen Devices (issue #6389): how
 * long a device nothing sees any more stays on the list. The line under the
 * table says what it is set to, and its Change opens the fold at the card
 * (#unseen-devices); each save reaches the line at once.
 */
const NetworkEndpoints: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  // What the card read or last saved: undefined until it has.
  const [retentionInDays, setRetentionInDays] = useState<number | undefined>(
    undefined,
  );

  return (
    <Fragment>
      <DiscoveredDevicesTable retentionInDays={retentionInDays} />
      {projectId ? (
        <AdvancedPageSection
          items={[
            getDiscoveredDeviceRetentionFoldedItem(retentionInDays, translator),
          ]}
          dataTestId={DISCOVERED_DEVICES_MORE_SETTINGS_TEST_ID}
        >
          <DiscoveredDeviceRetentionCard
            projectId={projectId}
            onRetentionChange={setRetentionInDays}
          />
        </AdvancedPageSection>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default NetworkEndpoints;
