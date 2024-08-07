import MonitorStepsForm from "../../../Components/Form/Monitor/MonitorSteps";
import DisabledWarning from "../../../Components/Monitor/DisabledWarning";
import MonitorStepsViewer from "../../../Components/Monitor/MonitorSteps/MonitorSteps";
import PageComponentProps from "../../PageComponentProps";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorStepsType from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import ComponentLoader from "Common/UI/src/Components/ComponentLoader/ComponentLoader";
import EmptyState from "Common/UI/src/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/src/Components/ErrorMessage/ErrorMessage";
import {
  CustomElementProps,
  FormFieldStyleType,
} from "Common/UI/src/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/src/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/src/Components/Forms/Types/FormValues";
import { ModalWidth } from "Common/UI/src/Components/Modal/Modal";
import CardModelDetail from "Common/UI/src/Components/ModelDetail/CardModelDetail";
import { GetReactElementFunction } from "Common/UI/src/Types/FunctionTypes";
import API from "Common/UI/src/Utils/API/API";
import ModelAPI from "Common/UI/src/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/src/Utils/Navigation";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import { useAsyncEffect } from "use-async-effect";

const MonitorCriteria: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [isLoading, setIsLoading] = useState<boolean>(true);

  const [error, setError] = useState<string>("");

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
        },
      });

      if (!item) {
        setError(`Monitor not found`);

        return;
      }

      setMonitorType(item.monitorType);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  const [monitorType, setMonitorType] = useState<MonitorType | undefined>(
    undefined,
  );

  useAsyncEffect(async () => {
    // fetch the model
    await fetchItem();
  }, []);

  const getPageContent: GetReactElementFunction = (): ReactElement => {
    if (!monitorType || isLoading) {
      return <ComponentLoader />;
    }

    if (error) {
      return <ErrorMessage error={error} />;
    }

    if (monitorType === MonitorType.Manual) {
      return (
        <EmptyState
          id="monitoring-criteria-empty-state"
          icon={IconProp.Criteria}
          title={"No Criteria for Manual Monitors"}
          description={
            <>
              This is a manual monitor and it cannot have any criteria set. You
              can have monitoring criteria on other monitor types.{" "}
            </>
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
          description: "Here is the criteria we use to monitor this resource.",
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
                  error={""}
                />
              );
            },
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: Monitor,
          id: "model-detail-monitors",
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
