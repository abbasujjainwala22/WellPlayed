#!/usr/bin/env bash
# One-shot demo deploy: API to Azure Container Apps, web app to Static Web Apps. See DEPLOYMENT.md.
# Run from the repo root after `az login` (and `gh auth login` to have GitHub configured for you):
#   SETUP_CI=1 bash scripts/azure-deploy.sh
# Optional secrets are read from your shell (unset ones are skipped):
#   ANTHROPIC_API_KEY  LIVEKIT_URL  LIVEKIT_API_KEY  LIVEKIT_API_SECRET  GIPHY_API_KEY  TMDB_API_KEY
# The API image is built with local Docker when available, otherwise by the "Deploy backend" GitHub Actions
# workflow (works in Azure Cloud Shell and on subscriptions where ACR Tasks are blocked; needs `gh`).
# SETUP_CI=1 also creates the GitHub OIDC identity and sets the repository variables (with gh) or prints them.
set -eo pipefail # no -u: macOS bash 3.2 treats empty arrays as unset

# Windows (Git Bash): keep /subscriptions/... arguments as-is, and drop the \r the Windows az CLI appends to output
export MSYS_NO_PATHCONV=1
az() { command az "$@" | tr -d '\r'; }

RG=${RG:-rg-hackathon-demo}
LOC=${LOC:-australiaeast}
API=${API:-hackathon-api}
ENV_NAME=${ENV_NAME:-hackathon-api-env}
SWA=${SWA:-wellplayed-web}
SWA_LOC=${SWA_LOC:-eastasia} # Static Web Apps is only offered in a few regions; content is served globally
REPO=${REPO:-akhil4rajan/WellPlayed}
SHA=$(git rev-parse HEAD)
SUB=$(az account show --query id -o tsv)
TENANT=$(az account show --query tenantId -o tsv)
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
have_gh() { command -v gh >/dev/null && gh auth status >/dev/null 2>&1; }

ci_identity() { # sets APP_ID; safe to re-run
  APP_ID=$(az ad app list --display-name gh-wellplayed-deploy --query "[0].appId" -o tsv)
  if [ -z "$APP_ID" ]; then
    APP_ID=$(az ad app create --display-name gh-wellplayed-deploy --query appId -o tsv)
  fi
  local sp
  sp=$(az ad sp show --id "$APP_ID" --query id -o tsv 2>/dev/null || true)
  if [ -z "$sp" ]; then
    sp=$(az ad sp create --id "$APP_ID" --query id -o tsv)
    sleep 20 # let the new service principal propagate before assigning roles
  fi
  if [ "$(az ad app federated-credential list --id "$APP_ID" --query "length([?name=='main'])" -o tsv)" = 0 ]; then
    az ad app federated-credential create --id "$APP_ID" --parameters "{\"name\":\"main\",
      \"issuer\":\"https://token.actions.githubusercontent.com\",\"subject\":\"repo:$REPO:ref:refs/heads/main\",
      \"audiences\":[\"api://AzureADTokenExchange\"]}" -o none
  fi
  local role scope
  for pair in "AcrPush|$(az acr show -n "$ACR" --query id -o tsv)" "Contributor|/subscriptions/$SUB/resourceGroups/$RG"; do
    role=${pair%%|*} scope=${pair#*|}
    [ "$(az role assignment list --assignee "$sp" --role "$role" --scope "$scope" --query 'length(@)' -o tsv)" != 0 ] ||
      az role assignment create --assignee-object-id "$sp" --assignee-principal-type ServicePrincipal \
        --role "$role" --scope "$scope" -o none
  done
}

github_settings() { # name=value pairs -> repository variables
  local kv
  for kv in "$@"; do gh variable set "${kv%%=*}" -R "$REPO" --body "${kv#*=}"; done
}

step "Subscription $(az account show --query name -o tsv) ($SUB)"
az extension add --name containerapp --upgrade --only-show-errors
for ns in Microsoft.App Microsoft.OperationalInsights Microsoft.ContainerRegistry Microsoft.Web; do
  az provider register --namespace "$ns" --wait --only-show-errors
done
az group create --name "$RG" --location "$LOC" --only-show-errors -o none

step "Container Apps environment and registry"
az containerapp env show -n "$ENV_NAME" -g "$RG" -o none 2>/dev/null ||
  az containerapp env create -n "$ENV_NAME" -g "$RG" --location "$LOC" -o none
ACR=${ACR_NAME:-$(az acr list -g "$RG" --query "[0].name" -o tsv)}
if [ -z "$ACR" ]; then
  ACR=wp$(echo "$SUB" | tr -d - | cut -c1-12)
  az acr create -g "$RG" -n "$ACR" --sku Basic -o none
fi
az acr update -n "$ACR" --admin-enabled true -o none # lets the Container App pull without extra role setup
ACR_SERVER=$(az acr show -n "$ACR" --query loginServer -o tsv)
echo "Registry: $ACR_SERVER"

step "Backend"
if az containerapp show -n "$API" -g "$RG" -o none 2>/dev/null; then
  echo "$API already exists; code changes are deployed by the Deploy backend workflow on merge to main."
elif docker info >/dev/null 2>&1; then
  echo "Building $SHA with local Docker"
  az acr login --name "$ACR"
  docker build --platform linux/amd64 -t "$ACR_SERVER/wellplayed-api:$SHA" backend
  docker push "$ACR_SERVER/wellplayed-api:$SHA"
  az containerapp create -n "$API" -g "$RG" --environment "$ENV_NAME" --image "$ACR_SERVER/wellplayed-api:$SHA" \
    --registry-server "$ACR_SERVER" --registry-username "$ACR" \
    --registry-password "$(az acr credential show -n "$ACR" --query 'passwords[0].value' -o tsv)" \
    --ingress external --target-port 8000 --min-replicas 1 --max-replicas 1 -o none
else
  echo "No Docker here: building main in GitHub Actions instead"
  have_gh || { echo "Run 'gh auth login' first, then re-run this script."; exit 1; }
  ci_identity
  github_settings "AZURE_CLIENT_ID=$APP_ID" "AZURE_TENANT_ID=$TENANT" "AZURE_SUBSCRIPTION_ID=$SUB" \
    "AZURE_RESOURCE_GROUP=$RG" "ACR_NAME=$ACR" "ACR_LOGIN_SERVER=$ACR_SERVER" "ACA_API_NAME=$API" \
    "ACA_ENVIRONMENT=$ENV_NAME"
  echo "Waiting 60s for the new Azure role assignments to take effect..."
  sleep 60
  gh workflow run deploy-backend.yml -R "$REPO" --ref main
  sleep 10
  RUN=$(gh run list -R "$REPO" --workflow deploy-backend.yml --event workflow_dispatch --limit 1 \
    --json databaseId -q '.[0].databaseId')
  echo "Watching https://github.com/$REPO/actions/runs/$RUN"
  gh run watch "$RUN" -R "$REPO" --exit-status ||
    { echo "Backend workflow failed: gh run view $RUN -R $REPO --log-failed  (then re-run this script)"; exit 1; }
fi
FQDN=$(az containerapp show -n "$API" -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)

step "Frontend: Static Web App"
az staticwebapp show -n "$SWA" -g "$RG" -o none 2>/dev/null ||
  az staticwebapp create -n "$SWA" -g "$RG" --location "$SWA_LOC" --sku Free -o none
SWA_HOST=$(az staticwebapp show -n "$SWA" -g "$RG" --query defaultHostname -o tsv)
SWA_TOKEN=$(az staticwebapp secrets list -n "$SWA" -g "$RG" --query properties.apiKey -o tsv)

step "Backend: config, secrets, one replica (room state is in memory)"
secrets=() envs=("WP_CORS_ORIGINS=https://$SWA_HOST")
add_secret() { # env var name, secret name
  if [ -n "${!1:-}" ]; then secrets+=("$2=${!1}"); envs+=("$1=secretref:$2"); fi
}
add_secret ANTHROPIC_API_KEY anthropic-key
add_secret LIVEKIT_API_KEY livekit-key
add_secret LIVEKIT_API_SECRET livekit-secret
add_secret GIPHY_API_KEY giphy-key
add_secret TMDB_API_KEY tmdb-key
[ -n "${LIVEKIT_URL:-}" ] && envs+=("LIVEKIT_URL=$LIVEKIT_URL")
[ ${#secrets[@]} -gt 0 ] && az containerapp secret set -n "$API" -g "$RG" --secrets "${secrets[@]}" -o none
az containerapp update -n "$API" -g "$RG" --min-replicas 1 --max-replicas 1 --set-env-vars "${envs[@]}" -o none

step "Frontend: build against https://$FQDN and upload"
(cd frontend && pnpm install --frozen-lockfile && VITE_API_URL="https://$FQDN" pnpm build)
npx --yes @azure/static-web-apps-cli@2 deploy ./frontend/dist --deployment-token "$SWA_TOKEN" --env production

step "Smoke test"
for _ in $(seq 1 20); do curl -fsS "https://$FQDN/healthz" && break || sleep 5; done
echo

VARS=("AZURE_TENANT_ID=$TENANT" "AZURE_SUBSCRIPTION_ID=$SUB" "AZURE_RESOURCE_GROUP=$RG" "ACR_NAME=$ACR"
  "ACR_LOGIN_SERVER=$ACR_SERVER" "ACA_API_NAME=$API" "ACA_ENVIRONMENT=$ENV_NAME" "VITE_API_URL=https://$FQDN")
if [ "${SETUP_CI:-0}" = 1 ]; then
  step "GitHub Actions access"
  ci_identity
  VARS=("AZURE_CLIENT_ID=$APP_ID" "${VARS[@]}")
  if have_gh; then
    github_settings "${VARS[@]}"
    gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN -R "$REPO" --body "$SWA_TOKEN"
    GH_DONE=1
  fi
fi

cat <<EOF

Done.
  Web app : https://$SWA_HOST
  API     : https://$FQDN   (health: https://$FQDN/healthz)
  Image   : $(az containerapp show -n "$API" -g "$RG" --query "properties.template.containers[0].image" -o tsv)
EOF
if [ "${GH_DONE:-0}" = 1 ]; then
  echo "GitHub variables and the AZURE_STATIC_WEB_APPS_API_TOKEN secret are set; merges to main now deploy."
else
  echo "GitHub -> Settings -> Secrets and variables -> Actions -> Variables:"
  printf '    %s\n' "${VARS[@]}"
  echo "  Secret AZURE_STATIC_WEB_APPS_API_TOKEN: az staticwebapp secrets list -n $SWA -g $RG --query properties.apiKey -o tsv"
fi
