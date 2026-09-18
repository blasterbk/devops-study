import yaml from 'js-yaml';

// Eager glob import of raw MDX files
const rawDocs = import.meta.glob('../../docs/**/*.mdx', { query: '?raw', eager: true });

function parseFrontmatter(rawContent) {
  if (!rawContent) return { frontmatter: {}, body: '' };
  
  const cleaned = rawContent.replace(/^\uFEFF/, '');
  const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = cleaned.match(fmRegex);
  
  if (match) {
    try {
      const frontmatter = yaml.load(match[1]) || {};
      const body = match[2] || '';
      return { frontmatter, body };
    } catch (err) {
      console.error('Error parsing YAML frontmatter:', err);
    }
  }
  
  return { frontmatter: {}, body: rawContent };
}

function cleanTitle(rawTitle) {
  if (!rawTitle) return '';
  // Strip "Chapter X — " or "Chapter X - " prefix if present for clean display
  return rawTitle.replace(/^Chapter\s+\d+\s*[—\-]\s*/i, '').trim();
}

export const MAIN_MODULES = [
  {
    dirName: "master-definitions-glossary",
    name: "📖 Master Definitions & Glossary",
    submodules: [
      { folder: "master-definitions-glossary", label: "Master Glossary" }
    ]
  },
  {
    dirName: "module-01-core-architecture",
    name: "Module 1: Kubernetes Core Architecture",
    submodules: [
      { folder: "01-control-plane", label: "1.1 Control Plane" },
      { folder: "02-api-server-and-client-go", label: "1.2 API Machinery" },
      { folder: "03-etcd-internals", label: "1.3 etcd" },
      { folder: "04-kubernetes-scheduler", label: "1.4 Scheduler" },
      { folder: "05-controller-manager", label: "1.5 Controller Manager" },
      { folder: "06-kubelet-internals", label: "1.6 kubelet" },
      { folder: "07-container-runtime", label: "1.7 Container Runtime" },
      { folder: "08-kube-proxy-internals", label: "1.8 kube-proxy" },
      { folder: "09-crds-and-operators", label: "1.9 CRDs & Operators" },
      { folder: "10-admission-controllers", label: "1.10 Admission Controllers" }
    ]
  },
  {
    dirName: "module-02-networking",
    name: "Module 2: Networking",
    submodules: [
      { folder: "01-networking-fundamentals", label: "2.1 Networking Fundamentals" },
      { folder: "02-cni", label: "2.2 CNI" },
      { folder: "03-ebpf", label: "2.3 eBPF" },
      { folder: "04-services", label: "2.4 Services" },
      { folder: "05-ingress", label: "2.5 Ingress" },
      { folder: "06-gateway-api", label: "2.6 Gateway API" },
      { folder: "07-dns", label: "2.7 DNS" },
      { folder: "08-network-security", label: "2.8 Network Security" },
      { folder: "09-service-mesh", label: "2.9 Service Mesh" },
      { folder: "10-multi-cluster-networking", label: "2.10 Multi-Cluster Networking" }
    ]
  },
  {
    dirName: "module-03-workloads-and-scheduling",
    name: "Module 3: Workloads & Scheduling",
    submodules: [
      { folder: "01-pods-and-containers", label: "3.1 Pods & Container Lifecycle" },
      { folder: "02-deployments-and-replicasets", label: "3.2 Deployments & ReplicaSets" },
      { folder: "03-statefulsets", label: "3.3 StatefulSets" },
      { folder: "04-daemonsets", label: "3.4 DaemonSets" },
      { folder: "05-jobs-and-cronjobs", label: "3.5 Jobs & CronJobs" },
      { folder: "06-advanced-scheduling", label: "3.6 Advanced Scheduling & Placement" },
      { folder: "07-pod-priority-preemption-and-qos", label: "3.7 Pod Priority, Preemption & QoS" },
      { folder: "08-autoscaling-hpa-vpa-keda", label: "3.8 Autoscaling (HPA, VPA, KEDA)" },
      { folder: "09-custom-workloads-and-operators", label: "3.9 Custom Workload Operators" },
      { folder: "10-batch-and-hpc-scheduling", label: "3.10 Batch & HPC Scheduling" }
    ]
  },
  {
    dirName: "module-04-storage",
    name: "Module 4: Storage",
    submodules: [
      { folder: "01-volumes-and-mounts", label: "4.1 Volumes & Mounts" },
      { folder: "02-persistent-volumes-and-claims", label: "4.2 PersistentVolumes & Claims" },
      { folder: "03-storageclasses-and-dynamic-provisioning", label: "4.3 StorageClasses & Dynamic Provisioning" },
      { folder: "04-csi-container-storage-interface-internals", label: "4.4 Container Storage Interface (CSI) Internals" },
      { folder: "05-ephemeral-inline-volumes-and-csi-ephemeral-volumes", label: "4.5 Ephemeral & CSI Inline Volumes" },
      { folder: "06-volume-expansion-and-snapshots", label: "4.6 Volume Expansion & Snapshots" },
      { folder: "07-storage-security-and-permissions", label: "4.7 Storage Security, Permissions & Secrets" },
      { folder: "08-block-storage-vs-file-storage-vs-object-storage", label: "4.8 Block, File, & Object Storage (Ceph/Rook)" },
      { folder: "09-cloud-storage-integrations-aws-gcp-azure", label: "4.9 Cloud Storage Integrations (AWS/GCP/Azure)" },
      { folder: "10-disaster-recovery-backup-and-migration", label: "4.10 Disaster Recovery, Backup & Migration (Velero)" }
    ]
  },
  {
    dirName: "module-05-security",
    name: "Module 5: Security",
    submodules: [
      { folder: "01-authentication-and-identity-providers", label: "5.1 Authentication & Identity Providers" },
      { folder: "02-authorization-and-rbac-internals", label: "5.2 Authorization & RBAC Internals" },
      { folder: "03-service-account-tokens-and-oidc-federation", label: "5.3 ServiceAccount Tokens & OIDC Federation" },
      { folder: "04-pod-security-standards-and-admission-control", label: "5.4 Pod Security Standards & Admission Control" },
      { folder: "05-network-policies-and-microsegmentation", label: "5.5 NetworkPolicies & Microsegmentation" },
      { folder: "06-secrets-management-and-encryption-at-rest", label: "5.6 Secrets Management & KMS Encryption" },
      { folder: "07-runtime-security-seccomp-apparmor-selinux", label: "5.7 Runtime Security (Seccomp, AppArmor, SELinux)" },
      { folder: "08-vulnerability-scanning-and-image-security", label: "5.8 Image Security, Supply Chain & Cosign" },
      { folder: "09-runtime-threat-detection-falco-and-ebpf", label: "5.9 Runtime Threat Detection (Falco & eBPF)" },
      { folder: "10-cluster-hardening-and-cis-benchmarks", label: "5.10 Cluster Hardening, CIS & Audit Logging" }
    ]
  },
  {
    dirName: "module-06-observability",
    name: "Module 6: Observability",
    submodules: [
      { folder: "01-metrics-architecture-and-metrics-server", label: "6.1 Metrics Architecture & Metrics Server" },
      { folder: "02-prometheus-architecture-and-promql", label: "6.2 Prometheus & PromQL" },
      { folder: "03-logging-architecture-and-log-aggregation", label: "6.3 Logging Architecture & Vector/Loki" },
      { folder: "04-distributed-tracing-opentelemetry-and-jaeger", label: "6.4 Distributed Tracing & OpenTelemetry" },
      { folder: "05-health-probes-and-readiness-liveness-startup", label: "6.5 Health Probes (Liveness, Readiness, Startup)" },
      { folder: "06-ebpf-observability-cilium-hubble-and-pixie", label: "6.6 eBPF Observability (Cilium Hubble & Pixie)" },
      { folder: "07-event-exporter-and-kubernetes-events", label: "6.7 Kubernetes Events & Event Exporter" },
      { folder: "08-dashboarding-grafana-and-golden-signals", label: "6.8 Grafana & The 4 Golden Signals" },
      { folder: "09-cost-observability-and-kubecost", label: "6.9 Cost Observability & Kubecost" },
      { folder: "10-production-observability-troubleshooting-labs", label: "6.10 Production Observability & CPU Throttling Labs" }
    ]
  },
  {
    dirName: "module-07-reliability-and-production-operations",
    name: "Module 7: Reliability & Production Operations",
    submodules: [
      { folder: "01-cluster-high-availability-and-control-plane-topology", label: "7.1 Control Plane HA & Topologies" },
      { folder: "02-etcd-operations-backup-restore-and-defrag", label: "7.2 etcd Operations, Backups & Defrag" },
      { folder: "03-cluster-upgrades-and-version-lifecycle", label: "7.3 Cluster Upgrades & Version Skew" },
      { folder: "04-cluster-autoscaling-and-karpenter", label: "7.4 Cluster Autoscaler & Karpenter" },
      { folder: "05-node-lifecycle-management-and-problem-detector", label: "7.5 Node Lifecycle & NodeProblemDetector" },
      { folder: "06-chaos-engineering-and-resilience-testing", label: "7.6 Chaos Engineering & Resilience" },
      { folder: "07-resource-management-quotas-and-limitranges", label: "7.7 ResourceQuotas & LimitRanges" },
      { folder: "08-ingress-controllers-and-edge-routing", label: "7.8 Ingress Controllers & cert-manager" },
      { folder: "09-gateway-api-and-next-gen-traffic-routing", label: "7.9 Gateway API & Traffic Splitting" },
      { folder: "10-disaster-recovery-runbooks-and-outage-postmortems", label: "7.10 Production Runbooks & Outage Recovery" }
    ]
  },
  {
    dirName: "module-08-cicd-and-gitops",
    name: "Module 8: CI/CD & GitOps",
    submodules: [
      { folder: "01-gitops-principles-and-declarative-delivery", label: "8.1 GitOps Principles & Declarative Delivery" },
      { folder: "02-argo-cd-architecture-and-reconciliation", label: "8.2 Argo CD Architecture & Sync Engine" },
      { folder: "03-flux-cd-v2-architecture-and-gitops-toolkit", label: "8.3 Flux CD v2 & GitOps Toolkit" },
      { folder: "04-progressive-delivery-argo-rollouts-and-flagger", label: "8.4 Progressive Delivery & Argo Rollouts" },
      { folder: "05-helm-chart-architecture-and-templating", label: "8.5 Helm v3 Architecture & Templating" },
      { folder: "06-kustomize-declarative-configuration-management", label: "8.6 Kustomize Base & Overlay Management" },
      { folder: "07-tekton-pipelines-and-cloud-native-ci", label: "8.7 Tekton Cloud-Native CI Pipelines" },
      { folder: "08-secret-management-in-gitops-sops-and-sealed-secrets", label: "8.8 GitOps Secret Management (SOPS/SealedSecrets)" },
      { folder: "09-image-automation-and-auto-promotion", label: "8.9 Automated Image Updates & Git Auto-Commit" },
      { folder: "10-production-gitops-troubleshooting-labs", label: "8.10 Production GitOps Troubleshooting & Sync Labs" }
    ]
  },
  {
    dirName: "module-09-multi-cluster-and-fleet-management",
    name: "Module 9: Multi-Cluster & Fleet Management",
    submodules: [
      { folder: "01-multi-cluster-architectures-and-patterns", label: "9.1 Multi-Cluster Topologies & Patterns" },
      { folder: "02-cluster-api-capi-and-declarative-infrastructure", label: "9.2 Cluster API (CAPI) & Declarative Infra" },
      { folder: "03-rancher-argo-cd-and-fleet-management-at-scale", label: "9.3 Fleet Management & GitOps at Scale" },
      { folder: "04-multi-cluster-networking-and-service-mesh", label: "9.4 Multi-Cluster Networking & Service Mesh" },
      { folder: "05-submariner-and-cross-cluster-service-discovery", label: "9.5 Submariner & Multi-Cluster Services" },
      { folder: "06-open-cluster-management-ocm-and-policy-enforcement", label: "9.6 Open Cluster Management (OCM) & Placement" },
      { folder: "07-multi-cluster-observability-thanos-and-mimir", label: "9.7 Multi-Cluster Observability (Thanos/Mimir)" },
      { folder: "08-identity-federation-and-cross-cluster-rbac", label: "9.8 Multi-Cluster Identity & OIDC Federation" },
      { folder: "09-disaster-recovery-and-failover-strategies", label: "9.9 Multi-Cluster DR & GSLB Failover" },
      { folder: "10-production-fleet-management-troubleshooting-labs", label: "9.10 Fleet Troubleshooting & CAPI Labs" }
    ]
  },
  {
    dirName: "module-10-ai-ml-workloads-and-gpus",
    name: "Module 10: AI/ML Workloads, GPUs & Cloud-Native Innovations",
    submodules: [
      { folder: "01-nvidia-gpu-operator-and-cuda-container-runtime", label: "10.1 NVIDIA GPU Operator & CUDA Runtime" },
      { folder: "02-dynamic-resource-allocation-dra-api", label: "10.2 Dynamic Resource Allocation (DRA) API" },
      { folder: "03-kuberay-operator-and-ray-clusters-on-kubernetes", label: "10.3 KubeRay Operator & Ray Clusters" },
      { folder: "04-kueue-batch-queuing-and-multi-tenant-gpu-quotas", label: "10.4 Kueue Batch Queuing & GPU Quotas" },
      { folder: "05-llm-model-serving-vllm-triton-and-kserve", label: "10.5 LLM Model Serving (vLLM, Triton, KServe)" },
      { folder: "06-vector-databases-milvus-qdrant-and-pgvector", label: "10.6 Vector Databases (Milvus, Qdrant, pgvector)" },
      { folder: "07-webassembly-wasm-and-runwasi-in-kubernetes", label: "10.7 WebAssembly (Wasm) & runwasi" },
      { folder: "08-confidential-containers-coco-and-katacontainers", label: "10.8 Confidential Containers & Kata" },
      { folder: "09-finops-gpu-cost-optimization-and-spot-gpus", label: "10.9 FinOps GPU Cost Optimization" },
      { folder: "10-ai-ml-infrastructure-troubleshooting-labs", label: "10.10 AI/ML Infrastructure Troubleshooting Labs" }
    ]
  }
];

export const CONTAINERS_MODULES = [
  {
    dirName: "module-01-container-fundamentals",
    name: "Module 1: Container Fundamentals",
    submodules: [
      { folder: "01-introduction-to-containers", label: "1.1 Introduction to Containers" },
      { folder: "02-container-architecture", label: "1.2 Container Architecture" },
      { folder: "03-container-ecosystem", label: "1.3 Container Ecosystem" },
      { folder: "04-container-use-cases", label: "1.4 Container Use Cases" }
    ]
  },
  {
    dirName: "module-02-open-container-initiative-oci",
    name: "Module 2: OCI (Open Container Initiative)",
    submodules: [
      { folder: "01-oci-overview-and-standardization", label: "2.1 OCI Overview" },
      { folder: "02-oci-image-specification", label: "2.2 OCI Image Specification" },
      { folder: "03-oci-runtime-specification", label: "2.3 OCI Runtime Specification" },
      { folder: "04-oci-distribution-specification", label: "2.4 OCI Distribution Specification" }
    ]
  },
  {
    dirName: "module-03-linux-namespaces",
    name: "Module 3: Linux Namespaces",
    submodules: [
      { folder: "01-namespace-fundamentals", label: "3.1 Namespace Fundamentals" },
      { folder: "02-namespace-types", label: "3.2 Namespace Types" },
      { folder: "03-namespace-tools", label: "3.3 Namespace Tools" },
      { folder: "04-practical-namespace-debugging", label: "3.4 Practical Debugging" }
    ]
  },
  {
    dirName: "module-04-linux-cgroups",
    name: "Module 4: Linux cgroups",
    submodules: [
      { folder: "01-cgroups-fundamentals", label: "4.1 cgroups Fundamentals" },
      { folder: "02-cgroup-v1-vs-cgroup-v2", label: "4.2 cgroup v1 vs v2" },
      { folder: "03-resource-management", label: "4.3 Resource Management" },
      { folder: "04-monitoring-and-pressure-stall-information", label: "4.4 Monitoring & PSI" }
    ]
  },
  {
    dirName: "module-05-union-filesystems-overlayfs",
    name: "Module 5: Union Filesystems (OverlayFS)",
    submodules: [
      { folder: "01-filesystem-fundamentals", label: "5.1 Filesystem Fundamentals" },
      { folder: "02-overlayfs-internals", label: "5.2 OverlayFS Internals" },
      { folder: "03-storage-drivers", label: "5.3 Storage Drivers" },
      { folder: "04-performance-and-layer-caching", label: "5.4 Performance & Layer Caching" }
    ]
  },
  {
    dirName: "module-06-docker-internals",
    name: "Module 6: Docker Internals",
    submodules: [
      { folder: "01-docker-architecture", label: "6.1 Docker Architecture" },
      { folder: "02-docker-objects", label: "6.2 Docker Objects" },
      { folder: "03-container-lifecycle", label: "6.3 Container Lifecycle" },
      { folder: "04-docker-networking", label: "6.4 Docker Networking" },
      { folder: "05-docker-storage", label: "6.5 Docker Storage" }
    ]
  },
  {
    dirName: "module-07-containerd",
    name: "Module 7: containerd",
    submodules: [
      { folder: "01-containerd-architecture", label: "7.1 containerd Architecture" },
      { folder: "02-containerd-components", label: "7.2 Core Components" },
      { folder: "03-containerd-shim", label: "7.3 containerd-shim & TTY" },
      { folder: "04-containerd-cli-and-ecosystem", label: "7.4 CLI & Snapshotters" }
    ]
  },
  {
    dirName: "module-08-runc",
    name: "Module 8: runc",
    submodules: [
      { folder: "01-runc-architecture", label: "8.1 runc Architecture" },
      { folder: "02-low-level-container-execution", label: "8.2 Container Lifecycle" },
      { folder: "03-alternative-runtimes", label: "8.3 Alternative Runtimes (Crun, Youki)" },
      { folder: "04-runc-security-and-cves", label: "8.4 runc Security & CVEs" }
    ]
  },
  {
    dirName: "module-09-container-registries",
    name: "Module 9: Container Registries",
    submodules: [
      { folder: "01-registry-architecture", label: "9.1 Registry Architecture" },
      { folder: "02-distribution-spec-api", label: "9.2 Distribution Spec API" },
      { folder: "03-registry-implementations", label: "9.3 Registry Implementations" },
      { folder: "04-registry-security-and-signing", label: "9.4 Security & Image Signing" }
    ]
  },
  {
    dirName: "module-10-buildkit",
    name: "Module 10: BuildKit",
    submodules: [
      { folder: "01-buildkit-architecture", label: "10.1 BuildKit Architecture" },
      { folder: "02-low-level-builder-llb", label: "10.2 LLB & Build DAG" },
      { folder: "03-caching-mechanisms", label: "10.3 Caching & Concurrency" },
      { folder: "04-advanced-dockerfile-features", label: "10.4 Advanced Dockerfile Features" }
    ]
  },
  {
    dirName: "module-11-image-optimization",
    name: "Module 11: Image Optimization",
    submodules: [
      { folder: "01-multi-stage-builds", label: "11.1 Multi-Stage Builds" },
      { folder: "02-minimal-base-images", label: "11.2 Minimal Base Images" },
      { folder: "03-layer-caching-strategies", label: "11.3 Layer Caching Strategies" },
      { folder: "04-image-security-and-hardening", label: "11.4 Image Security & Hardening" }
    ]
  },
  {
    dirName: "module-12-container-runtime-interface-cri",
    name: "Module 12: Container Runtime Interface (CRI)",
    submodules: [
      { folder: "01-cri-architecture", label: "12.1 CRI Architecture" },
      { folder: "02-cri-services", label: "12.2 CRI Services & gRPC" },
      { folder: "03-crio-internals", label: "12.3 CRI-O Internals" },
      { folder: "04-streaming-and-metrics", label: "12.4 Streaming & Metrics" }
    ]
  },
  {
    dirName: "module-13-rootless-containers",
    name: "Module 13: Rootless Containers",
    submodules: [
      { folder: "01-rootless-architecture", label: "13.1 Rootless Architecture" },
      { folder: "02-rootless-networking", label: "13.2 Rootless Networking" },
      { folder: "03-rootless-storage", label: "13.3 Rootless Storage" },
      { folder: "04-podman-rootless", label: "13.4 Podman Rootless & Quadlets" }
    ]
  },
  {
    dirName: "module-14-container-security",
    name: "Module 14: Container Security",
    submodules: [
      { folder: "01-linux-capabilities", label: "14.1 Linux Capabilities" },
      { folder: "02-seccomp-profiles", label: "14.2 Seccomp Profiles" },
      { folder: "03-apparmor-and-selinux", label: "14.3 AppArmor & SELinux" },
      { folder: "04-container-breakouts", label: "14.4 Container Breakouts & CVEs" },
      { folder: "05-security-benchmarks", label: "14.5 CIS, Trivy & Falco" }
    ]
  },
  {
    dirName: "module-15-container-performance-and-troubleshooting",
    name: "Module 15: Container Performance & Troubleshooting",
    submodules: [
      { folder: "01-resource-profiling", label: "15.1 Resource Profiling & Throttling" },
      { folder: "02-troubleshooting-tools", label: "15.2 Troubleshooting Tools (nsenter, strace)" },
      { folder: "03-oom-and-crash-analysis", label: "15.3 OOM & Crash Forensics" },
      { folder: "04-production-best-practices", label: "15.4 Production Best Practices" }
    ]
  }
];

export const NETWORKING_MODULES = [
  {
    dirName: "module-01-networking-fundamentals",
    name: "Module 1: Networking Fundamentals",
    submodules: [
      { folder: "01-computer-networks", label: "1.1 Computer Networks" },
      { folder: "02-data-transmission", label: "1.2 Data Transmission" },
      { folder: "03-bandwidth-and-latency", label: "1.3 Bandwidth & Latency" },
      { folder: "04-network-devices", label: "1.4 Network Devices" }
    ]
  },
  {
    dirName: "module-02-osi-model",
    name: "Module 2: OSI Model",
    submodules: [
      { folder: "01-layer-1-physical", label: "2.1 Layer 1: Physical Layer" },
      { folder: "02-layer-2-data-link", label: "2.2 Layer 2: Data Link Layer" },
      { folder: "03-layer-3-network", label: "2.3 Layer 3: Network Layer" },
      { folder: "04-layer-4-transport", label: "2.4 Layer 4: Transport Layer" },
      { folder: "05-layer-5-session", label: "2.5 Layer 5: Session Layer" },
      { folder: "06-layer-6-presentation", label: "2.6 Layer 6: Presentation Layer" },
      { folder: "07-layer-7-application", label: "2.7 Layer 7: Application Layer" }
    ]
  },
  {
    dirName: "module-03-tcp-ip",
    name: "Module 3: TCP/IP",
    submodules: [
      { folder: "01-ipv4-addressing", label: "3.1 IPv4 Addressing & Subnetting" },
      { folder: "02-ipv6-addressing", label: "3.2 IPv6 & Dual Stack" },
      { folder: "03-tcp-protocol", label: "3.3 TCP Protocol Deep Dive" },
      { folder: "04-udp-protocol", label: "3.4 UDP Protocol & Datagrams" },
      { folder: "05-icmp-protocol", label: "3.5 ICMP & Diagnostics" }
    ]
  },
  {
    dirName: "module-04-http-protocol",
    name: "Module 4: HTTP Protocol",
    submodules: [
      { folder: "01-http-1-1", label: "4.1 HTTP/1.1 & Semantics" },
      { folder: "02-http-2", label: "4.2 HTTP/2 & Multiplexing" },
      { folder: "03-http-3-and-quic", label: "4.3 HTTP/3 & QUIC" },
      { folder: "04-rest-apis", label: "4.4 REST APIs & Idempotency" },
      { folder: "05-grpc-and-protobuf", label: "4.5 gRPC & Protobuf" }
    ]
  },
  {
    dirName: "module-05-dns",
    name: "Module 5: DNS",
    submodules: [
      { folder: "01-dns-fundamentals", label: "5.1 DNS Architecture & Hierarchy" },
      { folder: "02-dns-records", label: "5.2 DNS Record Types" },
      { folder: "03-advanced-dns", label: "5.3 Advanced DNS & Security" }
    ]
  },
  {
    dirName: "module-06-dhcp-and-ip-management",
    name: "Module 6: DHCP & IP Management",
    submodules: [
      { folder: "01-dhcp-process-and-dora", label: "6.1 DHCP Process & DORA" },
      { folder: "02-ipam-and-ip-management", label: "6.2 IPAM & Address Lifecycle" }
    ]
  },
  {
    dirName: "module-07-routing",
    name: "Module 7: Routing",
    submodules: [
      { folder: "01-routing-concepts", label: "7.1 Routing Concepts & Tables" },
      { folder: "02-routing-algorithms", label: "7.2 Routing Algorithms" },
      { folder: "03-route-selection", label: "7.3 Route Selection & Metrics" }
    ]
  },
  {
    dirName: "module-08-bgp",
    name: "Module 8: BGP",
    submodules: [
      { folder: "01-bgp-fundamentals", label: "8.1 BGP Fundamentals & AS" },
      { folder: "02-bgp-policies-and-attributes", label: "8.2 BGP Policies & Attributes" },
      { folder: "03-internet-routing", label: "8.3 Internet Peering & Transit" },
      { folder: "04-kubernetes-bgp", label: "8.4 Kubernetes BGP (Calico/Cilium)" }
    ]
  },
  {
    dirName: "module-09-ospf",
    name: "Module 9: OSPF",
    submodules: [
      { folder: "01-ospf-fundamentals-and-areas", label: "9.1 OSPF Fundamentals & Areas" },
      { folder: "02-ospf-operations-and-tuning", label: "9.2 OSPF Operations & Dijkstra SPF" }
    ]
  },
  {
    dirName: "module-10-overlay-networking",
    name: "Module 10: Overlay Networking",
    submodules: [
      { folder: "01-vxlan-architecture", label: "10.1 VXLAN Architecture & VTEP" },
      { folder: "02-gre-and-ipip", label: "10.2 GRE & IPIP Encapsulation" },
      { folder: "03-mpls-and-labels", label: "10.3 MPLS & Label Switching" },
      { folder: "04-evpn-and-vxlan-fabrics", label: "10.4 EVPN & Data Center Fabrics" }
    ]
  },
  {
    dirName: "module-11-vpn",
    name: "Module 11: VPN",
    submodules: [
      { folder: "01-wireguard-architecture", label: "11.1 WireGuard Modern VPN" },
      { folder: "02-ipsec-architecture", label: "11.2 IPSec & IKEv2" },
      { folder: "03-openvpn-architecture", label: "11.3 OpenVPN & TLS Certificates" }
    ]
  },
  {
    dirName: "module-12-firewalls",
    name: "Module 12: Firewalls",
    submodules: [
      { folder: "01-iptables-architecture", label: "12.1 iptables Chains & Tables" },
      { folder: "02-nftables-architecture", label: "12.2 nftables Architecture & Sets" },
      { folder: "03-linux-firewall-tools", label: "12.3 UFW & firewalld Frontends" }
    ]
  },
  {
    dirName: "module-13-ebpf-networking",
    name: "Module 13: eBPF Networking",
    submodules: [
      { folder: "01-ebpf-fundamentals", label: "13.1 eBPF Architecture & Hooks" },
      { folder: "02-xdp-and-tc-datapaths", label: "13.2 XDP & TC Fast Datapaths" },
      { folder: "03-cilium-ebpf-datapath", label: "13.3 Cilium eBPF Datapath & kube-proxy" }
    ]
  },
  {
    dirName: "module-14-load-balancing",
    name: "Module 14: Load Balancing",
    submodules: [
      { folder: "01-load-balancing-algorithms", label: "14.1 Load Balancing Algorithms" },
      { folder: "02-l4-vs-l7-load-balancing", label: "14.2 L4 vs L7 & GSLB" },
      { folder: "03-enterprise-load-balancers", label: "14.3 NGINX, HAProxy & Envoy" }
    ]
  },
  {
    dirName: "module-15-service-mesh",
    name: "Module 15: Service Mesh",
    submodules: [
      { folder: "01-service-mesh-architecture", label: "15.1 Istio, Linkerd & Sidecars" },
      { folder: "02-traffic-and-security-features", label: "15.2 mTLS, Traffic Splitting & Resilience" },
      { folder: "03-ambient-mesh", label: "15.3 Ambient Mesh & Sidecarless Data Plane" }
    ]
  },
  {
    dirName: "module-16-cdn",
    name: "Module 16: CDN",
    submodules: [
      { folder: "01-cdn-architecture", label: "16.1 CDN Architecture & Edge POPs" },
      { folder: "02-web-performance-optimization", label: "16.2 Edge Caching & Compression" },
      { folder: "03-edge-security-and-ddos", label: "16.3 WAF & DDoS Mitigation" }
    ]
  },
  {
    dirName: "module-17-cloud-networking",
    name: "Module 17: Cloud Networking",
    submodules: [
      { folder: "01-vpc-architecture", label: "17.1 Cloud VPC & Subnet Design" },
      { folder: "02-cloud-connectivity", label: "17.2 NAT, Transit Gateways & Peering" },
      { folder: "03-hybrid-cloud-connectivity", label: "17.3 Direct Connect & Hybrid VPN" }
    ]
  },
  {
    dirName: "module-18-kubernetes-networking",
    name: "Module 18: Kubernetes Networking",
    submodules: [
      { folder: "01-cni-and-pod-networking", label: "18.1 CNI & Pod Networking" },
      { folder: "02-service-networking-and-dns", label: "18.2 Services, kube-proxy & CoreDNS" },
      { folder: "03-ingress-and-gateway-api", label: "18.3 Ingress & Gateway API" },
      { folder: "04-network-policies-and-cni-plugins", label: "18.4 NetworkPolicies & Cilium/Calico" }
    ]
  },
  {
    dirName: "module-19-network-security",
    name: "Module 19: Network Security",
    submodules: [
      { folder: "01-zero-trust-and-perimeter-defense", label: "19.1 Zero Trust, IDS/IPS & WAF" },
      { folder: "02-cryptography-and-workload-identity", label: "19.2 TLS 1.3, mTLS & SPIFFE/SPIRE" }
    ]
  },
  {
    dirName: "module-20-network-performance-and-troubleshooting",
    name: "Module 20: Network Performance & Troubleshooting",
    submodules: [
      { folder: "01-network-monitoring-and-telemetry", label: "20.1 Telemetry (NetFlow, sFlow, SNMP)" },
      { folder: "02-linux-network-diagnostic-toolkit", label: "20.2 Linux Toolkit (tcpdump, ss, iperf3)" },
      { folder: "03-production-network-incident-runbooks", label: "20.3 Production Incident Runbooks" }
    ]
  }
];

export const ROOT_CATEGORIES = [
  {
    name: "Networking",
    dirName: "networking",
    modules: NETWORKING_MODULES
  },
  {
    name: "Containers",
    dirName: "containers",
    modules: CONTAINERS_MODULES
  },
  {
    name: "Kubernetes",
    dirName: "kubernetes",
    modules: MAIN_MODULES
  }
];

export function loadAllDocs() {
  const docs = [];
  const folderDocsMap = {};

  for (const [filePath, rawObj] of Object.entries(rawDocs)) {
    const rawText = typeof rawObj === 'string' ? rawObj : (rawObj.default || '');
    const { frontmatter, body } = parseFrontmatter(rawText);
    
    const parts = filePath.split('/');
    const fileName = parts[parts.length - 1];
    const folderName = parts[parts.length - 2];
    
    const docId = `${folderName}/${fileName}`;
    const displayTitle = cleanTitle(frontmatter.title || fileName.replace(/\.mdx$/, ''));
    
    const docItem = {
      id: docId,
      path: filePath,
      folder: folderName,
      fileName,
      title: displayTitle,
      fullTitle: frontmatter.title || displayTitle,
      module: frontmatter.module || folderName,
      sidebar_position: frontmatter.sidebar_position || 1,
      description: frontmatter.description || '',
      body,
      rawText
    };
    
    docs.push(docItem);

    if (!folderDocsMap[folderName]) {
      folderDocsMap[folderName] = [];
    }
    folderDocsMap[folderName].push(docItem);
  }

  // Sort chapters inside each folder
  for (const folder in folderDocsMap) {
    folderDocsMap[folder].sort((a, b) => (a.sidebar_position || 0) - (b.sidebar_position || 0));
  }

  // Construct Category Tree with Root "Kubernetes" item
  const categoryTree = ROOT_CATEGORIES.map(cat => {
    const modules = cat.modules.map(mainMod => {
      const submodules = mainMod.submodules.map(sub => {
        const chapters = folderDocsMap[sub.folder] || [];
        return {
          ...sub,
          chapters
        };
      });

      return {
        name: mainMod.name,
        submodules
      };
    });

    return {
      name: cat.name,
      modules
    };
  });

  // For backward compatibility, also export moduleTree (the first category's modules)
  const moduleTree = categoryTree[0].modules;

  return { docs, categoryTree, moduleTree };
}
