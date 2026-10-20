import React, { FunctionComponent, ReactElement } from "react";
import Card from "Common/UI/Components/Card/Card";
import ObjectID from "Common/Types/ObjectID";
import { ProfileCategory } from "Common/Utils/Profiles/ProfileTypes";
import {
  ProfileKindChoice,
  ProfilesWindowPair,
} from "../../Utils/ProfilesView";
import AggregatedFlamegraph from "./AggregatedFlamegraph";
import DiffFlamegraph from "./DiffFlamegraph";
import {
  FLAME_COMPARE_DESCRIPTION,
  FLAME_COMPARE_TITLE,
  FLAME_DESCRIPTION,
  FLAME_TITLES,
} from "./ProfileCopy";

/*
 * THE FLAME GRAPH, IN A CARD THAT SAYS HOW TO READ IT.
 *
 * One window: every profile of the scope merged into one graph - the wider
 * a frame, the more of the kind it takes; a click zooms in. Two windows:
 * the same graph coloured by what changed, red for a bigger share after,
 * green for a smaller one. Both read the kind as the scope's own raw types,
 * in one unit, so the graph and the function list add up the same samples.
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
  // The Card looks its title and description up in the reader's language.
  const category: ProfileCategory = props.kind.category;

  if (props.comparison) {
    return (
      <Card title={FLAME_COMPARE_TITLE} description={FLAME_COMPARE_DESCRIPTION}>
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
      </Card>
    );
  }

  return (
    <Card title={FLAME_TITLES[category]} description={FLAME_DESCRIPTION}>
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
    </Card>
  );
};

export default ProfileFlameCard;
