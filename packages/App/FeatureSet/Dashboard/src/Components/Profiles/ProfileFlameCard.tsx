import React, { FunctionComponent, ReactElement, useState } from "react";
import Card from "Common/UI/Components/Card/Card";
import HelpModal from "Common/UI/Components/Help/HelpModal";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import { DOCS_URL } from "Common/UI/Config";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { ProfileCategory } from "Common/Utils/Profiles/ProfileTypes";
import {
  ProfileKindChoice,
  ProfilesWindowPair,
} from "../../Utils/ProfilesView";
import AggregatedFlamegraph from "./AggregatedFlamegraph";
import DiffFlamegraph from "./DiffFlamegraph";
import {
  FLAME_COMPARE_TITLE,
  FLAME_DESCRIPTION,
  FLAME_HELP_BUTTON,
  FLAME_TITLES,
} from "./ProfileCopy";
import { PROFILE_FLAME_HELP } from "./ProfileFlameHelp";

/*
 * THE FLAME GRAPH, IN A CARD THAT SAYS HOW TO READ IT.
 *
 * One window: every profile of the scope merged into one graph - the wider
 * a frame, the more of the kind it takes; a click zooms in. Two windows:
 * the same graph coloured by what changed, red for a bigger share after,
 * green for a smaller one - which the graph's own legend says, right above
 * it, so that card has a title and no sentence. Both read the kind as the
 * scope's own raw types, in one unit, so the graph and the function list
 * add up the same samples.
 *
 * Someone who has never read a flame graph is one click from how to read
 * it: "How to read this" beside the title opens the help dialog
 * (ProfileFlameHelp) - what to fix first, self and total, the colours,
 * code without symbols, zooming and comparing.
 */

export interface ComponentProps {
  startTime: Date;
  endTime: Date;
  comparison: ProfilesWindowPair | null;
  serviceIds?: Array<ObjectID> | undefined;
  kind: ProfileKindChoice;
  searchTerm: string;
  onSearchTermChange: (term: string) => void;
  onOpenFunction: (frame: { functionName: string; fileName: string }) => void;
  // Bumped by Refresh: the graph reads again.
  refreshCount: number;
}

const ProfileFlameCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isHelpOpen, setIsHelpOpen] = useState<boolean>(false);
  // The Card looks its title and description up in the reader's language.
  const category: ProfileCategory = props.kind.category;

  const helpButton: ReactElement = (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium text-indigo-600 hover:text-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      data-testid="profiles-flame-help"
      onClick={() => {
        setIsHelpOpen(true);
      }}
    >
      <Icon icon={IconProp.Help} className="h-4 w-4" />
      {translator.translateText(FLAME_HELP_BUTTON)}
    </button>
  );

  const help: ReactElement = isHelpOpen ? (
    <HelpModal
      title={PROFILE_FLAME_HELP.title}
      description={PROFILE_FLAME_HELP.description}
      markdown={PROFILE_FLAME_HELP.markdown}
      documentationLink={URL.fromString(
        `${DOCS_URL.toString()}/telemetry/profiles#reading-a-flame-graph`,
      )}
      onClose={() => {
        setIsHelpOpen(false);
      }}
    />
  ) : (
    <></>
  );

  if (props.comparison) {
    return (
      <Card title={FLAME_COMPARE_TITLE} rightElement={helpButton}>
        <div data-testid="profiles-flame-compare">
          <DiffFlamegraph
            key={props.refreshCount}
            baselineStartTime={props.comparison.before.startTime}
            baselineEndTime={props.comparison.before.endTime}
            comparisonStartTime={props.comparison.after.startTime}
            comparisonEndTime={props.comparison.after.endTime}
            serviceIds={props.serviceIds}
            profileType={props.kind.selection}
            profileTypes={props.kind.queryTypes}
            unit={props.kind.unit}
          />
        </div>
        {help}
      </Card>
    );
  }

  return (
    <Card
      title={FLAME_TITLES[category]}
      description={FLAME_DESCRIPTION}
      rightElement={helpButton}
    >
      <div data-testid="profiles-flame">
        <AggregatedFlamegraph
          key={props.refreshCount}
          startTime={props.startTime}
          endTime={props.endTime}
          serviceIds={props.serviceIds}
          profileType={props.kind.selection}
          profileTypes={props.kind.queryTypes}
          unit={props.kind.unit}
          searchTerm={props.searchTerm}
          onSearchTermChange={props.onSearchTermChange}
          onFocusFunction={props.onOpenFunction}
        />
      </div>
      {help}
    </Card>
  );
};

export default ProfileFlameCard;
