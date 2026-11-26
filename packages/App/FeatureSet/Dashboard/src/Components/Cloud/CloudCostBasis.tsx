import CloudCostSetting from "Common/Models/DatabaseModels/CloudCostSetting";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  CLOUD_COST_BASES,
  CLOUD_COST_BASIS_DESCRIPTIONS,
  CLOUD_COST_BASIS_LABELS,
  CLOUD_COST_DEFAULT_BASIS,
  CloudCostBasis,
  isCloudCostBasis,
  resolveCloudCostBasis,
} from "Common/Types/Cloud/CloudCostBasis";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ObjectID from "Common/Types/ObjectID";
import FilterButtons from "Common/UI/Components/FilterButtons/FilterButtons";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import RememberedChoice from "Common/UI/Utils/RememberedChoice";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import UserUtil from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import { CloudAccountRow, isCloudCostBasisPending } from "./UseCloudAccounts";

/*
 * WHICH COST THE CLOUD PAGES SHOW: BILLED, AMORTIZED OR NET (#11007).
 *
 * One switch on Costs, an account's Costs and a resource's cost; the
 * Overview follows it. A person's pick is remembered for them, in this
 * project, in their browser (RememberedChoice), as a dashboard viewer's
 * time range is; until they pick, the pages open on the project's cost
 * basis (Cloud > Settings > Costs, CloudCostSetting), amortized unless
 * someone picked another. Every chart and figure says which basis it is
 * on: the switch above them, and a pill on each card.
 */

export const COST_BASIS_SWITCH_LABEL: string = translationKey("Cost basis");
export const COST_BASIS_AZURE_NET_NOTE: string = translationKey(
  "Azure takes credits and prepayment off at the billing account, so a subscription's net cost is its amortized cost.",
);
export const COST_BASIS_PENDING_NOTE: string = translationKey(
  "Amortized and net costs arrive with each account's next read of costs. Until then they show billed costs.",
);

// Where a person's pick is kept: theirs, in one project.
export function getCloudCostBasisChoiceKey(data: {
  projectId: string;
  userId: string;
}): string {
  return `oneuptime-cloud-cost-basis:${data.projectId}:${data.userId}`;
}

// A pick kept in the browser, read back: null for none, or one that is not a basis.
export function readRememberedCloudCostBasis(
  key: string,
): CloudCostBasis | null {
  const value: string | null = RememberedChoice.read(key);
  return isCloudCostBasis(value) ? value : null;
}

/*
 * The project's cost basis, read once per project and page load: the
 * default when the project has no cloud cost settings yet, or they cannot
 * be read. Settings > Costs forgets it when it is changed.
 */
const projectBases: Map<string, Promise<CloudCostBasis>> = new Map();

export function forgetProjectCloudCostBasis(projectId: string): void {
  projectBases.delete(projectId);
}

export function fetchProjectCloudCostBasis(
  projectId: ObjectID,
): Promise<CloudCostBasis> {
  const key: string = projectId.toString();
  const known: Promise<CloudCostBasis> | undefined = projectBases.get(key);

  if (known) {
    return known;
  }

  const read: Promise<CloudCostBasis> = ModelAPI.getList<CloudCostSetting>({
    modelType: CloudCostSetting,
    query: { projectId },
    select: { costBasis: true },
    limit: 1,
    skip: 0,
    sort: {},
  })
    .then((result: ListResult<CloudCostSetting>): CloudCostBasis => {
      return resolveCloudCostBasis(result.data[0]?.costBasis);
    })
    .catch((): CloudCostBasis => {
      projectBases.delete(key);
      return CLOUD_COST_DEFAULT_BASIS;
    });

  projectBases.set(key, read);
  return read;
}

export interface CloudCostBasisChoice {
  basis: CloudCostBasis;
  // The project's own basis: what the pages open on until a person picks.
  projectBasis: CloudCostBasis;
  setBasis: (basis: CloudCostBasis) => void;
}

/*
 * The basis a page shows: the person's own pick in this project, else the
 * project's, else the default - and a way to pick another, remembered.
 */
export function useCloudCostBasis(): CloudCostBasisChoice {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const choiceKey: string | null = projectId
    ? getCloudCostBasisChoiceKey({
        projectId: projectId.toString(),
        userId: UserUtil.getUserId().toString(),
      })
    : null;
  const [picked, setPicked] = useState<CloudCostBasis | null>(() => {
    return choiceKey ? readRememberedCloudCostBasis(choiceKey) : null;
  });
  const [projectBasis, setProjectBasis] = useState<CloudCostBasis>(
    CLOUD_COST_DEFAULT_BASIS,
  );

  useEffect(() => {
    let ignore: boolean = false;

    if (projectId) {
      fetchProjectCloudCostBasis(projectId)
        .then((basis: CloudCostBasis): void => {
          if (!ignore) {
            setProjectBasis(basis);
          }
        })
        .catch(() => {
          // The default stays: fetchProjectCloudCostBasis never fails.
        });
    }

    return (): void => {
      ignore = true;
    };
  }, [projectId?.toString()]);

  const setBasis: (basis: CloudCostBasis) => void = useCallback(
    (basis: CloudCostBasis): void => {
      if (choiceKey) {
        RememberedChoice.remember(choiceKey, basis);
      }

      setPicked(basis);
    },
    [choiceKey],
  );

  return {
    basis: resolveCloudCostBasis(picked, projectBasis),
    projectBasis,
    setBasis,
  };
}

/*
 * The basis's name, on a card whose figures are on it: so a chart read
 * apart from the switch still says which cost it is.
 */
export const CloudCostBasisPill: FunctionComponent<{
  basis: CloudCostBasis;
}> = (props: { basis: CloudCostBasis }): ReactElement => {
  return (
    <span data-testid="cloud-cost-basis-pill" data-basis={props.basis}>
      <Pill
        text={CLOUD_COST_BASIS_LABELS[props.basis]}
        tone={PillTone.Info}
        tooltip={CLOUD_COST_BASIS_DESCRIPTIONS[props.basis]}
      />
    </span>
  );
};

export interface CloudCostBasisSwitchProps {
  basis: CloudCostBasis;
  onChange: (basis: CloudCostBasis) => void;
  // The accounts the page is over: what its notes are about.
  accounts: Array<CloudAccountRow>;
}

/*
 * The switch: Billed, Amortized, Net - and what the one picked counts, in
 * a line beside it. A page over an Azure subscription on Net says why its
 * net is its amortized cost; one whose accounts were last read before the
 * bases says when they arrive.
 */
const CloudCostBasisSwitch: FunctionComponent<CloudCostBasisSwitchProps> = (
  props: CloudCostBasisSwitchProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const hasAzure: boolean = props.accounts.some(
    (account: CloudAccountRow): boolean => {
      return account.provider === CloudProvider.Azure;
    },
  );
  const notes: Array<{ key: string; text: string }> = [];

  if (
    props.basis !== CloudCostBasis.Billed &&
    isCloudCostBasisPending(props.accounts)
  ) {
    notes.push({ key: "pending", text: COST_BASIS_PENDING_NOTE });
  }

  if (props.basis === CloudCostBasis.Net && hasAzure) {
    notes.push({ key: "azure", text: COST_BASIS_AZURE_NET_NOTE });
  }

  return (
    <div
      className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4"
      data-testid="cloud-cost-basis-switch"
      data-basis={props.basis}
    >
      <FilterButtons
        ariaLabel={COST_BASIS_SWITCH_LABEL}
        dataTestId="cloud-cost-basis"
        className="shrink-0"
        selectedValue={props.basis}
        options={CLOUD_COST_BASES.map((basis: CloudCostBasis) => {
          return { label: CLOUD_COST_BASIS_LABELS[basis], value: basis };
        })}
        onSelect={(value: string): void => {
          if (isCloudCostBasis(value)) {
            props.onChange(value);
          }
        }}
      />
      <div className="min-w-0 text-sm text-gray-600">
        <p data-testid="cloud-cost-basis-description">
          {translator.translateText(CLOUD_COST_BASIS_DESCRIPTIONS[props.basis])}
        </p>
        {notes.map((note: { key: string; text: string }): ReactElement => {
          return (
            <p
              key={note.key}
              className="mt-1 text-xs text-gray-500"
              data-testid={`cloud-cost-basis-note-${note.key}`}
            >
              {translator.translateText(note.text)}
            </p>
          );
        })}
      </div>
    </div>
  );
};

export default CloudCostBasisSwitch;
