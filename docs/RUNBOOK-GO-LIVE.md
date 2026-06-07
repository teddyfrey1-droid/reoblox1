# 🤖 RUNBOOK — Mise en production de LUMORA (exécutable par un agent)

> **But.** Rendre LUMORA **opérationnel et en ligne** (API + prototype web jouable),
> avec auth, base de données durable et HTTPS/WSS. Suivez les étapes dans l'ordre.
> Chaque étape a une **commande** et une **vérification**. Ne passez à l'étape suivante
> que si la vérification réussit.

---

## A. Ce que l'humain doit fournir AVANT (l'agent ne peut pas créer de comptes payants)

Demandez ces éléments à l'utilisateur et **arrêtez-vous** s'ils manquent :

1. **Hébergeur + jeton d'API.** Recommandé : **Fly.io** (CLI scriptable + Postgres managé).
   - Compte Fly.io créé (carte ajoutée, même pour le palier gratuit).
   - **`FLY_API_TOKEN` = un token de type _Org_** (Fly.io → *Tokens* / *Account → Access Tokens* →
     **Org token**, sélectionner votre org « personal »). ⚠️ **PAS un _App token_** : il est limité à
     une app existante et ne peut **ni créer l'app ni créer la base** (étape 3 échouerait). Un
     *Personal Access Token* « full » convient aussi. *Alternatives : Railway (`RAILWAY_TOKEN`), Render.*
2. **(Optionnel, pour encaisser)** Compte **Stripe** + `STRIPE_SECRET_KEY` (plus tard le `whsec_…`).
3. **(Optionnel)** Un **nom de domaine** si vous en voulez un personnalisé.

> L'agent génère lui-même `JWT_SIGNING_KEY` et le `DATABASE_URL` (via Fly Postgres).

---

## B. Étapes (agent)

### 0. Récupérer le code et valider (gate)
```bash
git clone https://github.com/teddyfrey1-droid/reoblox1.git && cd reoblox1
git checkout claude/inspiring-shannon-3ik4A     # ou main si la PR #1 est mergée
npm install
npm test                                        # DOIT afficher 101 pass / 0 fail
```
**Vérif :** `# pass 101` et `# fail 0`. Sinon, **stop** (ne pas déployer du rouge).

### 1. Générer la clé de signature des sessions
```bash
export JWT_SIGNING_KEY=$(openssl rand -hex 32)
echo "JWT_SIGNING_KEY=$JWT_SIGNING_KEY"   # à conserver précieusement (secret, stable)
```

### 2. Installer la CLI Fly et s'authentifier
```bash
curl -L https://fly.io/install.sh | sh
export FLYCTL_INSTALL="$HOME/.fly"; export PATH="$FLYCTL_INSTALL/bin:$PATH"
export FLY_API_TOKEN="<le token Org fourni par l'humain>"   # flyctl lit cette variable automatiquement
flyctl auth whoami                        # vérif : affiche l'email du compte (n'exécutez PAS `auth token`)
```

### 3. Créer l'app + la base Postgres
```bash
flyctl launch --no-deploy --copy-config --name lumora-prod --region cdg
# (le repo contient déjà un Dockerfile → Fly l'utilise. Refuser toute base proposée ici.)
flyctl postgres create --name lumora-db --region cdg --initial-cluster-size 1 --vm-size shared-cpu-1x --volume-size 1
flyctl postgres attach lumora-db --app lumora-prod   # injecte DATABASE_URL dans l'app
```
**Vérif :** `flyctl secrets list --app lumora-prod` montre `DATABASE_URL`.

### 4. Appliquer le schéma SQL à la base
```bash
# Récupère l'URL de connexion (proxy local) puis applique le schéma :
flyctl proxy 5432 -a lumora-db &           # ouvre un tunnel local vers Postgres
sleep 3
# Mot de passe/URL affichés par `postgres attach`/`postgres connect` ; sinon :
flyctl postgres connect -a lumora-db -c "$(cat db/schema.sql)"   # applique le schéma
```
*(Alternative robuste : `psql "$DATABASE_URL" -f db/schema.sql` si vous avez l'URL complète.)*
**Vérif :** `flyctl postgres connect -a lumora-db -c "\dt"` liste ~17 tables (players, wallets, lumi, …).

### 5. Poser les secrets de production + déployer
```bash
flyctl secrets set --app lumora-prod \
  NODE_ENV=production \
  JWT_SIGNING_KEY="$JWT_SIGNING_KEY" \
  TRUST_PROXY=1
flyctl deploy --app lumora-prod
```
**Vérif :** `flyctl status --app lumora-prod` → machine `started`, health check **passing**.

### 6. Vérifier que c'est EN LIGNE
```bash
APP_URL="https://lumora-prod.fly.dev"          # ou le domaine affiché par flyctl
curl -fsS "$APP_URL/api/healthz"               # {"ok":true,...}
curl -fsS -X POST "$APP_URL/api/auth/guest" -H 'content-type: application/json' -d '{}' | head -c 200
```
**Vérif (critère d'acceptation principal) :** `healthz` répond `ok:true`, et ouvrir
`$APP_URL` dans un navigateur crée un compte invité, affiche un Lumi dans **✨ Generator**,
et l'onglet **🌍 World** montre le *Great Bloom* qui monte en direct (WebSocket = WSS OK).

---

## C. Optionnel — Paiements Stripe (quand vous monétisez)
1. Stripe Dashboard → Developers → Webhooks → **Add endpoint** :
   `https://VOTRE-URL/api/webhooks/stripe`, événements `checkout.session.completed` + `payment_intent.succeeded`.
2. Copier le *Signing secret* (`whsec_…`) puis :
   ```bash
   flyctl secrets set --app lumora-prod STRIPE_WEBHOOK_SECRET=whsec_xxx
   ```
3. À la création d'un paiement (Checkout/PaymentIntent), passer `metadata.playerId` et
   `metadata.productId` (un id de `IAP_PRODUCTS`). L'octroi est **idempotent**.
**Vérif :** un paiement test crédite le joueur une seule fois (rejouer le webhook ⇒ `duplicate`).

## D. Optionnel — Domaine personnalisé
```bash
flyctl certs add app.votredomaine.com --app lumora-prod   # puis créez le CNAME indiqué
```
**Vérif :** `flyctl certs show app.votredomaine.com --app lumora-prod` → *Issued*.

---

## E. Critères d'acceptation (DONE)
- [ ] `npm test` = 101/0 avant déploiement.
- [ ] `GET /api/healthz` = `{"ok":true}` sur l'URL publique (HTTPS).
- [ ] Le prototype web charge, crée un compte invité, génère/voit des Lumi.
- [ ] WebSocket connecté (Great Bloom live, pas d'erreur console).
- [ ] La base Postgres contient les tables et **persiste** après un `flyctl apps restart lumora-prod`
      (recréer un joueur, redémarrer, le joueur existe toujours).
- [ ] `NODE_ENV=production` + `JWT_SIGNING_KEY` posés (le serveur refuse de démarrer sans la clé en prod).

## F. À NE PAS faire / limites connues (rester honnête avec l'utilisateur)
- Ne pas activer le provider IAP `test` en prod (`IAP_TEST_SECRET` non posé).
- Vérificateurs **Apple/Google réels** : non câblés (Stripe l'est) — voir `server/iap.js`.
- **Multi-instances** : garder **1 instance** pour l'instant (le temps réel et certains
  compteurs sont par-processus ; le passage à l'échelle requiert Redis — cf. `docs/11-TECH-ARCHITECTURE.md`).
  Donc : `flyctl scale count 1`.
- Client **mobile Godot** : non inclus (le prototype web suffit pour la démo/soft-launch).

> Détails et alternatives (Railway, Docker pur, VPS) : voir [`DEPLOYMENT.md`](DEPLOYMENT.md).
