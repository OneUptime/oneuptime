import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
import Select from "Common/Types/BaseDatabase/Select";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { SetupGuideStepView } from "../SetupGuide/SetupGuideSteps";
import PageMap from "../../Utils/PageMap";
import {
  RESOURCE_CONNECTION_STEP_DESCRIPTION,
  RESOURCE_CONNECTION_STEP_TITLE,
  getSuggestedResourceName,
  isSameResourceName,
  toResourceName,
} from "./ResourceOnboarding";
import ResourceNameField, { ExistingResource } from "./ResourceNameField";
import ResourceConnectionWatch, {
  ExistingRecordSnapshot,
} from "./ResourceConnectionWatch";

/*
 * A resource's Add guide: its setup guide, with the name the agent is told
 * above the steps (where the agent is told one) and a live last step that
 * waits for the resource to connect. The list's Add dialog shows it
 * (AddResourceModal), and so does an empty list, as its first-run card.
 *
 * Each resource says what it is in a ResourceOnboarding: its words, the
 * column its name lands in, and how to draw its guide with the name, the
 * field and the last step handed to it.
 */

// What a resource's guide is drawn with.
export interface ResourceGuideProps {
  title: string;
  description: string;
  // Only the guide, in a dialog that has its own title.
  isBare?: boolean | undefined;
  /*
   * The name every command carries: the resource being added, as the
   * guide's own Documentation tab gets it. Undefined where the guide names
   * nothing (functions and environments name themselves).
   */
  name?: string | undefined;
  // Above the steps: the name field.
  inputs?: ReactNode | undefined;
  // After the guide's own steps: waiting for the resource.
  lastStep: SetupGuideStepView;
}

export interface ResourceOnboardingName {
  // English: "Cluster name".
  label: string;
  // The column the agent's name lands in ("clusterIdentifier", "name").
  field: string;
  // The name the guide starts with, numbered when the project has it.
  example: string;
}

export interface ResourceOnboarding {
  modelType: { new (): BaseModel };
  /*
   * English translation keys. `addTitle` is the list's button and the
   * dialog's title, "Add Kubernetes Cluster"; `addDescription` is under
   * the dialog's title; `firstRunTitle` titles the empty list's card, "Add
   * your first cluster"; `viewText` links to the one that connected.
   */
  addTitle: string;
  addDescription: string;
  firstRunTitle: string;
  viewText: string;
  viewPage: PageMap;
  // Where the agent is told the resource's name.
  name?: ResourceOnboardingName | undefined;
  // What every record of the list has too (a cloud environment's kind).
  query?: Query<BaseModel> | undefined;
  renderGuide: (props: ResourceGuideProps) => ReactElement;
}

export interface ComponentProps {
  onboarding: ResourceOnboarding;
  // The dialog's title and description by default.
  title?: string | undefined;
  description?: string | undefined;
  isBare?: boolean | undefined;
  onConnected?: ((record: BaseModel) => void) | undefined;
}

/*
 * How long typing rests before the guide looks up whether the project has
 * a resource of that name already.
 */
export const RESOURCE_NAME_LOOKUP_DELAY_MS: number = 400;

interface ExistingLookup {
  resource: ExistingResource;
  // Only for one that was not reporting: the watch waits for it to report.
  snapshot?: ExistingRecordSnapshot | undefined;
}

const getColumnText: (
  record: BaseModel,
  field: string,
) => string | undefined = (
  record: BaseModel,
  field: string,
): string | undefined => {
  const value: unknown = record.getColumnValue(field);
  return typeof value === "string" ? value : undefined;
};

const toDate: (value: unknown) => Date | null = (
  value: unknown,
): Date | null => {
  if (!value) {
    return null;
  }
  const date: Date = new Date(value as string | Date);
  return Number.isFinite(date.getTime()) ? date : null;
};

const AddResourceGuide: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const onboarding: ResourceOnboarding = props.onboarding;
  const nameConfig: ResourceOnboardingName | undefined = onboarding.name;

  // Resources that register from now on are the ones this guide added.
  const since: Date = useMemo(() => {
    return new Date();
  }, []);

  const [typed, setTyped] = useState<string>(nameConfig?.example || "");
  const [suggestion, setSuggestion] = useState<string>(
    nameConfig?.example || "",
  );
  const [existing, setExisting] = useState<ExistingLookup | null>(null);
  // Once something is typed, the suggestion no longer replaces it.
  const hasTypedRef: MutableRefObject<boolean> = useRef<boolean>(false);

  // A name the project has not used yet, for the guide to start with.
  useEffect(() => {
    if (!nameConfig) {
      return;
    }

    let isMounted: boolean = true;

    ModelAPI.getList<BaseModel>({
      modelType: onboarding.modelType,
      query: {
        ...(onboarding.query || {}),
        [nameConfig.field]: new Search(nameConfig.example),
      } as Query<BaseModel>,
      select: {
        _id: true,
        [nameConfig.field]: true,
      } as Select<BaseModel>,
      sort: {},
      limit: 50,
      skip: 0,
    })
      .then((result: ListResult<BaseModel>) => {
        if (!isMounted) {
          return;
        }

        const next: string = getSuggestedResourceName({
          example: nameConfig.example,
          existingNames: result.data.map(
            (record: BaseModel): string | undefined => {
              return getColumnText(record, nameConfig.field);
            },
          ),
        });

        setSuggestion(next);
        if (!hasTypedRef.current) {
          setTyped(next);
        }
      })
      .catch(() => {
        // The example stays: the field below still says if it is taken.
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const resolvedName: string | undefined = nameConfig
    ? toResourceName(typed) || suggestion
    : undefined;

  // Whether the project already has a resource of that name.
  useEffect(() => {
    if (!nameConfig || !resolvedName) {
      setExisting(null);
      return;
    }

    let isMounted: boolean = true;

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      ModelAPI.getList<BaseModel>({
        modelType: onboarding.modelType,
        query: {
          ...(onboarding.query || {}),
          [nameConfig.field]: new Search(resolvedName),
        } as Query<BaseModel>,
        select: {
          _id: true,
          name: true,
          [nameConfig.field]: true,
          lastSeenAt: true,
          otelCollectorStatus: true,
        } as Select<BaseModel>,
        sort: {},
        limit: 10,
        skip: 0,
      })
        .then((result: ListResult<BaseModel>) => {
          if (!isMounted) {
            return;
          }

          const match: BaseModel | undefined = result.data.find(
            (record: BaseModel): boolean => {
              return isSameResourceName(
                getColumnText(record, nameConfig.field),
                resolvedName,
              );
            },
          );

          if (!match) {
            setExisting(null);
            return;
          }

          const id: ObjectID = new ObjectID(match._id as string);
          const isReporting: boolean =
            getColumnText(match, "otelCollectorStatus") === "connected";

          setExisting({
            resource: {
              id: id,
              name: getColumnText(match, "name") || resolvedName,
            },
            snapshot: isReporting
              ? undefined
              : {
                  id: id,
                  lastSeenAt: toDate(match.getColumnValue("lastSeenAt")),
                },
          });
        })
        .catch(() => {
          if (isMounted) {
            setExisting(null);
          }
        });
    }, RESOURCE_NAME_LOOKUP_DELAY_MS);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [resolvedName]);

  const inputs: ReactNode = nameConfig ? (
    <ResourceNameField
      label={nameConfig.label}
      value={typed}
      onChange={(value: string) => {
        hasTypedRef.current = true;
        setTyped(value);
      }}
      placeholder={suggestion}
      resolvedName={resolvedName || ""}
      existing={existing?.resource}
      viewPage={onboarding.viewPage}
      viewText={onboarding.viewText}
    />
  ) : undefined;

  const lastStep: SetupGuideStepView = {
    title:
      translator.translateText(RESOURCE_CONNECTION_STEP_TITLE) ||
      RESOURCE_CONNECTION_STEP_TITLE,
    description:
      translator.translateText(RESOURCE_CONNECTION_STEP_DESCRIPTION) ||
      RESOURCE_CONNECTION_STEP_DESCRIPTION,
    content: (
      <ResourceConnectionWatch
        modelType={onboarding.modelType}
        since={since}
        name={resolvedName}
        nameField={nameConfig?.field}
        query={onboarding.query}
        existing={existing?.snapshot}
        viewPage={onboarding.viewPage}
        viewText={onboarding.viewText}
        onConnected={props.onConnected}
      />
    ),
  };

  return onboarding.renderGuide({
    title: props.title || onboarding.addTitle,
    description: props.description || onboarding.addDescription,
    isBare: props.isBare,
    name: resolvedName,
    inputs: inputs,
    lastStep: lastStep,
  });
};

export default AddResourceGuide;
