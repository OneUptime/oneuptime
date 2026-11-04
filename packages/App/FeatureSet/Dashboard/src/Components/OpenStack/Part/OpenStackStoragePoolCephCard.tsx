import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import {
  OpenStackStoragePoolCephLink,
  isOpenStackStoragePoolCephLinked,
} from "Common/Types/OpenStack/OpenStackLinks";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import {
  OpenStackStoragePoolCephRead,
  confirmOpenStackStoragePoolCeph,
  fetchOpenStackStoragePoolCeph,
} from "../../../Pages/OpenStack/Utils/OpenStackUsageReads";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import useOpenStackRead, { OpenStackRead } from "./UseOpenStackRead";

/*
 * Which Ceph cluster a Cinder pool sits on, and how it reads. Cinder's driver says, to a probe
 * at the Full view level, and then this links on its own. Otherwise what a pool is called can
 * only suggest one, and someone who knows confirms it once. Says nothing on a project with no
 * Ceph clusters, because there is nothing to link it to.
 */

const HEALTH_WORDS: Record<number, string> = {
  0: "HEALTH_OK",
  1: "HEALTH_WARN",
  2: "HEALTH_ERR",
};

const OpenStackStoragePoolCephCard: FunctionComponent<{
  openStackCloudId: ObjectID;
  externalId: string;
  refreshToken?: number | undefined;
}> = (props: {
  openStackCloudId: ObjectID;
  externalId: string;
  refreshToken?: number | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [chosen, setChosen] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");

  const read: OpenStackRead<OpenStackStoragePoolCephRead> = useOpenStackRead(
    () => {
      return fetchOpenStackStoragePoolCeph({
        openStackCloudId: props.openStackCloudId,
        externalId: props.externalId,
      });
    },
    [props.openStackCloudId.toString(), props.externalId, props.refreshToken],
  );

  const link: OpenStackStoragePoolCephLink | undefined = read.data?.link;

  if (
    !read.data ||
    !link ||
    link.state === "no-clusters" ||
    link.state === "not-ceph"
  ) {
    return <></>;
  }

  const answer: (body: {
    cephClusterId?: string | undefined;
    isNotCeph?: boolean | undefined;
  }) => Promise<void> = async (body: {
    cephClusterId?: string | undefined;
    isNotCeph?: boolean | undefined;
  }): Promise<void> => {
    setIsSaving(true);
    setSaveError("");
    try {
      await confirmOpenStackStoragePoolCeph({
        openStackCloudId: props.openStackCloudId,
        externalId: props.externalId,
        ...body,
      });
      read.reload();
    } catch (err) {
      setSaveError(API.getFriendlyMessage(err));
    }
    setIsSaving(false);
  };

  const clusterLink: ReactElement = link.clusterId ? (
    <Link
      to={
        RouteUtil.populateRouteParams(
          RouteMap[PageMap.CEPH_CLUSTER_VIEW] as Route,
          { modelId: new ObjectID(link.clusterId) },
        ) as Route
      }
      className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
    >
      <bdi>{link.clusterName || link.clusterId}</bdi>
    </Link>
  ) : (
    <></>
  );

  const options: Array<DropdownOption> = read.data.clusters.map(
    (cluster: { id: string; name: string }): DropdownOption => {
      return { label: cluster.name, value: cluster.id };
    },
  );

  return (
    <div className="mb-6" data-testid="openstack-storage-pool-ceph" data-state={link.state}>
      <Card
        title="Ceph"
        description="The Ceph cluster behind this Cinder pool, so its trouble shows here and in this cloud's Needs attention."
      >
        {saveError ? <ErrorMessage message={saveError} /> : <></>}
        {isOpenStackStoragePoolCephLinked(link) ? (
          <div className="space-y-1 text-sm">
            <p>
              {link.state === "from-fsid"
                ? translator.translateText("Cinder's driver names this cluster.")
                : translator.translateText("Someone confirmed this cluster.")}{" "}
              {clusterLink}
            </p>
            <p data-testid="openstack-storage-pool-ceph-health">
              {read.data.health === null || read.data.health === undefined
                ? translator.translateText("It has not reported its health yet.")
                : translator.translateTemplate("It reads {{health}}.", {
                    health: HEALTH_WORDS[read.data.health] || "",
                  })}
            </p>
          </div>
        ) : link.state === "suggested" ? (
          <div className="space-y-3 text-sm">
            <p data-testid="openstack-storage-pool-ceph-suggestion">
              {translator.translateTemplate(
                "A pool called {{pool}} is on this Ceph cluster. Is that where this pool is?",
                { pool: link.cephPoolName || "" },
              )}{" "}
              {clusterLink}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                title="Yes, this is it"
                buttonStyle={ButtonStyleType.PRIMARY}
                isLoading={isSaving}
                onClick={() => {
                  void answer({ cephClusterId: link.clusterId || undefined });
                }}
              />
              <Button
                title="It isn't on Ceph"
                buttonStyle={ButtonStyleType.NORMAL}
                disabled={isSaving}
                onClick={() => {
                  void answer({ isNotCeph: true });
                }}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p>
              {translator.translateText(
                "Nothing that was collected says whether this pool is on Ceph. If it is, choose the cluster once and it stays linked.",
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-64">
                <Dropdown
                  options={options}
                  placeholder="Choose a Ceph cluster"
                  onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
                    setChosen(typeof value === "string" ? value : "");
                  }}
                />
              </div>
              <Button
                title="Link this cluster"
                buttonStyle={ButtonStyleType.PRIMARY}
                disabled={!chosen}
                isLoading={isSaving}
                onClick={() => {
                  void answer({ cephClusterId: chosen });
                }}
              />
              <Button
                title="It isn't on Ceph"
                buttonStyle={ButtonStyleType.NORMAL}
                disabled={isSaving}
                onClick={() => {
                  void answer({ isNotCeph: true });
                }}
              />
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

export default OpenStackStoragePoolCephCard;
