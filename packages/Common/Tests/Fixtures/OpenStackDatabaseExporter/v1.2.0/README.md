# What openstack_database_exporter v1.2.0 says

Read from [vexxhost/openstack_database_exporter](https://github.com/vexxhost/openstack_database_exporter) at tag `v1.2.0` (Apache-2.0), the image `docker-compose.yml` pins. It was read, not run. No test here has run it against a database.

- `series.json`: every series name its collectors declare, with its labels, from their `prometheus.NewDesc` calls.
- `exposition.prom`: lines of what its own unit tests expect those collectors to write for their mocked database rows, up to six per series. Nova's tests pin no lines of this form, so `OpenStackDatabaseExporterParity.test.ts` writes Nova's from the collector's source and says so.

Its rows are its tests' own, not a cloud's. What this proves is the shape, and that OneUptime's fold reads it. What real values look like on a real database needs the rig: `Tests/Ops/openstack-e2e` has no step for this yet.
