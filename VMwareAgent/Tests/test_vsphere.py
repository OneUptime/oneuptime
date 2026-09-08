"""Exercise real pyVmomi types and request construction against a fake SDK API."""

import ssl
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from pyVmomi import vim

from VMwareAgent.Tests.test_agent import config
from VMwareAgent.vsphere import PROPERTIES, VSphereClient


def sdk_object(obj, properties, missing=None):
    return SimpleNamespace(
        obj=obj,
        propSet=[
            SimpleNamespace(name=name, val=value) for name, value in properties.items()
        ],
        missingSet=missing or [],
    )


class VSphereTests(unittest.TestCase):
    def setUp(self):
        self.stop = threading.Event()
        self.client = VSphereClient(config(Path("unused")), self.stop)
        self.stub = Mock()
        self.view = vim.view.ContainerView("view-1", self.stub)
        self.collector = Mock()
        self.manager = Mock()
        self.manager.CreateContainerView.return_value = self.view
        self.content = SimpleNamespace(
            about=SimpleNamespace(apiType="VirtualCenter", instanceUuid="server-uuid"),
            rootFolder=vim.Folder("group-root"),
            viewManager=self.manager,
            propertyCollector=self.collector,
        )
        self.connection = Mock()
        self.connection.RetrieveContent.return_value = self.content
        self.client.connection = self.connection

    def test_paginated_properties_and_parent_references(self):
        first = sdk_object(
            vim.HostSystem("host-1"),
            {"name": "esx", "parent": vim.ClusterComputeResource("domain-c1")},
        )
        second = sdk_object(
            vim.VirtualMachine("vm-1"),
            {
                "name": "db",
                "runtime.host": vim.HostSystem("host-1"),
                "config.instanceUuid": "uuid-1",
            },
        )
        self.collector.RetrievePropertiesEx.return_value = SimpleNamespace(
            objects=[first], token="next"
        )
        self.collector.ContinueRetrievePropertiesEx.return_value = SimpleNamespace(
            objects=[second], token=None
        )
        snapshot = self.client.collect()
        self.assertEqual([record.kind for record in snapshot.records], ["host", "vm"])
        self.assertEqual(snapshot.records[1].properties["runtime.host"], "host-1")
        self.assertEqual(snapshot.records[0].properties["parent"], "domain-c1")
        self.assertEqual(snapshot.instance_uuid, "server-uuid")
        self.collector.ContinueRetrievePropertiesEx.assert_called_once_with(
            token="next"
        )
        self.collector.CancelRetrievePropertiesEx.assert_not_called()
        self.assertTrue(self.stub.InvokeMethod.called)  # ContainerView.Destroy
        arguments = self.collector.RetrievePropertiesEx.call_args.kwargs
        self.assertEqual(arguments["options"].maxObjects, 250)
        specs = arguments["specSet"][0].propSet
        self.assertEqual(
            {spec.type for spec in specs}, {value[0] for value in PROPERTIES.values()}
        )
        self.assertTrue(all(spec.all is False for spec in specs))
        self.assertIn(
            "runtime.inMaintenanceMode",
            next(spec.pathSet for spec in specs if spec.type == vim.HostSystem),
        )

    def test_permission_fault_is_partial_inventory(self):
        item = sdk_object(
            vim.VirtualMachine("vm-1"),
            {"name": "db"},
            [SimpleNamespace(path="config", fault=PermissionError())],
        )
        self.collector.RetrievePropertiesEx.return_value = SimpleNamespace(
            objects=[item], token=None
        )
        snapshot = self.client.collect()
        self.assertFalse(snapshot.complete)
        self.assertFalse(snapshot.records[0].complete)

    def test_template_flag_and_all_inventory_types_are_preserved(self):
        self.collector.RetrievePropertiesEx.return_value = SimpleNamespace(
            objects=[
                sdk_object(vim.VirtualMachine("vm-1"), {"config.template": True}),
                sdk_object(vim.Datastore("datastore-1"), {"summary.accessible": False}),
                sdk_object(
                    vim.ClusterComputeResource("cluster-1"), {"name": "cluster"}
                ),
            ],
            token=None,
        )
        snapshot = self.client.collect()
        self.assertEqual(
            [record.kind for record in snapshot.records], ["vm", "datastore", "cluster"]
        )
        self.assertTrue(snapshot.records[0].properties["is_template"])
        self.assertFalse(snapshot.records[1].properties["summary.accessible"])

    def test_unrecognized_entity_makes_inventory_incomplete(self):
        self.collector.RetrievePropertiesEx.return_value = SimpleNamespace(
            objects=[sdk_object(vim.Folder("group-1"), {"name": "folder"})],
            token=None,
        )
        snapshot = self.client.collect()
        self.assertFalse(snapshot.complete)
        self.assertEqual(snapshot.records, [])

    def test_empty_collection_is_complete_and_destroys_view(self):
        self.collector.RetrievePropertiesEx.return_value = None
        snapshot = self.client.collect()
        self.assertTrue(snapshot.complete)
        self.assertEqual(snapshot.records, [])
        self.collector.CancelRetrievePropertiesEx.assert_not_called()
        self.assertTrue(self.stub.InvokeMethod.called)

    def test_standalone_esxi_is_distinguished(self):
        self.content.about.apiType = "HostAgent"
        self.collector.RetrievePropertiesEx.return_value = SimpleNamespace(
            objects=[], token=None
        )
        self.assertEqual(self.client.collect().source_kind, "esxi")

    def test_stop_and_limit_cancel_pagination_and_destroy_view(self):
        item = sdk_object(vim.HostSystem("host-1"), {"name": "esx"})
        self.collector.RetrievePropertiesEx.return_value = SimpleNamespace(
            objects=[item], token="pending"
        )
        self.stop.set()
        with self.assertRaises(TimeoutError):
            self.client.collect()
        self.collector.CancelRetrievePropertiesEx.assert_called_once_with(
            token="pending"
        )
        self.assertTrue(self.stub.InvokeMethod.called)
        self.stop.clear()
        self.client.config = config(Path("unused"), max_objects=1)
        self.collector.RetrievePropertiesEx.return_value = SimpleNamespace(
            objects=[item, item], token="pending2"
        )
        with self.assertRaises(ValueError):
            self.client.collect()
        self.assertEqual(
            self.collector.CancelRetrievePropertiesEx.call_args.kwargs["token"],
            "pending2",
        )

    def test_request_fault_cleans_view_and_does_not_hide_fault(self):
        self.collector.RetrievePropertiesEx.side_effect = PermissionError()
        with self.assertRaises(PermissionError):
            self.client.collect()
        self.assertTrue(self.stub.InvokeMethod.called)

    def test_continuation_fault_cancels_pending_page_even_if_cleanup_fails(self):
        self.collector.RetrievePropertiesEx.return_value = SimpleNamespace(
            objects=[], token="pending"
        )
        failure = PermissionError("pagination fault")
        self.collector.ContinueRetrievePropertiesEx.side_effect = failure
        self.collector.CancelRetrievePropertiesEx.side_effect = RuntimeError()
        self.stub.InvokeMethod.side_effect = RuntimeError()
        with self.assertRaises(PermissionError) as caught:
            self.client.collect()
        self.assertIs(caught.exception, failure)
        self.collector.CancelRetrievePropertiesEx.assert_called_once_with(
            token="pending"
        )
        self.assertTrue(self.stub.InvokeMethod.called)

    def test_traversal_deadline_stops_before_another_page(self):
        self.collector.RetrievePropertiesEx.return_value = SimpleNamespace(
            objects=[], token="pending"
        )
        with patch("VMwareAgent.vsphere.time.monotonic", side_effect=[0, 61]):
            with self.assertRaises(TimeoutError):
                self.client.collect()
        self.collector.ContinueRetrievePropertiesEx.assert_not_called()
        self.collector.CancelRetrievePropertiesEx.assert_called_once_with(
            token="pending"
        )
        self.assertTrue(self.stub.InvokeMethod.called)

    def test_close_disconnects_once_and_clears_a_failed_session(self):
        with patch(
            "VMwareAgent.vsphere.Disconnect", side_effect=RuntimeError()
        ) as close:
            with self.assertRaises(RuntimeError):
                self.client.close()
            self.assertIsNone(self.client.connection)
            self.client.close()
        close.assert_called_once_with(self.connection)

    def test_tls_verification_and_bounded_connection(self):
        self.assertEqual(self.client.context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(self.client.context.check_hostname)
        self.client.connection = None
        self.collector.RetrievePropertiesEx.return_value = SimpleNamespace(
            objects=[], token=None
        )
        with patch(
            "VMwareAgent.vsphere.Connect", return_value=self.connection
        ) as connect:
            self.client.collect()
        kwargs = connect.call_args.kwargs
        self.assertEqual(kwargs["httpConnectionTimeout"], 15)
        self.assertEqual(kwargs["version"], "vim.version.v7_0")
        self.assertEqual(kwargs["host"], "vcenter.example.com")
        self.assertEqual(kwargs["sslContext"].verify_mode, ssl.CERT_REQUIRED)

    def test_custom_ca_is_used_by_tls_context(self):
        with patch("VMwareAgent.vsphere.ssl.create_default_context") as context:
            VSphereClient(config(Path("unused"), ca_file="/etc/ca.pem"), self.stop)
        context.assert_called_once_with(cafile="/etc/ca.pem")


if __name__ == "__main__":
    unittest.main()
