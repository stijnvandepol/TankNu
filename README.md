# 🛢️ TankNu.nl
<img alt="deviceframes" src="https://github.com/user-attachments/assets/9e30c88b-5bcd-49ad-ab81-6eb22ec034d6" width="280" align="right" />
Lichte web-app om brandstofprijzen in (en rond) Nederland direct uit de publieke ANWB API op te vragen en overzichtelijk te tonen. Geen eigen database, geen backend die data bewaart: de browser vraagt de API aan en toont de resultaten.

Het idee is simpel: één frontend die je locatie gebruikt, een verzoek naar de ANWB API doet en je laat zien waar je het goedkoopst kunt tanken – inclusief routeknop en ondersteuning voor verschillende brandstoftypes


---

## 🧭 Overzicht

Deze applicatie doet eigenlijk maar een paar dingen, maar dan goed:

- Haalt **tankstations en prijzen** op via de publieke ANWB API
- Vraagt deze data **direct vanuit de frontend** op (geen eigen opslag)
- Filtert en sorteert de resultaten in de browser op prijs en afstand
- Biedt een **snelle, simpele web-interface** met focus op “goedkoopste in de buurt”
- Integreert met Google Maps voor **navigatie naar het gekozen station**

## 🚀 Installatie

Je hebt **Docker Desktop** nodig. Of een andere Docker engine, maakt niet uit.

**Stap 1:** Clone de repository

```bash
git clone https://github.com/stijnvandepol/TankNu.git
cd Tanknu-lite
```

**Stap 3:** Start de docker stack

```bash
docker compose up --build
```

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
