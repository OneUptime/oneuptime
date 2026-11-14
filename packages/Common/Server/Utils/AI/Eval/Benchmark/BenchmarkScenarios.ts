import { BenchmarkScenario } from "./BenchmarkScenario";
import CheckoutDeployBreaksDiscounts from "./Scenarios/CheckoutDeployBreaksDiscounts";
import OrdersDbPoolExhausted from "./Scenarios/OrdersDbPoolExhausted";
import PaymentsUpstreamGateway503 from "./Scenarios/PaymentsUpstreamGateway503";
import ApiCertificateExpired from "./Scenarios/ApiCertificateExpired";
import NodeDiskPressureEvictions from "./Scenarios/NodeDiskPressureEvictions";
import SearchConfigPointsToStaging from "./Scenarios/SearchConfigPointsToStaging";
import LoginCredentialStuffingTraffic from "./Scenarios/LoginCredentialStuffingTraffic";
import InvoiceWorkerPoisonMessage from "./Scenarios/InvoiceWorkerPoisonMessage";

/*
 * Every scenario of the investigation benchmark, in the order a run takes
 * them. Results are compared by scenario id across runs, so an id never
 * changes; a scenario whose story changes gets a new one.
 */
const BENCHMARK_SCENARIOS: ReadonlyArray<BenchmarkScenario> = [
  CheckoutDeployBreaksDiscounts,
  OrdersDbPoolExhausted,
  PaymentsUpstreamGateway503,
  ApiCertificateExpired,
  NodeDiskPressureEvictions,
  SearchConfigPointsToStaging,
  LoginCredentialStuffingTraffic,
  InvoiceWorkerPoisonMessage,
];

export default BENCHMARK_SCENARIOS;
