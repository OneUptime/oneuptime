"""Run with python -m VMwareAgent."""

import logging
import signal
import threading

from VMwareAgent.agent import Agent
from VMwareAgent.config import Config
from VMwareAgent.transport import Exporter
from VMwareAgent.vsphere import VSphereClient


def main():
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    config = Config.from_env()
    Agent(config, VSphereClient(config, stop), Exporter(config, stop), stop).run()


if __name__ == "__main__":
    main()
