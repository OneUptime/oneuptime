import React, { FunctionComponent, ReactElement } from "react";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import Card from "Common/UI/Components/Card/Card";
import StorageUsageBar, {
  StorageUsageBarSize,
} from "Common/UI/Components/StorageUsage/StorageUsageBar";
import { StorageUsage } from "Common/Utils/Storage/StorageUsage";
import { getVMwareVCenterStorageUsage } from "../../Pages/VMware/Utils/VMwareHealth";

/*
 * HOW MUCH OF A VCENTER'S STORAGE IS USED, ALL OF IT TOGETHER (#9646).
 *
 * The ingest adds up every datastore's capacity and used space onto the
 * vCenter (VMwareVCenter.datastoreCapacityBytes, datastoreUsedBytes), and
 * the Overview selected them but never drew them. Here they are as the
 * shared storage bar's detail: how much is used, how much is free and how
 * big it all is, amber and red at the datastores' own levels - the total
 * vSphere Client's Capacity and Usage shows. Which datastore is fullest is
 * the Datastores tile beside it and the Datastores list.
 *
 * A vCenter that reported no datastore says nothing here; one whose
 * datastores have not reported their capacity yet says so in words.
 */

export interface ComponentProps {
  vcenter: Pick<
    VMwareVCenter,
    | "datastoreCapacityBytes"
    | "datastoreUsedBytes"
    | "datastoreCount"
    | "lastSeenAt"
  >;
}

const VMwareStorageCapacityCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const usage: StorageUsage | null = getVMwareVCenterStorageUsage({
    datastoreUsedBytes: props.vcenter.datastoreUsedBytes,
    datastoreCapacityBytes: props.vcenter.datastoreCapacityBytes,
  });
  const datastoreCount: number = Number(props.vcenter.datastoreCount) || 0;

  if (!usage && datastoreCount <= 0) {
    return <></>;
  }

  return (
    <div className="mb-6" data-testid="vmware-storage-capacity">
      <Card
        title="Storage Capacity"
        description="Used, free and total space across every datastore in this vCenter, added up."
      >
        <StorageUsageBar
          usage={usage}
          size={StorageUsageBarSize.Detail}
          measuredAt={
            usage && props.vcenter.lastSeenAt
              ? new Date(props.vcenter.lastSeenAt)
              : undefined
          }
          dataTestId="vmware-storage-capacity-usage"
        />
      </Card>
    </div>
  );
};

export default VMwareStorageCapacityCard;
