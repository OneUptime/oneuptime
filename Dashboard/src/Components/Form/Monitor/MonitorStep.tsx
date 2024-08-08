import MonitorCriteriaElement from "./MonitorCriteria";
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
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
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
import HorizontalRule from "Common/UI/Components/HorizontalRule/HorizontalRule";
import Input from "Common/UI/Components/Input/Input";
import Link from "Common/UI/Components/Link/Link";
import { APP_API_URL, DOCS_URL } from "Common/UI/Config";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import LogMonitorStepForm from "./LogMonitor/LogMonitorStepFrom";
import TraceMonitorStepForm from "./TraceMonitor/TraceMonitorStepForm";
import TelemetryService from "Common/Models/DatabaseModels/TelemetryService";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import DashboardNavigation from "../../../Utils/Navigation";
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

export interface ComponentProps {
  monitorStatusDropdownOptions: Array<DropdownOption>;
  incidentSeverityDropdownOptions: Array<DropdownOption>;
  onCallPolicyDropdownOptions: Array<DropdownOption>;
  initialValue?: undefined | MonitorStep;
  onChange?: undefined | ((value: MonitorStep) => void);
  // onDelete?: undefined | (() => void);
  monitorType: MonitorType;
}

const MonitorStepElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [
    showAdvancedOptionsRequestBodyAndHeaders,
    setShowAdvancedOptionsRequestBodyAndHeaders,
  ] = useState<boolean>(false);

  const [monitorStep, setMonitorStep] = useState<MonitorStep>(
    props.initialValue || new MonitorStep(),
  );

  const [telemetryServices, setTelemetryServices] = useState<
    Array<TelemetryService>
  >([]);
  const [attributeKeys, setAttributeKeys] = useState<Array<string>>([]);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    if (props.onChange && monitorStep) {
      props.onChange(monitorStep);
    }
  }, [monitorStep]);

  const fetchLogAttributes: PromiseVoidFunction = async (): Promise<void> => {
    const attributeRepsonse: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post(
        URL.fromString(APP_API_URL.toString()).addRoute(
          "/telemetry/logs/get-attributes",
        ),
        {},
        {
          ...ModelAPI.getCommonHeaders(),
        },
      );

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
      await API.post(
        URL.fromString(APP_API_URL.toString()).addRoute(
          "/telemetry/traces/get-attributes",
        ),
        {},
        {
          ...ModelAPI.getCommonHeaders(),
        },
      );

    if (attributeRepsonse instanceof HTTPErrorResponse) {
      throw attributeRepsonse;
    } else {
      const attributes: Array<string> = attributeRepsonse.data[
        "attributes"
      ] as Array<string>;
      setAttributeKeys(attributes);
    }
  };

  const fetchTelemetryServices: PromiseVoidFunction =
    async (): Promise<void> => {
      const telemetryServicesResult: ListResult<TelemetryService> =
        await ModelAPI.getList<TelemetryService>({
          modelType: TelemetryService,
          query: {
            projectId: DashboardNavigation.getProjectId(),
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

      setTelemetryServices(telemetryServicesResult.data);
    };

  const fetchTelemetryServicesAndAttributes: PromiseVoidFunction =
    async (): Promise<void> => {
      setIsLoading(true);
      setError("");
      try {
        await fetchTelemetryServices();

        if (props.monitorType === MonitorType.Logs) {
          await fetchLogAttributes();
        }

        if (props.monitorType === MonitorType.Traces) {
          await fetchSpanAttributes();
        }
      } catch (err) {
        setError(API.getFriendlyErrorMessage(err as Error));
      }

      setIsLoading(false);
    };

  useEffect(() => {
    fetchTelemetryServicesAndAttributes().catch((err: Error) => {
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
    props.initialValue?.data?.monitorDestination?.toString() || "",
  );

  let codeEditorPlaceholder: string = "";

  if (props.monitorType === MonitorType.CustomJavaScriptCode) {
    codeEditorPlaceholder = `
        // You can use axios, http modules here.
        await axios.get('https://example.com'); 

        // when you want to return a value, use return statement with data as a prop.

        return {
            data: 'Hello World' 
        };`;
  }

  if (props.monitorType === MonitorType.SyntheticMonitor) {
    codeEditorPlaceholder = `
        // You can use axios module, and page object from Playwright here.
        // Page Object is a class that represents a single page in a browser.

        await page.goto('https://playwright.dev/');
        
        // Playwright Documentation here: https://playwright.dev/docs/intro
    
        // To take screenshots,

        const screenshots = {};

        screenshots['screenshot-name'] = await page.screenshot(); // you can save multiple screenshots and have them with different names.


        // when you want to return a value, use return statement with data as a prop. You can also add screenshots in the screenshots array.

        return {
            data: 'Hello World',
            screenshots: screenshots // obj containing screenshots
        };`;
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
    return <ErrorMessage error={error} />;
  }

  return (
    <div className="mt-5">
      {hasMonitorDestination && (
        <div>
          <div className="mt-5">
            <FieldLabelElement
              title={destinationFieldTitle}
              description={destinationFieldDescription}
              required={true}
            />
            <Input
              initialValue={destinationInputValue}
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
                  } else if (props.monitorType === MonitorType.SSLCertificate) {
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
                setMonitorStep(MonitorStep.clone(monitorStep));
              }}
            />
          </div>
          {props.monitorType === MonitorType.Port && (
            <div className="mt-5">
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
                  setMonitorStep(MonitorStep.clone(monitorStep));
                }}
              />
            </div>
          )}

          {props.monitorType === MonitorType.API && (
            <div className="mt-5">
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
                  setMonitorStep(MonitorStep.clone(monitorStep));
                }}
              />
            </div>
          )}

          {!showAdvancedOptionsRequestBodyAndHeaders &&
            props.monitorType === MonitorType.API && (
              <div className="mt-1 -ml-3">
                <Button
                  title="Advanced: Add Request Headers and Body"
                  buttonStyle={ButtonStyleType.SECONDARY_LINK}
                  onClick={() => {
                    setShowAdvancedOptionsRequestBodyAndHeaders(true);
                  }}
                />
              </div>
            )}
          {showAdvancedOptionsRequestBodyAndHeaders &&
            props.monitorType === MonitorType.API && (
              <div className="mt-5">
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
                    setMonitorStep(MonitorStep.clone(monitorStep));
                  }}
                />
              </div>
            )}

          {showAdvancedOptionsRequestBodyAndHeaders &&
            props.monitorType === MonitorType.API && (
              <div className="mt-5">
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
                    } catch (err) {
                      setErrors({
                        ...errors,
                        requestBody: "Invalid JSON",
                      });
                    }

                    monitorStep.setRequestBody(value);
                    setMonitorStep(MonitorStep.clone(monitorStep));
                  }}
                />
              </div>
            )}

          <HorizontalRule />
        </div>
      )}

      {props.monitorType === MonitorType.Logs && (
        <div className="mt-5">
          <LogMonitorStepForm
            monitorStepLogMonitor={
              monitorStep.data?.logMonitor ||
              MonitorStepLogMonitorUtil.getDefault()
            }
            onMonitorStepLogMonitorChanged={(value: MonitorStepLogMonitor) => {
              monitorStep.setLogMonitor(value);
              setMonitorStep(MonitorStep.clone(monitorStep));
            }}
            attributeKeys={attributeKeys}
            telemetryServices={telemetryServices}
          />
        </div>
      )}

      {props.monitorType === MonitorType.Traces && (
        <div className="mt-5">
          <TraceMonitorStepForm
            monitorStepTraceMonitor={
              monitorStep.data?.traceMonitor ||
              MonitorStepTraceMonitorUtil.getDefault()
            }
            onMonitorStepTraceMonitorChanged={(
              value: MonitorStepTraceMonitor,
            ) => {
              monitorStep.setTraceMonitor(value);
              setMonitorStep(MonitorStep.clone(monitorStep));
            }}
            attributeKeys={attributeKeys}
            telemetryServices={telemetryServices}
          />
        </div>
      )}

      {isCodeMonitor && (
        <div className="mt-5">
          <FieldLabelElement
            title={
              props.monitorType === MonitorType.CustomJavaScriptCode
                ? "JavaScript Code"
                : "Playwright Code"
            }
            description={
              props.monitorType === MonitorType.CustomJavaScriptCode ? (
                <p>
                  Write your JavaScript code here.{" "}
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
              ) : (
                <p>
                  Write your Playwright code here. Playwright is a Node.js
                  library to automate Chromium, Firefox and WebKit with a single
                  API.{" "}
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
              )
            }
            required={true}
          />
          <div className="mt-1">
            <CodeEditor
              initialValue={monitorStep?.data?.customCode?.toString()}
              type={CodeType.JavaScript}
              onChange={(value: string) => {
                monitorStep.setCustomCode(value);
                setMonitorStep(MonitorStep.clone(monitorStep));
              }}
              placeholder={codeEditorPlaceholder}
            />
          </div>
        </div>
      )}

      {props.monitorType === MonitorType.SyntheticMonitor && (
        <div className="mt-5">
          <FieldLabelElement
            title={"Browser Type"}
            description={"Select the browser type."}
            required={true}
          />
          <div className="mt-1">
            <CheckBoxList
              options={enumToCategoryCheckboxOption(BrowserType)}
              initialValue={props.initialValue?.data?.browserTypes || []}
              onChange={(values: Array<CategoryCheckboxValue>) => {
                monitorStep.setBrowserTypes(values as Array<BrowserType>);
                setMonitorStep(MonitorStep.clone(monitorStep));
              }}
            />
          </div>
        </div>
      )}

      {props.monitorType === MonitorType.SyntheticMonitor && (
        <div className="mt-5">
          <FieldLabelElement
            title={"Screen Type"}
            description={"Which screen type should we use to run this test?"}
            required={true}
          />
          <div className="mt-1">
            <CheckBoxList
              options={enumToCategoryCheckboxOption(ScreenSizeType)}
              initialValue={props.initialValue?.data?.screenSizeTypes || []}
              onChange={(values: Array<CategoryCheckboxValue>) => {
                monitorStep.setScreenSizeTypes(values as Array<ScreenSizeType>);
                setMonitorStep(MonitorStep.clone(monitorStep));
              }}
            />
          </div>
        </div>
      )}

      <div className="mt-5">
        {props.monitorType !== MonitorType.IncomingRequest && (
          <>
            <HorizontalRule />
            <FieldLabelElement
              title="Monitor Criteria"
              isHeading={true}
              description={
                "Add Monitoring Criteria for this monitor. Monitor different properties."
              }
              required={true}
            />
          </>
        )}
        <MonitorCriteriaElement
          monitorType={props.monitorType}
          monitorStatusDropdownOptions={props.monitorStatusDropdownOptions}
          incidentSeverityDropdownOptions={
            props.incidentSeverityDropdownOptions
          }
          onCallPolicyDropdownOptions={props.onCallPolicyDropdownOptions}
          initialValue={monitorStep?.data?.monitorCriteria}
          onChange={(value: MonitorCriteria) => {
            monitorStep.setMonitorCriteria(value);
            setMonitorStep(MonitorStep.clone(monitorStep));
          }}
        />
      </div>

      {/* <div className='mt-5 -ml-3'>
                <Button
                    onClick={() => {
                        if (props.onDelete) {
                            props.onDelete();
                        }
                    }}
                    buttonStyle={ButtonStyleType.DANGER_OUTLINE}
                    buttonSize={ButtonSize.Small}
                    title="Delete Monitor Step"
                />
            </div> */}
    </div>
  );
};

export default MonitorStepElement;
