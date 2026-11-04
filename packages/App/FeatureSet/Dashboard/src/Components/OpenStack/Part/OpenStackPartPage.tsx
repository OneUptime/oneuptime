import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import OpenStackPartHero, {
  ComponentProps as HeroProps,
  OPENSTACK_PART_SLUGS,
} from "./OpenStackPartHero";
import OpenStackPartReadError from "./OpenStackPartReadError";
import { OpenStackPart } from "./UseOpenStackPart";

/*
 * What every part's page has in common: the hero with its tabs under it, and the three
 * things that can come instead of its Overview. A first read still out draws a loader. A
 * read that failed says so, with Try again. A part that is not in the inventory says that,
 * because it may really have gone: it is not the same thing as a read that failed.
 */

const NOT_REPORTED: Partial<Record<OpenStackResourceKind, string>> = {
  [OpenStackResourceKind.Api]: translationKey(
    "This API is not in this cloud's inventory. It may have left Keystone's catalog, or the agent may not have collected it yet.",
  ),
  [OpenStackResourceKind.Hypervisor]: translationKey(
    "This hypervisor is not in this cloud's inventory. It may have gone, or Nova may not have reported it yet.",
  ),
  [OpenStackResourceKind.Instance]: translationKey(
    "This instance is not in this cloud's inventory. It may have been deleted, or Nova may not have reported it yet.",
  ),
  [OpenStackResourceKind.Flavor]: translationKey(
    "This flavor is not in this cloud's inventory. It may have been deleted, or Nova may not have reported it yet.",
  ),
  [OpenStackResourceKind.Network]: translationKey(
    "This network is not in this cloud's inventory. It may have been deleted, or Neutron may not have reported it yet.",
  ),
  [OpenStackResourceKind.Subnet]: translationKey(
    "This subnet is not in this cloud's inventory. It may have been deleted, or Neutron may not have reported it yet.",
  ),
  [OpenStackResourceKind.Router]: translationKey(
    "This router is not in this cloud's inventory. It may have been deleted, or Neutron may not have reported it yet.",
  ),
  [OpenStackResourceKind.FloatingIp]: translationKey(
    "This floating IP is not in this cloud's inventory. It may have been released, or Neutron may not have reported it yet.",
  ),
  [OpenStackResourceKind.Service]: translationKey(
    "This agent is not in this cloud's inventory. It may have been removed, or Neutron may not have reported it yet.",
  ),
  [OpenStackResourceKind.Volume]: translationKey(
    "This volume is not in this cloud's inventory. It may have been deleted, or Cinder may not have reported it yet.",
  ),
  [OpenStackResourceKind.StoragePool]: translationKey(
    "This storage pool is not in this cloud's inventory. It may have gone, or Cinder may not have reported it yet.",
  ),
  [OpenStackResourceKind.Image]: translationKey(
    "This image is not in this cloud's inventory. It may have been deleted, or Glance may not have reported it yet.",
  ),
};

export interface ComponentProps {
  part: OpenStackPart;
  hero?: Omit<HeroProps, "part"> | undefined;
  overview: (row: OpenStackResource) => ReactElement;
  // The tabs after Overview, once the row is in hand.
  tabs?: ((row: OpenStackResource) => Array<Tab>) | undefined;
}

const OpenStackPartPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { part } = props;
  const slug: string =
    props.hero?.slug || OPENSTACK_PART_SLUGS[part.kind] || "part";

  if (part.isLoadingCloud) {
    return <PageLoader isVisible={true} />;
  }

  if (part.cloudError) {
    return <ErrorMessage message={part.cloudError} />;
  }

  if (!part.cloudName) {
    return <ErrorMessage message="Cloud not found." />;
  }

  const overview: ReactElement = part.isLoadingRow ? (
    <PageLoader isVisible={true} />
  ) : part.rowError ? (
    <OpenStackPartReadError
      kind={part.kind}
      message={part.rowError}
      onRetry={part.retry}
    />
  ) : part.row ? (
    props.overview(part.row)
  ) : (
    <p
      className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500 shadow-sm"
      data-testid={`openstack-${slug}-not-reported`}
    >
      {translator.translateText(NOT_REPORTED[part.kind] || "") ||
        NOT_REPORTED[part.kind]}
    </p>
  );

  const tabs: Array<Tab> = [
    { name: "Overview", children: overview },
    ...(part.row && props.tabs ? props.tabs(part.row) : []),
  ];

  return (
    <div data-testid={`openstack-${slug}-page`}>
      <OpenStackPartHero part={part} {...(props.hero || {})} />
      {/*
       * Its row wraps on a phone, so no tab is ever out of sight past the edge of the
       * screen. Mounted again once the row arrives, because Tabs keeps its own list.
       */}
      <Tabs key={tabs.length} tabs={tabs} wrap={true} onTabChange={() => {}} />
    </div>
  );
};

export default OpenStackPartPage;
