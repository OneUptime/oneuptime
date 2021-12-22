# OneUptime ELK

An Elastic Search tool for advance logging for OneUptime platform

## Setup

Before running the docker-compose file there are basic things to set up on your vm

-   Install Docker and Docker Compose [docker](https://docs.docker.com/engine/install/#server) [docker-compose](https://docs.docker.com/compose/install/)
-   Setup `vm.max_map_count` value

    ```js
    // run this in your terminal
    sudo nano /etc/sysctl.conf

    // add this value to the file
    vm.max_map_count=262144
    ```

-   Copy all the files and folder here to your prefered directory on the vm

## Running

To run elastic search server in the root directory run

```bash
docker-compose up -d --build
```

## Delete Containers

```bash
docker-compose down -v
```

> `-v` flag will delete the volumes too

## Networking

To allow inbound and outbound traffic to the server, there are few ports you need to allow
| Port | Description |
| ----------- | ----------- |
| 5601 | TCP |
| 9200 | TCP |
| 9300 | TCP |
| 1515 | TCP |
| 1515 | UDP |
| 1514 | UDP |
