import React, { FunctionComponent, ReactElement, useId } from "react";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Input from "Common/UI/Components/Input/Input";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  RESOURCE_NAME_FIELD_HINT,
  RESOURCE_NAME_REPORTED_AS,
  RESOURCE_NAME_TAKEN,
} from "./ResourceOnboarding";

/*
 * "Cluster name", above an Add guide's steps: the name the agent is told,
 * which every command below is written with as it is typed. It starts as
 * a name the project has not used, so the commands work as shown.
 *
 * What the commands carry is the typed name made safe for them
 * (toResourceName); when that differs from what was typed, the field says
 * so. A name the project already has is not refused - reinstalling an
 * agent is one reason to type it - but the field says the data goes there.
 */

export interface ExistingResource {
  id: ObjectID;
  name: string;
}

export interface ComponentProps {
  // English: "Cluster name".
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  // What the commands carry.
  resolvedName: string;
  // The project's resource of that name, when it has one.
  existing?: ExistingResource | undefined;
  viewPage: PageMap;
  // English: "View cluster".
  viewText: string;
}

const ResourceNameField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const inputId: string = `resource-name-${useId()}`;
  const hintId: string = `${inputId}-hint`;

  const typed: string = props.value.trim();
  const isReportedAsSomethingElse: boolean =
    typed.length > 0 && props.resolvedName !== typed;

  return (
    <div className="mb-6" data-testid="resource-name-field">
      <label
        htmlFor={inputId}
        className="mb-2 block text-xs font-medium uppercase tracking-wider text-gray-500"
      >
        {translator.translateText(props.label)}
      </label>
      <div className="max-w-md">
        <Input
          id={inputId}
          value={props.value}
          onChange={props.onChange}
          placeholder={props.placeholder}
          ariaDescribedby={hintId}
          dataTestId="resource-name-input"
          disableSpellCheck={true}
          autoComplete="off"
          outerDivClassName="relative w-full rounded-md shadow-sm"
        />
      </div>
      <div id={hintId} className="mt-1.5 space-y-1 text-sm text-gray-500">
        <p>{translator.translateText(RESOURCE_NAME_FIELD_HINT)}</p>
        {isReportedAsSomethingElse && (
          <p data-testid="resource-name-reported-as">
            <TranslatedSentence
              template={RESOURCE_NAME_REPORTED_AS}
              slots={{
                name: (
                  <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-800">
                    {props.resolvedName}
                  </code>
                ),
              }}
            />
          </p>
        )}
      </div>
      {props.existing && (
        <div
          className="mt-2 max-w-xl rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
          role="status"
          data-testid="resource-name-taken"
        >
          <TranslatedSentence
            template={RESOURCE_NAME_TAKEN}
            slots={{
              name: (
                <span className="font-semibold">{props.existing.name}</span>
              ),
              link: (
                <AppLink
                  to={RouteUtil.populateRouteParams(
                    RouteMap[props.viewPage] as Route,
                    { modelId: props.existing.id },
                  )}
                  className="font-medium text-amber-900 underline"
                >
                  {translator.translateText(props.viewText) || props.viewText}
                </AppLink>
              ),
            }}
          />
        </div>
      )}
    </div>
  );
};

export default ResourceNameField;
