# Base Token Scanner Bot

Bot Telegram qui scanne les nouveaux tokens sur Base en temps réel.

## Features

- 🔍 Détecte les nouveaux tokens dès leur création de pair DEX
- 💰 Filtre par liquidité minimale
- 📊 Récupère les données depuis DEXScreener (prix, volume, liquidité)
- ⚡ Alertes Telegram en temps réel
- 🔗 Liens directs vers BaseScan et DexScreener

## Commandes

- `/start` - S'abonner aux alertes
- `/stop` - Se désabonner
- `/status` - Voir le statut du scanner
- `/config` - Voir la configuration actuelle

## Installation

```bash
cd base-scanner-bot
npm install
npm start
```

## Configuration

Éditer `.env` dans le dossier parent :

- `MIN_LIQUIDITY_USD` - Liquidité minimale pour alerter (défaut: 5000)
- `SCAN_INTERVAL_SECONDS` - Fréquence de scan (défaut: 60)

## Améliorations futures

- [ ] Multi-DEX support (Aerodrome, autres)
- [ ] Filtres avancés (holders, age du contrat, honeypot detection)
- [ ] Historique des tokens détectés
- [ ] Analyse de smart contract (mint function, owner renounced, etc.)
- [ ] Alertes par catégories (memecoins vs DeFi)
