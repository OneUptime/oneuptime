import pathlib
from setuptools import setup

# The directory containing this file
HERE = pathlib.Path(__file__).parent

# The text of the README file
README = (HERE / "README.md").read_text()

setup(
    name="fyipe-sdk", # Replace with your own username
    version="0.0.1",
    author="HackerBay, Inc.",
    author_email="hello@hackerbay.io",
    description="A Fyipe package that tracks error event and send logs from your applications to your fyipe dashboard.",
    long_description=README,
    long_description_content_type="text/markdown",
    url="https://github.com/Fyipe/python-sdk",
    project_urls={
        "Bug Tracker": "https://github.com/Fyipe/python-sdk/issues",
    },
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
    packages=["fyipe-sdk"],
    python_requires=">=3.6",
    install_requires=["requests", "faker"],
)