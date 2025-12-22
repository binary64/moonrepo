#!/bin/bash
set -euo pipefail

# If we are root, bail
if [ "$(id -u)" = "0" ]; then
	echo "Please run as a non-root user."
	exit 1
fi

export DEBIAN_FRONTEND=noninteractive

sudo apt-get update
sudo apt-get install -y \
	curl \
	ca-certificates \
	gnupg \
	lsb-release \
	apt-transport-https \
	jq \
	git

# Disable swap (required)
sudo swapoff -a
sudo sed -i '/ swap / s/^/#/' /etc/fstab

# Required kernel modules
cat <<EOF | sudo tee /etc/modules-load.d/rke2.conf >/dev/null
overlay
br_netfilter
EOF

# Required sysctls
cat <<EOF | sudo tee /etc/sysctl.d/99-rke2.conf >/dev/null
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF

sudo sysctl --system

sudo mkdir -p /etc/rancher/rke2

cat <<EOF | sudo tee /etc/rancher/rke2/config.yaml >/dev/null
write-kubeconfig-mode: "0600"
tls-san:
  - $(hostname -f)
cni: canal
disable:
  - rke2-ingress-nginx
EOF

sudo mkdir -p /var/lib/rancher/rke2/server/manifests

cat <<EOF | sudo tee /var/lib/rancher/rke2/server/manifests/10-argocd.yaml >/dev/null
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

cat <<EOF | sudo tee /var/lib/rancher/rke2/server/manifests/20-infra-root.yaml >/dev/null
apiVersion: helm.cattle.io/v1
kind: HelmChart
metadata:
  name: infra-root
  namespace: kube-system
spec:
  chart: argocd-apps
  repo: https://argoproj.github.io/argo-helm
  version: 2.0.2
  targetNamespace: argocd
  valuesContent: |
    applications:
      infra-root:
        namespace: argocd
        project: default
        source:
          repoURL: https://github.com/binary64/moonrepo.git
          targetRevision: master
          path: infra/app-of-apps
          directory:
            recurse: true
        destination:
          server: https://kubernetes.default.svc
          namespace: argocd
        syncPolicy:
          automated:
            prune: true
            selfHeal: true
EOF

curl -sfL https://get.rke2.io | sudo sh -

sudo systemctl enable rke2-server

# Setup kubectl
sudo ln -s /var/lib/rancher/rke2/bin/kubectl /usr/local/bin/kubectl
cat <<EOF >>~/.bashrc
export KUBECONFIG=/etc/rancher/rke2/rke2.yaml
alias k=kubectl
EOF

echo "*** Installed. Now apt upgrade and reboot."
