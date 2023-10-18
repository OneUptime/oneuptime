# Use an official Python runtime as a parent image
FROM continuumio/anaconda3:latest

RUN conda install pytorch cpuonly -c pytorch

# Set the working directory in the container to /app
WORKDIR /app

# Copy the current directory contents into the container at /app
ADD ./Llama /app

# Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Install Hugging Face Transformers library
RUN pip install --no-cache-dir transformers

# Install acceletate
RUN pip install accelerate

# Make port 80 available to the world outside this container
EXPOSE 8547

# Run app.py when the container launches
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8547" ]
