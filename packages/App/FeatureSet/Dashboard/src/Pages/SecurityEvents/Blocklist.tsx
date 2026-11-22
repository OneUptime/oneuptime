import PageComponentProps from "../PageComponentProps";
import ResellerPlanNotice from "../../Components/Billing/ResellerPlanNotice";
import {
  BlocklistDestinations,
  readBlocklistDestinations,
} from "../../Components/SecurityEvents/Blocklist/BlocklistApi";
import {
  BLOCKLIST_KINDS,
  BLOCKLIST_KIND_WORDS,
  BlocklistKind,
} from "../../Components/SecurityEvents/Blocklist/BlocklistKinds";
import BlocklistKindTable from "../../Components/SecurityEvents/Blocklist/BlocklistKindTable";
import BlocklistCloudWafs from "../../Components/SecurityEvents/Blocklist/BlocklistCloudWafs";
import BlocklistNotEnforcedNotice from "../../Components/SecurityEvents/Blocklist/BlocklistNotEnforcedNotice";
import BlocklistFeedsStoppedNotice from "../../Components/SecurityEvents/BlocklistFeeds/BlocklistFeedsStoppedNotice";
import ObjectID from "Common/Types/ObjectID";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * SECURITY EVENTS > PLAYBOOKS > BLOCKLIST (#10338): what the project blocks
 * - and why, until when, its case and who or what added it - and where each
 * block is enforced, a chip per destination with where the block stands
 * there.
 *
 * A tab of each kind (#10346): Addresses, blocked or challenged at the edge
 * (or on every machine too); Domains and URLs and Files, blocked on every
 * machine through Microsoft Defender and CrowdStrike. Each tab lists, lifts,
 * extends and blocks its own kind (BlocklistKindTable).
 *
 * While nothing enforces the blocklist, the page says so above the tabs,
 * with where to connect what would: a block nothing holds blocks nothing.
 * Under the list, Cloud WAFs: the AWS WAF web ACLs it is enforced in, each
 * picked from the project's AWS inventory (#10344).
 */
const SecurityBlocklistPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const [refreshCount, setRefreshCount] = useState<number>(0);
  const [destinations, setDestinations] =
    useState<BlocklistDestinations | null>(null);

  useEffect(() => {
    let isCurrent: boolean = true;

    readBlocklistDestinations()
      .then((found: BlocklistDestinations) => {
        if (isCurrent) {
          setDestinations(found);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setDestinations({ destinations: [], cannotTell: true });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [refreshCount]);

  // Same reseller-telemetry gate as every other Security Events page.
  if (props.currentProject?.reseller?.enableTelemetryFeatures === false) {
    return (
      <ResellerPlanNotice
        project={props.currentProject}
        product="Security Events"
      />
    );
  }

  if (!projectId) {
    return <></>;
  }

  const refresh: () => void = (): void => {
    setRefreshCount((count: number): number => {
      return count + 1;
    });
  };

  return (
    <>
      {destinations &&
      (destinations.cannotTell || destinations.destinations.length === 0) ? (
        <BlocklistNotEnforcedNotice cannotTell={destinations.cannotTell} />
      ) : (
        <></>
      )}

      {/* A firewall that stopped reading its feed: its blocks are not enforced there (#10345). */}
      <BlocklistFeedsStoppedNotice refreshToggle={String(refreshCount)} />

      <Tabs
        label="Blocklist"
        tabs={BLOCKLIST_KINDS.map((kind: BlocklistKind): Tab => {
          return {
            name: BLOCKLIST_KIND_WORDS[kind].plural,
            children: (
              <BlocklistKindTable
                projectId={projectId}
                kind={kind}
                onChanged={refresh}
                pageRefreshCount={refreshCount}
              />
            ),
          };
        })}
        onTabChange={() => {}}
      />

      {/* Where the blocklist is enforced in the project's own clouds (#10344). */}
      <div className="mt-5">
        <BlocklistCloudWafs onChanged={refresh} />
      </div>
    </>
  );
};

export default SecurityBlocklistPage;
