#!/usr/bin/env python3
"""What control-plane-clusters.sh's RabbitMQ drills need a client for.

  healthy <host>                 a queue, and a consumer that keeps up with it
  no-consumers <host>            messages in a queue nothing reads
  unacked <host>                 a consumer that takes messages and acknowledges none
  drain <host>                   deletes every queue this script made
  hold-connections <host> <n>    n connections open, each a file descriptor on the node
"""

import socket
import sys
import time

import pika

QUEUES = ["ou-consumed", "ou-unconsumed", "ou-unacked"]


def ignore(_channel, _method, _properties, _body):
    pass


def main():
    action, host = sys.argv[1], sys.argv[2]

    if action == "hold-connections":
        # The AMQP header and no more: RabbitMQ holds the socket open for the handshake
        # to go on, for as long as the drill's handshake_timeout says.
        held = []
        for _ in range(int(sys.argv[3])):
            sock = socket.create_connection((host, 5672))
            sock.sendall(b"AMQP\x00\x00\x09\x01")
            held.append(sock)
        print(f"holding {len(held)} connections", flush=True)
        time.sleep(600)
        return

    connection = pika.BlockingConnection(
        pika.ConnectionParameters(host=host, credentials=pika.PlainCredentials("guest", "guest"))
    )
    channel = connection.channel()

    if action == "healthy":
        channel.queue_declare("ou-consumed")
        channel.basic_consume("ou-consumed", ignore, auto_ack=True)
        for _ in range(100):
            channel.basic_publish("", "ou-consumed", b"ou")
        channel.start_consuming()
    elif action == "no-consumers":
        channel.queue_declare("ou-unconsumed")
        for _ in range(500):
            channel.basic_publish("", "ou-unconsumed", b"ou")
    elif action == "unacked":
        channel.queue_declare("ou-unacked")
        for _ in range(2000):
            channel.basic_publish("", "ou-unacked", b"ou")
        channel.basic_consume("ou-unacked", ignore, auto_ack=False)
        channel.start_consuming()
    elif action == "drain":
        for name in QUEUES:
            channel.queue_delete(name)
    connection.close()


if __name__ == "__main__":
    main()
