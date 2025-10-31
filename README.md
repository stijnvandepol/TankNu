# 🛢️ TankNu.nl
<img alt="deviceframes" src="https://github.com/user-attachments/assets/9e30c88b-5bcd-49ad-ab81-6eb22ec034d6" width="280" align="right" />
Volledige applicatie om brandstofprijzen in Nederland te verzamelen, opslaan en beschikbaar maken. Alles gedockeriseerd. De data komt van de publieke ANWB API, wordt netjes in PostgreSQL gezet, en je krijgt er een FastAPI backend en moderne frontend bij.

Het idee is simpel: vier containers (ingest, API, frontend, database) die samen zorgen dat je altijd weet waar je het goedkoopst tankt. Inclusief automatische berekening van gemiddelde prijzen per brandstoftype.

---

## Wat zit erin

1. [Overzicht](#overzicht)
2. [Hoe het werkt](#hoe-het-werkt)
3. [Installatie](#installatie)
4. [Architectuur](#architectuur)
5. [API endpoints](#api-endpoints)
6. [Database structuur](#database-structuur)
7. [Configuratie](#configuratie)
8. [Troubleshooting](#troubleshooting)

---

## 🧭 Overzicht

Deze applicatie doet eigenlijk maar een paar dingen, maar dan goed:

- Haalt **alle tankstations** in Nederland op via de ANWB API
- Bewaart alles in een **PostgreSQL database**
- Verzamelt periodiek **actuele prijzen** per station  
- Stelt data beschikbaar via **FastAPI** zodat je kunt filteren en sorteren
- Toont het mooi in een **moderne web-interface** met prijsgrafieken

## 🚀 Installatie

Je hebt **Docker Desktop** nodig. Of een andere Docker engine, maakt niet uit.

**Stap 1:** Clone de repository

```bash
git clone https://github.com/stijnvandepol/Tanknu.git
cd Tanknu
```

**Stap 2:** Pas eventueel het `.env` bestand aan

Je kunt hier credentials wijzigen.

```bash
POSTGRES_HOST=db
POSTGRES_PASSWORD=Wachtwoord
POSTGRES_DB=fueldata
POSTGRES_USER=dbuser

DISCORD_WEBHOOK=
```

**Stap 3:** Start de docker stack

```bash
docker compose up --build
```

De `app` begint meteen met ophalen van stations. De `api` is standaard op poort 8080. De `frontend` op poort 80 (of wat je hebt ingesteld).

Let op: PostgreSQL heeft even nodig om op te starten bij eerste run. De ingester wacht keurig tot de database bereikbaar is.

## 🧠 Hoe het werkt

Het systeem is opgebouwd uit meerdere lagen:

### Data verzamelen
1. De ingester verdeelt Nederland in kleine tegels (tiles)
2. Voor elke tile vraagt hij stations op bij ANWB
3. Gevonden stations en prijzen gaan in de database

### Data serveren
De FastAPI backend haalt alles uit PostgreSQL en biedt endpoints aan voor:
- Stations in je buurt zoeken
- Goedkoopste prijzen vinden
- Gemiddelde prijzen per brandstoftype
- Historische prijsdata voor grafieken

### Data tonen
De frontend (vanilla JavaScript, geen frameworks) haalt data op via de API en toont:
- **Bij mij:** Goedkoopste stations in jouw buurt op basis van je locatie
- **Landelijk:** Absolute top prijzen in heel Nederland
- **Prijsdata:** Actuele gemiddelden  trend visualisatie

Plus directe Google Maps integratie voor routes naar stations.

## 🧩 Architectuur

De Docker Compose stack bestaat uit vier containers:

| Service | Wat doet ie |
|--------:|-------------|
| **db** | PostgreSQL database met stations & prijsdata |
| **app** | Python ingester die de ANWB API afloopt |
| **api** | FastAPI server die data serveert |
| **frontend** | Nginx met de TankNu web interface |

Ze delen een intern Docker netwerk. Frontend praat met API via reverse proxy. API praat met database. Ingester vult database.

## ⚙️ API endpoints (kort)

Als de API draait, vind je de Swagger UI op:

```
http://localhost:8080/docs
```

Belangrijkste endpoints:

**Stations zoeken**
```
GET /stations/nearby?lat={lat}&lon={lon}&radius_km={r}
GET /stations/cheapest?lat={lat}&lon={lon}&radius_km={r}&fuel_type={type}
GET /stations/search?city={city}&brand={brand}
GET /stations/{station_id}
```

**Prijsdata**
```
GET /avg-prices/latest
GET /avg-prices/history?fuel_type={type}
```

**Health & Stats**
```
GET /health
GET /stations/count
```

## 📊 Database structuur

Drie belangrijke tabellen:

**coordinate_tiles**
Gegenereerde tegels voor het scannen van Nederland – bevat coördinaten (sw_lat, sw_lon, ne_lat, ne_lon) en wanneer een tile voor het laatst is gescand.

**fuel_stations**  
Alle tankstation metadata: ID, naam, coördinaten, adres, postcode, stad, land. Basically alles wat je over een station moet weten behalve de prijzen.

**fuel_station_prices**
De prijsrecords zelf – station_id, fuel_type, prijs per liter, currency, wanneer het is opgehaald. Hier zit de tijdreeksdata in voor de grafieken.

**avg_fuel_prices** *(nieuw)*
Voorberekende gemiddelden per brandstoftype – wordt gebruikt voor de prijsdata tab in de frontend. Scheelt enorm veel rekenwerk bij elke request.

Je kunt de database bereiken met psql, pgAdmin, TablePlus of wat je maar wilt. Credentials staan in je `.env` file.

## 🔧 Configuratie

Een paar dingen die je waarschijnlijk wilt aanpassen:

### Poorten
Standaard:
- Database: 5432
- API: 8080
- Frontend: 8080

Aanpassen kan in `docker-compose.yml`.

### Frontend
De frontend verwacht de API op `/api` – dit is geconfigureerd via Nginx reverse proxy. Als je API op een andere poort draait, pas dan `nginx.conf` aan in de frontend container.

## 🪵 Logs & Troubleshooting

**Live logs bekijken:**

```bash
docker compose logs -f app
docker compose logs -f api
docker compose logs -f frontend
docker compose logs -f db
```

Of gebruik Portainer als je visueel werkt.

### Veelvoorkomende problemen

**"Veel 500 responses van ANWB"**
De externe API heeft tijdelijk problemen (hun kant). De ingester probeert het opnieuw en schakelt circuit breaker in bij veel fouten. Gewoon even geduld.

**"Frontend laadt maar API werkt niet"**
Check of de reverse proxy goed is ingesteld. De frontend verwacht `/api` te bereiken. Test met:
```bash
curl http://localhost:8080/health
```
**"Locatie werkt niet in frontend"**
Moet HTTPS zijn (of localhost). Browsers geven alleen op veilige verbindingen locatie-toegang. Voor development is localhost prima.

## 📱 Browser support

Frontend werkt op:
- Chrome
- Firefox 
- Safari
- Edge

## 🔐 Privacy

De frontend vraagt om je locatie voor de "Bij mij" functie. Deze locatie:
- Wordt alleen lokaal in browser opgeslagen
- Wordt gebruikt voor API calls
- Wordt nooit persistent bewaard
- Wordt nooit gedeeld

Backend logt geen persoonlijke data. Alleen anonieme stats zoals aantal API calls en errors.
