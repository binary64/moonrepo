#!/bin/bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y \
	curl \
	ca-certificates \
	gnupg \
	lsb-release \
	apt-transport-https \
	jq \
	git

# Disable swap (required)
swapoff -a
sed -i '/ swap / s/^/#/' /etc/fstab

# Required kernel modules
cat <<EOF >/etc/modules-load.d/rke2.conf
overlay
br_netfilter
EOF

modprobe overlay
modprobe br_netfilter

# Required sysctls
cat <<EOF >/etc/sysctl.d/99-rke2.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF

sysctl --system

mkdir -p /etc/rancher/rke2

cat <<EOF >/etc/rancher/rke2/config.yaml
write-kubeconfig-mode: "0600"
tls-san:
  - $(hostname -f)
cni: canal
disable:
  - rke2-ingress-nginx
EOF

mkdir -p /var/lib/rancher/rke2/server/manifests

cat <<EOF >/var/lib/rancher/rke2/server/manifests/10-argocd.yaml
apiVersion: helm.cattle.io/v1
kind: HelmChart
metadata:
  name: argocd
  namespace: kube-system
spec:
  chart: argo-cd
  repo: https://argoproj.github.io/argo-helm
  version: 6.7.12
  targetNamespace: argocd
  createNamespace: true
  valuesContent: |
    server:
      extraArgs:
        - --insecure
    controller:
      metrics:
        enabled: true
    applicationSet:
      enabled: true
EOF

cat <<EOF >/var/lib/rancher/rke2/server/manifests/20-infra-root.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: infra-root
  namespace: argocd
spec:
  source:
    repoURL: https://github.com/binary64/moonrepo.git
    targetRevision: main
    path: infra/app-of-apps
  destination:
    server: https://kubernetes.default.svc
    namespace: argocd
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
EOF

curl -sfL https://get.rke2.io | sh -

systemctl enable rke2-server

echo "*** Installed. Now apt upgrade and reboot."
