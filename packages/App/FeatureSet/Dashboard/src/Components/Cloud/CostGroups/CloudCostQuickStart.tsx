import CloudCostView from "Common/Models/DatabaseModels/CloudCostView";
import Route from "Common/Types/API/Route";
import { CloudCostViewGrouping } from "Common/Types/Cloud/CloudCostAllocation";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";
import Icon from "Common/UI/Components/Icon/Icon";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  QUICK_START_BY_RULES_DESCRIPTION,
  QUICK_START_BY_RULES_NAME,
  QUICK_START_BY_RULES_TITLE,
  QUICK_START_BY_TAG_DESCRIPTION,
  QUICK_START_BY_TAG_NAME,
  QUICK_START_BY_TAG_TITLE,
  QUICK_START_BY_TEAM_DESCRIPTION,
  QUICK_START_BY_TEAM_NAME,
  QUICK_START_BY_TEAM_TITLE,
  QUICK_START_CREATE,
  QUICK_START_DESCRIPTION,
  QUICK_START_NO_TAGS,
  QUICK_START_TITLE,
  RULE_EDITOR_TAG_KEY,
} from "./CloudCostGroupWords";

/*
 * The first view, one click away: a project with no cost view yet is
 * offered the three ways most teams start - a group per team that owns
 * cloud resources (built from the owners already set), a group per value
 * of a tag its costs carry, or groups of its own - each made at once and
 * opened, its groups made by OneUptime where it makes them.
 */

export interface ComponentProps {
  // The tags the accounts' costs carry, the costliest first.
  tagKeys: Array<string>;
  // A person who may not create views is shown nothing to press.
  canCreate: boolean;
}

const CloudCostQuickStart: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [tagKey, setTagKey] = useState<string>("");
  const [busy, setBusy] = useState<CloudCostViewGrouping | null>(null);
  const [error, setError] = useState<string>("");
  const activeTagKey: string = tagKey || props.tagKeys[0] || "";

  const create: (grouping: CloudCostViewGrouping) => Promise<void> = async (
    grouping: CloudCostViewGrouping,
  ): Promise<void> => {
    setBusy(grouping);
    setError("");

    try {
      const view: CloudCostView = new CloudCostView();
      view.grouping = grouping;
      view.name =
        grouping === CloudCostViewGrouping.OwnerTeam
          ? translator.translateText(QUICK_START_BY_TEAM_NAME) ||
            QUICK_START_BY_TEAM_NAME
          : grouping === CloudCostViewGrouping.TagValue
            ? translator.translateTemplate(QUICK_START_BY_TAG_NAME, {
                tag: activeTagKey,
              })
            : translator.translateText(QUICK_START_BY_RULES_NAME) ||
              QUICK_START_BY_RULES_NAME;

      if (grouping === CloudCostViewGrouping.TagValue) {
        view.tagKey = activeTagKey;
      }

      const response: { data: unknown } = await ModelAPI.create<CloudCostView>({
        model: view,
        modelType: CloudCostView,
      });
      const created: JSONObject = (response.data || {}) as JSONObject;
      const id: string = String(created["_id"] || "");

      if (id) {
        Navigation.navigate(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.CLOUD_COST_VIEW] as Route,
            { modelId: new ObjectID(id) },
          ),
        );
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const tagOptions: Array<DropdownOption> = props.tagKeys.map(
    (key: string): DropdownOption => {
      return { value: key, label: key, isUserContent: true };
    },
  );

  const choices: Array<{
    grouping: CloudCostViewGrouping;
    icon: IconProp;
    title: string;
    description: string;
    extra?: ReactElement | undefined;
    disabled?: boolean | undefined;
  }> = [
    {
      grouping: CloudCostViewGrouping.OwnerTeam,
      icon: IconProp.Team,
      title: QUICK_START_BY_TEAM_TITLE,
      description: QUICK_START_BY_TEAM_DESCRIPTION,
    },
    {
      grouping: CloudCostViewGrouping.TagValue,
      icon: IconProp.Tag,
      title: QUICK_START_BY_TAG_TITLE,
      description: QUICK_START_BY_TAG_DESCRIPTION,
      disabled: props.tagKeys.length === 0,
      extra:
        props.tagKeys.length > 0 ? (
          <div className="mt-3">
            <Dropdown
              ariaLabel={RULE_EDITOR_TAG_KEY}
              dataTestId="cloud-cost-quick-start-tag"
              options={tagOptions}
              value={tagOptions.find((option: DropdownOption): boolean => {
                return option.value === activeTagKey;
              })}
              isClearable={false}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                if (typeof value === "string" && value) {
                  setTagKey(value);
                }
              }}
            />
          </div>
        ) : (
          <p className="mt-3 text-xs text-gray-500">
            {translator.translateText(QUICK_START_NO_TAGS)}
          </p>
        ),
    },
    {
      grouping: CloudCostViewGrouping.Rules,
      icon: IconProp.Filter,
      title: QUICK_START_BY_RULES_TITLE,
      description: QUICK_START_BY_RULES_DESCRIPTION,
    },
  ];

  return (
    <Card title={QUICK_START_TITLE} description={QUICK_START_DESCRIPTION}>
      <div data-testid="cloud-cost-quick-start">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {choices.map((choice: (typeof choices)[number]) => {
            return (
              <div
                key={choice.grouping}
                className="flex flex-col rounded-lg border border-gray-200 p-4"
                data-testid="cloud-cost-quick-start-choice"
                data-grouping={choice.grouping}
              >
                <div className="flex items-center gap-2">
                  <Icon
                    icon={choice.icon}
                    className="h-5 w-5 flex-none text-indigo-600"
                  />
                  <h3 className="text-sm font-semibold text-gray-900">
                    {translator.translateText(choice.title)}
                  </h3>
                </div>
                <p className="mt-2 flex-1 text-sm text-gray-600">
                  {translator.translateText(choice.description)}
                </p>
                {choice.extra || <></>}
                {props.canCreate ? (
                  <div className="mt-4">
                    <Button
                      buttonStyle={ButtonStyleType.NORMAL}
                      title={QUICK_START_CREATE}
                      dataTestId="cloud-cost-quick-start-create"
                      isLoading={busy === choice.grouping}
                      disabled={Boolean(busy) || Boolean(choice.disabled)}
                      onClick={() => {
                        void create(choice.grouping);
                      }}
                    />
                  </div>
                ) : (
                  <></>
                )}
              </div>
            );
          })}
        </div>
        {error ? (
          <p className="mt-4 text-sm">
            <ErrorInSentence message={error} showWhereToLook={true} />
          </p>
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

export default CloudCostQuickStart;
