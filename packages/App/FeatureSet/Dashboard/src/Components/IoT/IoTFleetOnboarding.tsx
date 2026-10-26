import React, { ReactElement } from "react";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceGuideProps,
  ResourceOnboarding,
} from "../ResourceOnboarding/AddResourceGuide";
import IoTDocumentationCard from "./DocumentationCard";
import PageMap from "../../Utils/PageMap";
import { IOT_EXAMPLE_FLEET_NAME } from "../../Pages/IoT/Utils/DocumentationMarkdown";

/*
 * Adding an IoT fleet: name it, pick how the devices send and a key, send
 * a reading, and the guide's last step says when it arrived. The fleet
 * registers itself under that name (findOrCreateByName).
 */
const IOT_FLEET_ONBOARDING: ResourceOnboarding = {
  modelType: IoTFleet,
  addTitle: translationKey("Add IoT Fleet"),
  addDescription: translationKey(
    "Send readings from your devices with OpenTelemetry or MQTT. The fleet shows up here as soon as the first reading arrives.",
  ),
  viewText: translationKey("View fleet"),
  viewPage: PageMap.IOT_FLEET_VIEW,
  name: {
    label: translationKey("Fleet name"),
    field: "name",
    example: IOT_EXAMPLE_FLEET_NAME,
  },
  renderGuide: (props: ResourceGuideProps): ReactElement => {
    return (
      <IoTDocumentationCard
        title={props.title}
        description={props.description}
        fleetName={props.name}
        isBare={props.isBare}
        inputs={props.inputs}
        lastStep={props.lastStep}
      />
    );
  },
};

export default IOT_FLEET_ONBOARDING;
