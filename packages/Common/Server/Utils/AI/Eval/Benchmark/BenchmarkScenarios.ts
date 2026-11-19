import { BenchmarkScenario } from "./BenchmarkScenario";
import CheckoutDeployBreaksDiscounts from "./Scenarios/CheckoutDeployBreaksDiscounts";
import OrdersDbPoolExhausted from "./Scenarios/OrdersDbPoolExhausted";
import PaymentsUpstreamGateway503 from "./Scenarios/PaymentsUpstreamGateway503";
import ApiCertificateExpired from "./Scenarios/ApiCertificateExpired";
import NodeDiskPressureEvictions from "./Scenarios/NodeDiskPressureEvictions";
import SearchConfigPointsToStaging from "./Scenarios/SearchConfigPointsToStaging";
import LoginCredentialStuffingTraffic from "./Scenarios/LoginCredentialStuffingTraffic";
import InvoiceWorkerPoisonMessage from "./Scenarios/InvoiceWorkerPoisonMessage";
import OrdersApiNoisyNeighborContainer from "./Scenarios/OrdersApiNoisyNeighborContainer";
import CheckoutLatencyBlipNoCause from "./Scenarios/CheckoutLatencyBlipNoCause";
import SearchSlowCacheTtlAndLostNode from "./Scenarios/SearchSlowCacheTtlAndLostNode";
import PaymentsRecurrenceFixDoesNotApply from "./Scenarios/PaymentsRecurrenceFixDoesNotApply";

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
  // An alert, and the fault on the Docker host under it (#7766).
  OrdersApiNoisyNeighborContainer,
  // Nothing the telemetry shows explains it: the right answer says so (#7766).
  CheckoutLatencyBlipNoCause,
  // Two causes at once, one of them found in a connected cloud (#7766).
  SearchSlowCacheTtlAndLostNode,
  // A past incident that looks the same, whose fix does not apply; and the code (#7766).
  PaymentsRecurrenceFixDoesNotApply,
];

export default BENCHMARK_SCENARIOS;
