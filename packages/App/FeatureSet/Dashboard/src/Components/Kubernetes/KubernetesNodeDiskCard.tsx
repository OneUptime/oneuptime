import React, { FunctionComponent, ReactElement } from "react";
import Card from "Common/UI/Components/Card/Card";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import StorageUsageBar, {
  StorageUsageBarSize,
} from "Common/UI/Components/StorageUsage/StorageUsageBar";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  KUBERNETES_NODE_DISK_NOT_REPORTED_EXPLANATION,
  KubernetesNodeDisk,
} from "../../Pages/Kubernetes/Utils/KubernetesNodeDisk";

/*
 * A node's disk, on its page (#9645): how much of its root filesystem is
 * used and free and how big it is - the disk the kubelet keeps its pods'
 * logs and emptyDir volumes on, and evicts pods by - drawn with the shared
 * bar, amber when it is nearly full and red when it is almost out of space.
 * A node whose container images have a disk of their own shows that one
 * too, under a heading of its own. With no reading, it says why in a
 * sentence, never an empty bar.
 */

export const KUBERNETES_NODE_DISK_CARD_TEST_ID: string = "kubernetes-node-disk";

export interface ComponentProps {
  // Null while it loads, or when the node's row was not found.
  disk: KubernetesNodeDisk | null;
  isLoading: boolean;
  error?: string | undefined;
}

const DiskSection: FunctionComponent<{
  title: string;
  description: string;
  children: ReactElement;
  testId: string;
}> = (props: {
  title: string;
  description: string;
  children: ReactElement;
  testId: string;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <section data-testid={props.testId} className="space-y-3">
      <div>
        <h3 className="text-sm font-medium text-gray-900">
          {translator.translateText(props.title)}
        </h3>
        <p className="text-xs text-gray-500">
          {translator.translateText(props.description)}
        </p>
      </div>
      {props.children}
    </section>
  );
};

const KubernetesNodeDiskCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const getBody: () => ReactElement = (): ReactElement => {
    if (props.isLoading) {
      return <DetailListSkeleton fields={3} columns={3} />;
    }

    if (props.error) {
      return <ErrorMessage message={props.error} />;
    }

    const disk: KubernetesNodeDisk | null = props.disk;

    if (!disk || !disk.root) {
      return (
        <StorageUsageBar
          usage={null}
          size={StorageUsageBarSize.Detail}
          noUsageText={KUBERNETES_NODE_DISK_NOT_REPORTED_EXPLANATION}
          dataTestId={KUBERNETES_NODE_DISK_CARD_TEST_ID}
        />
      );
    }

    const root: ReactElement = (
      <StorageUsageBar
        usage={disk.root}
        size={StorageUsageBarSize.Detail}
        measuredAt={disk.measuredAt || undefined}
        dataTestId={KUBERNETES_NODE_DISK_CARD_TEST_ID}
      />
    );

    if (!disk.image) {
      return root;
    }

    return (
      <div className="space-y-5">
        <DiskSection
          title="Root filesystem"
          description="Pods' logs, emptyDir volumes and the kubelet's own files. The kubelet evicts pods when it runs low."
          testId={`${KUBERNETES_NODE_DISK_CARD_TEST_ID}-root-section`}
        >
          {root}
        </DiskSection>
        <div className="border-t border-gray-100 pt-5">
          <DiskSection
            title="Image filesystem"
            description="Container images and the files containers write. When it fills, new images stop pulling."
            testId={`${KUBERNETES_NODE_DISK_CARD_TEST_ID}-image-section`}
          >
            <StorageUsageBar
              usage={disk.image}
              size={StorageUsageBarSize.Detail}
              dataTestId={`${KUBERNETES_NODE_DISK_CARD_TEST_ID}-image`}
            />
          </DiskSection>
        </div>
      </div>
    );
  };

  return (
    <Card
      title="Disk"
      description="How much of this node's disk is used and free, as the kubelet last measured it."
    >
      {getBody()}
    </Card>
  );
};

export default KubernetesNodeDiskCard;
