import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  fetchRecordLabels,
  fetchRecordOwners,
  type RecordLabel,
  type RecordOwner,
} from "../api/recordPeople";
import type { FilterableList } from "../filters/recordFilters";

export interface RecordOwnersAndLabels {
  owners: Array<RecordOwner>;
  labels: Array<RecordLabel>;
  isLoading: boolean;
  // The owners could not be read: never shown as "no owners".
  ownersFailed: boolean;
  refetch: () => Promise<void>;
}

/*
 * A record's owners and labels, read beside its detail (they are an extra
 * to the record, not part of it: a failure here never takes the screen
 * down). Labels a server cannot read are simply not shown.
 */
export function useRecordOwnersAndLabels(
  list: FilterableList,
  projectId: string,
  recordId: string,
): RecordOwnersAndLabels {
  const enabled: boolean = Boolean(projectId) && Boolean(recordId);
  const owners: UseQueryResult<Array<RecordOwner>, Error> = useQuery({
    queryKey: ["record-owners", list, projectId, recordId],
    queryFn: (): Promise<Array<RecordOwner>> => {
      return fetchRecordOwners(projectId, list, recordId);
    },
    enabled: enabled,
  });
  const labels: UseQueryResult<Array<RecordLabel>, Error> = useQuery({
    queryKey: ["record-labels", list, projectId, recordId],
    queryFn: (): Promise<Array<RecordLabel>> => {
      return fetchRecordLabels(projectId, list, recordId);
    },
    enabled: enabled,
  });

  return {
    owners: owners.data ?? [],
    labels: labels.data ?? [],
    isLoading: enabled && owners.isPending,
    ownersFailed: owners.isError,
    refetch: async (): Promise<void> => {
      await Promise.all([owners.refetch(), labels.refetch()]);
    },
  };
}
