# 🛢️ TankNu.nl
<img alt="deviceframes" src="https://github.com/user-attachments/assets/9e30c88b-5bcd-49ad-ab81-6eb22ec034d6" width="280" align="right" />
Lichte web-app om brandstofprijzen in (en rond) Nederland direct uit de publieke ANWB API op te vragen en overzichtelijk te tonen. Geen eigen database, geen backend die data bewaart: de browser vraagt de API aan en toont de resultaten.

Het idee is simpel: één frontend die je locatie gebruikt, een verzoek naar de ANWB API doet en je laat zien waar je het goedkoopst kunt tanken – inclusief routeknop en ondersteuning voor verschillende brandstoftypes


---

## 🧭 Overzicht

Deze applicatie doet eigenlijk maar een paar dingen, maar dan goed:

- Haalt **tankstations en prijzen** op via de brandsof-zoeker.nl API
- Vraagt deze data **direct vanuit de frontend** op (geen eigen database)
- Filtert en sorteert de resultaten in de browser op prijs en afstand
- Biedt een **snelle, simpele web-interface** met focus op “goedkoopste in de buurt”
- Integreert met Google Maps voor **navigatie naar het gekozen station**

## 🚀 Installatie

Je hebt **Docker Desktop** nodig. Of een andere Docker engine, maakt niet uit.

```bash
docker run -d \
  --name tanknu-app \
  -p 8081:8080 \
  --restart unless-stopped \
  stijn0vp/tanknu-app:latest
```

## 🔐 Privacy

De frontend vraagt om je locatie voor de "Bij mij" functie. Deze locatie:
- Wordt alleen lokaal in browser opgeslagen
- Wordt gebruikt voor API calls
- Wordt nooit persistent bewaard
- Wordt nooit gedeeld

Backend logt geen persoonlijke data. Alleen anonieme stats zoals aantal API calls en errors.

## ⚠️ Disclaimer & gebruik van API

- Dit project is niet winstgevend
- Het is bedoeld voor persoonlijk gebruik, hobby en educatie
- Er wordt geen data opgeslagen of doorverkocht
- Beperkte caching om onnodige belasting van de API te voorkomen.
- De applicatie bevat geen advertenties

Om onnodige belasting van de API te voorkomen, wordt beperkte en tijdelijke caching toegepast

Mocht het gebruik van deze API in deze vorm ongewenst zijn, of mocht er bezwaar bestaan tegen deze implementatie, dan kan er direct contact worden opgenomen via:

📧 stijnvdol@outlook.com

Bij bezwaar wordt het project aangepast of direct offline gehaald.