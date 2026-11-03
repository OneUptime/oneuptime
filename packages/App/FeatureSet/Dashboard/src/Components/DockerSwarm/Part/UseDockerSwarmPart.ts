import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import DockerSwarmResource from "Common/Models/DatabaseModels/DockerSwarmResource";
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
import { DockerSwarmPartKind } from "../../../Pages/DockerSwarm/Utils/DockerSwarmHealth";
import { fetchDockerSwarmInventoryRows } from "../../../Pages/DockerSwarm/Utils/DockerSwarmResourceUtils";

/*
 * What a Docker Swarm node's, service's or task's page reads: the cluster's
 * name and the cluster's inventory (one read, the same rows the Overview and
 * the lists read), the part's own row among it, and when it was read.
 *
 * A failed read of the inventory is said as such (rowError), with refresh
 * to read it again: a page that swallowed it drew "not reported yet" about
 * an agent that may be reporting fine. Only the newest read lands.
 */

export interface DockerSwarmPart {
  cluster: DockerSwarmCluster | null;
  // The page-wide failure: the cluster itself could not be read.
  error: string;
  isLoading: boolean;
  rows: Array<DockerSwarmResource>;
  row: DockerSwarmResource | null;
  isLoadingRows: boolean;
  rowError: string;
  readAt: Date;
  refresh: () => void;
}

export default function useDockerSwarmPart(data: {
  clusterId: ObjectID;
  kind: DockerSwarmPartKind;
  externalId: string;
}): DockerSwarmPart {
  const [cluster, setCluster] = useState<DockerSwarmCluster | null>(null);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [rows, setRows] = useState<Array<DockerSwarmResource>>([]);
  const [isLoadingRows, setIsLoadingRows] = useState<boolean>(true);
  const [rowError, setRowError] = useState<string>("");
  const [readAt, setReadAt] = useState<Date>(OneUptimeDate.getCurrentDate());
  const readSeq: MutableRefObject<number> = useRef<number>(0);

  const readRows: () => Promise<void> = useCallback(async (): Promise<void> => {
    const seq: number = ++readSeq.current;
    setIsLoadingRows(true);
    try {
      const inventory: Array<DockerSwarmResource> =
        await fetchDockerSwarmInventoryRows({
          dockerSwarmClusterId: data.clusterId,
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
  }, [data.clusterId.toString()]);

  useEffect(() => {
    let ignore: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      try {
        const item: DockerSwarmCluster | null = await ModelAPI.getItem({
          modelType: DockerSwarmCluster,
          id: data.clusterId,
          select: {
            name: true,
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
  }, [data.clusterId.toString(), data.externalId]);

  const row: DockerSwarmResource | null =
    rows.find((candidate: DockerSwarmResource): boolean => {
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
    isLoadingRows: isLoadingRows,
    rowError: rowError,
    readAt: readAt,
    refresh: (): void => {
      readRows().catch(() => {});
    },
  };
}
