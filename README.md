# 🛢️ TankNu

Een volledig gecontaineriseerde applicatie om actuele brandstofprijzen in Nederland te verzamelen via de publieke ANWB API, deze gestructureerd op te slaan in een PostgreSQL-database, en via een FastAPI-backend en moderne frontend beschikbaar te maken.

De applicatie bestaat uit vier containers (ingest, API, frontend en database) en berekent automatisch gemiddelde brandstofprijzen per type, zodat gebruikers eenvoudig de goedkoopste optie in hun omgeving kunnen vinden.

---

## ⚙️ Inhoud
1. [Overzicht](#overzicht)
2. [Architectuur](#architectuur)
3. [Installatie](#installatie)
4. [Hoe het werkt](#hoe-het-werkt)
5. [API-endpoints](#api-endpoints)
6. [Database-tabellen](#database-tabellen)
7. [Logs & Troubleshooting](#logs--troubleshooting)
8. [Veelgestelde vragen](#veelgestelde-vragen)


---

## 🧭 Overzicht

Deze applicatie:
- haalt **alle tankstations in Nederland** op via de publieke **ANWB API**
- bewaart de resultaten in een **PostgreSQL-database**
- verzamelt periodiek **prijsinformatie per station**
- stelt via **FastAPI** endpoints beschikbaar waarmee je stations kunt opvragen, filteren en sorteren


## 🧩 Architectuur

De Docker Compose stack bestaat uit minimaal twee containers:

| Service | Beschrijving |
|--------:|-------------|
| **db**  | PostgreSQL database met alle stations & prijsdata |
| **app** | Python-ingester die de ANWB API afloopt en data opslaat |
| **api** | FastAPI-server die data serveert vanuit de database (optioneel) |

De services delen dezelfde database via het interne Docker-netwerk.

## 🚀 Installatie

Zorg dat je **Docker Desktop** of een andere Docker-engine hebt draaien.

1) Clone de repository

```bash
git clone https://github.com/stijnvandepol/Tanknu.nl.git
cd Tanknu.nl
```

2) (Optioneel) Pas de waardes in `.env` aan.

3) Start de stack

```bash
docker compose up --build
```

De `app` zal starten en beginnen met het ophalen van tiles en stations; de `api` is standaard op poort 8080 bereikbaar.(Is aanpasbaar in de docker-compose)

Opmerking: bij eerste run kan PostgreSQL enige tijd nodig hebben om op te starten; de ingester wacht op de DB-connectie.

## 🧠 Hoe het werkt

1. De ingester verdeelt Nederland in kleine tegels (tiles).
2. Voor elke tile vraagt de ingester stations op bij de ANWB `/fuel/stations` endpoint.
3. Gevonden stations en prijsdata worden in PostgreSQL opgeslagen in de tabellen `fuel_stations` en `fuel_station_prices`.

De ingester bevat eenvoudige retry-, rate-limiting- en circuit-breaker-logica zodat de externe API niet onnodig wordt belast.

## ⚙️ Configuratie 

- Poort 5432 (PostgreSQL) staat standaard open. Sluit deze poort in docker-compose.yml als externe toegang tot de database niet nodig is.
- Database-credentials (host, user, wachtwoord, database) worden ingesteld via het .env-bestand. Pas deze waarden aan naar je eigen voorkeur.
- Poorten aanpassen: de standaardpoorten zijn 3306 voor de database en 8080 voor de API. Je kunt deze wijzigen in docker-compose.yml als ze al in gebruik zijn.

Aantal API-verzoeken per seconde aanpassen (sneller of trager ophalen van data) kan via config.py.

## 🧭 API (kort)

Als de `api`-service draait, is de Swagger UI doorgaans beschikbaar op:

```
http://localhost:8080/docs
```

Voorbeelden van endpoints:
- `GET /stations` — alle stations
- `GET /stations/{station_id}` — details van één station
- `GET /stations/cheapest?lat={lat}&lon={lon}&radius_km={r}&fuel={type}` — goedkoopste station in straal

## Database

Belangrijke tabellen:

- `coordinate_tiles` — gegenereerde tegels (sw_lat, sw_lon, ne_lat, ne_lon, last_scanned_at)
- `fuel_stations` — station metadata (id, title, latitude, longitude, address, etc.)
- `fuel_station_prices` — prijsrecords (station_id, fuel_type, value_eur_per_l, collected_at)

Je kunt de database bereiken met een Postgres-client zoals psql, pgAdmin of TablePlus

## 🪵 Logs & Troubleshooting

Bekijk live logs:

```bash
docker compose logs -f ingest
docker compose logs -f api
docker compose logs -f db
```

Je kunt dit vereenvoudigen door gebruik te maken van Portainer.

## Veelgestelde vragen

- Waarom zie ik veel 500 responses van ANWB?  
	Dit betekent dat de externe API tijdelijk problemen heeft (server-side). De ingester zal retries proberen en activeert een korte cool-down (circuit) als er veel fouten optreden.

## Bijdragen & contact

Voor vragen kun je een issue openen in de repository.
