FROM docker.io/library/python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir -r requirements.txt
COPY pose.py server.py ./
USER 65534:65534
CMD ["python", "-u", "server.py"]
