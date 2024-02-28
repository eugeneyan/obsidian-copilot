# Build base image
FROM python:3.9.16-slim as base

RUN apt-get update && apt-get install -y make

WORKDIR /obsidian-copilot

ENV PYTHONUNBUFFERED TRUE

COPY requirements.txt .

RUN pip install --upgrade pip \
    && pip install --no-cache-dir wheel \
    && pip install --no-cache-dir -r requirements.txt \
    && pip list

# Built slim image
FROM python:3.9.16-slim as app

WORKDIR /obsidian-copilot

COPY --from=base /usr/local/lib/python3.9/site-packages/ /usr/local/lib/python3.9/site-packages/
# copy the repo contents into the container
COPY . .

RUN chmod +x /obsidian-copilot/build.sh