# Use an official Python runtime as a parent image
FROM huggingface/transformers-pytorch-gpu:latest

ARG IS_ENTERPRISE=false
ENV IS_ENTERPRISE=${IS_ENTERPRISE}

# Set the working directory in the container to /app
WORKDIR /app

# Copy the current directory contents into the container at /app
ADD . /app

# Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Make port 8547 available to the world outside this container
EXPOSE 8547

# Run app.py when the container launches
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8547" ]
