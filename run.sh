#!/bin/bash
set -euo pipefail

# Constants
CLUSTER_NAME="moonrepo-dev"
K3D_CONFIG="k3d-config.yaml"
APP_DIR="infra/app-of-apps"

# Checking dependencies
if ! command -v yq &>/dev/null; then
	echo "Error: yq is not installed or not in PATH."
	exit 1
fi
if ! command -v helm &>/dev/null; then
	echo "Error: helm is not installed or not in PATH."
	exit 1
fi
if ! command -v k3d &>/dev/null; then
	echo "Error: k3d is not installed or not in PATH."
	exit 1
fi

echo "=== Ensuring K3d Cluster is Running ==="
if ! k3d cluster list | grep -q "$CLUSTER_NAME"; then
	echo "Creating cluster '$CLUSTER_NAME'..."
	if [ -f "$K3D_CONFIG" ]; then
		k3d cluster create --config "$K3D_CONFIG" --wait || {
			echo "Failed to create cluster from config"
			exit 1
		}
		kubectl apply --server-side -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.4.0/experimental-install.yaml
	else
		echo "Warning: $K3D_CONFIG not found, creating default cluster."
		k3d cluster create "$CLUSTER_NAME"
	fi
else
	echo "Cluster '$CLUSTER_NAME' already exists."
fi

# Switch context just in case
kubectl config use-context "k3d-$CLUSTER_NAME" 2>/dev/null || echo "Context might already be set."

echo "=== Parsing Applications in $APP_DIR ==="

if [ ! -d "$APP_DIR" ]; then
	echo "Directory $APP_DIR does not exist."
	exit 1
fi

# Enable globbing for the loop, but handle empty results
shopt -s nullglob globstar
FILES=("$APP_DIR"/**/*.yaml "$APP_DIR"/**/*.yml)
shopt -u nullglob globstar

if [ ${#FILES[@]} -eq 0 ]; then
	echo "No .yaml or .yml files found in $APP_DIR"
	exit 0
fi

for file in "${FILES[@]}"; do
	echo "Scanning $file..."

	# reliable way to get number of documents using yq
	# document_index outputs the index for each document found.
	# we pipe to wc -l to count how many documents.
	DOC_COUNT=$(yq eval 'document_index' "$file" | wc -l)

	if [ "$DOC_COUNT" -eq 0 ]; then
		continue
	fi

	for ((i = 0; i < DOC_COUNT; i++)); do
		# Extract Kind for the current document index
		KIND=$(yq eval -r "select(document_index == $i) | .kind" "$file")

		if [ "$KIND" == "Application" ]; then
			echo "Found Application in $file (doc index $i)"

			# Extract fields
			# Using -r for raw output to avoid quotes
			REPO_URL=$(yq eval -r "select(document_index == $i) | .spec.source.repoURL" "$file")
			CHART=$(yq eval -r "select(document_index == $i) | .spec.source.chart" "$file")
			VERSION=$(yq eval -r "select(document_index == $i) | .spec.source.targetRevision" "$file")

			# For Release Name, try source.helm.releaseName, fallback to metadata.name
			RELEASE_NAME=$(yq eval -r "select(document_index == $i) | .spec.source.helm.releaseName // .metadata.name" "$file")

			# For Namespace, try destination.namespace, fallback to default
			NAMESPACE=$(yq eval -r "select(document_index == $i) | .spec.destination.namespace // \"default\"" "$file")

			# Values - this might be multiline
			VALUES=$(yq eval -r "select(document_index == $i) | .spec.source.helm.values" "$file")

			if [ "$REPO_URL" == "null" ] || [ "$CHART" == "null" ]; then
				echo "Skipping Application in $file: repoURL or chart is missing."
				continue
			fi

			echo "Processing Release: $RELEASE_NAME"
			echo "  Chart: $CHART"
			echo "  Repo: $REPO_URL"
			echo "  Namespace: $NAMESPACE"

			# Prepare Helm Repo
			REPO_ID=$(echo "$REPO_URL" | md5sum | cut -c1-8)
			REPO_NAME="repo-$REPO_ID"

			# Suppress output unless error, to keep logs clean
			helm repo add "$REPO_NAME" "$REPO_URL" >/dev/null 2>&1 || true
			helm repo update "$REPO_NAME"

			# Construct command arguments
			ARGS=()
			ARGS+=("--namespace" "$NAMESPACE")
			ARGS+=("--create-namespace")
			ARGS+=("--debug")
			ARGS+=("--wait")

			if [ "$VERSION" != "null" ] && [ -n "$VERSION" ]; then
				ARGS+=("--version" "$VERSION")
			fi

			# Handle Values File
			VALUES_FILE=""
			if [ "$VALUES" != "null" ] && [ -n "$VALUES" ]; then
				# Create a temp file
				VALUES_FILE="/tmp/values-${RELEASE_NAME}-${REPO_ID}.yaml"
				echo "$VALUES" >"$VALUES_FILE"
				ARGS+=("-f" "$VALUES_FILE")
			fi

			echo "Installing/Upgrading helm chart..."
			helm upgrade --install "$RELEASE_NAME" "$REPO_NAME/$CHART" "${ARGS[@]}"

			# Cleanup
			if [ -n "$VALUES_FILE" ] && [ -f "$VALUES_FILE" ]; then
				rm "$VALUES_FILE"
			fi
			echo "----------------------------------------"
		else
			echo "Found $KIND in $file (doc index $i), applying with kubectl..."
			yq eval "select(document_index == $i)" "$file" | kubectl apply -f -
		fi
	done
done

echo "=== All Done ==="
