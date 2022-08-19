import pathlib
from setuptools import setup

# The directory containing this file
HERE = pathlib.Path(__file__).parent

# The text of the README file
README = (HERE / "README.rst").read_text()

setup(
    name="oneuptime_sdk", # Replace with your own username
    version="1.0.0",
    author="OneUptime Limited.",
    author_email="hello@oneuptime.com",
    description="A OneUptime package that tracks error event and send logs from your applications to your oneuptime dashboard.",
    long_description=README,
    long_description_content_type="text/x-rst",
    url="https://github.com/OneUptime/PythonSDK",
    project_urls={
        "Bug Tracker": "https://github.com/OneUptime/PythonSDK/issues",
    },
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
    packages=["oneuptime_sdk"],
    python_requires=">=3.6",
    install_requires=["requests", "faker"],
)