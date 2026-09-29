package model

type NetworkInterfaceMetrics struct {
	InterfaceName   string `json:"interfaceName"`
	BytesReceived   uint64 `json:"bytesReceived"`
	BytesSent       uint64 `json:"bytesSent"`
	PacketsReceived uint64 `json:"packetsReceived"`
	PacketsSent     uint64 `json:"packetsSent"`
	ErrorsIn        uint64 `json:"errorsIn"`
	ErrorsOut       uint64 `json:"errorsOut"`
	DropsIn         uint64 `json:"dropsIn"`
	DropsOut        uint64 `json:"dropsOut"`
}

type NetworkMetrics struct {
	Interfaces             []*NetworkInterfaceMetrics `json:"interfaces,omitempty"`
	TotalBytesReceived     uint64                     `json:"totalBytesReceived,omitempty"`
	TotalBytesSent         uint64                     `json:"totalBytesSent,omitempty"`
	TotalPacketsReceived   uint64                     `json:"totalPacketsReceived,omitempty"`
	TotalPacketsSent       uint64                     `json:"totalPacketsSent,omitempty"`
	ConnectionsEstablished int                        `json:"connectionsEstablished,omitempty"`
	ConnectionsListen      int                        `json:"connectionsListen,omitempty"`
	ConnectionsTotal       int                        `json:"connectionsTotal,omitempty"`
}
