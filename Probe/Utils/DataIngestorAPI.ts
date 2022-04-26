import Protocol from 'Common/Types/API/Protocol';
import API from 'Common/Utils/API';
import { DataIngestorHostname } from 'CommonServer/Config';

// HTTP because its inter-cluster communication.
export default new API(Protocol.HTTP, DataIngestorHostname);