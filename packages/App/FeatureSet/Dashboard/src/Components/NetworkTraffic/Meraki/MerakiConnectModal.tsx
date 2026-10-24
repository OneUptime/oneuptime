import { runNetworkControllerTest } from "../NetworkTrafficUsageApi";
import MerakiTestResultPanel from "./MerakiTestResultPanel";
import {
  MerakiTemplate,
  drawMerakiTemplate,
  getMerakiIntervalOptions,
  getMerakiIntervalWords,
  getMerakiRegionOptions,
} from "./MerakiWords";
import NetworkControllerConnection from "Common/Models/DatabaseModels/NetworkControllerConnection";
import {
  DEFAULT_MERAKI_REGION,
  MerakiRegion,
  MerakiRegionDefinition,
  getMerakiRegionOrDefault,
} from "Common/Types/NetworkController/MerakiRegion";
import {
  DEFAULT_NETWORK_CONTROLLER_READ_INTERVAL_IN_MINUTES,
  MAX_ORGANIZATION_NAME_LENGTH,
} from "Common/Types/NetworkController/NetworkControllerConnectionSettings";
import {
  NetworkControllerOrganization,
  NetworkControllerTestResult,
} from "Common/Types/NetworkController/NetworkControllerConnectionTest";
import NetworkControllerProvider from "Common/Types/NetworkController/NetworkControllerProvider";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import Icon from "Common/UI/Components/Icon/Icon";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import { getSteppedModalFooter } from "Common/UI/Components/Forms/Utils/SteppedFormFooter";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * Connect a Meraki organization, in two steps:
 *
 *   1. API key  the key of a read-only administrator, made in the Meraki
 *               dashboard; the dashboard's region folded under More fields
 *               (most organizations are on the global one);
 *   2. Organization  the key is tested as the step opens: the
 *               organizations it reads (picked for you when it reads one),
 *               and for the one picked what a read will cover - networks
 *               and appliances. The name and how often to read are folded
 *               under More fields. Connect is offered here, and only once
 *               the test passed.
 *
 * A key Meraki refuses offers Change API key: back to the first step, the
 * key selected to paste over (there is no Back button on a stepped form;
 * the step list goes back too).
 *
 * The key is write-only: it goes to the server with the test and the
 * create, is stored encrypted and is never shown again.
 */

export interface ComponentProps {
  onClose: () => void;
  onConnected: (connection: { name: string }) => void;
}

const STEP_TITLES: Array<string> = ["API key", "Organization"];

const NAME_MAX_LENGTH: number = 50;

const MerakiConnectModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [step, setStep] = useState<1 | 2>(1);
  const [apiKey, setApiKey] = useState<string>("");
  const [region, setRegion] = useState<MerakiRegion>(DEFAULT_MERAKI_REGION);
  const [keyError, setKeyError] = useState<string>("");
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [listResult, setListResult] =
    useState<NetworkControllerTestResult | null>(null);
  const [organizationId, setOrganizationId] = useState<string>("");
  const [countResult, setCountResult] =
    useState<NetworkControllerTestResult | null>(null);
  const [name, setName] = useState<string>("");
  const [isNameEdited, setIsNameEdited] = useState<boolean>(false);
  const [interval, setReadInterval] = useState<number>(
    DEFAULT_NETWORK_CONTROLLER_READ_INTERVAL_IN_MINUTES,
  );
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");
  // Only the newest test lands: a re-pick can overlap the one before.
  const latestTest: React.MutableRefObject<number> = useRef<number>(0);
  // Back on the key step to change the key: it is selected, to paste over.
  const selectKeyOnOpen: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const regionDefinition: MerakiRegionDefinition =
    getMerakiRegionOrDefault(region);

  const organizations: Array<NetworkControllerOrganization> =
    listResult?.organizations || [];
  const picked: NetworkControllerOrganization | undefined = organizations.find(
    (organization: NetworkControllerOrganization): boolean => {
      return organization.id === organizationId;
    },
  );

  const test: (data: {
    organizationId: string;
  }) => Promise<NetworkControllerTestResult> = async (data: {
    organizationId: string;
  }): Promise<NetworkControllerTestResult> => {
    const config: JSONObject = { region };

    if (data.organizationId) {
      config["organizationId"] = data.organizationId;
    }

    return await runNetworkControllerTest({
      provider: NetworkControllerProvider.Meraki,
      config,
      secrets: { apiKey: apiKey.trim() },
    });
  };

  // The organization's counts, once one is picked.
  const countOrganization: (id: string) => Promise<void> = async (
    id: string,
  ): Promise<void> => {
    latestTest.current += 1;
    const testId: number = latestTest.current;

    setCountResult(null);
    setIsTesting(true);

    const result: NetworkControllerTestResult = await test({
      organizationId: id,
    });

    if (testId !== latestTest.current) {
      return;
    }

    setCountResult(result);
    setIsTesting(false);
  };

  // Step 2 opens on a test of the key: the organizations it reads.
  const runListTest: () => Promise<void> = async (): Promise<void> => {
    latestTest.current += 1;
    const testId: number = latestTest.current;

    setListResult(null);
    setCountResult(null);
    setOrganizationId("");
    setIsTesting(true);

    const result: NetworkControllerTestResult = await test({
      organizationId: "",
    });

    if (testId !== latestTest.current) {
      return;
    }

    setListResult(result);

    // A key that reads one organization: picked, and counted already.
    if (
      result.status !== "fail" &&
      result.organizationId &&
      result.networkCount !== undefined
    ) {
      setOrganizationId(result.organizationId);
      setCountResult(result);
    }

    setIsTesting(false);
  };

  useEffect(() => {
    if (step === 2) {
      runListTest().catch(() => {
        setIsTesting(false);
      });
    }

    if (step === 1 && selectKeyOnOpen.current) {
      selectKeyOnOpen.current = false;
      const input: HTMLElement | null =
        document.getElementById("meraki-api-key");

      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      }
    }
  }, [step]);

  const changeKey: () => void = (): void => {
    selectKeyOnOpen.current = true;
    setStep(1);
  };

  // The name follows the organization until someone types one.
  useEffect(() => {
    if (!isNameEdited) {
      setName((picked?.name || "").substring(0, NAME_MAX_LENGTH));
    }
  }, [picked?.id]);

  const goToOrganization: () => void = (): void => {
    if (apiKey.trim().length === 0) {
      setKeyError(
        translator.translateText("Enter the Meraki dashboard API key.") || "",
      );
      return;
    }

    setKeyError("");
    setStep(2);
  };

  const canConnect: boolean = Boolean(
    picked &&
      countResult &&
      countResult.status !== "fail" &&
      countResult.organizationId === picked.id &&
      !isTesting,
  );

  const connect: () => Promise<void> = async (): Promise<void> => {
    if (!picked || !canConnect) {
      return;
    }

    setIsSaving(true);
    setSaveError("");

    try {
      const connection: NetworkControllerConnection =
        new NetworkControllerConnection();
      connection.projectId = ProjectUtil.getCurrentProjectId()!;
      connection.name =
        name.trim().substring(0, NAME_MAX_LENGTH) ||
        picked.name.substring(0, NAME_MAX_LENGTH);
      connection.provider = NetworkControllerProvider.Meraki;
      connection.config = {
        region,
        organizationId: picked.id,
        organizationName: picked.name.substring(
          0,
          MAX_ORGANIZATION_NAME_LENGTH,
        ),
        readIntervalInMinutes: interval,
      };
      connection.secrets = JSON.stringify({ apiKey: apiKey.trim() });

      await ModelAPI.create<NetworkControllerConnection>({
        model: connection,
        modelType: NetworkControllerConnection,
      });

      props.onConnected({ name: connection.name });
    } catch (error) {
      setSaveError(API.getFriendlyMessage(error));
      setIsSaving(false);
    }
  };

  const footer: ReturnType<typeof getSteppedModalFooter> =
    getSteppedModalFooter({
      hasSteps: true,
      isOnLastStep: step === 2,
      onAction: () => {
        connect().catch(() => {
          // handled inside.
        });
      },
      onNext: goToOrganization,
    });

  const intervalWords: MerakiTemplate = getMerakiIntervalWords(interval);

  return (
    <Modal
      title="Connect Meraki"
      description="OneUptime reads uplink usage, applications and clients through the Meraki dashboard API. Nothing changes in Meraki or on the devices."
      onClose={props.onClose}
      submitButtonText="Connect"
      onSubmit={footer.onSubmit}
      secondaryButton={footer.secondaryButton}
      disableSubmitButton={!canConnect}
      isLoading={isSaving}
      error={saveError || undefined}
      modalWidth={ModalWidth.Medium}
    >
      <div data-testid="meraki-connect">
        <ol
          className="mb-5 flex items-center gap-2 text-xs font-medium"
          aria-label={translator.translateText("Progress")}
        >
          {STEP_TITLES.map((title: string, index: number): ReactElement => {
            const number: 1 | 2 = (index + 1) as 1 | 2;
            const isCurrent: boolean = step === number;
            const canOpen: boolean = number < step;

            return (
              <li key={title} className="flex items-center gap-2">
                {index > 0 ? (
                  <span className="h-px w-6 bg-gray-200" aria-hidden="true" />
                ) : (
                  <></>
                )}
                <button
                  type="button"
                  disabled={!canOpen}
                  aria-current={isCurrent ? "step" : undefined}
                  onClick={() => {
                    if (canOpen) {
                      setStep(number);
                    }
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ring-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    isCurrent
                      ? "bg-indigo-50 text-indigo-700 ring-indigo-200"
                      : canOpen
                        ? "bg-white text-gray-700 ring-gray-200 hover:bg-gray-50"
                        : "bg-white text-gray-400 ring-gray-200"
                  }`}
                  data-testid={`meraki-connect-step-${number}`}
                >
                  {canOpen ? (
                    // A step done: checked, as the product's step list does.
                    <Icon
                      icon={IconProp.Check}
                      className="h-3.5 w-3.5 flex-shrink-0 text-indigo-600"
                    />
                  ) : (
                    <span className="tabular-nums">{number}</span>
                  )}
                  {translator.translateText(title)}
                </button>
              </li>
            );
          })}
        </ol>

        {step === 1 ? (
          <div className="space-y-4" data-testid="meraki-connect-key-step">
            <div>
              <label
                htmlFor="meraki-api-key"
                className="block text-sm font-medium text-gray-900"
              >
                {translator.translateText("API key")}
              </label>
              <div className="mt-1">
                <Input
                  id="meraki-api-key"
                  type={InputType.PASSWORD}
                  value={apiKey}
                  onChange={(value: string) => {
                    setApiKey(value);
                    setKeyError("");
                  }}
                  onEnterPress={goToOrganization}
                  error={keyError || undefined}
                  dataTestId="meraki-api-key"
                />
              </div>
              <p className="mt-1.5 text-xs text-gray-500">
                {translator.translateText(
                  "Make one in the Meraki dashboard under Organization > API & Webhooks > API keys and access. A read-only administrator's key is enough. OneUptime stores it encrypted and never shows it again.",
                )}
              </p>
            </div>

            <FoldedSection
              title={MORE_FIELDS_SECTION_TITLE}
              items={[
                {
                  key: "region",
                  title: "Dashboard region",
                  isSet: region !== DEFAULT_MERAKI_REGION,
                  value: regionDefinition.name,
                  translateValue: true,
                },
              ]}
              dataTestId="meraki-connect-key-more"
            >
              <div className="pt-2">
                <label
                  htmlFor="meraki-region"
                  className="block text-sm font-medium text-gray-900"
                >
                  {translator.translateText("Dashboard region")}
                </label>
                <select
                  id="meraki-region"
                  value={region}
                  onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                    setRegion(event.target.value as MerakiRegion);
                  }}
                  className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  data-testid="meraki-region"
                >
                  {getMerakiRegionOptions().map(
                    (definition: MerakiRegionDefinition): ReactElement => {
                      return (
                        <option
                          key={definition.region}
                          value={definition.region}
                        >
                          {`${translator.translateText(definition.name) || definition.name} (${definition.dashboardHost})`}
                        </option>
                      );
                    },
                  )}
                </select>
                <p className="mt-1.5 text-xs text-gray-500">
                  {translator.translateText(
                    "The address you sign in to Meraki at. Most organizations are on dashboard.meraki.com.",
                  )}
                </p>
              </div>
            </FoldedSection>
          </div>
        ) : (
          <div
            className="space-y-4"
            data-testid="meraki-connect-organization-step"
          >
            {isTesting && !listResult ? (
              <p
                className="flex items-center gap-2 text-sm text-gray-600"
                role="status"
                data-testid="meraki-connect-testing"
              >
                <Icon
                  icon={IconProp.Spinner}
                  className="h-4 w-4 flex-shrink-0 animate-spin text-gray-400"
                />
                {translator.translateTemplate(
                  "Checking the key with {{host}}…",
                  { host: regionDefinition.apiHost },
                )}
              </p>
            ) : (
              <></>
            )}

            {listResult && listResult.status === "fail" ? (
              <MerakiTestResultPanel
                result={listResult}
                organizationName=""
                dashboardHost={regionDefinition.dashboardHost}
                onTryAgain={() => {
                  runListTest().catch(() => {
                    setIsTesting(false);
                  });
                }}
                onChangeKey={changeKey}
              />
            ) : (
              <></>
            )}

            {listResult && listResult.status !== "fail" ? (
              <div>
                <div className="text-sm font-medium text-gray-900">
                  {translator.translateText("Organization")}
                </div>
                {organizations.length === 1 ? (
                  <p
                    className="mt-1 text-sm text-gray-700"
                    data-testid="meraki-connect-only-organization"
                  >
                    {organizations[0]!.name}
                  </p>
                ) : (
                  <div
                    className="-mx-0.5 mt-1.5 max-h-56 space-y-1 overflow-y-auto p-0.5"
                    role="radiogroup"
                    aria-label={translator.translateText("Organization")}
                    data-testid="meraki-connect-organizations"
                  >
                    {organizations.map(
                      (
                        organization: NetworkControllerOrganization,
                      ): ReactElement => {
                        const isPicked: boolean =
                          organization.id === organizationId;

                        return (
                          <label
                            key={organization.id}
                            className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 ring-1 ${
                              isPicked
                                ? "bg-indigo-50 ring-indigo-200"
                                : "ring-gray-200 hover:bg-gray-50"
                            }`}
                          >
                            <input
                              type="radio"
                              name="meraki-organization"
                              value={organization.id}
                              checked={isPicked}
                              onChange={() => {
                                setOrganizationId(organization.id);
                                countOrganization(organization.id).catch(() => {
                                  setIsTesting(false);
                                });
                              }}
                              className="h-4 w-4 text-indigo-600 focus:ring-indigo-500"
                              data-testid="meraki-connect-organization"
                            />
                            <span className="min-w-0 truncate text-sm text-gray-900">
                              {organization.name}
                            </span>
                          </label>
                        );
                      },
                    )}
                  </div>
                )}
              </div>
            ) : (
              <></>
            )}

            {organizationId && isTesting ? (
              <p
                className="flex items-center gap-2 text-sm text-gray-600"
                role="status"
              >
                <Icon
                  icon={IconProp.Spinner}
                  className="h-4 w-4 flex-shrink-0 animate-spin text-gray-400"
                />
                {translator.translateText("Counting what a read will cover…")}
              </p>
            ) : (
              <></>
            )}

            {countResult ? (
              <MerakiTestResultPanel
                result={countResult}
                organizationName={picked?.name || ""}
                dashboardHost={regionDefinition.dashboardHost}
                onTryAgain={() => {
                  countOrganization(organizationId).catch(() => {
                    setIsTesting(false);
                  });
                }}
                onChangeKey={changeKey}
              />
            ) : (
              <></>
            )}

            {picked ? (
              <FoldedSection
                title={MORE_FIELDS_SECTION_TITLE}
                items={[
                  {
                    key: "name",
                    title: "Name",
                    isSet: isNameEdited && name.trim() !== picked.name,
                    value: name.trim() || undefined,
                  },
                  {
                    key: "readInterval",
                    title: "Read uplink usage",
                    isSet:
                      interval !==
                      DEFAULT_NETWORK_CONTROLLER_READ_INTERVAL_IN_MINUTES,
                    value: drawMerakiTemplate(translator, intervalWords),
                  },
                ]}
                dataTestId="meraki-connect-organization-more"
              >
                <div className="space-y-4 pt-2">
                  <div>
                    <label
                      htmlFor="meraki-connection-name"
                      className="block text-sm font-medium text-gray-900"
                    >
                      {translator.translateText("Name")}
                    </label>
                    <div className="mt-1">
                      <Input
                        id="meraki-connection-name"
                        value={name}
                        onChange={(value: string) => {
                          setName(value.substring(0, NAME_MAX_LENGTH));
                          setIsNameEdited(true);
                        }}
                        dataTestId="meraki-connection-name"
                      />
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor="meraki-read-interval"
                      className="block text-sm font-medium text-gray-900"
                    >
                      {translator.translateText("Read uplink usage")}
                    </label>
                    <select
                      id="meraki-read-interval"
                      value={String(interval)}
                      onChange={(
                        event: React.ChangeEvent<HTMLSelectElement>,
                      ) => {
                        setReadInterval(Number(event.target.value));
                      }}
                      className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      data-testid="meraki-read-interval"
                    >
                      {getMerakiIntervalOptions().map(
                        (option: {
                          value: number;
                          words: MerakiTemplate;
                        }): ReactElement => {
                          return (
                            <option key={option.value} value={option.value}>
                              {drawMerakiTemplate(translator, option.words)}
                            </option>
                          );
                        },
                      )}
                    </select>
                    <p className="mt-1.5 text-xs text-gray-500">
                      {translator.translateText(
                        "Each read of the uplinks is one API call for the whole organization. Applications and clients are read every two hours, as Meraki sums them.",
                      )}
                    </p>
                  </div>
                </div>
              </FoldedSection>
            ) : (
              <></>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};

export default MerakiConnectModal;
