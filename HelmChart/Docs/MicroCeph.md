# MicroCeph

## Install a multi node cluster

https://canonical-microceph.readthedocs-hosted.com/en/reef-stable/tutorial/multi-node/

## Ceph Dashboard 

From: https://docs.ceph.com/en/quincy/mgr/dashboard/

```
ceph mgr module enable dashboard
ceph dashboard create-self-signed-cert
```

Username and Password

```
ceph dashboard ac-user-create admin -i <file-containing-password> administrator
```

You can now access the dashboard at https://<server_ip>:8443/


## High Availability

Ceph is a highly available storage system. It is designed to be deployed on commodity hardware, and to automatically detect and respond to failures of individual components. Ceph is self-healing and self-managing, and thus very easy to operate.

Add / remove servers and add / remove disks without downtime.