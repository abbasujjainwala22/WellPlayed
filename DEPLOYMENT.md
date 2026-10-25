# Deploying WellPlayed to Azure (hackathon demo)

| Part | Where | Source |
| --- | --- | --- |
| Web app (Vite SPA) | Azure Static Web Apps, Free | `frontend/` → `frontend/dist` |
| API + WebSockets (FastAPI) | Azure Container Apps, Consumption | `backend/Dockerfile` |
| Images | Azure Container Registry, tagged with the full commit SHA | `wellplayed-api:<sha>` |
| CI/CD | GitHub Actions on push to `main` | `.github/workflows/deploy-backend.yml`, `deploy-frontend.yml` |

## What the repository actually needs

- **There is no PostgreSQL, Redis, SQLAlchemy or ARQ in the code.** Rooms, members, sockets and timers live in the API
  process's memory (`backend/app/rooms.py`, `backend/app/hub.py`). That means:
  - **No worker app.** There is nothing to run as a worker.
  - **Run exactly one replica** (`--min-replicas 1 --max-replicas 1`). Two replicas would split rooms between processes.
    Scaling to zero, or any new revision, ends every open room, so **do not deploy during the demo.**
- The only backend configuration is the environment variables in `backend/app/config.py` and `.env.example`. All of them are optional,
  and the app falls back to deterministic AI or "voice not configured" when they're missing.
- Discover recommendations are written to `recs.json` in `WP_DATA_DIR` (`/srv/var` in the image). Container disk is per revision, so
  a new deploy starts with an empty list. That's fine for the demo; mount an Azure Files share there if you need it to persist.
- Health check: `GET /healthz` (an alias of `GET /api/health`) returns `{"status":"ok"}`.
- The image installs the `voice` (LiveKit) and `ai` (Anthropic) extras from `uv.lock`. `asr` (faster-whisper) and `translate`
  (Argos, which pulls in torch) are left out: the web UI never calls `/transcribe`, and translation uses Claude when
  `ANTHROPIC_API_KEY` is set. To add them: `docker build --build-arg EXTRAS="voice ai asr" backend`. faster-whisper
  downloads its model from Hugging Face on first use and needs about 2 GiB RAM for `small`, so give the app `--memory 2Gi` or more.
- The frontend calls the API through `VITE_API_URL` (build time, public; only the backend origin goes in it, never a secret). When it is unset,
  the app uses same-origin URLs, so `pnpm dev` and `make demo` behave exactly as before. WebSockets become `wss://` automatically when
  `VITE_API_URL` is `https://…`.
- The WXT/Chrome extension in `extension/` is distributed separately. Hosting the site does not install it. The "Pair phone → extension"
  panel now shows the API URL as the "Server" value.

## Fast path

`scripts/azure-deploy.sh` runs steps 1–2 below (plus the OIDC part of step 3 with `SETUP_CI=1`) and prints the GitHub variables:

```bash
az login && az account set --subscription "<SUBSCRIPTION_ID>"
export ANTHROPIC_API_KEY=... LIVEKIT_URL=wss://... LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=...   # any you have
SETUP_CI=1 bash scripts/azure-deploy.sh
```

## Names used below (change them if you like)

```bash
RG=rg-hackathon-demo
LOC=australiaeast
API=hackathon-api
SWA=wellplayed-web
REPO=akhil4rajan/WellPlayed   # case matters for the OIDC subject
```

## 1. Backend: first deploy from your machine

```bash
az login
az account set --subscription "<SUBSCRIPTION_ID>"
az extension add --name containerapp --upgrade
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.OperationalInsights
az provider register --namespace Microsoft.ContainerRegistry

az group create --name $RG --location $LOC

# Builds backend/Dockerfile in ACR and creates the environment, Log Analytics, the registry and the app
az containerapp up \
  --name $API --resource-group $RG --location $LOC \
  --source ./backend --ingress external --target-port 8000

# Required: one always-on replica (in-memory state)
az containerapp update --name $API --resource-group $RG --min-replicas 1 --max-replicas 1
```

If ACR Tasks are blocked (`TasksOperationsNotAllowed`, common on free/trial subscriptions) and you have no Docker (e.g. Cloud Shell),
`scripts/azure-deploy.sh` has GitHub Actions build the image and create the app (needs `gh auth login`). With Docker, build locally instead:

```bash
ACR=<name from `az acr list -g $RG -o table`, or create one: az acr create -g $RG -n <unique> --sku Basic --admin-enabled true>
az acr login --name $ACR
docker build -t $ACR.azurecr.io/wellplayed-api:$(git rev-parse HEAD) backend
docker push $ACR.azurecr.io/wellplayed-api:$(git rev-parse HEAD)
az containerapp up --name $API --resource-group $RG --location $LOC \
  --image $ACR.azurecr.io/wellplayed-api:$(git rev-parse HEAD) --registry-server $ACR.azurecr.io \
  --ingress external --target-port 8000
```

### Configuration (secrets go in Container App secrets, never in the image)

```bash
# Sensitive values: store as secrets, then reference them
az containerapp secret set --name $API --resource-group $RG --secrets \
  anthropic-key="<ANTHROPIC_API_KEY>" livekit-key="<LIVEKIT_API_KEY>" livekit-secret="<LIVEKIT_API_SECRET>" \
  giphy-key="<GIPHY_API_KEY>" tmdb-key="<TMDB_API_KEY>"

az containerapp update --name $API --resource-group $RG --set-env-vars \
  WP_CORS_ORIGINS="https://<your-swa>.azurestaticapps.net" \
  ANTHROPIC_API_KEY=secretref:anthropic-key \
  LIVEKIT_URL="wss://<your-project>.livekit.cloud" \
  LIVEKIT_API_KEY=secretref:livekit-key \
  LIVEKIT_API_SECRET=secretref:livekit-secret \
  GIPHY_API_KEY=secretref:giphy-key \
  TMDB_API_KEY=secretref:tmdb-key
```

The "Deploy backend" workflow also applies these on every deploy from GitHub: set `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
`GIPHY_API_KEY`, `ANTHROPIC_API_KEY` and `TMDB_API_KEY` as repository **secrets** and `LIVEKIT_URL` as a repository
**variable** (Settings → Secrets and variables → Actions). Any that are unset are skipped.

| Variable | Required | Notes |
| --- | --- | --- |
| `WP_CORS_ORIGINS` | yes, once the frontend exists | Comma-separated. The exact SWA origin, with no trailing slash. Add a custom domain here too if you use one. |
| `ANTHROPIC_API_KEY` | no | Without it (or the Foundry pair below), AI features use deterministic fallbacks. |
| `ANTHROPIC_FOUNDRY_API_KEY` / `ANTHROPIC_FOUNDRY_RESOURCE` | no | Claude on Microsoft Foundry instead of an Anthropic key; wins when both are set. `bash scripts/azure-foundry-setup.sh` creates the resource and deployment and sets all three Foundry values. |
| `WP_LLM_MODEL` | no | Default `claude-haiku-5-5`. On Foundry, the deployment name. |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | for voice/video | The browser connects straight to `LIVEKIT_URL`, so it must be a public `wss://` URL (e.g. LiveKit Cloud), not `ws://localhost`. |
| `TMDB_API_KEY` | no | Real watch-provider data; sample catalogue otherwise. |
| `GIPHY_API_KEY` | no | GIFs and stickers in chat. The backend proxies GIPHY, so the key never reaches the browser. Without it the picker offers emoji only. |
| `WP_TRANSLATOR` | no | `auto` (default), `llm`, `argos`, `mock`, `none`. |
| `PORT` | no | Default 8000. If you change it, change `--target-port` to match. |

Skip any secret you don't have: leave it out of both commands.

### Check it

```bash
FQDN=$(az containerapp show -n $API -g $RG --query properties.configuration.ingress.fqdn -o tsv)
curl -fsS https://$FQDN/healthz                       # {"status":"ok"}
curl -fsS -X POST https://$FQDN/api/rooms -H 'content-type: application/json' \
  -d '{"display_name":"Smoke","name":"Smoke test","mode":"movie","language":"en"}'   # {"code":...,"token":...}
az containerapp logs show -n $API -g $RG --follow --tail 50
```

## 2. Frontend: Static Web Apps

Create the app **with deployment source "Other"**, so Azure does not commit its own workflow to `main`. Its generated Oryx build
would not set `VITE_API_URL`, and you would end up with two deployments fighting each other.

```bash
az staticwebapp create --name $SWA --resource-group $RG --location eastasia --sku Free   # SWA is only offered in some regions
az staticwebapp show -n $SWA -g $RG --query defaultHostname -o tsv                        # → put https://<this> in WP_CORS_ORIGINS
TOKEN=$(az staticwebapp secrets list -n $SWA -g $RG --query properties.apiKey -o tsv)
```

(In the Portal: Plan **Free**, Deployment details **Other**. If you already connected it to GitHub, delete the workflow file Azure added.)

First deploy from your machine (`workflow_dispatch` only works once the workflow file is on `main`):

```bash
cd frontend
pnpm install --frozen-lockfile
VITE_API_URL=https://$FQDN pnpm build
npx @azure/static-web-apps-cli@2 deploy ./dist --deployment-token "$TOKEN" --env production
```

`frontend/public/staticwebapp.config.json` adds the SPA fallback (so `/room/ABC123` and `/join/…` load), `.wasm` MIME and caching
for hashed assets. MediaPipe's WASM is served from `/mediapipe/wasm`, and its models come from `storage.googleapis.com` in the browser.
Camera and microphone need HTTPS, which both Azure URLs provide.

Remember to update `WP_CORS_ORIGINS` on the API with the SWA URL (step 1).

## 3. CI/CD (GitHub Actions)

### Azure identity for GitHub OIDC (no client secret)

```bash
SUB=$(az account show --query id -o tsv); TENANT=$(az account show --query tenantId -o tsv)
ACR=$(az acr list -g $RG --query "[0].name" -o tsv); ACR_SERVER=$(az acr show -n $ACR --query loginServer -o tsv)

APP_ID=$(az ad app create --display-name gh-wellplayed-deploy --query appId -o tsv)
az ad sp create --id $APP_ID
az ad app federated-credential create --id $APP_ID --parameters "{
  \"name\": \"main\", \"issuer\": \"https://token.actions.githubusercontent.com\",
  \"subject\": \"repo:$REPO:ref:refs/heads/main\", \"audiences\": [\"api://AzureADTokenExchange\"]}"

az role assignment create --assignee $APP_ID --role AcrPush --scope $(az acr show -n $ACR --query id -o tsv)
# Lets `az containerapp update` create new revisions. Scoped to this demo resource group only.
az role assignment create --assignee $APP_ID --role Contributor --scope /subscriptions/$SUB/resourceGroups/$RG
```

The Container App also has to be able to **pull** from ACR. `az containerapp up` sets this up already, using registry admin credentials. If you
created the app another way:
`az containerapp registry set -n $API -g $RG --server $ACR_SERVER --identity system`, then grant that identity `AcrPull` on the registry.

### GitHub settings → Secrets and variables → Actions

| Name | Kind | Value |
| --- | --- | --- |
| `AZURE_CLIENT_ID` | variable | `$APP_ID` |
| `AZURE_TENANT_ID` | variable | `$TENANT` |
| `AZURE_SUBSCRIPTION_ID` | variable | `$SUB` |
| `AZURE_RESOURCE_GROUP` | variable | `rg-hackathon-demo` |
| `ACR_NAME` | variable | `$ACR` |
| `ACR_LOGIN_SERVER` | variable | `$ACR_SERVER` (e.g. `myacr.azurecr.io`) |
| `ACA_API_NAME` | variable | `hackathon-api` |
| `ACA_ENVIRONMENT` | variable | `hackathon-api-env` (used when the workflow has to create the app) |
| `VITE_API_URL` | variable | `https://$FQDN` (public backend origin) |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | **secret** | `$TOKEN` |

None of the variables are sensitive. Only the SWA token is a secret.

### What runs

- `deploy-backend.yml` runs on a push to `main` that touches `backend/**`, or manually. It runs ruff + pytest, builds
  `$ACR_LOGIN_SERVER/wellplayed-api:${{ github.sha }}`, pushes it, runs `az containerapp update --image` with that exact tag (revision suffix
  = short SHA), then polls `https://<fqdn>/healthz`. It never creates or recreates the resource group, environment or registry.
- `deploy-frontend.yml` runs on a push to `main` that touches `frontend/**`, or manually. It runs vitest, builds with `VITE_API_URL`, and uploads
  `frontend/dist` to SWA.
- The existing `ci.yml` still runs lint/tests on every push and PR.

## Which commit is live?

```bash
az containerapp show -n $API -g $RG --query "properties.template.containers[0].image" -o tsv   # …/wellplayed-api:<sha>
az containerapp revision list -n $API -g $RG -o table
```

## Rollback

```bash
az acr repository show-tags -n $ACR --repository wellplayed-api --orderby time_desc -o table
az containerapp update -n $API -g $RG --image $ACR_SERVER/wellplayed-api:<previous-sha>
```

Frontend: re-run the `Deploy frontend` workflow on the previous commit, or re-deploy a local build of it with the SWA CLI command above.

## Demo smoke test

1. Open `https://<swa>.azurestaticapps.net` and create a room. In DevTools → Network, the `POST /api/rooms` should go to the Container App and
   the `WS` should go to `wss://<fqdn>/ws/rooms/<code>`.
2. Open the invite link in a second browser and check that chat, reactions and play/pause sync.
3. If configured, test voice (LiveKit), AI catch-up (Claude), and the camera wellbeing check (camera permission prompt).
4. Watch `az containerapp logs show -n $API -g $RG --follow` while you do this.
5. Write down the deployed image SHA (above). **Don't push to `main` during the demo**, because a new revision ends live rooms.

## Cost and cleanup

One always-on 0.5 vCPU / 1 GiB replica, plus ACR Basic and Log Analytics, is billed. It is not covered by the free allowance indefinitely.
Set a budget alert, and remove everything afterwards:

```bash
az group delete --name $RG --yes --no-wait
az ad app delete --id $APP_ID
```
