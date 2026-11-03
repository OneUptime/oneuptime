import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import CephResource from "Common/Models/DatabaseModels/CephResource";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  CephPartKind,
  getCephNewestSeenAt,
} from "../../../Pages/Ceph/Utils/CephHealth";
import CephResourceUtils from "../../../Pages/Ceph/Utils/CephResourceUtils";

/*
 * What an OSD's or a pool's page reads: the cluster's name and connection,
 * the cluster's OSDs or pools (one read, the rows the list of its kind
 * reads), the part's own row among them, and when they were read.
 *
 * A failed read of the rows is said as such (rowError), with refresh to
 * read them again: a page that swallowed it drew "not in the inventory yet"
 * about an agent that may be reporting fine. Only the newest read lands.
 */

export interface CephPart {
  cluster: CephCluster | null;
  // The page-wide failure: the cluster itself could not be read.
  error: string;
  isLoading: boolean;
  // The cluster's parts of this kind, the part's own row among them.
  rows: Array<CephResource>;
  row: CephResource | null;
  // The newest report among them, which "Stopped reporting" is measured by.
  newestSeenAt: Date | null;
  isLoadingRows: boolean;
  rowError: string;
  readAt: Date;
  refresh: () => void;
}

export default function useCephPart(data: {
  clusterId: ObjectID;
  kind: CephPartKind;
  externalId: string;
}): CephPart {
  const [cluster, setCluster] = useState<CephCluster | null>(null);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [rows, setRows] = useState<Array<CephResource>>([]);
  const [isLoadingRows, setIsLoadingRows] = useState<boolean>(true);
  const [rowError, setRowError] = useState<string>("");
  const [readAt, setReadAt] = useState<Date>(OneUptimeDate.getCurrentDate());
  const readSeq: MutableRefObject<number> = useRef<number>(0);

  const readRows: () => Promise<void> = useCallback(async (): Promise<void> => {
    const seq: number = ++readSeq.current;
    setIsLoadingRows(true);
    try {
      const inventory: Array<CephResource> =
        await CephResourceUtils.fetchCephResources({
          cephClusterId: data.clusterId,
          kinds: [data.kind],
        });
      if (seq !== readSeq.current) {
        return;
      }
      setRows(inventory);
      setRowError("");
      setReadAt(OneUptimeDate.getCurrentDate());
    } catch (err) {
      if (seq !== readSeq.current) {
        return;
      }
      setRowError(API.getFriendlyMessage(err));
    }
    setIsLoadingRows(false);
  }, [data.clusterId.toString(), data.kind]);

  useEffect(() => {
    let ignore: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      try {
        const item: CephCluster | null = await ModelAPI.getItem({
          modelType: CephCluster,
          id: data.clusterId,
          select: {
            name: true,
            otelCollectorStatus: true,
          },
        });
        if (!ignore) {
          setCluster(item);
        }
      } catch (err) {
        if (!ignore) {
          setError(API.getFriendlyMessage(err));
        }
      }
      if (!ignore) {
        setIsLoading(false);
      }
      await readRows();
    };

    load().catch((err: Error) => {
      if (!ignore) {
        setError(API.getFriendlyMessage(err));
        setIsLoading(false);
      }
    });

    return () => {
      ignore = true;
    };
  }, [data.clusterId.toString(), data.kind, data.externalId]);

  const row: CephResource | null =
    rows.find((candidate: CephResource): boolean => {
      return (
        candidate.kind === data.kind && candidate.externalId === data.externalId
      );
    }) || null;

  return {
    cluster: cluster,
    error: error,
    isLoading: isLoading,
    rows: rows,
    row: row,
    newestSeenAt: getCephNewestSeenAt(rows),
    isLoadingRows: isLoadingRows,
    rowError: rowError,
    readAt: readAt,
    refresh: (): void => {
      readRows().catch(() => {});
    },
  };
}
