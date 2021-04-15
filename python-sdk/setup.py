import setuptools

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setuptools.setup(
    name="sdk-pkg-fyipe", # Replace with your own username
    version="0.0.1",
    author="HackerBay, Inc.",
    author_email="hello@hackerbay.io",
    description="A Fyipe package that tracks error event and send logs from your applications to your fyipe dashboard.",
    long_description=long_description,
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
    package_dir={"": "src"},
    packages=setuptools.find_packages(where="src"),
    python_requires=">=3.6",
)