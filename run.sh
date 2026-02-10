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

echo "=== Installing DB Operators (Pre-flight) ==="

# Detect CI environment (GitHub Actions sets CI=true)
HELM_WAIT_FLAG="--wait"
if [ "${CI:-}" = "true" ]; then
    echo "Running in CI mode - skipping --wait for DB operators to avoid timeout"
    HELM_WAIT_FLAG=""
fi

# CloudNativePG
helm repo add cloudnative-pg https://cloudnative-pg.github.io/charts/ || true
helm repo update cloudnative-pg
helm upgrade --install cloudnative-pg cloudnative-pg/cloudnative-pg \
    --namespace cloudnative-pg --create-namespace \
    --set crds.create=true $HELM_WAIT_FLAG --timeout 15m

# MariaDB Operator CRDs (must be installed first)
helm repo add mariadb-operator https://helm.mariadb.com/mariadb-operator || true
helm repo update mariadb-operator
helm upgrade --install mariadb-operator-crds mariadb-operator/mariadb-operator-crds \
    --namespace mariadb-operator --create-namespace \
    --wait --timeout 20m

# MariaDB Operator
helm upgrade --install mariadb-operator mariadb-operator/mariadb-operator \
    --namespace mariadb-operator --create-namespace \
    --set crds.enabled=false \
    --set ha.enabled=false --wait --timeout 20m
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

ATTEMPT=1
MAX_ATTEMPTS=6
declare -A INSTALLED_TRACKER

while true; do
	if [ "$ATTEMPT" -gt "$MAX_ATTEMPTS" ]; then
		echo "=== FATAL: Exceeded maximum attempts ($MAX_ATTEMPTS). Exiting. ==="
		exit 1
	fi
	echo "=== Attempt $ATTEMPT to apply resources ==="
	FAILURES=0
	FAILURES_LIST=()

	# 1. Collect and Update Repos (Once per attempt to save resources)
	declare -A REPOS
	for file in "${FILES[@]}"; do
		DOC_COUNT=$(yq eval 'document_index' "$file" | wc -l)
		for ((i = 0; i < DOC_COUNT; i++)); do
			# Check for skip-local annotation
			SKIP_LOCAL=$(yq eval -r "select(document_index == $i) | .metadata.annotations[\"moonrepo.dev/skip-local\"] // \"false\"" "$file")
			if [ "$SKIP_LOCAL" == "true" ]; then
				continue
			fi
			KIND=$(yq eval -r "select(document_index == $i) | .kind" "$file")
			if [ "$KIND" == "Application" ]; then
				# Only collect Helm repos (those with a chart field), not Git repos
				CHART=$(yq eval -r "select(document_index == $i) | .spec.source.chart" "$file")
				if [ "$CHART" != "null" ]; then
					REPO_URL=$(yq eval -r "select(document_index == $i) | .spec.source.repoURL" "$file")
					if [ "$REPO_URL" != "null" ]; then
						REPOS["$REPO_URL"]=1
					fi
				fi
			fi
		done
	done

	echo "--- Updating Helm Repositories ---"
	declare -A NEEDED_REPOS

	# 0. Get list of existing repos
	# Format: "name url" per line
	# We use an associative array to map URL -> Name
	declare -A EXISTING_REPOS
	while read -r name url; do
		EXISTING_REPOS["$url"]="$name"
	done < <(helm repo list -o json 2>/dev/null | jq -r '.[] | "\(.name) \(.url)"')

	# 1. Compile list of needed repos
	for REPO_URL in "${!REPOS[@]}"; do
		if [ -n "${EXISTING_REPOS[$REPO_URL]:-}" ]; then
			# Already exists, just note the name for later update
			NEEDED_REPOS["$REPO_URL"]="${EXISTING_REPOS[$REPO_URL]}"
		else
			# Does not exist, needs adding
			REPO_ID=$(echo "$REPO_URL" | md5sum | cut -c1-8)
			REPO_NAME="repo-$REPO_ID"
			NEEDED_REPOS["$REPO_URL"]="$REPO_NAME"

			echo "Adding repo $REPO_NAME ($REPO_URL)..."
			REPO_ADDED=false
			BACKOFF=2
			for ((r = 1; r <= 6; r++)); do
				if helm repo add "$REPO_NAME" "$REPO_URL" 2>/dev/null; then
					REPO_ADDED=true
					break
				elif helm repo add "$REPO_NAME" "$REPO_URL" --force-update >/dev/null 2>&1; then
					REPO_ADDED=true
					break
				fi
				echo "Warning: Failed to add repo $REPO_NAME (attempt $r/6)"
				sleep $BACKOFF
				BACKOFF=$((BACKOFF < 30 ? BACKOFF * 2 : 30))
			done

			if [ "$REPO_ADDED" = false ]; then
				echo "Error: Could not add repo $REPO_NAME ($REPO_URL) after 6 retries."
				exit 1
			fi
		fi
	done

	# 2. Update all needed repos
	for REPO_URL in "${!NEEDED_REPOS[@]}"; do
		REPO_NAME="${NEEDED_REPOS[$REPO_URL]}"
		# echo "Updating repo $REPO_NAME..."

		UPDATED=false
		BACKOFF=2
		for ((r = 1; r <= 6; r++)); do
			if helm repo update "$REPO_NAME" 2>/dev/null; then
				UPDATED=true
				break
			fi
			echo "Warning: Failed to update repo $REPO_NAME (attempt $r/6)"
			sleep $BACKOFF
			BACKOFF=$((BACKOFF < 30 ? BACKOFF * 2 : 30))
		done

		# If update fails, we might still proceed as cache might be fresh enough,
		# but if you want strict failure:
		if [ "$UPDATED" = false ]; then
			echo "Error: Could not update repo $REPO_NAME after 6 retries."
			exit 1
		fi
	done
	echo "----------------------------------"

	# 2. Process Files
	for file in "${FILES[@]}"; do
		DOC_COUNT=$(yq eval 'document_index' "$file" | wc -l)

		if [ "$DOC_COUNT" -eq 0 ]; then
			continue
		fi

		for ((i = 0; i < DOC_COUNT; i++)); do
			# Check for skip-local annotation
			SKIP_LOCAL=$(yq eval -r "select(document_index == $i) | .metadata.annotations[\"moonrepo.dev/skip-local\"] // \"false\"" "$file")
			if [ "$SKIP_LOCAL" == "true" ]; then
				NAME=$(yq eval -r "select(document_index == $i) | .metadata.name" "$file")
				echo "Skipping $NAME (moonrepo.dev/skip-local: true)"
				continue
			fi

			# Unique ID for tracking success
			TRACK_ID="${file}:${i}"

			if [ "${INSTALLED_TRACKER[$TRACK_ID]:-}" == "true" ]; then
				# Silently skip already successful resources
				continue
			fi

			KIND=$(yq eval -r "select(document_index == $i) | .kind" "$file")

			if [ "$KIND" == "Application" ]; then
				echo "Found Application in $file (doc index $i)"

				REPO_URL=$(yq eval -r "select(document_index == $i) | .spec.source.repoURL" "$file")
				CHART=$(yq eval -r "select(document_index == $i) | .spec.source.chart" "$file")
				VERSION=$(yq eval -r "select(document_index == $i) | .spec.source.targetRevision" "$file")
				RELEASE_NAME=$(yq eval -r "select(document_index == $i) | .spec.source.helm.releaseName // .metadata.name" "$file")
				NAMESPACE=$(yq eval -r "select(document_index == $i) | .spec.destination.namespace // \"default\"" "$file")
				VALUES=$(yq eval -r "select(document_index == $i) | .spec.source.helm.values" "$file")

				if [ "$REPO_URL" == "null" ] || [ "$CHART" == "null" ]; then
					echo "Skipping Application in $file: repoURL or chart is missing."
					continue
				fi

				echo "Processing Release: $RELEASE_NAME"

				# Reuse logic to find correct repo name
				EXISTING_REPO_NAME=$(helm repo list -o json 2>/dev/null | jq -r --arg url "$REPO_URL" '.[] | select(.url == $url) | .name' | head -n1)
				if [ -n "$EXISTING_REPO_NAME" ]; then
					REPO_NAME="$EXISTING_REPO_NAME"
					# Still need unique ID for temp file if needed
					REPO_ID=$(echo "$REPO_URL" | md5sum | cut -c1-8)
				else
					REPO_ID=$(echo "$REPO_URL" | md5sum | cut -c1-8)
					REPO_NAME="repo-$REPO_ID"
				fi

				ARGS=()
				ARGS+=("--namespace" "$NAMESPACE")
				ARGS+=("--create-namespace")

				if [ "$VERSION" != "null" ] && [ -n "$VERSION" ]; then
					ARGS+=("--version" "$VERSION")
				fi

				VALUES_FILE=""
				if [ "$VALUES" != "null" ] && [ -n "$VALUES" ]; then
					VALUES_FILE="/tmp/values-${RELEASE_NAME}-${REPO_ID}.yaml"
					echo "$VALUES" >"$VALUES_FILE"
					ARGS+=("-f" "$VALUES_FILE")
				fi

				echo "Installing/Upgrading helm chart: $RELEASE_NAME..."
				# Retry loop for helm upgrade
				INSTALLED=false
				for ((r = 1; r <= 3; r++)); do
					if helm upgrade --install "$RELEASE_NAME" "$REPO_NAME/$CHART" "${ARGS[@]}" --timeout 15m; then
						INSTALLED=true
						break
					fi
					echo "Warning: Failed to install $RELEASE_NAME, retrying in 1s..."
					sleep 1
				done

				if [ "$INSTALLED" = false ]; then
					echo "Error: Failed to install/upgrade helm chart $RELEASE_NAME ($CHART) after 3 retries."
					FAILURES=$((FAILURES + 1))
					FAILURES_LIST+=("Helm Release: $RELEASE_NAME")
				else
					INSTALLED_TRACKER["$TRACK_ID"]="true"
				fi

				if [ -n "$VALUES_FILE" ] && [ -f "$VALUES_FILE" ]; then
					rm "$VALUES_FILE"
				fi
				echo "----------------------------------------"
			else
				echo "Found $KIND in $file (doc index $i), applying with kubectl..."

				APPLIED=false
				for ((r = 1; r <= 3; r++)); do
					if yq eval "select(document_index == $i)" "$file" | kubectl apply -f -; then
						APPLIED=true
						break
					fi
					echo "Warning: Failed to apply resource in $file (doc index $i), retrying within 1s..."
					sleep 1
				done

				if [ "$APPLIED" = false ]; then
					echo "Error: Failed to apply resource in $file (doc index $i) after 3 retries. Moving on."
					FAILURES=$((FAILURES + 1))
					NAME=$(yq eval -r "select(document_index == $i) | .metadata.name" "$file")
					FAILURES_LIST+=("Resource: $KIND/$NAME in $file")
				else
					INSTALLED_TRACKER["$TRACK_ID"]="true"
				fi
			fi
		done
	done

	if [ "$FAILURES" -eq 0 ]; then
		echo "=== All resources applied successfully! ==="
		break
	else
		echo "=== Encountered $FAILURES failures. Retrying in 10s... ==="
		echo "Failed Resources:"
		for item in "${FAILURES_LIST[@]}"; do
			echo " - $item"
		done
		sleep 10
		ATTEMPT=$((ATTEMPT + 1))
	fi
done

echo "=== All Done ==="
