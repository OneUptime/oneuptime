package utils

import (
	"log/slog"
	"oneuptime-infrastructure-agent/model"

	"github.com/shirou/gopsutil/v3/net"
)

// GetNetworkMetrics returns per-interface and aggregate network counters.
// Counters are cumulative since boot — the backend or UI computes deltas/rates.
func GetNetworkMetrics() *model.NetworkMetrics {
	perInterface, err := net.IOCounters(true)
	if err != nil {
		slog.Warn("Failed to fetch per-interface network counters", "error", err)
		return nil
	}

	metrics := &model.NetworkMetrics{}

	for _, c := range perInterface {
		// Skip loopback and down interfaces with zero traffic so the payload stays lean.
		if c.Name == "lo" || c.Name == "lo0" {
			continue
		}
		if c.BytesRecv == 0 && c.BytesSent == 0 && c.PacketsRecv == 0 && c.PacketsSent == 0 {
			continue
		}

		iface := &model.NetworkInterfaceMetrics{
			InterfaceName:   c.Name,
			BytesReceived:   c.BytesRecv,
			BytesSent:       c.BytesSent,
			PacketsReceived: c.PacketsRecv,
			PacketsSent:     c.PacketsSent,
			ErrorsIn:        c.Errin,
			ErrorsOut:       c.Errout,
			DropsIn:         c.Dropin,
			DropsOut:        c.Dropout,
		}
		metrics.Interfaces = append(metrics.Interfaces, iface)

		metrics.TotalBytesReceived += c.BytesRecv
		metrics.TotalBytesSent += c.BytesSent
		metrics.TotalPacketsReceived += c.PacketsRecv
		metrics.TotalPacketsSent += c.PacketsSent
	}

	// Connection counts by state — useful for diagnosing socket exhaustion.
	if conns, err := net.Connections("inet"); err == nil {
		metrics.ConnectionsTotal = len(conns)
		for _, c := range conns {
			switch c.Status {
			case "ESTABLISHED":
				metrics.ConnectionsEstablished++
			case "LISTEN":
				metrics.ConnectionsListen++
			}
		}
	}

	return metrics
}
