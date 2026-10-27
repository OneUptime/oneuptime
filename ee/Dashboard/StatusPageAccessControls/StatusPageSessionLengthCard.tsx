import EnterpriseSettingLicenseNotice from "../EnterpriseSettings/EnterpriseSettingLicenseNotice";
import {
  EnterpriseLicenseMode,
  LicensedFeature,
} from "../Identity/License/EnterpriseLicenseMode";
import useEnterpriseLicenseMode from "../Identity/License/UseEnterpriseLicenseMode";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { Yellow } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import {
  PRIVATE_USER_SESSION_LENGTH_COLUMN,
  readPrivateUserSessionLength,
} from "Common/Types/StatusPage/PrivateUserSessionLength";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { getPlanNeededToChangeColumn } from "Common/UI/Components/ModelSwitch/ModelSwitchUtil";
import Pill from "Common/UI/Components/Pill/Pill";
import SaveStatus from "Common/UI/Components/SaveStatus/SaveStatus";
import useSaveOnChange, {
  SaveOnChange,
} from "Common/UI/Components/SaveStatus/useSaveOnChange";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import StatusPageSessionLengthCopy, {
  fromSessionLengthChoiceValue,
  getSessionLengthChoices,
  getSessionLengthDescription,
  SessionLengthChoice,
  STATUS_PAGE_SESSION_LENGTH_CARD_TEST_ID,
  STATUS_PAGE_SESSION_LENGTH_SETTING_TEST_ID,
  toSessionLengthChoiceValue,
} from "@oneuptime/dashboard/Components/StatusPage/StatusPageSessionLengthCopy";

/*
 * The Reader Sessions card on Security -> Access: "Sign readers out after", one
 * pick that saves the moment it is made (see StatusPageSessionLengthCopy).
 *
 * - "Saving…" and then "Saved" show beside it; a pick the server refuses
 *   goes back to what the page has, with the reason under it.
 * - The sentence under it says what the pick means for readers: with No
 *   limit, that a reader stays signed in while they come back at least once
 *   every 30 days; with a length, that everyone signs in again that often.
 * - Someone who may not change the setting sees it locked, with the
 *   permission that is missing. Where the plan has to be upgraded to set a
 *   length, the plan's name is beside it before anyone tries; No limit can
 *   always be picked.
 */

export interface ComponentProps {
  statusPageId: ObjectID;
  /*
   * Told the length readers stay signed in - once read and after each save
   * - so the Access page's folded More settings can say so.
   */
  onLengthChange?: ((lengthInHours: number | null) => void) | undefined;
}

interface SettingProps {
  statusPageId: ObjectID;
  initialLengthInHours: number | null;
  onSaved?: ((lengthInHours: number | null) => void) | undefined;
}

const SessionLengthSetting: FunctionComponent<SettingProps> = (
  props: SettingProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const labelId: string = `session-length-label-${useId()}`;

  const setting: SaveOnChange<number | null> = useSaveOnChange<number | null>({
    initialValue: props.initialLengthInHours,
    save: async (lengthInHours: number | null): Promise<void> => {
      await ModelAPI.updateById<StatusPage>({
        modelType: StatusPage,
        id: props.statusPageId,
        data: {
          [PRIVATE_USER_SESSION_LENGTH_COLUMN]: lengthInHours,
        },
      });
    },
    onSaved: (lengthInHours: number | null): void => {
      props.onSaved?.(lengthInHours);
    },
  });

  /*
   * Read on every render: the permissions arrive after the first paint of a
   * fresh sign-in, and a gate kept from then would leave the dropdown locked
   * for someone who may change it.
   */
  const statusPage: StatusPage = useMemo((): StatusPage => {
    return new StatusPage();
  }, []);

  const updateGate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    statusPage,
    PRIVATE_USER_SESSION_LENGTH_COLUMN,
  );

  const planNeeded: PlanType | null = getPlanNeededToChangeColumn(
    statusPage,
    PRIVATE_USER_SESSION_LENGTH_COLUMN,
  );

  // Built from the saved value, so a length set elsewhere stays offered.
  const options: Array<DropdownOption> = useMemo((): Array<DropdownOption> => {
    return getSessionLengthChoices(setting.savedValue).map(
      (choice: SessionLengthChoice): DropdownOption => {
        return {
          value: choice.value,
          label: choice.labelValues
            ? translator.translateTemplate(choice.label, choice.labelValues)
            : choice.label,
        };
      },
    );
  }, [setting.savedValue, translator]);

  const selectedValue: number = toSessionLengthChoiceValue(setting.value);

  const selectedOption: DropdownOption | undefined = options.find(
    (option: DropdownOption): boolean => {
      return option.value === selectedValue;
    },
  );

  const dropdown: ReactElement = (
    <div
      className="w-40"
      data-testid={STATUS_PAGE_SESSION_LENGTH_SETTING_TEST_ID}
    >
      <Dropdown
        options={options}
        value={selectedOption}
        ariaLabelledby={labelId}
        isClearable={false}
        disabled={!updateGate.isAllowed}
        className="relative w-full overflow-visible rounded-md"
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
          if (typeof value !== "number" || !updateGate.isAllowed) {
            return;
          }

          setting.change(fromSessionLengthChoiceValue(value));
        }}
      />
    </div>
  );

  return (
    <div data-testid={`${STATUS_PAGE_SESSION_LENGTH_SETTING_TEST_ID}-row`}>
      {/*
       * As on a switch's row: the plan's pill sits to the right from sm up,
       * and under the pick on a phone.
       */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
          <span id={labelId} className="text-sm font-medium text-gray-900">
            {translator.translateText(StatusPageSessionLengthCopy.label)}
          </span>
          {updateGate.isAllowed ? (
            dropdown
          ) : (
            <Tooltip text={updateGate.disabledReason}>{dropdown}</Tooltip>
          )}
          <SaveStatus
            state={setting.saveState}
            dataTestId={`${STATUS_PAGE_SESSION_LENGTH_SETTING_TEST_ID}-status`}
          />
        </div>
        {planNeeded ? (
          <div className="flex-shrink-0">
            <Pill
              text={translator.translateTemplate("{{planName}} Plan", {
                planName: planNeeded,
              })}
              color={Yellow}
            />
          </div>
        ) : (
          <></>
        )}
      </div>
      <p
        className="mt-1 text-sm text-gray-500"
        data-testid={`${STATUS_PAGE_SESSION_LENGTH_SETTING_TEST_ID}-description`}
      >
        {translator.translateText(getSessionLengthDescription(setting.value))}
      </p>
      {setting.error ? (
        <p
          className="mt-1 text-sm text-red-600"
          role="alert"
          data-testid={`${STATUS_PAGE_SESSION_LENGTH_SETTING_TEST_ID}-error`}
        >
          {setting.error}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

const StatusPageSessionLengthCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const licenseMode: EnterpriseLicenseMode = useEnterpriseLicenseMode(
    LicensedFeature.StatusPageAccessControls,
  );
  const ruledListClassName: string = useCardRuledListClassName();
  const translator: Translator = useTranslator();
  const [lengthInHours, setLengthInHours] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchStatusPage: () => Promise<void> = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const item: StatusPage | null = await ModelAPI.getItem<StatusPage>({
        modelType: StatusPage,
        id: props.statusPageId,
        select: {
          [PRIVATE_USER_SESSION_LENGTH_COLUMN]: true,
        },
      });

      if (item) {
        const length: number | null = readPrivateUserSessionLength(
          item[PRIVATE_USER_SESSION_LENGTH_COLUMN],
        );

        setLengthInHours(length);
        props.onLengthChange?.(length);
      } else {
        setError(
          translator.translateText("Status page not found.") ||
            "Status page not found.",
        );
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    void fetchStatusPage();
  }, [props.statusPageId.toString()]);

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (error) {
      return (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            void fetchStatusPage();
          }}
        />
      );
    }

    return (
      /*
       * Full-bleed rows, ruled like the card's own header rule, as on the
       * Channels card: the body reaches the card's edges and each row
       * brings its own padding back.
       */
      <div className={ruledListClassName}>
        <div className="px-5 py-4 md:px-6">
          <SessionLengthSetting
            statusPageId={props.statusPageId}
            initialLengthInHours={lengthInHours}
            onSaved={props.onLengthChange}
          />
        </div>
      </div>
    );
  };

  return (
    <Fragment>
      <EnterpriseSettingLicenseNotice
        mode={licenseMode}
        feature={LicensedFeature.StatusPageAccessControls}
      />
      <Card
        title={StatusPageSessionLengthCopy.cardTitle}
        description={StatusPageSessionLengthCopy.cardDescription}
      >
        <div data-testid={STATUS_PAGE_SESSION_LENGTH_CARD_TEST_ID}>
          {getBody()}
        </div>
      </Card>
    </Fragment>
  );
};

export default StatusPageSessionLengthCard;
