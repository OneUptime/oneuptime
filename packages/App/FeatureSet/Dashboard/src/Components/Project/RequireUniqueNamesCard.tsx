import RequireUniqueNamesCopy, {
  DUPLICATE_NAMES_TEST_ID,
  REQUIRE_UNIQUE_NAMES_COLUMN,
  REQUIRE_UNIQUE_NAMES_SWITCH_TEST_ID,
  UNIQUE_NAMES_CARD_ID,
} from "./RequireUniqueNamesCopy";
import { getRecordPageRoute } from "../UniqueNames/RecordPages";
import Project from "Common/Models/DatabaseModels/Project";
import Route from "Common/Types/API/Route";
import {
  DuplicateNameGroup,
  DuplicateNameRecord,
  DuplicateNamesAnswer,
  DuplicateNamesOfKind,
  getDuplicateNameCount,
} from "Common/Types/Database/RequiredUniqueNames";
import { SHARED_NAME_CREATED_DETAIL } from "Common/Types/Database/SharedNameMarks";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import ErrorSentence from "Common/UI/Components/ErrorMessage/ErrorSentence";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import API from "Common/UI/Utils/API/API";
import { writeReaderDay } from "Common/UI/Utils/ReaderMoments";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import UniqueNamesApi from "Common/UI/Utils/UniqueNamesApi";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useState,
} from "react";

/*
 * REQUIRE UNIQUE NAMES, ON PROJECT SETTINGS > PROJECT (#10761).
 *
 * One switch that saves when flipped: while it is on, two monitors,
 * templates or other records of one kind cannot share a name in the
 * project, over the Dashboard, the API and Terraform alike. Under it, the
 * names the project already holds more than once - kind by kind, each
 * record linked to its page for renaming, with the day it was made to tell
 * twins apart - or one calm line that none repeat. Turning it on refuses
 * nothing that exists: the list says so, and the twins keep working until
 * someone renames them.
 */

export interface ComponentProps {
  projectId: ObjectID;
}

const RequireUniqueNamesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelSwitchCard<Project>
      modelType={Project}
      modelId={props.projectId}
      column={REQUIRE_UNIQUE_NAMES_COLUMN}
      cardId={UNIQUE_NAMES_CARD_ID}
      cardTitle={RequireUniqueNamesCopy.cardTitle}
      cardDescription={RequireUniqueNamesCopy.cardDescription}
      title={RequireUniqueNamesCopy.switchTitle}
      getDescription={(isOn: boolean): string => {
        return isOn
          ? RequireUniqueNamesCopy.switchOnDescription
          : RequireUniqueNamesCopy.switchOffDescription;
      }}
      getDetails={(_item: Project, isOn: boolean): ReactNode => {
        return <DuplicateNamesList isRequired={isOn} />;
      }}
      dataTestId={REQUIRE_UNIQUE_NAMES_SWITCH_TEST_ID}
    />
  );
};

export const DuplicateNamesList: FunctionComponent<{
  isRequired: boolean;
}> = (props: { isRequired: boolean }): ReactElement => {
  const translator: Translator = useTranslator();
  const [answer, setAnswer] = useState<DuplicateNamesAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent: boolean = true;

    UniqueNamesApi.readDuplicates()
      .then((read: DuplicateNamesAnswer): void => {
        if (isCurrent) {
          setAnswer(read);
          setError(null);
        }
      })
      .catch((err: unknown): void => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  if (error) {
    return (
      <p
        className="text-sm text-gray-600"
        data-testid={`${DUPLICATE_NAMES_TEST_ID}-error`}
      >
        <ErrorSentence
          template={RequireUniqueNamesCopy.loadFailed}
          error={error}
        />
      </p>
    );
  }

  if (!answer) {
    return <DetailListSkeleton fields={2} columns={1} />;
  }

  const count: number = getDuplicateNameCount(answer);

  if (count === 0) {
    return (
      <div
        className="flex items-start gap-2 text-sm text-gray-600"
        data-testid={`${DUPLICATE_NAMES_TEST_ID}-none`}
      >
        <Icon
          icon={IconProp.CheckCircle}
          className="mt-0.5 h-4 w-4 flex-none text-emerald-600"
        />
        <p>{translator.translateText(RequireUniqueNamesCopy.noneRepeat)}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid={DUPLICATE_NAMES_TEST_ID}>
      <div className="flex items-start gap-2 text-sm text-amber-800">
        <Icon
          icon={IconProp.Alert}
          className="mt-0.5 h-4 w-4 flex-none text-amber-600"
        />
        <p data-testid={`${DUPLICATE_NAMES_TEST_ID}-summary`}>
          {translator.translatePlural(
            RequireUniqueNamesCopy.repeatCount,
            count,
          )}{" "}
          {translator.translateText(
            props.isRequired
              ? RequireUniqueNamesCopy.repeatKeptWhileOn
              : RequireUniqueNamesCopy.repeatKeptWhenTurnedOn,
          )}
        </p>
      </div>

      {answer.kinds.map((kind: DuplicateNamesOfKind): ReactElement => {
        return <DuplicateNamesOfKindSection key={kind.tableName} kind={kind} />;
      })}
    </div>
  );
};

const DuplicateNamesOfKindSection: FunctionComponent<{
  kind: DuplicateNamesOfKind;
}> = (props: { kind: DuplicateNamesOfKind }): ReactElement => {
  const translator: Translator = useTranslator();
  // The kind's name in the plural, in the reader's words: "Monitors".
  const pluralName: string =
    translator.translateText(props.kind.pluralName) || props.kind.pluralName;
  const moreNames: number = props.kind.groupCount - props.kind.groups.length;

  return (
    <section
      aria-label={pluralName}
      data-testid={`${DUPLICATE_NAMES_TEST_ID}-${props.kind.tableName}`}
    >
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {pluralName}
      </h4>
      <ul className="mt-1 divide-y divide-gray-100">
        {props.kind.groups.map(
          (group: DuplicateNameGroup, index: number): ReactElement => {
            return (
              <DuplicateNameRow
                key={`${props.kind.tableName}-${index}`}
                tableName={props.kind.tableName}
                group={group}
              />
            );
          },
        )}
      </ul>
      {moreNames > 0 ? (
        <p className="mt-1 text-xs text-gray-500">
          {translator.translatePlural(
            RequireUniqueNamesCopy.moreNames,
            moreNames,
          )}
        </p>
      ) : (
        <></>
      )}
    </section>
  );
};

const DuplicateNameRow: FunctionComponent<{
  tableName: string;
  group: DuplicateNameGroup;
}> = (props: {
  tableName: string;
  group: DuplicateNameGroup;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const hidden: number = props.group.count - props.group.records.length;

  return (
    <li className="py-2" data-testid={`${DUPLICATE_NAMES_TEST_ID}-group`}>
      <ul className="flex flex-col gap-1">
        {props.group.records.map(
          (record: DuplicateNameRecord): ReactElement => {
            return (
              <DuplicateNameRecordLine
                key={record.id}
                tableName={props.tableName}
                record={record}
              />
            );
          },
        )}
      </ul>
      {hidden > 0 ? (
        <p className="mt-1 text-xs text-gray-500">
          {translator.translatePlural(
            RequireUniqueNamesCopy.hiddenRecords,
            hidden,
          )}
        </p>
      ) : (
        <></>
      )}
    </li>
  );
};

const DuplicateNameRecordLine: FunctionComponent<{
  tableName: string;
  record: DuplicateNameRecord;
}> = (props: {
  tableName: string;
  record: DuplicateNameRecord;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const route: Route | null = getRecordPageRoute({
    tableName: props.tableName,
    modelId: new ObjectID(props.record.id),
  });
  const createdAt: Date | null = props.record.createdAt
    ? OneUptimeDate.fromString(props.record.createdAt)
    : null;

  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {route ? (
        <Link
          to={route}
          openInNewTab={true}
          className="inline-flex items-center gap-1 font-medium text-indigo-700 hover:text-indigo-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          dataTestId={`${DUPLICATE_NAMES_TEST_ID}-record-link`}
        >
          <bdi>{props.record.name}</bdi>
          <Icon icon={IconProp.ExternalLink} className="h-3 w-3 shrink-0" />
        </Link>
      ) : (
        <span className="font-medium text-gray-900">
          <bdi>{props.record.name}</bdi>
        </span>
      )}
      {createdAt && !isNaN(createdAt.getTime()) ? (
        <span className="text-xs text-gray-500">
          {translator.translateTemplate(SHARED_NAME_CREATED_DETAIL, {
            date: writeReaderDay(createdAt),
          })}
        </span>
      ) : (
        <></>
      )}
      {props.record.isArchived ? (
        <Pill text="Archived" tone={PillTone.Paused} />
      ) : (
        <></>
      )}
    </li>
  );
};

export default RequireUniqueNamesCard;
