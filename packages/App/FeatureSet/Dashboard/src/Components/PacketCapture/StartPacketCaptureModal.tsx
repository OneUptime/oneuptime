import PacketCaptureFilterInput from "./PacketCaptureFilterInput";
import {
  PACKET_CAPTURE_SENSITIVE_DATA_TITLE,
  PacketCaptureFilterValue,
  buildFilter,
  describeDuration,
  describeLimits,
  getDefaultFilterValue,
  getDefaultLimits,
  getDurationChoices,
  getInterfaceOptions,
  getSensitiveDataNotice,
  InterfaceOption,
} from "./PacketCaptureViewModel";
import PacketCapture from "Common/Models/DatabaseModels/PacketCapture";
import ObjectID from "Common/Types/ObjectID";
import PacketCaptureCapabilityUtil, {
  ALL_INTERFACES_NAME,
  PacketCaptureCapability,
} from "Common/Types/PacketCapture/PacketCaptureCapability";
import { PacketCaptureFilterBuild } from "Common/Types/PacketCapture/PacketCaptureFilter";
import {
  PACKET_CAPTURE_MIN_FILE_SIZE_IN_MB,
  PACKET_CAPTURE_MIN_PACKETS,
  PacketCaptureLimits,
  PacketCaptureLimitsUtil,
} from "Common/Types/PacketCapture/PacketCaptureLimits";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ButtonType from "Common/UI/Components/Button/ButtonTypes";
import BasicForm, {
  BasicFormHandle,
} from "Common/UI/Components/Forms/BasicForm";
import Field, {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  getAdvancedFormSection,
  normalizeFormValue,
} from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useMemo,
  useRef,
  useState,
} from "react";

export interface StartPacketCaptureFormValues {
  interfaceName: string;
  filter: PacketCaptureFilterValue;
  maxDurationInSeconds: number;
  maxPackets: number;
  maxFileSizeInMB: number;
}

export interface ComponentProps {
  probeId: ObjectID;
  capability: PacketCaptureCapability;
  // Started from a device's page: linked to it, and filtered to its address.
  networkDeviceId?: ObjectID | undefined;
  defaultHost?: string | undefined;
  onClose: () => void;
  onStarted: () => void;
}

/*
 * Start Packet Capture: where to listen, which packets to keep, and for how
 * long - three rows, the limits folded with a sentence that says what they
 * are. Above them, what a capture holds and what OneUptime does about it,
 * said before anything is captured rather than after.
 */
const StartPacketCaptureModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const formRef: MutableRefObject<BasicFormHandle | null> =
    useRef<BasicFormHandle | null>(null);
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const maximums: PacketCaptureLimits = PacketCaptureLimitsUtil.getMaximums(
    props.capability.limits,
  );

  const interfaceOptions: Array<InterfaceOption> = getInterfaceOptions(
    props.capability,
    translator,
  );

  const initialValues: StartPacketCaptureFormValues = useMemo(() => {
    const limits: PacketCaptureLimits = getDefaultLimits(props.capability);

    return {
      interfaceName:
        PacketCaptureCapabilityUtil.getDefaultInterfaceName(props.capability) ||
        "",
      filter: getDefaultFilterValue(props.defaultHost),
      maxDurationInSeconds: limits.maxDurationInSeconds,
      maxPackets: limits.maxPackets,
      maxFileSizeInMB: limits.maxFileSizeInMB,
    };
  }, [props.capability, props.defaultHost]);

  const readLimits: (
    values: FormValues<StartPacketCaptureFormValues>,
  ) => PacketCaptureLimits = (
    values: FormValues<StartPacketCaptureFormValues>,
  ): PacketCaptureLimits => {
    return {
      maxDurationInSeconds: Number(
        normalizeFormValue(values.maxDurationInSeconds) ||
          initialValues.maxDurationInSeconds,
      ),
      maxPackets: Number(values.maxPackets || initialValues.maxPackets),
      maxFileSizeInMB: Number(
        values.maxFileSizeInMB || initialValues.maxFileSizeInMB,
      ),
    };
  };

  const limitsSection: FormFieldCollapsibleSection<StartPacketCaptureFormValues> =
    getAdvancedFormSection<StartPacketCaptureFormValues>({
      id: "packet-capture-limits",
      /*
       * The sentence says what the limits are, set or not, so the header
       * draws no chips that would say it a second time.
       */
      isConfigured: (): boolean => {
        return false;
      },
      getSummary: (
        values: FormValues<StartPacketCaptureFormValues>,
      ): Array<string> => {
        return [describeLimits(readLimits(values), translator)];
      },
    });

  // What "every packet on ..." names: the interface, or every interface.
  const getInterfaceLabel: (
    values: FormValues<StartPacketCaptureFormValues>,
  ) => string = (values: FormValues<StartPacketCaptureFormValues>): string => {
    const name: string = String(normalizeFormValue(values.interfaceName) || "");

    if (!name || name === ALL_INTERFACES_NAME) {
      return translator.translateText("every interface") || "";
    }

    return name;
  };

  const fields: Array<Field<StartPacketCaptureFormValues>> = [
    {
      field: { interfaceName: true },
      title: "Interface",
      description:
        "Where the probe listens: the interface a switch mirrors traffic to, or all of them.",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: interfaceOptions,
      required: true,
      dataTestId: "packet-capture-interface",
    },
    {
      field: { filter: true },
      title: "Which packets",
      description:
        "Leave it empty to keep every packet, or narrow it to a host, a port or a protocol.",
      fieldType: FormFieldSchemaType.CustomComponent,
      required: false,
      customValidation: (
        values: FormValues<StartPacketCaptureFormValues>,
      ): string | null => {
        return buildFilter(
          values.filter as unknown as PacketCaptureFilterValue,
        ).error;
      },
      getCustomElement: (
        values: FormValues<StartPacketCaptureFormValues>,
        customElementProps: CustomElementProps,
      ): ReactElement => {
        return (
          <PacketCaptureFilterInput
            initialValue={
              (values.filter as unknown as PacketCaptureFilterValue) ||
              initialValues.filter
            }
            onChange={(value: PacketCaptureFilterValue) => {
              customElementProps.onChange?.(value);
            }}
            interfaceLabel={getInterfaceLabel(values)}
            error={customElementProps.error}
          />
        );
      },
    },
    {
      field: { maxDurationInSeconds: true },
      title: "Duration",
      description: "The longest the capture runs.",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: getDurationChoices(maximums.maxDurationInSeconds).map(
        (seconds: number) => {
          return {
            value: seconds,
            label: describeDuration(seconds, translator),
          };
        },
      ),
      required: true,
      collapsibleSection: limitsSection,
      dataTestId: "packet-capture-duration",
    },
    {
      field: { maxPackets: true },
      title: "Packet limit",
      description: "It stops after this many packets.",
      fieldType: FormFieldSchemaType.Number,
      required: true,
      validation: {
        minValue: PACKET_CAPTURE_MIN_PACKETS,
        maxValue: maximums.maxPackets,
      },
      collapsibleSection: limitsSection,
      dataTestId: "packet-capture-max-packets",
    },
    {
      field: { maxFileSizeInMB: true },
      title: "File size limit (MB)",
      description: "It stops when the file reaches this size.",
      fieldType: FormFieldSchemaType.Number,
      required: true,
      validation: {
        minValue: PACKET_CAPTURE_MIN_FILE_SIZE_IN_MB,
        maxValue: maximums.maxFileSizeInMB,
      },
      collapsibleSection: limitsSection,
      dataTestId: "packet-capture-max-file-size",
    },
  ];

  const onSubmit: (
    values: FormValues<StartPacketCaptureFormValues>,
  ) => Promise<void> = async (
    values: FormValues<StartPacketCaptureFormValues>,
  ): Promise<void> => {
    const filter: PacketCaptureFilterBuild = buildFilter(
      values.filter as unknown as PacketCaptureFilterValue,
    );

    if (filter.error) {
      setError(filter.error);
      return;
    }

    const limits: PacketCaptureLimits = readLimits(values);

    const capture: PacketCapture = new PacketCapture();
    capture.probeId = props.probeId;
    capture.interfaceName = String(normalizeFormValue(values.interfaceName));
    capture.bpfFilter = filter.expression;
    capture.maxDurationInSeconds = limits.maxDurationInSeconds;
    capture.maxPackets = limits.maxPackets;
    capture.maxFileSizeInMB = limits.maxFileSizeInMB;

    if (props.networkDeviceId) {
      capture.networkDeviceId = props.networkDeviceId;
    }

    setIsStarting(true);
    setError("");

    try {
      await ModelAPI.create<PacketCapture>({
        model: capture,
        modelType: PacketCapture,
      });

      props.onStarted();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <Modal
      title="Start Packet Capture"
      submitButtonText="Start Capture"
      submitButtonType={ButtonType.Submit}
      modalWidth={ModalWidth.Medium}
      isLoading={isStarting}
      error={error || undefined}
      onClose={props.onClose}
      onSubmit={() => {
        formRef.current?.submitAllSteps();
      }}
    >
      <div className="space-y-4" data-testid="start-packet-capture">
        <Alert
          type={AlertType.WARNING}
          strongTitle={PACKET_CAPTURE_SENSITIVE_DATA_TITLE}
          title={getSensitiveDataNotice(translator)}
          dataTestId="packet-capture-sensitive-data"
        />
        <BasicForm
          ref={formRef}
          id="start-packet-capture-form"
          name="Start Packet Capture"
          fields={fields}
          initialValues={initialValues}
          hideSubmitButton={true}
          footer={<></>}
          onSubmit={(values: FormValues<StartPacketCaptureFormValues>) => {
            onSubmit(values).catch((err: Error) => {
              setError(API.getFriendlyMessage(err));
            });
          }}
        />
      </div>
    </Modal>
  );
};

export default StartPacketCaptureModal;
