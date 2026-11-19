import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import OneUptimeDate from "Common/Types/Date";
import { OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import { getOpenStackAttentionItems } from "../../../Pages/OpenStack/Utils/OpenStackHealth";
import { getOpenStackPartExplanation } from "../../../Pages/OpenStack/Utils/OpenStackPartFacts";
import NeedsAttentionCard from "../../ResourcePart/NeedsAttentionCard";
import { ResourceAttentionItem } from "../../ResourcePart/ResourceAttention";
import { ResourcePartAttention } from "../../ResourcePart/ResourcePartTypes";
import ResourcePartDetailsCard, {
  ResourcePartDetailRow,
} from "../../ResourcePart/ResourcePartDetailsCard";
import {
  OpenStackPartAlerts,
  OpenStackPartOpenEvents,
} from "./OpenStackPartActivity";
import OpenStackPartNotice from "./OpenStackPartNotice";
import { OpenStackPart } from "./UseOpenStackPart";

/*
 * ONE PART OF A SERVICE A CLOUD MAY NOT RUN.
 *
 * What is broken about it, its tiles, what is open on it, the alerts that watch it and what the service
 * says of it, in that order. Each kind says only what it has to: its words, its tiles and its details.
 * The words are translation keys, because this reads them for every kind that uses it.
 */

export interface OpenStackServicePartWords {
  // "This share".
  thisOne: string;
  attentionDescription: string;
  openTitle: string;
  openDescription: string;
  alertsTitle: string;
  alertsDescription: string;
  detailsDescription: string;
}

/*
 * What needs attention on the part, read once on its page: its Needs
 * attention card lists it, and its hero's status opens it (#9594).
 */
export function getOpenStackServicePartAttention(data: {
  part: OpenStackPart;
  /*
   * The row the rules read, when the page knows more of it than its own
   * read (a load balancer's amphorae saying they are both the MASTER);
   * the part's row when left out.
   */
  row?: OpenStackResource | null | undefined;
  words: Pick<OpenStackServicePartWords, "thisOne" | "attentionDescription">;
}): ResourcePartAttention {
  const row: OpenStackResource | null =
    data.row !== undefined ? data.row : data.part.row;
  return {
    items: row
      ? getOpenStackAttentionItems({
          rows: [row],
          now: OneUptimeDate.getCurrentDate(),
          routeFor: data.part.routes.routeFor,
        })
      : [],
    description: data.words.attentionDescription,
    current: {
      key: `${row?.kind || data.part.kind}/${data.part.externalId}`,
      label: data.words.thisOne,
    },
  };
}

export interface ComponentProps {
  part: OpenStackPart;
  /*
   * What needs attention on it, read once by its page
   * (getOpenStackServicePartAttention) for this card and for its hero.
   */
  attention: ResourcePartAttention;
  row: OpenStackResource;
  service: OpenStackServiceType;
  // Which test ids it answers to: openstack-<slug>-overview and so on.
  slug: string;
  words: OpenStackServicePartWords;
  alertTemplateIds: Array<string>;
  detailRows: Array<ResourcePartDetailRow>;
  // What it adds above what is open on it: its tiles.
  tiles?: ReactNode | undefined;
  // What a collector can't say about why it is what it is. Shown only when it needs someone.
  whyNotKnown?: string | undefined;
  // What it adds under its details.
  children?: ReactNode | undefined;
}

const OpenStackServicePartOverview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { part, row, slug, words } = props;
  const now: Date = OneUptimeDate.getCurrentDate();

  const attention: Array<ResourceAttentionItem> = props.attention.items;
  const explanation: string | null = getOpenStackPartExplanation(row, now);

  return (
    <div data-testid={`openstack-${slug}-overview`}>
      {explanation ? (
        <OpenStackPartNotice
          testId={`openstack-${slug}-explanation`}
          tone="warning"
          text={explanation}
        />
      ) : (
        <></>
      )}

      <NeedsAttentionCard
        testId={`openstack-${slug}-attention`}
        items={attention}
        current={props.attention.current}
        description={props.attention.description}
      />

      {props.tiles ? (
        <div
          className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
          data-testid={`openstack-${slug}-tiles`}
        >
          {props.tiles}
        </div>
      ) : (
        <></>
      )}

      {attention.length > 0 && props.whyNotKnown ? (
        <OpenStackPartNotice
          testId={`openstack-${slug}-why-not-known`}
          text={props.whyNotKnown}
        />
      ) : (
        <></>
      )}

      <OpenStackPartOpenEvents
        testId={`openstack-${slug}-open`}
        title={words.openTitle}
        description={words.openDescription}
        part={part}
        row={row}
      />

      <OpenStackPartAlerts
        testId={`openstack-${slug}-alerts`}
        title={words.alertsTitle}
        description={words.alertsDescription}
        templateIds={props.alertTemplateIds}
        context={{ openStackServices: [props.service] }}
        part={part}
      />

      <ResourcePartDetailsCard
        testId={`openstack-${slug}-details`}
        description={words.detailsDescription}
        rows={props.detailRows}
      />

      {props.children}
    </div>
  );
};

export default OpenStackServicePartOverview;
