#!/usr/bin/env bash
# Point the backend at Claude on Microsoft Foundry instead of an Anthropic API key. See DEPLOYMENT.md.
# Run after `az login` (Azure Cloud Shell works) once the API Container App exists:
#   bash scripts/azure-foundry-setup.sh
# Creates (or reuses) a Foundry resource, deploys the Claude model, checks it answers, then stores the key as a
# Container App secret and sets ANTHROPIC_FOUNDRY_API_KEY / ANTHROPIC_FOUNDRY_RESOURCE / WP_LLM_MODEL. Safe to re-run.
set -eo pipefail

# Windows (Git Bash): keep /subscriptions/... arguments as-is, and drop the \r the Windows az CLI appends to output
export MSYS_NO_PATHCONV=1
az() { command az "$@" | tr -d '\r'; }

RG=${RG:-rg-hackathon-demo}
API=${API:-hackathon-api}
FOUNDRY=${FOUNDRY:-wellplayed-foundry} # also the endpoint subdomain, so it must be globally unique
FOUNDRY_LOC=${FOUNDRY_LOC:-eastus2}    # a region that offers Claude models
MODEL=${MODEL:-claude-haiku-5-5}
DEPLOYMENT=${DEPLOYMENT:-$MODEL}       # the backend sends this as the model name
CAPACITY=${CAPACITY:-1}
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

step "Foundry resource $FOUNDRY ($FOUNDRY_LOC)"
if ! az cognitiveservices account show -n "$FOUNDRY" -g "$RG" -o none 2>/dev/null; then
  az cognitiveservices account create -n "$FOUNDRY" -g "$RG" -l "$FOUNDRY_LOC" \
    --kind AIServices --sku S0 --custom-domain "$FOUNDRY" --yes -o none
fi

step "Model deployment $DEPLOYMENT ($MODEL)"
if ! az cognitiveservices account deployment show -n "$FOUNDRY" -g "$RG" --deployment-name "$DEPLOYMENT" -o none 2>/dev/null; then
  VERSION=$(az cognitiveservices account list-models -n "$FOUNDRY" -g "$RG" \
    --query "[?format=='Anthropic' && name=='$MODEL'].version | [0]" -o tsv)
  if [ -z "$VERSION" ]; then
    echo "$MODEL is not offered to $FOUNDRY in $FOUNDRY_LOC. Claude models this resource can deploy:"
    az cognitiveservices account list-models -n "$FOUNDRY" -g "$RG" \
      --query "[?format=='Anthropic'].name" -o tsv | sort -u
    echo "Re-run with MODEL=<one of the above>, or FOUNDRY_LOC=swedencentral FOUNDRY=<new name>."
    exit 1
  fi
  az cognitiveservices account deployment create -n "$FOUNDRY" -g "$RG" --deployment-name "$DEPLOYMENT" \
    --model-format Anthropic --model-name "$MODEL" --model-version "$VERSION" \
    --sku-name GlobalStandard --sku-capacity "$CAPACITY" -o none || {
    echo "Deployment failed. Claude is sold through Azure Marketplace, so the subscription must allow Marketplace"
    echo "purchases. Deploy it once at https://ai.azure.com (resource $FOUNDRY > Models > Deploy $MODEL,"
    echo "deployment name $DEPLOYMENT), then re-run this script."
    exit 1
  }
fi

step "Checking the deployment answers"
KEY=$(az cognitiveservices account keys list -n "$FOUNDRY" -g "$RG" --query key1 -o tsv)
for i in $(seq 1 10); do
  curl -fsS "https://$FOUNDRY.services.ai.azure.com/anthropic/v1/messages" \
    -H "x-api-key: $KEY" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" \
    -d "{\"model\":\"$DEPLOYMENT\",\"max_tokens\":20,\"messages\":[{\"role\":\"user\",\"content\":\"Say hi\"}]}" &&
    break
  [ "$i" = 10 ] && { echo "Foundry endpoint did not answer; check the deployment in https://ai.azure.com"; exit 1; }
  sleep 15 # a new deployment can take a minute to start serving
done
echo

step "Container App $API: Foundry key and settings"
az containerapp secret set -n "$API" -g "$RG" --secrets "foundry-key=$KEY" -o none
az containerapp update -n "$API" -g "$RG" --set-env-vars ANTHROPIC_FOUNDRY_API_KEY=secretref:foundry-key \
  "ANTHROPIC_FOUNDRY_RESOURCE=$FOUNDRY" "WP_LLM_MODEL=$DEPLOYMENT" -o none
echo "Done. The API uses Claude on Foundry once it runs an image that includes Foundry support."
