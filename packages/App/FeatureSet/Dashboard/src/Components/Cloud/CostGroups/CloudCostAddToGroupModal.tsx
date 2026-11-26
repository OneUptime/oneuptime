import CloudCostGroup from "Common/Models/DatabaseModels/CloudCostGroup";
import {
  CloudCostRule,
  CloudCostRuleField,
  makeCloudCostRule,
} from "Common/Types/Cloud/CloudCostRules";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Input from "Common/UI/Components/Input/Input";
import Modal from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Toast from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";
import { readGroupRules } from "./CloudCostAllocationReads";
import {
  ADDED_TO_GROUP,
  ADD_TO_GROUP,
  ADD_TO_GROUP_DESCRIPTION,
  ADD_TO_GROUP_NEW,
  ADD_TO_GROUP_NEW_NAME,
  ADD_TO_GROUP_PICK,
  ADD_TO_GROUP_TITLE,
} from "./CloudCostGroupWords";
import {
  CloudCostConditionSentence,
  CloudCostRuleNames,
} from "./CloudCostRuleSummary";

/*
 * "Add to Group" on what no rule matches: a service, an account, a tag's
 * value or an owner team becomes a rule of the group picked - or of a new
 * group - and its costs move into the group, past months too, on the next
 * read. A group OneUptime makes for a tag value or a team keeps its own
 * rules, so it is not offered.
 */

// The value of the new-group choice in the picker: no group's ID is it.
const NEW_GROUP: string = "new-group";

export interface CloudCostUnallocatedPick {
  field: CloudCostRuleField;
  value: string;
  key?: string | undefined;
}

export interface ComponentProps {
  viewId: ObjectID;
  groups: Array<CloudCostGroup>;
  pick: CloudCostUnallocatedPick;
  names: CloudCostRuleNames;
  onClose: () => void;
  onAdded: () => void;
}

const CloudCostAddToGroupModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const nameId: string = useId();
  const own: Array<CloudCostGroup> = props.groups.filter(
    (group: CloudCostGroup): boolean => {
      return !group.automaticKey;
    },
  );
  const [groupId, setGroupId] = useState<string>(
    own[0]?._id?.toString() || NEW_GROUP,
  );
  const [newName, setNewName] = useState<string>(props.pick.value);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const rule: CloudCostRule = makeCloudCostRule({
    field: props.pick.field,
    value: props.pick.value,
    key: props.pick.key,
  });

  const options: Array<DropdownOption> = [
    ...own.map((group: CloudCostGroup): DropdownOption => {
      return {
        value: group._id?.toString() || "",
        label: group.name || "",
        isUserContent: true,
      };
    }),
    { value: NEW_GROUP, label: ADD_TO_GROUP_NEW },
  ];

  const save: () => Promise<void> = async (): Promise<void> => {
    setIsSaving(true);
    setError("");

    try {
      let name: string = newName.trim();

      if (groupId === NEW_GROUP) {
        const group: CloudCostGroup = new CloudCostGroup();
        group.cloudCostViewId = props.viewId;
        group.name = name;
        group.rules = [rule];

        await ModelAPI.create<CloudCostGroup>({
          model: group,
          modelType: CloudCostGroup,
        });
      } else {
        const group: CloudCostGroup | undefined = own.find(
          (entry: CloudCostGroup): boolean => {
            return entry._id?.toString() === groupId;
          },
        );

        name = group?.name || "";

        await ModelAPI.updateById<CloudCostGroup>({
          modelType: CloudCostGroup,
          id: new ObjectID(groupId),
          data: {
            rules: [
              ...(group ? readGroupRules(group) : []),
              rule,
            ] as unknown as JSONObject,
          },
        });
      }

      Toast.success(
        translator.translateTemplate(ADDED_TO_GROUP, { group: name }),
      );
      props.onAdded();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      title={ADD_TO_GROUP_TITLE}
      description={ADD_TO_GROUP_DESCRIPTION}
      submitButtonText={ADD_TO_GROUP}
      onClose={props.onClose}
      onSubmit={() => {
        void save();
      }}
      isLoading={isSaving}
      disableSubmitButton={groupId === NEW_GROUP && newName.trim().length < 2}
      error={error}
    >
      <div className="space-y-4" data-testid="cloud-cost-add-to-group">
        <div className="rounded-md bg-gray-50 px-3 py-2 text-sm">
          <CloudCostConditionSentence
            condition={rule.conditions[0]!}
            names={props.names}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            {translator.translateText(ADD_TO_GROUP_PICK)}
          </label>
          <Dropdown
            ariaLabel={ADD_TO_GROUP_PICK}
            dataTestId="cloud-cost-add-to-group-pick"
            options={options}
            value={options.find((option: DropdownOption): boolean => {
              return option.value === groupId;
            })}
            isClearable={false}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              if (typeof value === "string" && value) {
                setGroupId(value);
              }
            }}
          />
        </div>
        {groupId === NEW_GROUP ? (
          <div>
            <label
              htmlFor={nameId}
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              {translator.translateText(ADD_TO_GROUP_NEW_NAME)}
            </label>
            <Input
              id={nameId}
              value={newName}
              dataTestId="cloud-cost-add-to-group-name"
              onChange={(value: string) => {
                setNewName(value);
              }}
            />
          </div>
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export default CloudCostAddToGroupModal;
