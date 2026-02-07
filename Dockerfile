FROM python:3.11-slim

ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY app /app/app
COPY rules.example.yaml /etc/alertbridge/rules.yaml

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
