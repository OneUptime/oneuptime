import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  OpenStackMaintenancePart,
  OpenStackMaintenancePartKind,
} from "Common/Types/OpenStack/OpenStackMaintenancePart";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Link from "Common/UI/Components/Link/Link";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import {
  OpenStackWhoWouldBeTold,
  fetchOpenStackMaintenanceCovering,
  fetchOpenStackWhoWouldBeTold,
} from "../../../Pages/OpenStack/Utils/OpenStackStatusPageReads";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import OpenStackPartNotice from "./OpenStackPartNotice";
import useOpenStackRead, { OpenStackRead } from "./UseOpenStackRead";

/*
 * PLANNED WORK ON A HOST OR A ZONE.
 *
 * An event on just this: while it is on, what this part says stays quiet and every other part goes on paging.
 * It names who it reaches when it is made, in its own feed, and tells the projects that asked, so this shows
 * who that would be before it is made. A disable reads as what it is: expected during such an event, and
 * something nobody has explained outside one.
 */

const SCHEDULE_FORM_ID: string = "openstack-planned-work-form";

export interface ComponentProps {
  testId: string;
  openStackCloudId: ObjectID;
  kind: OpenStackMaintenancePartKind;
  // The host or the zone, as the inventory has it.
  name: string;
  regionName: string | null;
  // Someone disabled this host's nova-compute.
  isDisabled?: boolean | undefined;
}

const OpenStackPlannedWorkCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);
  const [madeId, setMadeId] = useState<string | null>(null);
  const [error, setError] = useState<string>("");

  const part: OpenStackMaintenancePart = {
    openStackCloudId: props.openStackCloudId.toString(),
    kind: props.kind,
    name: props.name,
    regionName: props.regionName,
  };

  const told: OpenStackRead<OpenStackWhoWouldBeTold> =
    useOpenStackRead<OpenStackWhoWouldBeTold>(() => {
      return fetchOpenStackWhoWouldBeTold({
        openStackCloudId: props.openStackCloudId,
        part: { parts: [part] },
      });
    }, [
      props.openStackCloudId.toString(),
      props.kind,
      props.name,
      props.regionName || "",
    ]);

  const covering: OpenStackRead<Array<{ id: string; title: string }>> =
    useOpenStackRead<Array<{ id: string; title: string }>>(async () => {
      if (
        !props.isDisabled ||
        props.kind !== OpenStackMaintenancePartKind.Hypervisor
      ) {
        return [];
      }

      return await fetchOpenStackMaintenanceCovering({
        openStackCloudId: props.openStackCloudId,
        hostName: props.name,
        regionName: props.regionName,
      });
    }, [
      props.openStackCloudId.toString(),
      props.name,
      props.regionName || "",
      String(Boolean(props.isDisabled)),
      madeId || "",
    ]);

  const madeRoute: Route | null = madeId
    ? RouteUtil.populateRouteParams(
        RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW] as Route,
        { modelId: new ObjectID(madeId) },
      )
    : null;

  const isOn: boolean = (covering.data || []).length > 0;

  return (
    <div data-testid={props.testId}>
      {props.isDisabled && !covering.isLoading ? (
        <OpenStackPartNotice
          testId={`${props.testId}-disabled`}
          tone={isOn ? "neutral" : "warning"}
          text={
            isOn
              ? translationKey(
                  "Disabled during planned maintenance, which is expected. Nothing pages about this host while it is on.",
                )
              : translationKey(
                  "Disabled with no maintenance event covering this host. Compute Service Disabled pages about this. If it is planned, put an event on the host.",
                )
          }
        />
      ) : (
        <></>
      )}

      <Card
        title={translationKey("Planned Work")}
        description={
          props.kind === OpenStackMaintenancePartKind.AvailabilityZone
            ? translationKey(
                "A maintenance event on this zone keeps its hosts quiet while it is on, names who it reaches, and tells the projects that asked. Every other part goes on paging.",
              )
            : translationKey(
                "A maintenance event on this host keeps it quiet while it is on, names who it reaches, and tells the projects that asked. Every other host goes on paging.",
              )
        }
        buttons={[
          {
            title: translationKey("Schedule Maintenance"),
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.Calendar,
            onClick: () => {
              setError("");
              setIsFormOpen(true);
            },
          },
        ]}
      >
        <div
          className="space-y-2 text-sm text-gray-700"
          data-testid={`${props.testId}-reach`}
        >
          {error ? <ErrorMessage message={error} /> : <></>}
          {told.data?.summary ? (
            <p>
              {translator.translateTemplate("It reaches {{summary}}.", {
                summary: told.data.summary,
              })}
            </p>
          ) : (
            <></>
          )}
          {told.data && told.data.told.length > 0 ? (
            <ul data-testid={`${props.testId}-told`}>
              {told.data.told.map(
                (one: OpenStackWhoWouldBeTold["told"][number]) => {
                  return (
                    <li key={`${one.projectId}-${one.address}`}>
                      {translator.translateTemplate(
                        "{{project}} would be told, at {{address}}.",
                        {
                          project: one.name || one.projectId,
                          address:
                            one.address ||
                            translator.translateText("its status page") ||
                            "",
                        },
                      )}
                    </li>
                  );
                },
              )}
            </ul>
          ) : (
            <></>
          )}
          {told.data && told.data.told.length === 0 ? (
            <p>
              {translator.translateText(
                "Nobody would be told: no project on it has a notice turned on.",
              )}
            </p>
          ) : (
            <></>
          )}
          {madeRoute ? (
            <p data-testid={`${props.testId}-made`}>
              <Link to={madeRoute} className="text-indigo-600 underline">
                {translator.translateText("Open the maintenance event")}
              </Link>
            </p>
          ) : (
            <></>
          )}
        </div>
      </Card>

      {isFormOpen ? (
        <BasicFormModal<JSONObjectForm>
          title={translationKey("Schedule Maintenance")}
          description={translationKey(
            "Starts on the state it would on any event, and stays editable on its own page.",
          )}
          onClose={() => {
            setIsFormOpen(false);
          }}
          formProps={{
            id: SCHEDULE_FORM_ID,
            fields: [
              {
                field: { title: true },
                title: "Title",
                fieldType: FormFieldSchemaType.Text,
                required: true,
                placeholder: "Kernel upgrade",
              },
              {
                field: { startsAt: true },
                title: "Starts At",
                fieldType: FormFieldSchemaType.DateTime,
                required: true,
              },
              {
                field: { endsAt: true },
                title: "Ends At",
                fieldType: FormFieldSchemaType.DateTime,
                required: true,
              },
            ],
          }}
          onSubmit={async (values: FormValues<JSONObjectForm>) => {
            try {
              const event: ScheduledMaintenance = new ScheduledMaintenance();
              event.title = String(values["title"] || "");
              event.startsAt = OneUptimeDate.fromString(
                String(values["startsAt"]),
              );
              event.endsAt = OneUptimeDate.fromString(String(values["endsAt"]));
              event.openStackParts = [part];

              // Linked to the cloud as well, so it lists on the cloud's page.
              const cloud: OpenStackCloud = new OpenStackCloud();
              cloud._id = props.openStackCloudId.toString();
              event.openStackClouds = [cloud];

              const created: { data: ScheduledMaintenance } =
                (await ModelAPI.create<ScheduledMaintenance>({
                  model: event,
                  modelType: ScheduledMaintenance,
                })) as unknown as { data: ScheduledMaintenance };

              setMadeId(created.data?._id?.toString() || null);
              setIsFormOpen(false);
            } catch (err) {
              setError(API.getFriendlyMessage(err));
              setIsFormOpen(false);
            }
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

interface JSONObjectForm {
  title?: string;
  startsAt?: Date;
  endsAt?: Date;
}

export default OpenStackPlannedWorkCard;
