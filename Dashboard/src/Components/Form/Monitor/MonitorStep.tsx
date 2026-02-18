import MonitorCriteriaElement from "./MonitorCriteria";
import { IncidentRoleOption } from "./MonitorCriteriaIncidentForm";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
import CodeType from "Common/Types/Code/CodeType";
import Dictionary from "Common/Types/Dictionary";
import Exception from "Common/Types/Exception/Exception";
import IP from "Common/Types/IP/IP";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "Common/Types/Monitor/MonitorStepLogMonitor";
import MonitorType from "Common/Types/Monitor/MonitorType";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import Port from "Common/Types/Port";
import ScreenSizeType from "Common/Types/ScreenSizeType";
import ProjectUtil from "Common/UI/Utils/Project";
import { ButtonSize } from "Common/UI/Components/Button/Button";
import CheckBoxList, {
  CategoryCheckboxValue,
  enumToCategoryCheckboxOption,
} from "Common/UI/Components/CategoryCheckbox/CheckboxList";
import CodeEditor from "Common/UI/Components/CodeEditor/CodeEditor";
import DictionaryOfStrings from "Common/UI/Components/Dictionary/DictionaryOfStrings";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import { APP_API_URL, DOCS_URL } from "Common/UI/Config";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import CollapsibleSection from "Common/UI/Components/CollapsibleSection/CollapsibleSection";
import Card from "Common/UI/Components/Card/Card";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import LogMonitorStepForm from "./LogMonitor/LogMonitorStepFrom";
import TraceMonitorStepForm from "./TraceMonitor/TraceMonitorStepForm";
import Service from "Common/Models/DatabaseModels/Service";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import API from "Common/UI/Utils/API/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import MonitorStepTraceMonitor, {
  MonitorStepTraceMonitorUtil,
} from "Common/Types/Monitor/MonitorStepTraceMonitor";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import MonitorTestForm from "./MonitorTest";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import ObjectID from "Common/Types/ObjectID";
import Probe from "Common/Models/DatabaseModels/Probe";
import MetricMonitorStepForm from "./MetricMonitor/MetricMonitorStepForm";
import MonitorStepMetricMonitor, {
  MonitorStepMetricMonitorUtil,
} from "Common/Types/Monitor/MonitorStepMetricMonitor";
import Link from "Common/UI/Components/Link/Link";
import TinyFormDocumentation from "Common/UI/Components/TinyFormDocumentation/TinyFormDocumentation";
import ExceptionMonitorStepForm from "./ExceptionMonitor/ExceptionMonitorStepForm";
import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "Common/Types/Monitor/MonitorStepExceptionMonitor";
import SnmpMonitorStepForm from "./SnmpMonitor/SnmpMonitorStepForm";
import MonitorStepSnmpMonitor, {
  MonitorStepSnmpMonitorUtil,
} from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import DnsMonitorStepForm from "./DnsMonitor/DnsMonitorStepForm";
import MonitorStepDnsMonitor, {
  MonitorStepDnsMonitorUtil,
} from "Common/Types/Monitor/MonitorStepDnsMonitor";
import DomainMonitorStepForm from "./DomainMonitor/DomainMonitorStepForm";
import MonitorStepDomainMonitor, {
  MonitorStepDomainMonitorUtil,
} from "Common/Types/Monitor/MonitorStepDomainMonitor";

export interface ComponentProps {
  monitorStatusDropdownOptions: Array<DropdownOption>;
  incidentSeverityDropdownOptions: Array<DropdownOption>;
  alertSeverityDropdownOptions: Array<DropdownOption>;
  onCallPolicyDropdownOptions: Array<DropdownOption>;
  labelDropdownOptions: Array<DropdownOption>;
  teamDropdownOptions: Array<DropdownOption>;
  userDropdownOptions: Array<DropdownOption>;
  incidentRoleOptions?: Array<IncidentRoleOption> | undefined;
  value?: undefined | MonitorStep;
  onChange?: undefined | ((value: MonitorStep) => void);
  // onDelete?: undefined | (() => void);
  monitorType: MonitorType;
  allMonitorSteps: MonitorSteps;
  probes: Array<Probe>;
  monitorId?: ObjectID | undefined; // this is used to populate secrets when testing the monitor.
}

const MonitorStepElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [
    showAdvancedOptionsRequestBodyAndHeaders,
    setShowAdvancedOptionsRequestBodyAndHeaders,
  ] = useState<boolean>(false);

  const [showDoNotFollowRedirects, setShowDoNotFollowRedirects] =
    useState<boolean>(false);

  const [
    showSyntheticMonitorAdvancedOptions,
    setShowSyntheticMonitorAdvancedOptions,
  ] = useState<boolean>(false);

  const [telemetryServices, setServices] = useState<Array<Service>>([]);
  const [attributeKeys, setAttributeKeys] = useState<Array<string>>([]);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchLogAttributes: PromiseVoidFunction = async (): Promise<void> => {
    const attributeRepsonse: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          "/telemetry/logs/get-attributes",
        ),
        data: {},
        headers: {
          ...ModelAPI.getCommonHeaders(),
        },
      });

    if (attributeRepsonse instanceof HTTPErrorResponse) {
      throw attributeRepsonse;
    } else {
      const attributes: Array<string> = attributeRepsonse.data[
        "attributes"
      ] as Array<string>;
      setAttributeKeys(attributes);
    }
  };

  const fetchSpanAttributes: PromiseVoidFunction = async (): Promise<void> => {
    const attributeRepsonse: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          "/telemetry/traces/get-attributes",
        ),
        data: {},
        headers: {
          ...ModelAPI.getCommonHeaders(),
        },
      });

    if (attributeRepsonse instanceof HTTPErrorResponse) {
      throw attributeRepsonse;
    } else {
      const attributes: Array<string> = attributeRepsonse.data[
        "attributes"
      ] as Array<string>;
      setAttributeKeys(attributes);
    }
  };

  const fetchServices: PromiseVoidFunction = async (): Promise<void> => {
    const telemetryServicesResult: ListResult<Service> =
      await ModelAPI.getList<Service>({
        modelType: Service,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          name: true,
        },
        sort: {
          name: SortOrder.Ascending,
        },
      });

    if (telemetryServicesResult instanceof HTTPErrorResponse) {
      throw telemetryServicesResult;
    }

    setServices(telemetryServicesResult.data);
  };

  const fetchServicesAndAttributes: PromiseVoidFunction =
    async (): Promise<void> => {
      setIsLoading(true);
      setError("");
      try {
        await fetchServices();

        if (props.monitorType === MonitorType.Logs) {
          await fetchLogAttributes();
        }

        if (props.monitorType === MonitorType.Traces) {
          await fetchSpanAttributes();
        }

        // For metrics monitor we don't need attributes because the metric view component fetches it for us. So we don't need to fetch it here.
      } catch (err) {
        setError(API.getFriendlyErrorMessage(err as Error));
      }

      setIsLoading(false);
    };

  useEffect(() => {
    fetchServicesAndAttributes().catch((err: Error) => {
      setError(API.getFriendlyErrorMessage(err as Error));
    });
  }, [props.monitorType]);

  const [errors, setErrors] = useState<Dictionary<string>>({});
  const [touched, setTouched] = useState<Dictionary<boolean>>({});

  const [destinationFieldTitle, setDestinationFieldTitle] =
    useState<string>("URL");
  const [destinationFieldDescription, setDestinationFieldDescription] =
    useState<string>("");

  const requestTypeDropdownOptions: Array<DropdownOption> =
    DropdownUtil.getDropdownOptionsFromEnum(HTTPMethod);

  const [destinationInputValue, setDestinationInputValue] = useState<string>(
    props.value?.data?.monitorDestination?.toString() || "",
  );

  let codeEditorPlaceholder: string = "";

  if (props.monitorType === MonitorType.CustomJavaScriptCode) {
    codeEditorPlaceholder = `
// You can use axios, http modules here.
await axios.get('https://example.com');

// when you want to return a value, use return statement with data as a prop.

return {
    data: 'Hello World'
};
        `;
  }

  if (props.monitorType === MonitorType.SyntheticMonitor) {
    codeEditorPlaceholder = `
// Objects available in the context of the script are:

// - axios: Axios module to make HTTP requests
// - page: Playwright Page object to interact with the browser
// - browserType: Browser type in the current run context - Chromium, Firefox, Webkit
// - screenSizeType: Screen size type in the current run context - Mobile, Tablet, Desktop
// - browser: Playwright Browser object to interact with the browser

await page.goto('https://playwright.dev/');

// Playwright Documentation here: https://playwright.dev/docs/intro

// To take screenshots,

const screenshots = {};

screenshots['screenshot-name'] = await page.screenshot(); // you can save multiple screenshots and have them with different names.


// To log data, use console.log
console.log('Hello World');

// when you want to return a value, use return statement with data as a prop. You can also add screenshots in the screenshots array.

return {
    data: 'Hello World',
    screenshots: screenshots // obj containing screenshots
};
        `;
  }

  useEffect(() => {
    if (props.monitorType === MonitorType.API) {
      setDestinationFieldTitle("API URL");
      setDestinationFieldDescription(
        "Whats the URL of the API you want to monitor?",
      );
    } else if (props.monitorType === MonitorType.Website) {
      setDestinationFieldTitle("Website URL");
      setDestinationFieldDescription(
        "Whats the URL of the website you want to monitor?",
      );
    } else if (props.monitorType === MonitorType.Ping) {
      setDestinationFieldTitle("Ping Hostname or IP address");
      setDestinationFieldDescription(
        "Whats the Hostname or IP address of the resource you want to ping?",
      );
    } else if (props.monitorType === MonitorType.IP) {
      setDestinationFieldTitle("IP Address");
      setDestinationFieldDescription(
        "Whats the IP address you want to monitor?",
      );
    } else if (props.monitorType === MonitorType.Port) {
      setDestinationFieldTitle("Hostname or IP address");
      setDestinationFieldDescription(
        "Whats the Hostname or IP address of the resource you want to ping?",
      );
    }
  }, [props.monitorType]);

  const hasMonitorDestination: boolean =
    props.monitorType === MonitorType.IP ||
    props.monitorType === MonitorType.Ping ||
    props.monitorType === MonitorType.Port ||
    props.monitorType === MonitorType.Website ||
    props.monitorType === MonitorType.API ||
    props.monitorType === MonitorType.SSLCertificate;

  const isCodeMonitor: boolean =
    props.monitorType === MonitorType.CustomJavaScriptCode ||
    props.monitorType === MonitorType.SyntheticMonitor;

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  const monitorStep: MonitorStep = props.value || new MonitorStep();

  // Check if there are any advanced options configured
  const hasAdvancedOptionsConfigured: boolean =
    Boolean(
      monitorStep.data?.requestHeaders &&
        Object.keys(monitorStep.data.requestHeaders).length > 0,
    ) ||
    Boolean(monitorStep.data?.requestBody) ||
    Boolean(monitorStep.data?.doNotFollowRedirects);

  return (
    <div className="mt-5 space-y-6">
      {/* Monitor Target Card */}
      {hasMonitorDestination && (
        <Card
          title="Monitor Target"
          description="Configure what you want to monitor"
        >
          <div className="space-y-4">
            <div>
              <FieldLabelElement
                title={destinationFieldTitle}
                description={destinationFieldDescription}
                required={true}
              />
              <Input
                initialValue={destinationInputValue}
                disableSpellCheck={true}
                onBlur={() => {
                  setTouched({
                    ...touched,
                    destination: true,
                  });

                  if (!monitorStep?.data?.monitorDestination?.toString()) {
                    setErrors({
                      ...errors,
                      destination: "Destination is required",
                    });
                  } else {
                    setErrors({
                      ...errors,
                      destination: "",
                    });
                    setDestinationInputValue(
                      monitorStep?.data?.monitorDestination?.toString(),
                    );
                  }
                }}
                error={
                  touched["destination"] && errors["destination"]
                    ? errors["destination"]
                    : undefined
                }
                onChange={(value: string) => {
                  let destination: IP | URL | Hostname | undefined = undefined;

                  try {
                    if (props.monitorType === MonitorType.IP) {
                      destination = IP.fromString(value);
                    } else if (props.monitorType === MonitorType.Ping) {
                      if (IP.isIP(value)) {
                        destination = IP.fromString(value);
                      } else {
                        destination = Hostname.fromString(value);
                      }
                    } else if (props.monitorType === MonitorType.Port) {
                      if (IP.isIP(value)) {
                        destination = IP.fromString(value);
                      } else {
                        destination = Hostname.fromString(value);
                      }
                    } else if (props.monitorType === MonitorType.Website) {
                      destination = URL.fromString(value);
                    } else if (props.monitorType === MonitorType.API) {
                      destination = URL.fromString(value);
                    } else if (
                      props.monitorType === MonitorType.SSLCertificate
                    ) {
                      destination = URL.fromString(value);
                    }

                    setErrors({
                      ...errors,
                      destination: "",
                    });
                  } catch (err) {
                    if (err instanceof Exception) {
                      setErrors({
                        ...errors,
                        destination: err.message,
                      });
                    } else {
                      setErrors({
                        ...errors,
                        destination: "Invalid Destination",
                      });
                    }
                  }

                  if (destination) {
                    monitorStep.setMonitorDestination(destination);
                  }

                  setDestinationInputValue(value);
                  if (props.onChange) {
                    props.onChange(MonitorStep.clone(monitorStep));
                  }
                }}
              />
            </div>

            {(props.monitorType === MonitorType.API ||
              props.monitorType === MonitorType.Website) && (
              <TinyFormDocumentation title="URL placeholder help">
                <>
                  <div>
                    <code className="bg-gray-100 px-1 rounded">
                      {"{{timestamp}}"}
                    </code>{" "}
                    — replaced with current Unix timestamp
                  </div>
                  <div>
                    <code className="bg-gray-100 px-1 rounded">
                      {"{{random}}"}
                    </code>{" "}
                    — replaced with a random unique string
                  </div>
                  <div>
                    Example:{" "}
                    <code className="bg-gray-100 px-1 rounded">
                      {"https://example.com?cb={{timestamp}}"}
                    </code>
                  </div>
                  <div>
                    Useful for busting CDN or proxy caches on each check.{" "}
                    <Link
                      className="underline"
                      openInNewTab={true}
                      to={URL.fromString(
                        DOCS_URL.toString() +
                          (props.monitorType === MonitorType.API
                            ? "/monitor/api-monitor"
                            : "/monitor/website-monitor"),
                      )}
                    >
                      Learn more.
                    </Link>
                  </div>
                </>
              </TinyFormDocumentation>
            )}

            {props.monitorType === MonitorType.Port && (
              <div>
                <FieldLabelElement
                  title={"Port"}
                  description={"Whats the port you want to monitor?"}
                  required={true}
                />
                <Input
                  initialValue={monitorStep?.data?.monitorDestinationPort?.toString()}
                  onChange={(value: string) => {
                    const port: Port = new Port(value);
                    monitorStep.setPort(port);
                    if (props.onChange) {
                      props.onChange(MonitorStep.clone(monitorStep));
                    }
                  }}
                />
              </div>
            )}

            {props.monitorType === MonitorType.API && (
              <div>
                <FieldLabelElement
                  title={"API Request Type"}
                  description={"What is the type of the API request?"}
                  required={true}
                />
                <Dropdown
                  initialValue={requestTypeDropdownOptions.find(
                    (i: DropdownOption) => {
                      return (
                        i.value ===
                        (monitorStep?.data?.requestType || HTTPMethod.GET)
                      );
                    },
                  )}
                  options={requestTypeDropdownOptions}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    monitorStep.setRequestType(
                      (value?.toString() as HTTPMethod) || HTTPMethod.GET,
                    );
                    if (props.onChange) {
                      props.onChange(MonitorStep.clone(monitorStep));
                    }
                  }}
                />
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Advanced Options - Collapsible Section for API monitors */}
      {props.monitorType === MonitorType.API && (
        <CollapsibleSection
          title="Advanced Options"
          description="Request headers, body, and redirect settings"
          badge={hasAdvancedOptionsConfigured ? "Configured" : undefined}
          variant="card"
          defaultCollapsed={
            !hasAdvancedOptionsConfigured &&
            !showAdvancedOptionsRequestBodyAndHeaders
          }
          onToggle={(isCollapsed: boolean) => {
            if (!isCollapsed) {
              setShowAdvancedOptionsRequestBodyAndHeaders(true);
            }
          }}
        >
          <div className="space-y-4">
            <div>
              <FieldLabelElement
                title={"Request Headers"}
                description={
                  <p>
                    Request Headers to send.{" "}
                    <Link
                      className="underline"
                      openInNewTab={true}
                      to={URL.fromString(
                        DOCS_URL.toString() + "/monitor/monitor-secrets",
                      )}
                    >
                      You can use secrets here.
                    </Link>
                  </p>
                }
                required={false}
              />
              <DictionaryOfStrings
                addButtonSuffix="Request Header"
                keyPlaceholder={"Header Name"}
                valuePlaceholder={"Header Value"}
                initialValue={monitorStep.data?.requestHeaders || {}}
                onChange={(value: Dictionary<string>) => {
                  monitorStep.setRequestHeaders(value);
                  if (props.onChange) {
                    props.onChange(MonitorStep.clone(monitorStep));
                  }
                }}
              />
            </div>

            <div>
              <FieldLabelElement
                title={"Request Body (in JSON)"}
                description={
                  <p>
                    Request Headers to send in JSON.{" "}
                    <Link
                      className="underline"
                      openInNewTab={true}
                      to={URL.fromString(
                        DOCS_URL.toString() + "/monitor/monitor-secrets",
                      )}
                    >
                      You can use secrets here.
                    </Link>
                  </p>
                }
                required={false}
              />
              <CodeEditor
                type={CodeType.JSON}
                onBlur={() => {
                  setTouched({
                    ...touched,
                    requestBody: true,
                  });
                }}
                error={
                  touched["requestBody"] && errors["requestBody"]
                    ? errors["requestBody"]
                    : undefined
                }
                initialValue={monitorStep.data?.requestBody}
                onChange={(value: string) => {
                  try {
                    JSON.parse(value);
                    setErrors({
                      ...errors,
                      requestBody: "",
                    });
                  } catch {
                    setErrors({
                      ...errors,
                      requestBody: "Invalid JSON",
                    });
                  }

                  monitorStep.setRequestBody(value);
                  if (props.onChange) {
                    props.onChange(MonitorStep.clone(monitorStep));
                  }
                }}
              />
            </div>

            <div>
              <CheckboxElement
                initialValue={monitorStep.data?.doNotFollowRedirects || false}
                title={"Do not follow redirects"}
                description="Please check this if you do not want to follow redirects."
                onChange={(value: boolean) => {
                  monitorStep.setDoNotFollowRedirects(value);
                  if (props.onChange) {
                    props.onChange(MonitorStep.clone(monitorStep));
                  }
                }}
              />
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* Advanced Options - Collapsible Section for Website monitors */}
      {props.monitorType === MonitorType.Website && (
        <CollapsibleSection
          title="Advanced Options"
          description="Redirect settings"
          badge={
            monitorStep.data?.doNotFollowRedirects ? "Configured" : undefined
          }
          variant="card"
          defaultCollapsed={
            !monitorStep.data?.doNotFollowRedirects && !showDoNotFollowRedirects
          }
          onToggle={(isCollapsed: boolean) => {
            if (!isCollapsed) {
              setShowDoNotFollowRedirects(true);
            }
          }}
        >
          <div>
            <CheckboxElement
              initialValue={monitorStep.data?.doNotFollowRedirects || false}
              title={"Do not follow redirects"}
              description="Please check this if you do not want to follow redirects."
              onChange={(value: boolean) => {
                monitorStep.setDoNotFollowRedirects(value);
                if (props.onChange) {
                  props.onChange(MonitorStep.clone(monitorStep));
                }
              }}
            />
          </div>
        </CollapsibleSection>
      )}

      {/* Telemetry Monitor Forms */}
      {props.monitorType === MonitorType.Logs && (
        <Card
          title="Log Monitor Configuration"
          description="Configure the log monitoring settings"
        >
          <LogMonitorStepForm
            monitorStepLogMonitor={
              monitorStep.data?.logMonitor ||
              MonitorStepLogMonitorUtil.getDefault()
            }
            onMonitorStepLogMonitorChanged={(value: MonitorStepLogMonitor) => {
              monitorStep.setLogMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
            attributeKeys={attributeKeys}
            telemetryServices={telemetryServices}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.Metrics && (
        <Card
          title="Metric Monitor Configuration"
          description="Configure the metric monitoring settings"
        >
          <MetricMonitorStepForm
            monitorStepMetricMonitor={
              monitorStep.data?.metricMonitor ||
              MonitorStepMetricMonitorUtil.getDefault()
            }
            onChange={(value: MonitorStepMetricMonitor) => {
              monitorStep.setMetricMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.Traces && (
        <Card
          title="Trace Monitor Configuration"
          description="Configure the trace monitoring settings"
        >
          <TraceMonitorStepForm
            monitorStepTraceMonitor={
              monitorStep.data?.traceMonitor ||
              MonitorStepTraceMonitorUtil.getDefault()
            }
            onMonitorStepTraceMonitorChanged={(
              value: MonitorStepTraceMonitor,
            ) => {
              monitorStep.setTraceMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
            attributeKeys={attributeKeys}
            telemetryServices={telemetryServices}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.Exceptions && (
        <Card
          title="Exception Monitor Configuration"
          description="Configure the exception monitoring settings"
        >
          <ExceptionMonitorStepForm
            monitorStepExceptionMonitor={
              monitorStep.data?.exceptionMonitor ||
              MonitorStepExceptionMonitorUtil.getDefault()
            }
            telemetryServices={telemetryServices}
            onMonitorStepExceptionMonitorChanged={(
              value: MonitorStepExceptionMonitor,
            ) => {
              monitorStep.setExceptionMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.SNMP && (
        <Card
          title="SNMP Monitor Configuration"
          description="Configure the SNMP monitoring settings"
        >
          <SnmpMonitorStepForm
            monitorStepSnmpMonitor={
              monitorStep.data?.snmpMonitor ||
              MonitorStepSnmpMonitorUtil.getDefault()
            }
            onChange={(value: MonitorStepSnmpMonitor) => {
              monitorStep.setSnmpMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.DNS && (
        <Card
          title="DNS Monitor Configuration"
          description="Configure the DNS monitoring settings"
        >
          <DnsMonitorStepForm
            monitorStepDnsMonitor={
              monitorStep.data?.dnsMonitor ||
              MonitorStepDnsMonitorUtil.getDefault()
            }
            onChange={(value: MonitorStepDnsMonitor) => {
              monitorStep.setDnsMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
          />
        </Card>
      )}

      {props.monitorType === MonitorType.Domain && (
        <Card
          title="Domain Monitor Configuration"
          description="Configure the domain registration monitoring settings"
        >
          <DomainMonitorStepForm
            monitorStepDomainMonitor={
              monitorStep.data?.domainMonitor ||
              MonitorStepDomainMonitorUtil.getDefault()
            }
            onChange={(value: MonitorStepDomainMonitor) => {
              monitorStep.setDomainMonitor(value);
              props.onChange?.(MonitorStep.clone(monitorStep));
            }}
          />
        </Card>
      )}

      {/* Code Monitor Section */}
      {isCodeMonitor && (
        <Card
          title={
            props.monitorType === MonitorType.CustomJavaScriptCode
              ? "JavaScript Code"
              : "Playwright Code"
          }
          description={
            props.monitorType === MonitorType.CustomJavaScriptCode
              ? "Write your JavaScript code here. You can use secrets for sensitive data."
              : "Write your Playwright code here. Playwright is a Node.js library to automate browsers."
          }
        >
          <div className="space-y-4">
            <div>
              <CodeEditor
                initialValue={monitorStep?.data?.customCode?.toString()}
                type={CodeType.JavaScript}
                onChange={(value: string) => {
                  monitorStep.setCustomCode(value);
                  if (props.onChange) {
                    props.onChange(MonitorStep.clone(monitorStep));
                  }
                }}
                placeholder={codeEditorPlaceholder}
              />
              <p className="mt-2 text-sm text-gray-500">
                <Link
                  className="underline"
                  openInNewTab={true}
                  to={URL.fromString(
                    DOCS_URL.toString() + "/monitor/monitor-secrets",
                  )}
                >
                  You can use secrets here.
                </Link>
              </p>
            </div>

            {props.monitorType === MonitorType.SyntheticMonitor && (
              <>
                <div>
                  <FieldLabelElement
                    title={"Browser Type"}
                    description={"Select the browser type."}
                    required={true}
                  />
                  <CheckBoxList
                    options={enumToCategoryCheckboxOption(BrowserType)}
                    initialValue={props.value?.data?.browserTypes || []}
                    onChange={(values: Array<CategoryCheckboxValue>) => {
                      monitorStep.setBrowserTypes(values as Array<BrowserType>);
                      if (props.onChange) {
                        props.onChange(MonitorStep.clone(monitorStep));
                      }
                    }}
                  />
                </div>

                <div>
                  <FieldLabelElement
                    title={"Screen Type"}
                    description={
                      "Which screen type should we use to run this test?"
                    }
                    required={true}
                  />
                  <CheckBoxList
                    options={enumToCategoryCheckboxOption(ScreenSizeType)}
                    initialValue={props.value?.data?.screenSizeTypes || []}
                    onChange={(values: Array<CategoryCheckboxValue>) => {
                      monitorStep.setScreenSizeTypes(
                        values as Array<ScreenSizeType>,
                      );
                      if (props.onChange) {
                        props.onChange(MonitorStep.clone(monitorStep));
                      }
                    }}
                  />
                </div>
              </>
            )}
          </div>
        </Card>
      )}

      {/* Synthetic Monitor Advanced Options */}
      {props.monitorType === MonitorType.SyntheticMonitor && (
        <CollapsibleSection
          title="Advanced Options"
          description="Retry settings and more"
          variant="card"
          defaultCollapsed={!showSyntheticMonitorAdvancedOptions}
          onToggle={(isCollapsed: boolean) => {
            if (!isCollapsed) {
              setShowSyntheticMonitorAdvancedOptions(true);
            }
          }}
        >
          <div>
            <FieldLabelElement
              title={"Retry Count on Error"}
              description={
                "How many times should we retry the synthetic monitor if it fails? Set to 0 for no retries. Max is 5."
              }
              required={false}
            />
            <Input
              initialValue={
                props.value?.data?.retryCountOnError?.toString() || "0"
              }
              onChange={(value: string) => {
                const retryCountOnError: number = parseInt(value) || 0;
                monitorStep.setRetryCountOnError(
                  retryCountOnError < 0
                    ? 0
                    : retryCountOnError > 5
                      ? 5
                      : retryCountOnError,
                );
                if (props.onChange) {
                  props.onChange(MonitorStep.clone(monitorStep));
                }
              }}
              placeholder="0"
              type={InputType.NUMBER}
            />
          </div>
        </CollapsibleSection>
      )}

      {/* Test Monitor Card - not shown for Incoming Request monitors */}
      {props.monitorType !== MonitorType.IncomingRequest && (
        <Card
          title="Test Monitor"
          description="Verify your monitor configuration before saving"
          className="bg-blue-50 border-blue-200"
        >
          <MonitorTestForm
            monitorId={props.monitorId}
            monitorSteps={props.allMonitorSteps}
            monitorType={props.monitorType}
            probes={props.probes}
            buttonSize={ButtonSize.Normal}
          />
        </Card>
      )}

      {/* Monitor Criteria Section */}
      <Card
        title="Monitor Criteria"
        description="Add Monitoring Criteria for this monitor. Monitor different properties."
      >
        <MonitorCriteriaElement
          monitorType={props.monitorType}
          monitorStep={monitorStep}
          monitorStatusDropdownOptions={props.monitorStatusDropdownOptions}
          incidentSeverityDropdownOptions={
            props.incidentSeverityDropdownOptions
          }
          alertSeverityDropdownOptions={props.alertSeverityDropdownOptions}
          onCallPolicyDropdownOptions={props.onCallPolicyDropdownOptions}
          labelDropdownOptions={props.labelDropdownOptions}
          teamDropdownOptions={props.teamDropdownOptions}
          userDropdownOptions={props.userDropdownOptions}
          incidentRoleOptions={props.incidentRoleOptions}
          value={monitorStep?.data?.monitorCriteria}
          onChange={(value: MonitorCriteria) => {
            monitorStep.setMonitorCriteria(value);
            props.onChange?.(MonitorStep.clone(monitorStep));
          }}
        />
      </Card>
    </div>
  );
};

export default MonitorStepElement;
