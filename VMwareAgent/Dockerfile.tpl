# Compose builds this template directly; no generated Dockerfile is needed.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt \
    && useradd --uid 10001 --create-home vmware \
    && mkdir -p /var/lib/oneuptime-vmware \
    && chown vmware:vmware /var/lib/oneuptime-vmware
COPY --chown=vmware:vmware *.py /app/VMwareAgent/
USER 10001:10001
CMD ["python", "-m", "VMwareAgent"]
