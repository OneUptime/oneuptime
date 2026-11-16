import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SetupHealthApi from "./SetupHealthApi";
import {
  DISMISS_CLASS_NAME,
  FindingFix,
  FindingIcon,
  FindingSentence,
  SetupHealthDismissModal,
} from "./SetupHealthFindingParts";
import {
  LEVEL_LOOK,
  RECORD_LINE_LOOK,
  getSetupHealthFindingIcon,
} from "./SetupHealthLook";
import SetupHealthQuickFixButton from "./SetupHealthQuickFixButton";
import { SETUP_HEALTH_WORDS_PAGE } from "./SetupHealthWords";
import RecommendationDismissal from "Common/Models/DatabaseModels/RecommendationDismissal";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import {
  SetupHealthCheck,
  SetupHealthFinding,
  SetupHealthRecordKind,
} from "Common/Types/SetupHealth/SetupHealth";
import Link from "Common/UI/Components/Link/Link";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * A RECORD'S OWN FINDINGS, AT THE TOP OF ITS PAGE (#7297): someone who
 * opens an on-call policy that nothing runs learns it there, not only on
 * Setup Health. Each finding is the page's own row - the same sentence, the
 * same fix, Dismiss - drawn by SetupHealthFindingParts, so the line and the
 * page never say a finding two ways; and the server hands only the
 * findings the person may see, never a dismissed one
 * (SetupHealthService.getForRecord).
 *
 * A page says each thing once: a check its own cards already say is
 * handed in as saidByThisPage and left out - an on-call policy's summary
 * says it has no escalation rules or reaches nobody, a status page's first
 * step that it shows no monitor. Nothing is drawn while the findings are
 * read, when they could not be, or when there are none.
 */

export interface ComponentProps {
  recordKind: SetupHealthRecordKind;
  recordId: ObjectID;
  saidByThisPage?: ReadonlyArray<SetupHealthCheck> | undefined;
}

// Where the line leads for the rest: the page, opened from a record.
export function getSetupHealthPageRoute(): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.HOME_SETUP_HEALTH] as Route,
  ).addQueryParams({ from: "record" });
}

// The findings the line says: the record's, but the ones its page says itself.
export function getRecordLineFindings(
  findings: ReadonlyArray<SetupHealthFinding>,
  saidByThisPage?: ReadonlyArray<SetupHealthCheck> | undefined,
): Array<SetupHealthFinding> {
  return findings.filter((finding: SetupHealthFinding): boolean => {
    return !(saidByThisPage || []).includes(finding.check);
  });
}

const SetupHealthRecordFindings: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [findings, setFindings] = useState<Array<SetupHealthFinding>>([]);
  const [dismissTarget, setDismissTarget] = useState<SetupHealthFinding | null>(
    null,
  );
  const requestRef: React.MutableRefObject<number> = useRef<number>(0);
  const recordId: string = props.recordId.toString();

  // As the dismissals' table allows; not offered while permissions load.
  const canDismiss: boolean = PermissionGate.check(
    new RecommendationDismissal(),
    ModelAction.Create,
  ).isAllowed;

  /*
   * The record's findings; worked out again (`refresh`) after a fix made
   * here, so the one fixed is gone rather than read from the minute-old
   * answer. A dismissal needs no refresh: the dismissals are read on every
   * ask.
   */
  const load: (refresh: boolean) => Promise<void> = useCallback(
    async (refresh: boolean): Promise<void> => {
      const request: number = ++requestRef.current;

      try {
        const read: Array<SetupHealthFinding> =
          await SetupHealthApi.getRecordFindings(
            { kind: props.recordKind, id: recordId },
            { refresh: refresh },
          );

        if (request === requestRef.current) {
          setFindings(read);
        }
      } catch {
        // A line that could not be read says nothing: the page is the record's.
        if (request === requestRef.current) {
          setFindings([]);
        }
      }
    },
    [props.recordKind, recordId],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const shown: Array<SetupHealthFinding> = getRecordLineFindings(
    findings,
    props.saidByThisPage,
  );

  if (shown.length === 0) {
    return <></>;
  }

  return (
    <section
      className="mb-6 space-y-3"
      aria-label={translator.translateText("Setup Health")}
      data-testid="setup-health-record"
    >
      {shown.map((finding: SetupHealthFinding): ReactElement => {
        return (
          <div
            key={finding.key}
            className={`flex items-start gap-3 rounded-xl border px-5 py-4 md:px-6 ${RECORD_LINE_LOOK[finding.level]}`}
            data-testid="setup-health-record-finding"
            data-check={finding.check}
            data-level={finding.level}
          >
            <FindingIcon
              icon={getSetupHealthFindingIcon(finding)}
              colors={LEVEL_LOOK[finding.level].iconBox}
            />
            {/* The first line of words level with the middle of the icon. */}
            <div className="min-w-0 flex-1 pt-1">
              <p
                className="text-sm leading-6 text-gray-800"
                data-testid="setup-health-sentence"
              >
                <FindingSentence finding={finding} />
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <SetupHealthQuickFixButton
                  finding={finding}
                  onApplied={() => {
                    void load(true);
                  }}
                />
                <FindingFix finding={finding} />
                {canDismiss ? (
                  <button
                    type="button"
                    className={DISMISS_CLASS_NAME}
                    data-testid="setup-health-dismiss"
                    onClick={() => {
                      setDismissTarget(finding);
                    }}
                  >
                    {translator.translateText(SETUP_HEALTH_WORDS_PAGE.dismiss)}
                  </button>
                ) : (
                  <></>
                )}
                <Link
                  to={getSetupHealthPageRoute()}
                  className="ms-auto rounded text-sm text-gray-500 hover:text-gray-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  dataTestId="setup-health-record-page-link"
                >
                  {translator.translateText("Setup Health")}
                </Link>
              </div>
            </div>
          </div>
        );
      })}

      {dismissTarget ? (
        <SetupHealthDismissModal
          finding={dismissTarget}
          onClose={() => {
            setDismissTarget(null);
          }}
          onDismissed={() => {
            setDismissTarget(null);
            void load(false);
          }}
        />
      ) : (
        <></>
      )}
    </section>
  );
};

export default SetupHealthRecordFindings;
