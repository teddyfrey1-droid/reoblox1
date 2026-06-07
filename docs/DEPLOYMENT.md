# 🚀 Mettre LUMORA en ligne — guide pas à pas

Ce guide met en ligne **le serveur LUMORA** (API + prototype web jouable). Le client
mobile (Godot) est sur la *roadmap* ; ce qui se déploie ici est le backend + le prototype
navigateur, qui suffit pour une démo publique / un *soft launch* technique.

> Pré-requis : un compte sur un hébergeur (Render / Railway / Fly.io / un VPS), `git`,
> et — en local — Node ≥ 20. Le serveur écoute en HTTP ; **mettez-le derrière un proxy
> TLS** (l'hébergeur le fait en général pour vous), ce qui gère aussi `wss://` (WebSocket).

---

## 0. Vérifier en local (2 min)

```bash
git clone <repo> && cd reoblox1
npm install          # installe pg + ws (optionnels) ; pglite (dev) pour les tests
npm test             # 101 tests doivent passer
npm start            # http://localhost:8787 — ouvrez-le, onglet ✨ Generator
```

## 1. Générer les secrets

```bash
openssl rand -hex 32   # → JWT_SIGNING_KEY (clé de signature des jetons, STABLE)
```
Gardez cette clé secrète et **identique entre tous les redémarrages/instances** (sinon les
sessions sont invalidées). En prod, le serveur **refuse de démarrer** sans elle.

## 2. Provisionner PostgreSQL (durabilité)

1. Créez une base Postgres managée (Render/Railway/Neon/Supabase/RDS…). Récupérez son
   `DATABASE_URL` (`postgres://user:pass@host:5432/lumora`).
2. Appliquez le schéma :
   ```bash
   psql "$DATABASE_URL" -f db/schema.sql
   ```
   (Au premier démarrage, le serveur applique aussi le schéma s'il est absent.)

> Sans `DATABASE_URL`, le serveur tourne en **mémoire** (les données sont perdues au
> redémarrage) — pratique pour une démo jetable, **pas** pour de vrais joueurs.

## 3. Déployer (le plus simple : Docker)

Un `Dockerfile` est fourni. La plupart des PaaS détectent le `Dockerfile` automatiquement.

**Option A — PaaS (recommandé : Render/Railway/Fly).**
1. Connectez le dépôt à l'hébergeur, sélectionnez « Deploy from Dockerfile ».
2. Renseignez les variables d'environnement (section 4).
3. Déployez. L'hébergeur fournit l'URL HTTPS + le proxy TLS.

**Option B — Docker manuel (VPS).**
```bash
docker build -t lumora .
docker run -d --name lumora -p 80:8787 \
  -e NODE_ENV=production \
  -e JWT_SIGNING_KEY=xxxxxxxx \
  -e DATABASE_URL=postgres://... \
  -e TRUST_PROXY=1 \
  lumora
```
(Placez un reverse-proxy TLS — Caddy/Nginx/Traefik — devant pour le HTTPS + WSS.)

**Option C — sans Docker.** `npm install --omit=dev && NODE_ENV=production node server/index.js`
sous un superviseur (systemd / pm2).

## 4. Variables d'environnement

| Variable | Requis | Rôle |
|---|---|---|
| `JWT_SIGNING_KEY` | **Oui (prod)** | Signature des jetons de session (32 octets hex stables) |
| `DATABASE_URL` | Recommandé | Postgres durable (sinon mémoire) |
| `PORT` | Non (8787) | Port d'écoute |
| `NODE_ENV` | **`production`** | Active les garde-fous prod |
| `TRUST_PROXY` | Oui derrière un LB | `1` → le rate-limit lit la vraie IP via `X-Forwarded-For` |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_SENSITIVE_MAX` | Non | Limites de débit (défaut 300 / 30 par min/IP) |
| `STRIPE_WEBHOOK_SECRET` | Si Stripe | Active `POST /api/webhooks/stripe` |
| `IAP_TEST_SECRET` | **Non en prod** | N'activez le provider IAP `test` qu'en dev |

## 5. Paiements (optionnel, quand vous monétisez)

**Stripe (web shop)** :
1. Dans le dashboard Stripe → Developers → Webhooks → *Add endpoint* :
   `https://VOTRE-DOMAINE/api/webhooks/stripe`, événements
   `checkout.session.completed` et `payment_intent.succeeded`.
2. Copiez le *Signing secret* (`whsec_…`) dans `STRIPE_WEBHOOK_SECRET`.
3. À la création du paiement (Checkout/PaymentIntent), passez `metadata.playerId` et
   `metadata.productId` (un id de `IAP_PRODUCTS`). L'octroi est **idempotent**.

**Apple / Google (mobile)** : branchez un *transport* réel sur l'interface déjà en place
(`createIapVerifier({ transport })`, voir `server/iap.js`) — App Store Server API / Play
Developer API. Tant que ce n'est pas câblé, ces plateformes répondent `501`.

## 6. Domaine, TLS, WebSocket

- Pointez votre domaine vers l'hébergeur (DNS A/CNAME).
- TLS : géré par le PaaS, ou via Caddy/Nginx en Option B. Le temps réel passe par le même
  domaine en `wss://VOTRE-DOMAINE/ws?token=…` (aucune config supplémentaire si le proxy
  transmet l'`Upgrade` WebSocket — c'est le défaut sur Render/Railway/Fly).

## 7. Smoke test en production

```bash
BASE=https://VOTRE-DOMAINE
curl -s $BASE/api/healthz                       # {"ok":true,...}
curl -s -X POST $BASE/api/auth/guest -H 'content-type: application/json' -d '{}' | head -c 200
# Ouvrez $BASE dans un navigateur : un compte invité se crée, l'onglet World montre
# le Great Bloom qui monte en direct (WebSocket).
```

## 8. Exploitation & montée en charge

- **Logs/متriques** : surveillez les 5xx, la latence, le *crash-free*. Le grand-livre
  économique (`economy_ledger`) alimente le ratio *faucet/sink* (cf. `docs/07-ECONOMY.md`).
- **Sauvegardes** : activez les backups *point-in-time* de Postgres.
- **Multi-instances** (à l'échelle) : deux limites connues, documentées dans
  `docs/11-TECH-ARCHITECTURE.md` — (a) le *fan-out* temps réel et le compteur Great Bloom
  sont par-processus → ajouter **Redis** (pub/sub + INCR) ; (b) écritures concurrentes sur
  le **même** joueur en dernier-écrivain-gagne → verrouillage de ligne / concurrence
  optimiste. Un achat n'est **jamais** crédité deux fois (réservation atomique de reçu).

## 9. CI/CD

Le workflow `.github/workflows/ci.yml` exécute, à chaque push : la suite de tests (101),
le lint, la validation du schéma SQL, la galerie et la simulation d'équilibrage. Branchez
le déploiement automatique de votre PaaS sur la branche principale après *CI verte*.

## 10. Limites connues avant un vrai lancement grand public

- Client **mobile Godot** : à produire (le prototype web sert pour la démo/soft-launch).
- Vérificateurs **Apple/Google réseau** : transport à câbler (Stripe est complet).
- **Redis** pour le temps réel multi-instances + concurrence par joueur.
- **Clearance de marque** « LUMORA/Lumi » avant tout marketing (cf. `docs/01-STRATEGY.md`).
