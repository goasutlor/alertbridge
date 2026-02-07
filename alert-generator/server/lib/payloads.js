/**
 * Standard alert payloads for OCP (Prometheus/Alertmanager) and Confluent Cloud.
 * Information is random-generated per call.
 */

const ALERT_NAMES = [
  'HighCPUUsage', 'PodNotReady', 'NodeMemoryPressure', 'DiskSpaceLow',
  'ContainerOOMKilled', 'DeploymentReplicasMismatch', 'TargetDown', 'Watchdog',
  'KubePodCrashLooping', 'KubeNodeNotReady', 'ClusterCritical',
];
const JOBS = ['prometheus', 'alert-generator', 'node-exporter', 'kube-state-metrics', 'custom-app'];
const INSTANCES = ['localhost:9090', 'pod-01:8080', 'worker-2:9090', 'broker-1:9092', 'api-gw:443'];
const NAMESPACES = ['openshift-monitoring', 'openshift-ingress', 'default', 'kube-system', 'openshift-machine-api'];
const PODS = ['prometheus-k8s-0', 'prometheus-k8s-1', 'alertmanager-main-0', 'node-exporter-xyz', 'kube-state-metrics-abc'];
const SEVERITIES = ['warning', 'critical', 'info'];
const SUMMARIES = [
  'High resource usage detected',
  'Instance unreachable',
  'Target is down',
  'Threshold exceeded',
  'Replica set mismatch',
  'Certificate expiring soon',
  'Connection timeout',
];
const DESCRIPTIONS = [
  'CPU usage above 80% for more than 5 minutes.',
  'Target has been down for more than 2 minutes.',
  'Disk space is below 10% on volume.',
  'Pod has been restarting repeatedly.',
  'Number of replicas does not match desired state.',
  'Description of the alert.',
  'Random load test event from Alert Generator.',
];

const CONFLUENT_TITLES = [
  'Kafka cluster expansion failure',
  'Connector in FAILED state',
  'Cloud Service Quota reached 90%',
  'Kafka cluster shrink complete',
  'Connector state: PROVISIONING to RUNNING',
  'Flink statement degraded',
];
const CONFLUENT_MESSAGES = [
  'Cluster lkc-xxxx could not complete expansion. Check Confluent Cloud console.',
  'Connector my-connector has transitioned to FAILED. Review task logs.',
  'Service quota usage has reached 90%. Consider upgrading your plan.',
  'Cluster shrink operation completed successfully.',
  'Random test notification from Alert Generator (Confluent format).',
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randHex(len = 8) {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

function ocpPayload(overrides = {}) {
  const now = new Date().toISOString();
  const v = (key, fallback) => (overrides[key] != null && String(overrides[key]).trim() !== '' ? String(overrides[key]).trim() : fallback);

  const alertname = v('alertname', pick(ALERT_NAMES));
  const job = v('job', pick(JOBS));
  const instance = v('instance', pick(INSTANCES));
  const namespace = v('namespace', pick(NAMESPACES));
  const pod = v('pod', pick(PODS));
  const severity = v('severity', pick(SEVERITIES));
  const summary = v('summary', pick(SUMMARIES));
  const description = v('description', pick(DESCRIPTIONS));
  const groupKey = `{}:{alertname="${alertname}", job="${job}"}`;
  const generatorURL = v('generatorURL', `http://prometheus:9090/graph?g0.expr=up%3D%3D0&g0.tab=1`);

  const labels = {
    alertname,
    severity,
    instance,
    job,
    namespace,
    pod,
  };
  const annotations = {
    summary,
    description,
  };

  return {
    version: '4',
    groupKey,
    status: 'firing',
    receiver: 'webhook',
    groupLabels: { alertname, job },
    commonLabels: labels,
    commonAnnotations: annotations,
    externalURL: 'http://alertmanager:9093',
    alerts: [
      {
        status: 'firing',
        labels: { ...labels },
        annotations: { ...annotations },
        startsAt: now,
        endsAt: '0001-01-01T00:00:00Z',
        generatorURL,
        fingerprint: randHex(16),
      },
    ],
    truncatedAlerts: 0,
  };
}

function confluentPayload(overrides = {}) {
  const now = new Date().toISOString();
  const v = (key, fallback) => (overrides[key] != null && String(overrides[key]).trim() !== '' ? String(overrides[key]).trim() : fallback);
  return {
    id: v('id', `evt-${Date.now()}-${randHex(6)}`),
    title: v('title', pick(CONFLUENT_TITLES)),
    message: v('message', pick(CONFLUENT_MESSAGES)),
    created_at: now,
  };
}

function deepMerge(target, source) {
  const out = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && !(source[key] instanceof Date)) {
      out[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      out[key] = source[key];
    }
  }
  return out;
}

module.exports = { ocpPayload, confluentPayload, deepMerge };
