import Service from "Common/Models/DatabaseModels/Service";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import ProjectUtil from "Common/UI/Utils/Project";
import TelemetryServiceUtil from "Common/UI/Utils/TelemetryService";
import { JSONObject } from "Common/Types/JSON";
import Card from "Common/UI/Components/Card/Card";
import Detail from "Common/UI/Components/Detail/Detail";
import Field from "Common/UI/Components/Detail/Field";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { FunctionComponent, ReactElement } from "react";
import ServiceElement from "../Service/ServiceElement";

export interface ComponentProps {
  exceptionType?: string | undefined;
  message?: string | undefined;
  stackTrace?: string | undefined;
  fingerprint?: string | undefined;
  firstSeenAt?: Date | undefined;
  lastSeenAt?: Date | undefined;
  occuranceCount?: number | undefined;
  attributes?: JSONObject | undefined;
  service?: Service | undefined;
  serviceId?: ObjectID | undefined;
  serviceType?: ServiceType | undefined;
  firstSeenInRelease?: string | undefined;
  lastSeenInRelease?: string | undefined;
  environment?: string | undefined;
}

const ExceptionDetail: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const fields: Array<Field<ComponentProps>> = [];

  if (props.message) {
    fields.push({
      key: "message",
      title: "Message",
      description: "The message of the exception.",
      fieldType: FieldType.InlineCode,
    });
  }

  if (props.exceptionType) {
    fields.push({
      key: "exceptionType",
      title: "Exception Type",
      description: "The type of the exception.",
      fieldType: FieldType.Text,
    });
  }

  if (props.firstSeenInRelease) {
    fields.push({
      key: "firstSeenInRelease",
      title: "Introduced In Release",
      description:
        "The release version where this exception was first observed.",
      fieldType: FieldType.Text,
    });
  }

  if (props.lastSeenInRelease) {
    fields.push({
      key: "lastSeenInRelease",
      title: "Last Seen In Release",
      description:
        "The most recent release version where this exception was observed.",
      fieldType: FieldType.Text,
    });
  }

  if (props.environment) {
    fields.push({
      key: "environment",
      title: "Environment",
      description: "The deployment environment where this exception occurred.",
      fieldType: FieldType.Text,
    });
  }

  if (props.stackTrace) {
    fields.push({
      key: "stackTrace",
      title: "Stack Trace",
      description: "The stack trace of the exception.",
      fieldType: FieldType.Code,
    });
  }

  if (props.firstSeenAt) {
    fields.push({
      key: "firstSeenAt",
      title: "First Seen At",
      description: "The time the exception was first seen.",
      fieldType: FieldType.DateTime,
    });
  }

  if (props.lastSeenAt) {
    fields.push({
      key: "lastSeenAt",
      title: "Last Seen At",
      description: "The time the exception was last seen.",
      fieldType: FieldType.DateTime,
    });
  }

  if (props.occuranceCount) {
    fields.push({
      key: "occuranceCount",
      title: "Occurance Count",
      description: "The number of times this exception has occurred.",
      fieldType: FieldType.Number,
    });
  }

  if (props.fingerprint) {
    fields.push({
      key: "fingerprint",
      title: "Fingerprint",
      description: "SHA256 hash of this exception.",
      fieldType: FieldType.InlineCode,
    });
  }

  if (props.attributes) {
    fields.push({
      key: "attributes",
      title: "Attributes",
      description: "Additional attributes of the exception.",
      fieldType: FieldType.JSON,
    });
  }

  /*
   * Resolve the resource this exception belongs to. serviceId is
   * polymorphic: a real Service renders as a linked ServiceElement; the
   * unattributed bucket (serviceType Unknown / serviceId === projectId)
   * renders as a non-linked synthetic "Unknown Service"; Host / DockerHost
   * / KubernetesCluster render as a typed label.
   */
  const serviceField: ReactElement | null = ((): ReactElement | null => {
    if (props.service) {
      return <ServiceElement service={props.service} />;
    }

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (
      projectId &&
      (props.serviceType === ServiceType.Unknown ||
        TelemetryServiceUtil.isUnknownServiceId(props.serviceId, projectId))
    ) {
      return (
        <ServiceElement
          service={TelemetryServiceUtil.getUnknownService(projectId)}
        />
      );
    }

    const typeLabels: Record<string, string> = {
      [ServiceType.Host]: "Host telemetry",
      [ServiceType.DockerHost]: "Docker host telemetry",
      [ServiceType.KubernetesCluster]: "Kubernetes telemetry",
    };
    const label: string | undefined = props.serviceType
      ? typeLabels[props.serviceType]
      : undefined;
    if (label) {
      return <div className="text-gray-700">{label}</div>;
    }

    return null;
  })();

  if (serviceField) {
    fields.push({
      key: "serviceId",
      title: "Telemetry Service",
      description: "The resource that this exception was received from.",
      fieldType: FieldType.Element,
      getElement: () => {
        return serviceField;
      },
    });
  }

  return (
    <Card
      title={"Exception Details"}
      description={"Here are more details of this exception."}
    >
      <div>
        <Detail<ComponentProps> item={props} fields={fields} />
      </div>
    </Card>
  );
};

export default ExceptionDetail;
