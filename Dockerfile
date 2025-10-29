FROM python:3.11-slim

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
build-essential \
default-libmysqlclient-dev \
&& rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY src ./src

ENV PYTHONUNBUFFERED=1

CMD ["python", "-m", "src.ingest"]