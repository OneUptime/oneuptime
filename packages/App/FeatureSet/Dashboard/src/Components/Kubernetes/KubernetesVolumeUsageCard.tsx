import React, { FunctionComponent, ReactElement } from "react";
import Card from "Common/UI/Components/Card/Card";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import StorageUsageBar, {
  STORAGE_USAGE_BAR_COLOR_CLASS_NAMES,
  StorageUsageBarSize,
} from "Common/UI/Components/StorageUsage/StorageUsageBar";
import {
  StorageUsage,
  formatStorageCount,
  formatStorageUsedPercent,
} from "Common/Utils/Storage/StorageUsage";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  KUBERNETES_VOLUME_USAGE_GAP_EXPLANATION,
  KubernetesVolumeClaimUsage,
  KubernetesVolumeUsageGap,
} from "../../Pages/Kubernetes/Utils/KubernetesVolumeUsage";

/*
 * A claim's storage, on its page and on the page of the volume bound to it
 * (#9539): how much of the filesystem is used, how much is free and how big
 * it is, with a bar that turns amber when it is nearly full and red when it
 * is almost out of space, and its inodes - a filesystem with free bytes but
 * no free inodes can no longer create a file. A claim with no usage says
 * why, in a sentence, never an empty bar.
 */

export const KUBERNETES_VOLUME_USAGE_CARD_TEST_ID: string =
  "kubernetes-volume-usage";

export interface ComponentProps {
  // Null while it loads, or when the claim's row was not found.
  usage: KubernetesVolumeClaimUsage | null;
  isLoading: boolean;
  error?: string | undefined;
  // The card's line under its title: the claim's or the volume's words.
  description: string;
  /*
   * English, looked up: why there is no usage, when the page knows better
   * than the claim's row - a volume no claim is bound to.
   */
  noUsageExplanation?: string | undefined;
}

const InodeUsage: FunctionComponent<{ inodes: StorageUsage }> = (props: {
  inodes: StorageUsage;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const width: number = Math.min(Math.max(props.inodes.usedPercent, 0), 100);

  return (
    <div
      data-testid={`${KUBERNETES_VOLUME_USAGE_CARD_TEST_ID}-inodes`}
      className="border-t border-gray-100 pt-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-gray-700">
          {translator.translateText("Inode Usage")}
        </span>
        <span className="text-xs text-gray-600">
          {translator.translateTemplate(
            "{{used}} of {{total}} used ({{percent}})",
            {
              used: formatStorageCount(props.inodes.used, translator.language),
              total: formatStorageCount(
                props.inodes.capacity,
                translator.language,
              ),
              percent: formatStorageUsedPercent(
                props.inodes,
                translator.language,
              ),
            },
          )}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-1.5 rounded-full ${
            STORAGE_USAGE_BAR_COLOR_CLASS_NAMES[props.inodes.level]
          }`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
};

const KubernetesVolumeUsageCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const getBody: () => ReactElement = (): ReactElement => {
    if (props.isLoading) {
      return <DetailListSkeleton fields={3} columns={3} />;
    }

    if (props.error) {
      return <ErrorMessage message={props.error} />;
    }

    const usage: KubernetesVolumeClaimUsage | null = props.usage;

    if (!usage || !usage.space) {
      const gap: KubernetesVolumeUsageGap =
        usage?.gap || KubernetesVolumeUsageGap.NotReported;

      return (
        <StorageUsageBar
          usage={null}
          size={StorageUsageBarSize.Detail}
          noUsageText={
            props.noUsageExplanation ||
            KUBERNETES_VOLUME_USAGE_GAP_EXPLANATION[gap]
          }
          dataTestId={KUBERNETES_VOLUME_USAGE_CARD_TEST_ID}
        />
      );
    }

    return (
      <div className="space-y-4">
        <StorageUsageBar
          usage={usage.space}
          size={StorageUsageBarSize.Detail}
          measuredAt={usage.measuredAt || undefined}
          dataTestId={KUBERNETES_VOLUME_USAGE_CARD_TEST_ID}
        />
        {usage.inodes ? <InodeUsage inodes={usage.inodes} /> : null}
      </div>
    );
  };

  return (
    <Card title="Storage" description={props.description}>
      {getBody()}
    </Card>
  );
};

export default KubernetesVolumeUsageCard;
