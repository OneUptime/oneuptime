import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import SnmpOid from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Navigation from "Common/UI/Utils/Navigation";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceOidTemplate from "Common/Models/DatabaseModels/NetworkDeviceOidTemplate";
import SnmpOidListUtil from "Common/Types/Monitor/SnmpMonitor/SnmpOidListUtil";
import {
  MONITORING_METHOD_OPTIONS,
  isMonitorBackedDevice,
  isSnmpDevice,
} from "../../../Components/NetworkDevice/MonitoringMethodFormFields";
import {
  DEVICE_ROLE_FIELD_DESCRIPTION,
  DEVICE_ROLE_FIELD_TITLE,
  DEVICE_ROLE_OPTIONS,
} from "../../../Components/NetworkDevice/DeviceRoleFormFields";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import DeviceHealthOidsFormField from "../../../Components/NetworkDevice/DeviceHealthOidsFormField";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { getSnmpConfigFormFields } from "../SnmpConfigFormFields";
import { getDevicePollingFormFields } from "../DevicePollingFormFields";
import ProbeUtil from "../../../Utils/Probe";
import Probe from "Common/Models/DatabaseModels/Probe";
import ProbeElement from "Common/UI/Components/Probe/Probe";
import BadDataException from "Common/Types/Exception/BadDataException";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

const NetworkDeviceSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  /*
   * The probe list is fetched rather than pulled in through a dropdownModal:
   * global probes are not project rows and only come back from the dedicated
   * /probe/global-probes endpoint, which ProbeUtil merges in. A plain model
   * dropdown would silently offer an empty list on any install whose probes
   * are all global.
   */
  const [probes, setProbes] = useState<Array<Probe>>([]);
  /*
   * The project's OID Collection Templates, WITH their OID lists.
   *
   * Fetched as a top-level list rather than reached through the device's
   * `oidTemplate` relation, and that is a hard constraint, not a preference:
   * QueryPermission.checkRelationQueryPermission refuses any column on a
   * joined model that does not carry canReadOnRelationQuery, and on
   * NetworkDeviceOidTemplate only `name` and `projectId` do. A select of
   * `oidTemplate: { oids: true }` throws "Column oids on OID Collection
   * Template does not support read on relation query" and takes the whole
   * request with it — the card would not render at all.
   *
   * One list serves both readers below: the editor, which shows what the
   * selected template contributes while the form is open, and the read-only
   * Health OIDs row, which has to merge the same list to say what the device
   * actually collects.
   */
  const [oidTemplates, setOidTemplates] = useState<
    Array<NetworkDeviceOidTemplate>
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * Deliberately swallows its own errors instead of failing the page.
   *
   * A reader with ReadNetworkDevice but no ReadNetworkDeviceOidTemplate gets
   * a 401 here, and this list is an enrichment — losing it costs the OID
   * bodies, not the ability to see or edit the device's polling settings.
   * Both readers below say so explicitly rather than rendering a device that
   * looks like it collects nothing but its own OIDs.
   */
  const fetchOidTemplates: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const listResult: ListResult<NetworkDeviceOidTemplate> =
        await ModelAPI.getList<NetworkDeviceOidTemplate>({
          modelType: NetworkDeviceOidTemplate,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
            oids: true,
          },
          sort: {},
        });

      setOidTemplates(listResult.data);
    } catch {
      setOidTemplates([]);
    }
  };

  /*
   * Both fetches gate the loader, and the templates one has to.
   * ModelDetail captures its `fields` — closures included — in a mount-time
   * effect, so a template list that arrives after the card has rendered is
   * never seen by the Health OIDs element below.
   */
  const fetchPageData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const [fetchedProbes]: [Array<Probe>, void] = await Promise.all([
        ProbeUtil.getAllProbes(),
        fetchOidTemplates(),
      ]);

      setProbes(fetchedProbes);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchPageData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  type FindOidTemplateFunction = (
    templateId: string | undefined,
  ) => NetworkDeviceOidTemplate | undefined;

  const findOidTemplate: FindOidTemplateFunction = (
    templateId: string | undefined,
  ): NetworkDeviceOidTemplate | undefined => {
    if (!templateId) {
      return undefined;
    }

    return oidTemplates.find((template: NetworkDeviceOidTemplate): boolean => {
      return template._id?.toString() === templateId;
    });
  };

  type GetSelectedOidTemplateIdFunction = (
    values: FormValues<NetworkDevice>,
  ) => string | undefined;

  /*
   * The template the FORM currently has selected, which is not necessarily
   * the one the device was saved with — ModelForm reduces an entity relation
   * to its id, and EntityDropdown hands back an id (or null on clear), so
   * both shapes arrive here as something with a toString().
   */
  const getSelectedOidTemplateId: GetSelectedOidTemplateIdFunction = (
    values: FormValues<NetworkDevice>,
  ): string | undefined => {
    const selected: unknown = values.oidTemplate;

    if (!selected) {
      return undefined;
    }

    return String(selected);
  };

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <Fragment>
      <CardModelDetail<NetworkDevice>
        name="Device Settings"
        cardProps={{
          title: "Device Settings",
          description: "Manage settings for this network device.",
        }}
        isEditable={true}
        editButtonText="Edit Settings"
        formSteps={[
          {
            title: "Device Details",
            id: "device-details",
          },
          {
            /*
             * Nothing polls a monitor-backed device, so a community string
             * or a v3 credential has nothing to be used for.
             */
            title: "SNMP Credentials",
            id: "snmp",
            showIf: isSnmpDevice,
          },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "device-details",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "core-switch-01",
          },
          {
            field: {
              monitoringMethod: true,
            },
            title: "Monitoring Method",
            stepId: "device-details",
            description:
              "SNMP means an assigned probe polls this device on its own schedule. Monitor means nothing polls it and the bound monitor's status is its status — switching to Monitor turns polling off.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: MONITORING_METHOD_OPTIONS,
            required: true,
            placeholder: "Monitoring method",
          },
          {
            field: {
              monitor: true,
            },
            title: "Monitor",
            stepId: "device-details",
            showIf: isMonitorBackedDevice,
            description:
              "The monitor whose status IS this device's status. Usually a Ping or IP monitor on the device's address.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: Monitor,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Monitor",
          },
          {
            field: {
              deviceRole: true,
            },
            title: DEVICE_ROLE_FIELD_TITLE,
            stepId: "device-details",
            description: DEVICE_ROLE_FIELD_DESCRIPTION,
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: DEVICE_ROLE_OPTIONS,
            required: false,
            placeholder: "Worked out from the device (SNMP only)",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "device-details",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Core switch in the US East datacenter",
          },
          {
            field: {
              hostname: true,
            },
            title: "Hostname",
            stepId: "device-details",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "10.0.0.1 or switch-01.example.com",
            description: "IP address or hostname the probe will poll via SNMP.",
          },
          ...getSnmpConfigFormFields({ stepId: "snmp" }),
        ]}
        modelDetailProps={{
          modelType: NetworkDevice,
          id: "network-device-settings",
          modelId: modelId,
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FieldType.Text,
            },
            {
              field: {
                hostname: true,
              },
              title: "Hostname",
              fieldType: FieldType.Text,
            },
            {
              field: {
                monitoringMethod: true,
              },
              title: "Monitoring Method",
              fieldType: FieldType.Text,
            },
            {
              field: {
                monitor: {
                  name: true,
                },
              },
              title: "Monitor",
              fieldType: FieldType.Text,
            },
            {
              field: {
                deviceRole: true,
              },
              title: DEVICE_ROLE_FIELD_TITLE,
              fieldType: FieldType.Text,
            },
          ],
        }}
      />
      <CardModelDetail<NetworkDevice>
        name="Polling & Data Collection"
        cardProps={{
          title: "Polling & Data Collection",
          description:
            "The assigned probe polls this device on its own schedule — inventory, interfaces, topology neighbors, endpoints, and health OIDs. Monitors are only needed to alert on what these polls report.",
        }}
        isEditable={true}
        editButtonText="Edit Polling"
        formSteps={[
          {
            title: "Polling",
            id: "polling",
          },
          {
            title: "Health OIDs",
            id: "health-oids",
          },
        ]}
        formFields={[
          {
            field: {
              probe: true,
            },
            title: "Probe",
            stepId: "polling",
            description:
              "The probe that polls this device, and the one whose SNMP trap, syslog and NetFlow receivers this device's records are matched against. It has to be able to reach the device directly.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: probes.map((probe: Probe) => {
              if (!probe.name || !probe._id) {
                throw new BadDataException(`Probe name or id is missing`);
              }

              return {
                label: probe.name,
                value: probe._id,
              };
            }),
            required: true,
            placeholder: "Probe",
          },
          ...getDevicePollingFormFields({ stepId: "polling" }),
          {
            field: {
              oidTemplate: true,
            },
            title: "OID Collection Template",
            stepId: "health-oids",
            description:
              "The shared OID list this device collects, on top of any device-specific OIDs below. The link is live and nothing is copied here: editing the template changes what every device linked to it collects on the next poll. Interfaces need no OIDs — bits in/out, errors, utilization and up/down are walked for every port automatically.",
            sideLink: {
              text: "Manage templates",
              url: RouteUtil.populateRouteParams(
                RouteMap[
                  PageMap.NETWORK_DEVICE_SETTINGS_OID_TEMPLATES
                ] as Route,
              ),
              openLinkInNewTab: true,
            },
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: NetworkDeviceOidTemplate,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "No template — device-specific OIDs only",
          },
          {
            field: {
              snmpOids: true,
            },
            title: "Device-Specific Health OIDs",
            stepId: "health-oids",
            description:
              "Extra OIDs only this device collects, on top of whatever its template contributes. If more than one device needs the same OID it belongs on a template instead — one edit there reaches every device linked to it. Values are recorded as device metrics and can be alerted on through monitor criteria.",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            getCustomElement: (
              value: FormValues<NetworkDevice>,
              customElementProps: CustomElementProps,
            ): ReactElement => {
              const selectedTemplateId: string | undefined =
                getSelectedOidTemplateId(value);

              const selectedTemplate: NetworkDeviceOidTemplate | undefined =
                findOidTemplate(selectedTemplateId);

              return (
                <DeviceHealthOidsFormField
                  {...customElementProps}
                  /*
                   * Re-passed AFTER the spread on purpose. FormField hands a
                   * CustomComponent `currentValues[fieldName] || ""`, so an
                   * untouched form supplies an empty STRING rather than an
                   * empty list.
                   */
                  initialValue={
                    (value.snmpOids as Array<SnmpOid> | undefined) || []
                  }
                  /*
                   * Spread conditionally: the PRESENCE of templateOids is
                   * what tells the editor a template is linked, so an
                   * explicit undefined would read as "no template" and put
                   * the vendor copy dropdown back on screen next to it.
                   * Passing an empty list for a template the fetch could not
                   * resolve is the honest answer — it is linked, and this
                   * page cannot say what it contains.
                   */
                  {...(selectedTemplateId
                    ? { templateOids: selectedTemplate?.oids || [] }
                    : {})}
                  {...(selectedTemplate?.name
                    ? { templateName: selectedTemplate.name }
                    : {})}
                />
              );
            },
          },
          {
            field: {
              autoApplyVendorHealthTemplate: true,
            },
            title: "Auto-Apply Vendor Health Template",
            stepId: "health-oids",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "When the device's vendor is fingerprinted from its SNMP sysObjectID and the Health OID list above is empty, seed it with the matching vendor health template automatically on the next poll. A non-empty list is never touched. Auto-imported devices have this on by default.",
          },
        ]}
        modelDetailProps={{
          modelType: NetworkDevice,
          id: "network-device-polling-settings",
          modelId: modelId,
          fields: [
            {
              field: {
                probe: {
                  name: true,
                  iconFileId: true,
                },
              },
              title: "Probe",
              fieldType: FieldType.Element,
              getElement: (item: NetworkDevice): ReactElement => {
                if (!item.probe) {
                  return <p>No probe assigned.</p>;
                }
                return <ProbeElement probe={item.probe} />;
              },
            },
            {
              field: {
                isPollingEnabled: true,
              },
              title: "Polling Enabled",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                pollingIntervalInMinutes: true,
              },
              title: "Polling Interval (Minutes)",
              fieldType: FieldType.Number,
            },
            {
              field: {
                walkInterfaces: true,
              },
              title: "Walk Interfaces",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                collectEndpoints: true,
              },
              title: "Collect Connected Endpoints",
              fieldType: FieldType.Boolean,
            },
            {
              /*
               * The EFFECTIVE list, and the only place it is visible.
               *
               * A linked template is resolved at poll time and never copied
               * onto the device, so `snmpOids` on its own stopped being an
               * answer to "what does this device collect?" the moment
               * templates existed — it is only the device's own additions.
               *
               * The template's NAME comes through the relation, which it may
               * (canReadOnRelationQuery); its OIDs come from the list fetched
               * above, which they must — see the comment on that fetch. The
               * id is selected so a template whose body could not be fetched
               * is still reported as linked instead of silently vanishing.
               */
              field: {
                snmpOids: true,
                oidTemplateId: true,
                oidTemplate: {
                  name: true,
                },
              },
              title: "Health OIDs",
              fieldType: FieldType.Element,
              getElement: (item: NetworkDevice): ReactElement => {
                const linkedTemplateId: string | undefined =
                  item.oidTemplateId?.toString();

                const templateName: string | undefined = linkedTemplateId
                  ? item.oidTemplate?.name || "the linked template"
                  : undefined;

                const linkedTemplate: NetworkDeviceOidTemplate | undefined =
                  findOidTemplate(linkedTemplateId);

                if (linkedTemplateId && !linkedTemplate) {
                  return (
                    <span>
                      This device is linked to {templateName}, but its OIDs
                      could not be loaded, so the full collected list cannot be
                      shown here.
                    </span>
                  );
                }

                const templateOids: Array<SnmpOid> = linkedTemplate?.oids || [];
                const deviceOids: Array<SnmpOid> = item.snmpOids || [];

                const effectiveOids: Array<SnmpOid> =
                  SnmpOidListUtil.mergeOidLists(templateOids, deviceOids);

                if (effectiveOids.length === 0) {
                  return (
                    <span>
                      {templateName
                        ? `No health OIDs collected — ${templateName} is empty and this device adds none of its own.`
                        : "No health OIDs configured."}
                    </span>
                  );
                }

                const fromTemplate: Set<string> = new Set(
                  templateOids.map((oid: SnmpOid): string => {
                    return SnmpOidListUtil.normalizeOid(oid.oid);
                  }),
                );

                const overriddenByDevice: Set<string> = new Set(
                  deviceOids.map((oid: SnmpOid): string => {
                    return SnmpOidListUtil.normalizeOid(oid.oid);
                  }),
                );

                const templateCount: number = effectiveOids.filter(
                  (oid: SnmpOid): boolean => {
                    return fromTemplate.has(oid.oid);
                  },
                ).length;

                const summary: string = templateName
                  ? `${effectiveOids.length} collected on each poll — ${templateCount} from ${templateName}, ${
                      effectiveOids.length - templateCount
                    } specific to this device.`
                  : `${effectiveOids.length} collected on each poll, all specific to this device. No OID Collection Template is linked.`;

                return (
                  <div
                    className="space-y-2"
                    data-testid="network-device-effective-health-oids"
                  >
                    <p className="text-sm text-gray-500">{summary}</p>
                    <ul className="space-y-1 text-sm text-gray-700">
                      {effectiveOids.map((oid: SnmpOid, index: number) => {
                        const isFromTemplate: boolean = fromTemplate.has(
                          oid.oid,
                        );

                        return (
                          <li
                            key={`${oid.oid}-${index}`}
                            className="flex flex-wrap items-baseline gap-x-2"
                          >
                            <span className="font-medium text-gray-900">
                              {oid.name || oid.oid}
                            </span>
                            {oid.name ? (
                              <span className="text-gray-500">{oid.oid}</span>
                            ) : (
                              <></>
                            )}
                            {isFromTemplate ? (
                              <span className="text-gray-500">
                                {overriddenByDevice.has(oid.oid)
                                  ? "from template, overridden by this device"
                                  : "from template"}
                              </span>
                            ) : (
                              <></>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              },
            },
          ],
        }}
      />
      <ArchiveResourceCard<NetworkDevice>
        modelType={NetworkDevice}
        modelId={modelId}
        singularName="device"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.NETWORK_DEVICES] as Route,
        )}
      />
    </Fragment>
  );
};

export default NetworkDeviceSettings;
