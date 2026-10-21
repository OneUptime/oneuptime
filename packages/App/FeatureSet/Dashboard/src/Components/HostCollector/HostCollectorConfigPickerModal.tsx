import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Host from "Common/Models/DatabaseModels/Host";
import HostCollectorConfig from "Common/Models/DatabaseModels/HostCollectorConfig";
import Label from "Common/Models/DatabaseModels/Label";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  AUTOMATIC_HOST_COLLECTOR_CONFIG,
  HostCollectorConfigChoiceHost,
  HostCollectorConfigChoiceOption,
  getAutomaticHostCollectorConfigId,
  getCurrentHostCollectorConfigChoice,
  getHostCollectorConfigChoiceUpdate,
  getPickableHostCollectorConfigs,
} from "./HostCollectorConfigChoice";
import { getHostCollectorConfigLabel } from "./HostCollectorStatus";

/*
 * Change config, on a managed host's Collector page: run the config the
 * list gives this host (automatic), or one picked for it. Only configs for
 * the host's system - or for any system - are offered.
 */

export interface ComponentProps {
  host: Host;
  onClose: () => void;
  onSaved: () => void;
}

interface ChoiceFormValues {
  config: string;
}

const toOption: (
  config: HostCollectorConfig,
) => HostCollectorConfigChoiceOption = (
  config: HostCollectorConfig,
): HostCollectorConfigChoiceOption => {
  return {
    id: config._id?.toString() || "",
    name: config.name || "",
    osType: config.osType,
    labelIds: (config.labels || [])
      .map((label: Label): string => {
        return label._id?.toString() || "";
      })
      .filter((id: string): boolean => {
        return Boolean(id);
      }),
    order: config.order || 0,
  };
};

const HostCollectorConfigPickerModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [configs, setConfigs] = useState<
    Array<HostCollectorConfigChoiceOption>
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const choiceHost: HostCollectorConfigChoiceHost = {
    osType: props.host.osType,
    labelIds: (props.host.labels || [])
      .map((label: Label): string => {
        return label._id?.toString() || "";
      })
      .filter((id: string): boolean => {
        return Boolean(id);
      }),
    collectorConfigId: props.host.collectorConfigId?.toString() || null,
    isCollectorConfigPinned: props.host.isCollectorConfigPinned,
  };

  useEffect(() => {
    let isCurrent: boolean = true;

    ModelAPI.getList<HostCollectorConfig>({
      modelType: HostCollectorConfig,
      query: {
        projectId: ProjectUtil.getCurrentProjectId()!,
      },
      select: {
        _id: true,
        name: true,
        osType: true,
        order: true,
        labels: {
          _id: true,
        },
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      sort: {
        order: SortOrder.Ascending,
      },
    })
      .then((result: ListResult<HostCollectorConfig>) => {
        if (isCurrent) {
          setConfigs(result.data.map(toOption));
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  const automaticId: string | null = getAutomaticHostCollectorConfigId({
    configs: configs,
    host: choiceHost,
  });

  const automaticName: string =
    configs.find((config: HostCollectorConfigChoiceOption): boolean => {
      return config.id === automaticId;
    })?.name ||
    getHostCollectorConfigLabel({ osType: props.host.osType }, translator);

  const dropdownOptions: Array<DropdownOption> = [
    {
      // Already in the reader's language, with a config's name in it.
      label: translator.translateTemplate("Automatic: {{config}} for now", {
        config: automaticName,
      }),
      value: AUTOMATIC_HOST_COLLECTOR_CONFIG,
      isUserContent: true,
    },
    ...getPickableHostCollectorConfigs({
      configs: configs,
      host: choiceHost,
    }).map((config: HostCollectorConfigChoiceOption): DropdownOption => {
      // A config's name is what someone typed: never looked up.
      return {
        label: config.name,
        value: config.id,
        isUserContent: true,
      };
    }),
  ];

  return (
    <BasicFormModal<ChoiceFormValues>
      title="Change config"
      name="Host > Collector > Change config"
      description="Automatic runs the first Collector Config that applies to this host, or OneUptime's default. A config you pick stays until you change it."
      isLoading={isLoading}
      error={error || undefined}
      submitButtonText="Save"
      onClose={props.onClose}
      onSubmit={async (values: ChoiceFormValues) => {
        setIsLoading(true);
        setError("");

        try {
          const update: {
            collectorConfigId: string | null;
            isCollectorConfigPinned: boolean;
          } = getHostCollectorConfigChoiceUpdate({
            choice: values.config || AUTOMATIC_HOST_COLLECTOR_CONFIG,
            configs: configs,
            host: choiceHost,
          });

          await ModelAPI.updateById<Host>({
            modelType: Host,
            id: new ObjectID(props.host._id?.toString() || ""),
            data: {
              collectorConfigId: update.collectorConfigId,
              isCollectorConfigPinned: update.isCollectorConfigPinned,
            },
          });

          props.onSaved();
        } catch (err) {
          setError(API.getFriendlyMessage(err));
          setIsLoading(false);
        }
      }}
      formProps={{
        id: "host-collector-config-picker",
        name: "Host > Collector > Change config",
        initialValues: {
          config: getCurrentHostCollectorConfigChoice(choiceHost),
        },
        fields: [
          {
            field: {
              config: true,
            },
            title: "Config",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: dropdownOptions,
            required: true,
          },
        ],
      }}
    />
  );
};

export default HostCollectorConfigPickerModal;
