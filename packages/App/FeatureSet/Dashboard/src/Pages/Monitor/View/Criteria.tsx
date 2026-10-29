import MonitorStepsForm from "../../../Components/Form/Monitor/MonitorSteps";
import DisabledWarning from "../../../Components/Monitor/DisabledWarning";
import MonitorStepsViewer from "../../../Components/Monitor/MonitorSteps/MonitorSteps";
import PageComponentProps from "../../PageComponentProps";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorStepsType from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import {
  CustomElementProps,
  FormFieldStyleType,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import { useAsyncEffect } from "use-async-effect";
import MonitorTestForm from "../../../Components/Form/Monitor/MonitorTest";
import Probe from "Common/Models/DatabaseModels/Probe";
import ProbeUtil from "../../../Utils/Probe";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const MonitorCriteria: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [isLoading, setIsLoading] = useState<boolean>(true);

  const [error, setError] = useState<string>("");

  const [probes, setProbes] = useState<Array<Probe>>([]);

  const fetchItem: PromiseVoidFunction = async (): Promise<void> => {
    // get item.
    setIsLoading(true);

    setError("");
    try {
      const item: Monitor | null = await ModelAPI.getItem({
        modelType: Monitor,
        id: modelId,
        select: {
          monitorType: true,
          name: true,
        },
      });

      if (!item) {
        setError(ExceptionMessages.MonitorNotFound);

        return;
      }

      /*
       * A telemetry monitor's rule names what it opens after the monitor
       * ("Checkout: too many errors"), and follows a changed rule only in
       * the titles it wrote - which it knows by the monitor's name.
       */
      setMonitorName(item.name || "");

      const probes: Array<Probe> = await ProbeUtil.getAllProbes();

      setProbes(probes);

      setMonitorType(item.monitorType);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  const [monitorType, setMonitorType] = useState<MonitorType | undefined>(
    undefined,
  );

  const [monitorName, setMonitorName] = useState<string>("");

  const [monitorSteps, setMonitorSteps] = useState<
    MonitorStepsType | undefined
  >(undefined);

  useAsyncEffect(async () => {
    // fetch the model
    await fetchItem();
  }, []);

  const getPageContent: GetReactElementFunction = (): ReactElement => {
    if (!monitorType || isLoading) {
      return <ComponentLoader />;
    }

    if (error) {
      return <ErrorMessage message={error} />;
    }

    /*
     * A manual monitor has no criteria, so its menu lists no Criteria page
     * (MonitorTypeHelper.doesMonitorTypeHaveCriteria): an entry that only
     * opened "there is nothing here" would be one more row to read on
     * every visit. The address still answers - an old bookmark, a link
     * someone shared - and says why there is nothing, with one way on:
     * the overview, where the status is set.
     */
    if (monitorType === MonitorType.Manual) {
      return (
        <EmptyState
          id="monitoring-criteria-empty-state"
          icon={IconProp.Criteria}
          title={"No Criteria for Manual Monitors"}
          description={
            <>
              {translator.translateText(
                "A manual monitor has no criteria: you set its status yourself, from the ⋯ menu on its overview.",
              )}
            </>
          }
          footer={
            /*
             * The wrapper takes off the dialog-footer margin Button
             * carries from md, which set it off centre.
             */
            <div className="[&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0">
              <Button
                title="Go to Overview"
                icon={IconProp.Info}
                buttonStyle={ButtonStyleType.NORMAL}
                dataTestId="manual-monitor-criteria-go-to-overview"
                onClick={() => {
                  Navigation.navigate(
                    RouteUtil.populateRouteParams(
                      RouteMap[PageMap.MONITOR_VIEW] as Route,
                      { modelId: modelId },
                    ),
                  );
                }}
              />
            </div>
          }
        />
      );
    }

    return (
      <CardModelDetail
        name="Monitoring Criteria"
        editButtonText="Edit Monitoring Criteria"
        cardProps={{
          title: "Monitoring Criteria",
          description:
            "The conditions that decide this monitor's status, and the incidents and alerts it creates.",
          rightElement: monitorSteps ? (
            <MonitorTestForm
              monitorId={modelId}
              buttonSize={ButtonSize.Normal}
              monitorSteps={monitorSteps}
              monitorType={monitorType}
              probes={probes}
            />
          ) : (
            <></>
          ),
        }}
        createEditModalWidth={ModalWidth.Large}
        isEditable={true}
        formFields={[
          {
            field: {
              monitorSteps: true,
            },
            stepId: "criteria",
            styleType: FormFieldStyleType.Heading,
            title: "Monitor Details",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: true,
            hideColumnDescription: true,
            customValidation: (values: FormValues<Monitor>) => {
              const error: string | null = MonitorStepsType.getValidationError(
                values.monitorSteps as MonitorStepsType,
                monitorType,
              );

              return error;
            },
            getCustomElement: (
              _value: FormValues<Monitor>,
              props: CustomElementProps,
            ) => {
              return (
                <MonitorStepsForm
                  {...props}
                  monitorType={monitorType || MonitorType.Manual}
                  monitorId={modelId}
                  monitorName={monitorName}
                />
              );
            },
          },
        ]}
        onSaveSuccess={async (item: Monitor) => {
          setMonitorSteps(item.monitorSteps);
        }}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: Monitor,
          id: "model-detail-monitors",
          onItemLoaded: (monitor: Monitor) => {
            if (!monitorSteps) {
              setMonitorSteps(monitor.monitorSteps);
            }
          },
          fields: [
            {
              field: {
                monitorSteps: true,
              },
              title: "",
              getElement: (item: Monitor): ReactElement => {
                return (
                  <MonitorStepsViewer
                    monitorSteps={item["monitorSteps"] as MonitorStepsType}
                    monitorType={monitorType}
                  />
                );
              },
            },
          ],
          modelId: modelId,
        }}
      />
    );
  };

  return (
    <Fragment>
      <DisabledWarning monitorId={modelId} />
      {getPageContent()}
    </Fragment>
  );
};

export default MonitorCriteria;
