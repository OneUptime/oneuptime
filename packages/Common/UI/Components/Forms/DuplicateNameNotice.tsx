import Icon from "../Icon/Icon";
import Link from "../Link/Link";
import RecordPageContext, {
  GetRecordPageRoute,
} from "../RecordPage/RecordPageContext";
import TranslatedSentence from "../TranslatedSentence/TranslatedSentence";
import UniqueNamesApi from "../../Utils/UniqueNamesApi";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import Route from "../../../Types/API/Route";
import { UniqueNameCheckAnswer } from "../../../Types/Database/RequiredUniqueNames";
import { getNameKey, normalizeName } from "../../../Types/Database/UniqueName";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import { translatableTerm, translationKey } from "../../../Types/Translator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * ANOTHER RECORD OF THIS KIND IS ALREADY CALLED THIS (#10761).
 *
 * Drawn under a form's name field as it takes a name - creating a record,
 * or renaming one - while another record of its kind in the project has
 * that name, case and spacing aside: "Another monitor is already called API
 * Health Check.", the other record's name a link to it, opened in a new tab
 * so the form keeps what was typed. It never blocks: the server decides.
 * Where saving would be refused - the project requires unique names, or
 * the kind holds its names unique always - it says so in a second sentence,
 * and the server's refusal, should the form be sent anyway, replaces it
 * under the field.
 *
 * The name is asked about a moment after typing stops (CHECK_DELAY_IN_MS),
 * once; an answer for a name typed over since is dropped, and so is a
 * failure: the warning only helps. A record edited with its own name again
 * - perhaps in another case - is no rename, and nothing is asked.
 *
 * ModelForm draws it for every kind with a name of its own in a project
 * (Types/Database/ProjectNameRule), so no form writes a line for it.
 */

// How long after the last keystroke the name is asked about.
export const DUPLICATE_NAME_CHECK_DELAY_IN_MS: number = 400;

// The record that has the name, named and linked.
export const DUPLICATE_NAME_TAKEN: string = translationKey(
  "Another {{kind}} is already called {{name}}.",
);

// The same, when only an archived record has it.
export const DUPLICATE_NAME_TAKEN_BY_ARCHIVED: string = translationKey(
  "An archived {{kind}} is already called {{name}}.",
);

// A record the reader may not read has it: said only where saving would be refused.
export const DUPLICATE_NAME_TAKEN_BY_UNREADABLE: string = translationKey(
  "Another {{kind}} already has this name.",
);

// Saving it would be refused.
export const DUPLICATE_NAME_REFUSED: string = translationKey(
  "Pick another name: names are unique in this project.",
);

// Saving it would be refused, and the record that has it is archived.
export const DUPLICATE_NAME_REFUSED_BY_ARCHIVED: string = translationKey(
  "Unarchive it, or pick another name: names are unique in this project.",
);

export const DUPLICATE_NAME_NOTICE_TEST_ID: string = "duplicate-name-notice";

// What the warning says, from the server's answer: null when the name is free.
export interface DuplicateNameNoticeWords {
  // The first sentence, with {{kind}} and {{name}}.
  taken: string;
  // The second, where saving would be refused.
  refused: string | null;
}

export const getDuplicateNameNoticeWords: (
  answer: UniqueNameCheckAnswer | null,
) => DuplicateNameNoticeWords | null = (
  answer: UniqueNameCheckAnswer | null,
): DuplicateNameNoticeWords | null => {
  if (!answer) {
    return null;
  }

  if (answer.takenBy) {
    const isArchived: boolean = answer.takenBy.isArchived;

    return {
      taken: isArchived
        ? DUPLICATE_NAME_TAKEN_BY_ARCHIVED
        : DUPLICATE_NAME_TAKEN,
      refused: answer.isRequired
        ? isArchived
          ? DUPLICATE_NAME_REFUSED_BY_ARCHIVED
          : DUPLICATE_NAME_REFUSED
        : null,
    };
  }

  if (answer.isTakenByUnreadable && answer.isRequired) {
    return {
      taken: DUPLICATE_NAME_TAKEN_BY_UNREADABLE,
      refused: DUPLICATE_NAME_REFUSED,
    };
  }

  return null;
};

export interface ComponentProps {
  // The kind, by its table and its singular name: "Monitor".
  tableName: string;
  singularName: string;
  // The name the form holds now.
  name: unknown;
  // The record's own name, on an edit: kept, it is no rename.
  originalName?: unknown;
  // The record the form edits.
  exceptId?: ObjectID | null | undefined;
  // The field shows an error of its own - the server's refusal, say.
  hasFieldError?: boolean | undefined;
  // How long after typing stops the name is asked about.
  checkDelayInMs?: number | undefined;
}

interface CheckedName {
  name: string;
  answer: UniqueNameCheckAnswer;
}

const DuplicateNameNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();
  const getRecordPageRoute: GetRecordPageRoute | null =
    useContext(RecordPageContext);
  const [checked, setChecked] = useState<CheckedName | null>(null);

  // Bumped by every question: an answer to one asked before is dropped.
  const questionRef: MutableRefObject<number> = useRef<number>(0);

  const name: string = normalizeName(props.name);
  const nameKey: string = getNameKey(name);
  const isOwnName: boolean =
    props.originalName !== undefined &&
    nameKey === getNameKey(props.originalName);

  useEffect(() => {
    const question: number = questionRef.current + 1;
    questionRef.current = question;

    if (!nameKey || isOwnName) {
      setChecked(null);
      return;
    }

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      UniqueNamesApi.check({
        tableName: props.tableName,
        name: name,
        exceptId: props.exceptId || null,
      })
        .then((answer: UniqueNameCheckAnswer): void => {
          if (question === questionRef.current) {
            setChecked({ name: name, answer: answer });
          }
        })
        .catch((): void => {
          // The warning only helps: without it the form works as ever.
          if (question === questionRef.current) {
            setChecked(null);
          }
        });
    }, props.checkDelayInMs ?? DUPLICATE_NAME_CHECK_DELAY_IN_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [nameKey, isOwnName, props.tableName, props.exceptId?.toString()]);

  if (
    props.hasFieldError ||
    !checked ||
    isOwnName ||
    getNameKey(checked.name) !== nameKey
  ) {
    return null;
  }

  const words: DuplicateNameNoticeWords | null = getDuplicateNameNoticeWords(
    checked.answer,
  );

  if (!words) {
    return null;
  }

  const holderRoute: Route | null =
    checked.answer.takenBy && getRecordPageRoute
      ? getRecordPageRoute({
          tableName: props.tableName,
          modelId: new ObjectID(checked.answer.takenBy.id),
        })
      : null;

  const holderName: string = checked.answer.takenBy?.name || name;

  const nameElement: ReactNode = holderRoute ? (
    <Link
      to={holderRoute}
      openInNewTab={true}
      className="inline-flex items-baseline gap-0.5 font-semibold text-amber-900 underline decoration-amber-400 underline-offset-2 hover:decoration-amber-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
      dataTestId="duplicate-name-notice-link"
    >
      <bdi>{holderName}</bdi>
      <Icon
        icon={IconProp.ExternalLink}
        className="h-3 w-3 shrink-0 self-center"
      />
    </Link>
  ) : (
    <strong className="font-semibold text-amber-900">
      <bdi>{holderName}</bdi>
    </strong>
  );

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={DUPLICATE_NAME_NOTICE_TEST_ID}
      className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-5 text-amber-800"
    >
      <div aria-hidden="true" className="mt-0.5 shrink-0 text-amber-600">
        <Icon icon={IconProp.Alert} className="h-4 w-4" />
      </div>
      {/*
       * A div, not a p: the link's icon is drawn in a div (Icon), which a
       * paragraph cannot hold.
       */}
      <div className="min-w-0 [overflow-wrap:anywhere]">
        <TranslatedSentence
          template={words.taken}
          slots={
            words.taken === DUPLICATE_NAME_TAKEN_BY_UNREADABLE
              ? {}
              : { name: nameElement }
          }
          values={{
            kind: translatableTerm(props.singularName, { inSentence: true }),
          }}
        />
        {words.refused ? (
          <>
            {" "}
            <span data-testid="duplicate-name-notice-refused">
              {translator.translateText(words.refused) || words.refused}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default DuplicateNameNotice;
