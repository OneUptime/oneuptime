import Service from "Common/Models/DatabaseModels/Service";
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
  telemetryService?: Service | undefined;
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

  if (props.telemetryService) {
    fields.push({
      key: "telemetryService",
      title: "Telemetry Service",
      description: "The service that this exception was received from.",
      fieldType: FieldType.Element,
      getElement: () => {
        return <ServiceElement service={props.telemetryService!} />;
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
