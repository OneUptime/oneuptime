import ObjectID from "Common/Types/ObjectID";
import Incident from "Common/Models/DatabaseModels/Incident";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Card from "Common/UI/Components/Card/Card";
import DictionaryOfStringsViewer from "Common/UI/Components/Dictionary/DictionaryOfStingsViewer";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import API from "Common/UI/Utils/API/API";

export interface ComponentProps {
  incidentId: ObjectID;
}

const IncidentAffectedResources: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [seriesLabels, setSeriesLabels] = useState<
    Dictionary<string> | undefined
  >(undefined);

  const fetchSeriesLabels: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const incident: Incident | null = await ModelAPI.getItem({
        modelType: Incident,
        id: props.incidentId,
        select: {
          seriesLabels: true,
        },
      });

      const labels: JSONObject | undefined = incident?.seriesLabels as
        | JSONObject
        | undefined;

      if (!labels || Object.keys(labels).length === 0) {
        setSeriesLabels(undefined);
        return;
      }

      const stringLabels: Dictionary<string> = {};
      for (const key of Object.keys(labels)) {
        const value: unknown = labels[key];
        stringLabels[key] =
          value === undefined || value === null ? "" : String(value);
      }

      setSeriesLabels(stringLabels);
    } catch (err) {
      /*
       * Fetch failure is not worth surfacing — the section simply doesn't
       * render. The main incident detail shows the error state.
       */
      API.getFriendlyMessage(err);
      setSeriesLabels(undefined);
    }
  };

  useEffect(() => {
    fetchSeriesLabels().catch(() => {
      // handled inside fetchSeriesLabels
    });
  }, [props.incidentId]);

  if (!seriesLabels) {
    return <Fragment />;
  }

  return (
    <Fragment>
      <Card
        title="Affected Resource"
        description="The specific resource (e.g. host, pod, container) that triggered this incident. Present when a metric monitor is grouped by one or more attributes."
      >
        <DictionaryOfStringsViewer value={seriesLabels} />
      </Card>
    </Fragment>
  );
};

export default IncidentAffectedResources;
